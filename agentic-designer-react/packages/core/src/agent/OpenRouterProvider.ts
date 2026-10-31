// Ported 1:1 from AgenticDesigner/Agent/OpenRouterProvider.swift

import { getPlatform } from '../platform';
import { newUUID } from '../models/uuid';
import type { JSONObject, JSONValue } from '../models/JSON';
import {
  decodeDesignAgentResponse,
  decodeLossyDesignActions,
  type DesignAction,
  type DesignAgentResponse,
} from './DesignAction';
import { AIProviderError, type AIProvider } from './AIProvider';
import { OpenRouterConfiguration } from './OpenRouterConfiguration';
import {
  ModelProviderCatalog,
  routeResolvedKey,
  type ModelProviderRoute,
} from './ModelProviderCatalog';
import {
  decodeBase64,
  fetchWithTimeout,
  isTimeoutError,
  type AgentFetch,
} from './http';
import { getLocalBridges } from '../platform/LocalBridges';

// MARK: - Turn results

/**
 * Result of one function-calling turn: either the model wants tools run, or
 * it produced its final text.
 */
export type AgentToolTurn =
  | { kind: 'text'; text: string }
  | { kind: 'toolCalls'; toolCalls: OpenRouterMessageToolCall[]; assistantText?: string };

export interface AgentToolUsage {
  promptTokens: number;
  completionTokens: number;
  costUSD?: number;
}

export interface AgentToolTurnResult {
  turn: AgentToolTurn;
  usage?: AgentToolUsage;
}

// MARK: - Wire messages

export interface OpenRouterMessage {
  role: string;
  content: string;
  imageDataURLs?: string[];
  // Function-calling round trip (the agent tool loop): an assistant message
  // that requested tools echoes them back via `toolCalls`; a "tool" role
  // message carries the result for `toolCallId`.
  toolCallId?: string;
  toolCalls?: OpenRouterMessageToolCall[];
}

export function makeOpenRouterMessage(
  role: string,
  content: string,
  options: { imageDataURLs?: string[]; toolCallId?: string; toolCalls?: OpenRouterMessageToolCall[] } = {},
): OpenRouterMessage {
  const message: OpenRouterMessage = { role, content };
  if (options.imageDataURLs !== undefined) message.imageDataURLs = options.imageDataURLs;
  if (options.toolCallId !== undefined) message.toolCallId = options.toolCallId;
  if (options.toolCalls !== undefined) message.toolCalls = options.toolCalls;
  return message;
}

/**
 * One requested function call, in OpenAI/OpenRouter wire shape:
 * {"id","type":"function","function":{"name","arguments"}} — `arguments` is a
 * JSON string. Decoding tolerates providers (some Ollama builds) that send
 * `arguments` as a raw object instead of a string.
 */
export interface OpenRouterMessageToolCall {
  id: string;
  name: string;
  arguments: string;
  /**
   * Opaque provider-specific payload that came back with this tool call and
   * MUST be echoed on the next turn. Gemini puts a `thought_signature`
   * here and rejects the follow-up request without it:
   *   400 "Function call is missing a thought_signature in functionCall
   *        parts. This is required for tools to work correctly."
   */
  extraContentJSON?: string;
}

export function makeOpenRouterMessageToolCall(
  id: string,
  name: string,
  args: string,
  extraContentJSON?: string,
): OpenRouterMessageToolCall {
  const call: OpenRouterMessageToolCall = { id, name, arguments: args };
  if (extraContentJSON !== undefined) call.extraContentJSON = extraContentJSON;
  return call;
}

// MARK: - Decoding helpers (mirroring Swift's Codable behaviour)

type DecodeErrorKind = 'dataCorrupted' | 'keyNotFound' | 'typeMismatch' | 'valueNotFound';

export class ResponseDecodingError extends Error {
  constructor(
    readonly kind: DecodeErrorKind,
    readonly debugDescription: string,
    readonly codingPath: string[],
    readonly typeName = '',
    readonly key = '',
  ) {
    super(debugDescription);
    this.name = 'ResponseDecodingError';
  }
}

function codingPathDescription(codingPath: string[]): string {
  return codingPath.length === 0 ? 'root' : codingPath.join('.');
}

/** `decodingDebugMessage(_:)` */
export function decodingDebugMessage(error: unknown): string {
  if (error instanceof ResponseDecodingError) {
    const path = codingPathDescription(error.codingPath);
    switch (error.kind) {
      case 'dataCorrupted':
        return `${error.debugDescription} at ${path}`;
      case 'keyNotFound':
        return `Missing key '${error.key}' at ${path}`;
      case 'typeMismatch':
        return `Type mismatch for ${error.typeName}: ${error.debugDescription} at ${path}`;
      case 'valueNotFound':
        return `Missing value for ${error.typeName}: ${error.debugDescription} at ${path}`;
    }
  }
  return (error as Error)?.message ?? String(error);
}

function describeValue(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  switch (typeof value) {
    case 'object': return 'a dictionary';
    case 'string': return 'a string/data';
    case 'number': return 'a number';
    case 'boolean': return 'a boolean';
    default: return 'null';
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `decoder.container(keyedBy:)` */
function keyedContainer(value: unknown, path: string[], typeName: string): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new ResponseDecodingError(
      'typeMismatch',
      `Expected to decode Dictionary<String, Any> but found ${describeValue(value)} instead.`,
      path,
      typeName,
    );
  }
  return value;
}

/** `container.decodeIfPresent(String.self, forKey:)` */
function decodeIfPresentString(
  container: Record<string, unknown>,
  key: string,
  path: string[],
): string | undefined {
  const value = container[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new ResponseDecodingError(
      'typeMismatch',
      `Expected to decode String but found ${describeValue(value)} instead.`,
      [...path, key],
      'String',
    );
  }
  return value;
}

function decodeIfPresentInt(container: Record<string, unknown>, key: string, path: string[]): number | undefined {
  const value = container[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new ResponseDecodingError(
      'typeMismatch',
      `Expected to decode Int but found ${describeValue(value)} instead.`,
      [...path, key],
      'Int',
    );
  }
  return value;
}

function decodeIfPresentDouble(container: Record<string, unknown>, key: string, path: string[]): number | undefined {
  const value = container[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number') {
    throw new ResponseDecodingError(
      'typeMismatch',
      `Expected to decode Double but found ${describeValue(value)} instead.`,
      [...path, key],
      'Double',
    );
  }
  return value;
}

/**
 * `struct JSONFragment` — decodes any JSON value and preserves it as a compact
 * JSON string, so opaque provider payloads survive a round trip.
 */
export function jsonFragmentRawJSON(value: unknown): string {
  if (isPlainObject(value) || Array.isArray(value)) {
    try {
      return JSON.stringify(value) ?? '{}';
    } catch {
      return '{}';
    }
  }
  return '{}';
}

/** `private struct OpenRouterContentPart` */
interface OpenRouterContentPart {
  type?: string;
  text?: string;
  content?: string;
}

function decodeContentPartArray(value: unknown[]): OpenRouterContentPart[] | undefined {
  const parts: OpenRouterContentPart[] = [];
  for (const item of value) {
    if (!isPlainObject(item)) return undefined;
    const part: OpenRouterContentPart = {};
    if (typeof item.type === 'string') part.type = item.type;
    else if (item.type !== undefined && item.type !== null) return undefined;
    if (typeof item.text === 'string') part.text = item.text;
    else if (item.text !== undefined && item.text !== null) return undefined;
    if (typeof item.content === 'string') part.content = item.content;
    else if (item.content !== undefined && item.content !== null) return undefined;
    parts.push(part);
  }
  return parts;
}

/** `private struct FlexibleOpenRouterContentValue` */
export function flexibleOpenRouterContentValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const parts = decodeContentPartArray(value);
    if (parts) {
      const joined = parts
        .map((part) => part.text ?? part.content)
        .filter((text): text is string => text !== undefined)
        .join('\n')
        .trim();
      return joined.length === 0 ? null : joined;
    }
    return serializedJSONString(value.map((item) => flexibleJSONObject(item)));
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return swiftNumberString(value);
  if (isPlainObject(value)) {
    const mapped: Record<string, JSONValue> = {};
    for (const [key, inner] of Object.entries(value)) mapped[key] = flexibleJSONObject(inner);
    return serializedJSONString(mapped);
  }
  return null;
}

function flexibleJSONObject(value: unknown): JSONValue {
  const stringValue = flexibleOpenRouterContentValue(value);
  return stringValue === null ? null : stringValue;
}

/** `Int` prints without a fraction, `Double` always with one (Swift semantics). */
function swiftNumberString(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(value);
}

function serializedJSONString(object: JSONValue): string | null {
  try {
    return JSON.stringify(sortedKeysJSON(object));
  } catch {
    return null;
  }
}

function sortedKeysJSON(value: JSONValue): JSONValue {
  if (Array.isArray(value)) return value.map((item) => sortedKeysJSON(item));
  if (isPlainObject(value)) {
    const out: Record<string, JSONValue> = {};
    for (const key of Object.keys(value).sort()) out[key] = sortedKeysJSON((value as JSONObject)[key]!);
    return out;
  }
  return value;
}

/** `OpenRouterMessageToolCall.init(from:)` */
export function decodeOpenRouterMessageToolCall(value: unknown, path: string[]): OpenRouterMessageToolCall {
  const container = keyedContainer(value, path, 'OpenRouterMessageToolCall');
  const id = decodeIfPresentString(container, 'id', path) ?? newUUID();
  if (container.function === undefined || container.function === null) {
    throw new ResponseDecodingError('keyNotFound', 'No value associated with key function', path, '', 'function');
  }
  const fn = keyedContainer(container.function, [...path, 'function'], 'OpenRouterMessageToolCall');
  if (fn.name === undefined || fn.name === null) {
    throw new ResponseDecodingError('keyNotFound', 'No value associated with key name', [...path, 'function'], '', 'name');
  }
  if (typeof fn.name !== 'string') {
    throw new ResponseDecodingError(
      'typeMismatch',
      `Expected to decode String but found ${describeValue(fn.name)} instead.`,
      [...path, 'function', 'name'],
      'String',
    );
  }
  let args: string;
  if (typeof fn.arguments === 'string') {
    args = fn.arguments;
  } else if (fn.arguments !== undefined && fn.arguments !== null) {
    args = jsonFragmentRawJSON(fn.arguments);
  } else {
    args = '{}';
  }
  const extra = container.extra_content;
  const call: OpenRouterMessageToolCall = { id, name: fn.name, arguments: args };
  if (extra !== undefined && extra !== null) call.extraContentJSON = jsonFragmentRawJSON(extra);
  return call;
}

/** `OpenRouterMessageToolCall.encode(to:)` */
export function encodeOpenRouterMessageToolCall(call: OpenRouterMessageToolCall): JSONObject {
  const encoded: JSONObject = {
    id: call.id,
    type: 'function',
    function: { name: call.name, arguments: call.arguments },
  };
  // Re-emit the provider's opaque blob byte-for-byte.
  if (call.extraContentJSON) {
    try {
      encoded.extra_content = JSON.parse(call.extraContentJSON) as JSONValue;
    } catch {
      /* not valid JSON: Swift silently skips it too */
    }
  }
  return encoded;
}

/** `OpenRouterMessage.init(from:)` */
export function decodeOpenRouterMessage(value: unknown, path: string[] = []): OpenRouterMessage {
  const container = keyedContainer(value, path, 'OpenRouterMessage');
  if (typeof container.role !== 'string') {
    throw new ResponseDecodingError(
      'typeMismatch',
      `Expected to decode String but found ${describeValue(container.role)} instead.`,
      [...path, 'role'],
      'String',
    );
  }
  const message: OpenRouterMessage = {
    role: container.role,
    content: typeof container.content === 'string' ? container.content : '',
    imageDataURLs: [],
  };
  const toolCallId = container.tool_call_id;
  if (typeof toolCallId === 'string') message.toolCallId = toolCallId;
  const rawToolCalls = container.tool_calls;
  if (Array.isArray(rawToolCalls)) {
    try {
      message.toolCalls = rawToolCalls.map((item, index) =>
        decodeOpenRouterMessageToolCall(item, [...path, 'tool_calls', String(index)]),
      );
    } catch {
      /* `try?` in Swift */
    }
  }
  return message;
}

/** `OpenRouterMessage.encode(to:)` */
export function encodeOpenRouterMessage(message: OpenRouterMessage): JSONObject {
  const encoded: JSONObject = { role: message.role };
  if (message.toolCallId !== undefined) encoded.tool_call_id = message.toolCallId;
  if (message.toolCalls && message.toolCalls.length > 0) {
    encoded.tool_calls = message.toolCalls.map(encodeOpenRouterMessageToolCall);
  }
  const images = message.imageDataURLs ?? [];
  if (images.length === 0) {
    encoded.content = message.content;
    return encoded;
  }
  const parts: JSONValue[] = [{ type: 'text', text: message.content }];
  for (const url of images) parts.push({ type: 'image_url', image_url: { url } });
  encoded.content = parts;
  return encoded;
}

// MARK: - Response decoding

interface OpenRouterResponseMessage {
  role?: string;
  content?: string;
  toolCalls?: OpenRouterMessageToolCall[];
}

interface OpenRouterChoice {
  message?: OpenRouterResponseMessage;
  delta?: OpenRouterResponseMessage;
  text?: string;
  directContent?: string;
}

interface OpenRouterUsage {
  promptTokens?: number;
  completionTokens?: number;
  cost?: number;
}

export interface OpenRouterChatResponse {
  choices?: OpenRouterChoice[];
  error?: { message: string };
  usage?: OpenRouterUsage;
}

function decodeResponseMessage(value: unknown, path: string[]): OpenRouterResponseMessage {
  const container = keyedContainer(value, path, 'OpenRouterResponseMessage');
  const message: OpenRouterResponseMessage = {};
  const role = decodeIfPresentString(container, 'role', path);
  if (role !== undefined) message.role = role;
  const content = flexibleOpenRouterContentValue(container.content);
  if (content !== null) message.content = content;
  const rawToolCalls = container.tool_calls;
  if (Array.isArray(rawToolCalls)) {
    try {
      message.toolCalls = rawToolCalls.map((item, index) =>
        decodeOpenRouterMessageToolCall(item, [...path, 'tool_calls', String(index)]),
      );
    } catch {
      /* `try?` in Swift */
    }
  }
  return message;
}

function decodeChoice(value: unknown, path: string[]): OpenRouterChoice {
  const container = keyedContainer(value, path, 'OpenRouterChoice');
  const choice: OpenRouterChoice = {};
  if (container.message !== undefined && container.message !== null) {
    choice.message = decodeResponseMessage(container.message, [...path, 'message']);
  }
  if (container.delta !== undefined && container.delta !== null) {
    choice.delta = decodeResponseMessage(container.delta, [...path, 'delta']);
  }
  const text = decodeIfPresentString(container, 'text', path);
  if (text !== undefined) choice.text = text;
  const directContent = decodeIfPresentString(container, 'content', path);
  if (directContent !== undefined) choice.directContent = directContent;
  return choice;
}

/** `OpenRouterChoice.content` */
export function choiceContent(choice: OpenRouterChoice): string | undefined {
  return choice.message?.content ?? choice.delta?.content ?? choice.text ?? choice.directContent;
}

/** `OpenRouterChoice.toolCalls` */
export function choiceToolCalls(choice: OpenRouterChoice): OpenRouterMessageToolCall[] {
  return choice.message?.toolCalls ?? choice.delta?.toolCalls ?? [];
}

function decodeUsage(value: unknown, path: string[]): OpenRouterUsage {
  const container = keyedContainer(value, path, 'OpenRouterUsage');
  const usage: OpenRouterUsage = {};
  try {
    const promptTokens = decodeIfPresentInt(container, 'prompt_tokens', path);
    if (promptTokens !== undefined) usage.promptTokens = promptTokens;
  } catch {
    /* `try?` */
  }
  try {
    const completionTokens = decodeIfPresentInt(container, 'completion_tokens', path);
    if (completionTokens !== undefined) usage.completionTokens = completionTokens;
  } catch {
    /* `try?` */
  }
  let cost: number | undefined;
  try {
    cost = decodeIfPresentDouble(container, 'cost', path);
  } catch {
    cost = undefined;
  }
  if (cost === undefined) {
    const stringCost = typeof container.cost === 'string' ? Number(container.cost) : undefined;
    cost = stringCost !== undefined && Number.isFinite(stringCost) ? stringCost : undefined;
  }
  if (cost !== undefined) usage.cost = cost;
  return usage;
}

/** `private struct OpenRouterAPIError` */
function decodeAPIError(value: unknown, path: string[]): { message: string } {
  if (typeof value === 'string') return { message: value };
  const container = keyedContainer(value, path, 'OpenRouterAPIError');
  const message = flexibleOpenRouterContentValue(container.message);
  const code = flexibleOpenRouterContentValue(container.code);
  const joined = [message, code === null ? null : `code: ${code}`]
    .filter((part): part is string => part !== null)
    .join(' ');
  return { message: joined };
}

/** `JSONDecoder().decode(OpenRouterChatResponse.self, from:)` */
export function decodeOpenRouterChatResponse(value: unknown): OpenRouterChatResponse {
  const container = keyedContainer(value, [], 'OpenRouterChatResponse');
  const response: OpenRouterChatResponse = {};
  const rawChoices = container.choices;
  if (rawChoices !== undefined && rawChoices !== null) {
    if (!Array.isArray(rawChoices)) {
      throw new ResponseDecodingError(
        'typeMismatch',
        `Expected to decode Array<Any> but found ${describeValue(rawChoices)} instead.`,
        ['choices'],
        'Array<OpenRouterChoice>',
      );
    }
    response.choices = rawChoices.map((item, index) => decodeChoice(item, ['choices', String(index)]));
  }
  if (container.error !== undefined && container.error !== null) {
    response.error = decodeAPIError(container.error, ['error']);
  }
  if (container.usage !== undefined && container.usage !== null) {
    response.usage = decodeUsage(container.usage, ['usage']);
  }
  return response;
}

// MARK: - Provider

function charCount(text: string): number {
  return Array.from(text).length;
}

function prefixString(text: string, count: number): string {
  return Array.from(text).slice(0, count).join('');
}

/** `String.jsonEscaped` */
function jsonEscaped(text: string): string {
  return text
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')
    .replaceAll('\t', '\\t');
}

export interface OpenRouterProviderOptions {
  /** Route provider HTTP through a custom implementation (web: `POST /proxy`). */
  fetchImpl?: AgentFetch;
}

export class OpenRouterProvider implements AIProvider {
  readonly apiKey: string;
  readonly model: string;
  readonly temperature: number;
  private readonly fetchImpl?: AgentFetch;

  private readonly imageEndpoint = 'https://openrouter.ai/api/v1/images';

  constructor(apiKey: string, model: string, temperature = 0.35, options: OpenRouterProviderOptions = {}) {
    this.apiKey = apiKey;
    this.model = model;
    this.temperature = temperature;
    if (options.fetchImpl) this.fetchImpl = options.fetchImpl;
  }

  // A model id carries its own provider: "local/qwen3-vl:32b" runs on Ollama,
  // "cerebras/…" and "gemini/…" hit those vendors' free tiers directly, and a
  // bare "vendor/model" is an OpenRouter id. See ModelProviderCatalog.
  private get route(): ModelProviderRoute {
    return ModelProviderCatalog.route(this.model);
  }
  private get isLocalModel(): boolean {
    return this.route.id === ModelProviderCatalog.localId;
  }
  private get resolvedModelName(): string {
    return ModelProviderCatalog.upstreamModelName(this.model);
  }
  private get endpoint(): string {
    return this.route.chatEndpoint;
  }
  /** The route's own key wins: an OpenRouter key must not be sent to Cerebras. */
  private get effectiveKey(): string {
    return routeResolvedKey(this.route) ?? this.apiKey;
  }

  // MARK: Learned ceilings (statics)

  /**
   * Hard PROMPT ceiling this account is subject to, learned the first time
   * OpenRouter rejects a turn for it. undefined until something gets rejected.
   */
  static learnedPromptTokenCeiling: number | undefined;
  /** Output reservation this balance can actually afford, learned from a 402. */
  static learnedOutputTokenCeiling: number | undefined;

  static resetLearnedTokenCeilings(): void {
    OpenRouterProvider.learnedPromptTokenCeiling = undefined;
    OpenRouterProvider.learnedOutputTokenCeiling = undefined;
  }

  /**
   * Distinguishes an exhausted allowance from a momentary rate limit.
   * Google says "You exceeded your current quota"; OpenRouter says
   * "rate-limited upstream" / "daily limit"; a plain per-minute throttle
   * usually says "too many requests" and IS worth retrying.
   */
  static isQuotaExhausted(message: string): boolean {
    const text = message.toLowerCase();
    // "free-models-per-day" is OpenRouter's daily cap and contains no
    // "quota" at all — matching only on that word missed it entirely.
    const exhausted = ['exceeded your current quota', 'quota exceeded', 'insufficient_quota',
      'daily limit', 'out of credits', 'exhausted',
      'per-day', 'per day', 'daily quota'];
    if (exhausted.some((needle) => text.includes(needle))) return true;
    // "quota" alone counts only when it isn't phrased as a short throttle.
    return text.includes('quota') && !text.includes('per minute') && !text.includes('try again in');
  }

  /** Parses `Prompt tokens limit exceeded: 17434 > 15878`. */
  static parsePromptTokenLimit(message: string): { actual: number; limit: number } | undefined {
    if (!message.toLowerCase().includes('prompt tokens limit')) return undefined;
    const numbers = message
      .split(/[^0-9]+/)
      .filter((part) => part.length > 0)
      .map((part) => Number.parseInt(part, 10))
      .filter((value) => Number.isFinite(value));
    if (numbers.length < 2) return undefined;
    return { actual: numbers[0]!, limit: numbers[1]! };
  }

  /**
   * Parses OpenRouter's 402 message ("...can only afford 3121...") so the
   * retry asks for what the balance actually covers.
   */
  static affordableTokens(message: string): number | undefined {
    const index = message.indexOf('afford');
    if (index < 0) return undefined;
    const tail = message.slice(index + 'afford'.length);
    const digits = tail.replace(/^[^0-9]*/, '').match(/^[0-9]+/)?.[0];
    if (!digits) return undefined;
    const value = Number.parseInt(digits, 10);
    return Number.isFinite(value) ? value : undefined;
  }

  /**
   * Anthropic allows up to 4 breakpoints; everything BEFORE a breakpoint is
   * cached. Two are enough here: the system prompt and the settled head of the
   * conversation, leaving the newest exchanges live.
   */
  static markingCacheBreakpoints(messages: JSONObject[]): JSONObject[] {
    const result = [...messages];
    const breakpoints: number[] = [];

    let systemIndex = -1;
    for (let i = result.length - 1; i >= 0; i--) {
      if (result[i]!.role === 'system') { systemIndex = i; break; }
    }
    if (systemIndex >= 0) breakpoints.push(systemIndex);
    // Everything except the two newest messages counts as settled history.
    const settledEnd = result.length - 3;
    const last = breakpoints.length > 0 ? breakpoints[breakpoints.length - 1]! : -1;
    if (settledEnd > last) breakpoints.push(settledEnd);

    for (const index of breakpoints) {
      if (index >= 0 && index < result.length) result[index] = markedForCaching(result[index]!);
    }
    return result;
  }

  /**
   * Only Anthropic requires caller-placed breakpoints; other providers on
   * OpenRouter cache prefixes automatically (or not at all).
   */
  get supportsExplicitPromptCaching(): boolean {
    const model = this.resolvedModelName.toLowerCase();
    return model.includes('claude') || model.includes('anthropic');
  }

  // MARK: - Actions

  generateActions(systemPrompt: string, userPrompt: string): Promise<DesignAction[]>;
  generateActions(messages: OpenRouterMessage[]): Promise<DesignAction[]>;
  async generateActions(first: string | OpenRouterMessage[], second?: string): Promise<DesignAction[]> {
    const messages: OpenRouterMessage[] = typeof first === 'string'
      ? [
          makeOpenRouterMessage('system', first),
          makeOpenRouterMessage('user', second ?? ''),
        ]
      : first;

    const logger = getPlatform().logger;
    const conversation = [...messages];
    let lastFailureMessage = 'No JSON object or array found in model response.';

    // One generation attempt plus one self-repair round trip: on a decode
    // failure the model sees its own broken output and the exact decode error.
    for (let attempt = 1; attempt <= 2; attempt++) {
      const content = await this.generateRawChat(conversation, true);

      logger.info(`===== RAW AI RESPONSE (attempt ${attempt}) =====`);
      logger.info(content);
      logger.info('===========================');

      const jsonCandidates = this.extractJSONCandidates(content);
      const attemptedJSON: string[] = [];
      let lastDecodeError: unknown;
      let decoded: DesignAgentResponse | undefined;

      for (const candidate of jsonCandidates) {
        const repairedJSON = this.repairCommonJSONMistakes(candidate);
        attemptedJSON.push(repairedJSON);
        try {
          const response = this.decodeAgentResponse(repairedJSON);
          logger.info('===== AGENT DESIGN PLAN =====');
          response.plan.forEach((step) => logger.info(`- ${step}`));
          logger.info('=============================');
          decoded = response;
          break;
        } catch (error) {
          lastDecodeError = error;
        }
      }
      if (decoded) return decoded.actions;

      lastFailureMessage = lastDecodeError === undefined
        ? 'No JSON object or array found in model response.'
        : decodingDebugMessage(lastDecodeError);

      logger.info('===== EXTRACTED ACTION JSON CANDIDATES =====');
      for (const candidate of attemptedJSON) {
        logger.info(candidate);
        logger.info('-----');
      }
      logger.info('===== ACTION JSON DECODE ERROR =====');
      logger.info(lastFailureMessage);

      conversation.push(makeOpenRouterMessage('assistant', content));
      conversation.push(makeOpenRouterMessage(
        'user',
        `Your previous response could not be parsed as a valid \`DesignAgentResponse\`.
Decode error: ${lastFailureMessage}
Return the complete corrected JSON object only ({ "plan": [...], "actions": [...] }). No explanations, no markdown fences.`,
      ));
    }

    throw AIProviderError.invalidJSON(lastFailureMessage);
  }

  /**
   * Schema-CONSTRAINED generation on a local model. Ollama's native
   * `/api/chat` accepts a JSON Schema in `format`, and the decoder is then
   * physically unable to emit a token that would break it.
   *
   * Note the endpoint: the OpenAI-compatible `/v1` path with
   * `response_format` returned EMPTY output for MLX models, so this
   * deliberately talks to the native API instead.
   */
  async generateConstrainedJSON(
    messages: OpenRouterMessage[],
    schema: JSONObject,
    maxTokens = 4096,
  ): Promise<string> {
    if (!this.isLocalModel) {
      // Cloud providers get the ordinary json_object path; only Ollama
      // exposes true grammar-constrained decoding here.
      return this.generateRawChat(messages, true, 0, maxTokens);
    }

    const body: JSONObject = {
      model: this.resolvedModelName,
      stream: false,
      format: schema,
      options: { num_predict: maxTokens, temperature: this.temperature },
      messages: messages.map((message) => {
        const entry: JSONObject = { role: message.role, content: message.content };
        const images = message.imageDataURLs ?? [];
        if (images.length > 0) {
          // Ollama's native API takes bare base64, not data: URLs.
          entry.images = images.map((url) => {
            const parts = url.split('base64,');
            return parts.length > 1 ? parts[parts.length - 1]! : url;
          });
        }
        return entry;
      }),
    };
    body.keep_alive = '10m';

    const response = await fetchWithTimeout(
      'http://127.0.0.1:11434/api/chat',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      1800,
      this.fetchImpl,
    );
    const text = await response.text();
    if (!(response.status >= 200 && response.status < 300)) {
      throw AIProviderError.httpError(
        response.status,
        `Ollama constrained call failed: ${prefixString(text, 200)}`,
      );
    }
    let object: unknown;
    try {
      object = JSON.parse(text);
    } catch {
      throw AIProviderError.emptyContent();
    }
    const message = isPlainObject(object) ? object.message : undefined;
    const content = isPlainObject(message) ? message.content : undefined;
    if (typeof content !== 'string' || content.trim().length === 0) {
      throw AIProviderError.emptyContent();
    }

    // MEASURED: Ollama's MLX-quantised builds silently IGNORE `format` and
    // answer in prose, while GGUF builds honour it.
    const leading = content.trim()[0];
    if (leading !== '{' && leading !== '[') {
      getPlatform().logger.warn(
        `⚠️ ${this.resolvedModelName} ignored the JSON schema and answered in prose. Ollama's MLX builds do not support constrained decoding — pull a GGUF build of a comparable model to get guaranteed-valid output.`,
      );
    }
    return content;
  }

  async generateRawChat(
    messages: OpenRouterMessage[],
    jsonMode = false,
    retryCount = 0,
    maxTokens = 24576,
  ): Promise<string> {
    const logger = getPlatform().logger;
    logger.info('===== FULL AI PROMPT =====');
    for (const message of messages) {
      logger.info(`--- ${message.role.toUpperCase()} ---`);
      logger.info(message.content);
    }
    logger.info('==========================');

    const trimmedKey = this.effectiveKey.trim();
    if (trimmedKey.length === 0 && !this.isLocalModel) {
      throw AIProviderError.missingAPIKey();
    }

    const requestBody: JSONObject = {
      model: this.resolvedModelName,
      messages: messages.map(encodeOpenRouterMessage),
      temperature: this.temperature,
    };
    if (jsonMode) requestBody.response_format = { type: 'json_object' };
    if (!this.isLocalModel) requestBody.max_tokens = maxTokens;

    // Large free models can take minutes to emit a full multi-screen
    // response — the default 60s timeout kills them mid-generation.
    const response = await fetchWithTimeout(
      this.endpoint,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${trimmedKey}`,
          'Content-Type': 'application/json',
          'X-OpenRouter-Title': 'AgenticDesigner',
        },
        body: JSON.stringify(requestBody),
      },
      600,
      this.fetchImpl,
    );
    const rawResponse = await response.text();

    if (!(response.status >= 200 && response.status < 300)) {
      const message = extractErrorMessage(rawResponse);
      const lowerMessage = message.toLowerCase();
      if ([401, 403].includes(response.status)
        || (response.status === 400 && lowerMessage.includes('api key'))) {
        throw AIProviderError.providerUnavailable(this.route.name, message);
      }

      // 402 = the account can't cover the OUTPUT RESERVATION, not the
      // real cost. Shrink max_tokens toward what the balance affords
      // (OpenRouter names the affordable number in the message).
      if (response.status === 402 && maxTokens > 2048) {
        const affordableRaw = OpenRouterProvider.affordableTokens(message);
        const affordable = affordableRaw === undefined ? undefined : Math.trunc(affordableRaw * 0.9);
        const next = Math.max(2048, Math.min(affordable ?? Math.trunc(maxTokens / 2), Math.trunc(maxTokens / 2)));
        logger.info(`⚠️ HTTP 402 (credits) — retrying with max_tokens ${next}`);
        return this.generateRawChat(messages, jsonMode, retryCount, next);
      }

      // Free-tier congestion (429 rate limit, 502/503 overload) is
      // transient — back off and retry up to 3 times before failing.
      if ([429, 502, 503].includes(response.status) && retryCount < 3) {
        const delaySeconds = (retryCount + 1) * 8;
        logger.info(`⚠️ HTTP ${response.status} — retrying in ${delaySeconds}s (attempt ${retryCount + 1}/3)`);
        await getPlatform().clock.sleep(delaySeconds * 1000);
        return this.generateRawChat(messages, jsonMode, retryCount + 1, maxTokens);
      }

      // Some providers reject response_format; retry once without it.
      if (jsonMode && message.toLowerCase().includes('response_format')) {
        logger.info('⚠️ Provider rejected response_format — retrying without JSON mode.');
        return this.generateRawChat(messages, false, 0, maxTokens);
      }

      // Text-only models have no endpoints accepting image parts —
      // retry once with the screenshots stripped.
      if (message.toLowerCase().includes('no endpoints found')
        && messages.some((message2) => (message2.imageDataURLs ?? []).length > 0)) {
        logger.info('⚠️ Model has no vision endpoint — retrying without screenshots.');
        const textOnly = messages.map((message2) => makeOpenRouterMessage(message2.role, message2.content));
        return this.generateRawChat(textOnly, jsonMode, 0, maxTokens);
      }

      throw AIProviderError.httpError(response.status, message);
    }

    let decodedResponse: OpenRouterChatResponse;
    try {
      decodedResponse = decodeOpenRouterChatResponse(parseJSONOrThrow(rawResponse));
    } catch (error) {
      logger.info('===== OPENROUTER CHAT DECODE ERROR =====');
      logger.info(decodingDebugMessage(error));
      logger.info(rawResponse.length > 0 ? rawResponse : 'Unreadable response body');
      logger.info('========================================');
      throw AIProviderError.invalidJSON(
        `Could not decode OpenRouter chat response: ${decodingDebugMessage(error)}. Raw response: ${prefixString(rawResponse, 700)}`,
      );
    }

    if (decodedResponse.error) {
      // A provider error INSIDE an HTTP-200 body (e.g. the model host
      // returned 500 "Internal Server Error") is an upstream hiccup —
      // transient. Back off and retry instead of losing the whole build.
      if (retryCount < 3) {
        const delaySeconds = (retryCount + 1) * 6;
        logger.info(`⚠️ Provider error in 200 body: ${decodedResponse.error.message} — retrying in ${delaySeconds}s (attempt ${retryCount + 1}/3)`);
        await getPlatform().clock.sleep(delaySeconds * 1000);
        return this.generateRawChat(messages, jsonMode, retryCount + 1, maxTokens);
      }
      throw AIProviderError.httpError(response.status, decodedResponse.error.message);
    }

    const content = (decodedResponse.choices ?? [])
      .map((choice) => choiceContent(choice))
      .filter((text): text is string => text !== undefined)
      .find((text) => text.trim().length > 0);
    if (content === undefined || content.trim().length === 0) {
      throw AIProviderError.emptyContent();
    }
    return content;
  }

  /**
   * One turn of a function-calling conversation: sends the messages plus
   * tool schemas ([{type:"function",function:{name,description,parameters}}])
   * and returns either the model's tool calls or its final text.
   */
  async generateToolTurn(
    messages: OpenRouterMessage[],
    toolSchemas: JSONObject[],
    retryCount = 0,
    // A tool turn's output is usually small, but it can legitimately be a
    // whole file (set_source_override) or a long action batch.
    maxTokens = 16384,
  ): Promise<AgentToolTurnResult> {
    const trimmedKey = this.effectiveKey.trim();
    if (trimmedKey.length === 0 && !this.isLocalModel) {
      throw AIProviderError.missingAPIKey();
    }

    const body: JSONObject = {
      model: this.resolvedModelName,
      messages: messages.map(encodeOpenRouterMessage),
      temperature: this.temperature,
    };
    body.tools = toolSchemas as unknown as JSONValue;
    // Ask OpenRouter to return per-turn token and cost data. OpenRouter-ONLY
    // extension: Google's OpenAI-compat layer 400s on any unknown field.
    if (this.route.id === ModelProviderCatalog.openRouterId) {
      body.usage = { include: true };
    }
    // Start from what this balance was last known to afford.
    const effectiveMaxTokens = Math.min(maxTokens, OpenRouterProvider.learnedOutputTokenCeiling ?? maxTokens);
    if (!this.isLocalModel) body.max_tokens = effectiveMaxTokens;
    // Anthropic bills a cached prefix at ~10% — but ONLY where the caller
    // places explicit cache_control breakpoints.
    if (this.supportsExplicitPromptCaching) {
      const encodedMessages = body.messages as unknown as JSONObject[] | undefined;
      if (encodedMessages) {
        body.messages = OpenRouterProvider.markingCacheBreakpoints(encodedMessages) as unknown as JSONValue;
      }
    }

    // Local models legitimately take much longer per turn; cloud gets a
    // bounded recovery path.
    const turnTimeout = this.isLocalModel ? 1800 : 150;

    let response;
    try {
      response = await fetchWithTimeout(
        this.endpoint,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${trimmedKey}`,
            'Content-Type': 'application/json',
            'X-OpenRouter-Title': 'AgenticDesigner',
          },
          body: JSON.stringify(body),
        },
        turnTimeout,
        this.fetchImpl,
      );
    } catch (error) {
      if (isTimeoutError(error) && this.isLocalModel && retryCount < 2) {
        // A timed-out local turn usually means transient GPU contention.
        await getPlatform().clock.sleep(10_000);
        return this.generateToolTurn(messages, toolSchemas, retryCount + 1);
      }
      if (isTimeoutError(error)) {
        throw AIProviderError.rateLimited(
          this.route.name,
          `Tool turn did not respond within ${Math.trunc(turnTimeout)} seconds (${(error as Error).message}).`,
        );
      }
      throw error;
    }

    const rawResponse = await response.text();
    if (!(response.status >= 200 && response.status < 300)) {
      const message = extractErrorMessage(rawResponse);
      const lowerMessage = message.toLowerCase();
      if ([401, 403].includes(response.status)
        || (response.status === 400 && lowerMessage.includes('api key'))) {
        throw AIProviderError.providerUnavailable(this.route.name, message);
      }
      // A 402 has TWO different causes. "Prompt tokens limit exceeded"
      // means the conversation itself is too big for what the balance
      // allows — surface a distinct error the agent loop can answer by
      // compacting.
      if (response.status === 402) {
        const promptLimit = OpenRouterProvider.parsePromptTokenLimit(message);
        if (promptLimit) {
          OpenRouterProvider.learnedPromptTokenCeiling = promptLimit.limit;
          throw AIProviderError.promptTooLarge(promptLimit.actual, promptLimit.limit);
        }
      }
      // Credits: shrink the output reservation to what the balance affords.
      if (response.status === 402 && maxTokens > 256) {
        const affordableRaw = OpenRouterProvider.affordableTokens(message);
        const affordable = affordableRaw === undefined ? undefined : Math.trunc(affordableRaw * 0.9);
        const proposed = affordable ?? Math.trunc(maxTokens / 2);
        const next = Math.max(256, Math.min(proposed, maxTokens - 1));
        if (next < maxTokens) {
          OpenRouterProvider.learnedOutputTokenCeiling = next;
          return this.generateToolTurn(messages, toolSchemas, retryCount, next);
        }
      }
      if (response.status === 402) {
        throw AIProviderError.quotaExceeded(this.route.name, message);
      }
      // A 429 is either "slow down" (transient) or "your allowance is gone".
      if (response.status === 429 && OpenRouterProvider.isQuotaExhausted(message)) {
        throw AIProviderError.quotaExceeded(this.route.name, message);
      }
      // A transient 429 is surfaced instead of being retried in here: the
      // LOOP knows whether another provider is available.
      if (response.status === 429) {
        throw AIProviderError.rateLimited(this.route.name, message);
      }
      if ([502, 503].includes(response.status) && retryCount < 3) {
        await getPlatform().clock.sleep((retryCount + 1) * 8 * 1000);
        return this.generateToolTurn(messages, toolSchemas, retryCount + 1, maxTokens);
      }
      throw AIProviderError.httpError(response.status, message);
    }

    let decoded: OpenRouterChatResponse;
    try {
      decoded = decodeOpenRouterChatResponse(parseJSONOrThrow(rawResponse));
    } catch (error) {
      throw AIProviderError.invalidJSON(
        `Could not decode tool-turn response: ${decodingDebugMessage(error)}. Raw: ${prefixString(rawResponse, 600)}`,
      );
    }

    if (decoded.error) {
      if (retryCount < 3) {
        await getPlatform().clock.sleep((retryCount + 1) * 6 * 1000);
        return this.generateToolTurn(messages, toolSchemas, retryCount + 1, maxTokens);
      }
      throw AIProviderError.httpError(response.status, decoded.error.message);
    }

    const choice = (decoded.choices ?? [])[0];
    if (!choice) throw AIProviderError.emptyContent();

    const usage: AgentToolUsage | undefined = decoded.usage
      ? {
          promptTokens: decoded.usage.promptTokens ?? 0,
          completionTokens: decoded.usage.completionTokens ?? 0,
          ...(decoded.usage.cost !== undefined ? { costUSD: decoded.usage.cost } : {}),
        }
      : undefined;

    const toolCalls = choiceToolCalls(choice);
    if (toolCalls.length > 0) {
      const turn: AgentToolTurn = { kind: 'toolCalls', toolCalls };
      const assistantText = choiceContent(choice);
      if (assistantText !== undefined) turn.assistantText = assistantText;
      return usage ? { turn, usage } : { turn };
    }
    const text = (choiceContent(choice) ?? '').trim();
    if (text.length === 0) throw AIProviderError.emptyContent();
    const turn: AgentToolTurn = { kind: 'text', text };
    return usage ? { turn, usage } : { turn };
  }

  // MARK: - Image generation

  async generateImageAsset(
    prompt: string,
    assetKind: string | undefined,
    aspectRatio: string | undefined,
    resolution: string | undefined,
    size: string | undefined,
  ): Promise<string> {
    const trimmedKey = this.apiKey.trim();
    const trimmedPrompt = prompt.trim();

    if (trimmedPrompt.length === 0) {
      throw AIProviderError.invalidJSON('Missing imagePrompt for generated asset.');
    }

    // Local-first: if a Draw Things / A1111-compatible server is running
    // on 127.0.0.1:7860, generate there (free, offline, no API key
    // needed) — this must be tried before the API-key check below.
    try {
      const localPath = await this.generateLocalImage(trimmedPrompt, size);
      return localPath;
    } catch {
      /* `try?` in Swift */
    }

    if (trimmedKey.length === 0) throw AIProviderError.missingAPIKey();

    const requestBody: JSONObject = {
      model: OpenRouterConfiguration.imageModel,
      prompt: this.enrichedImagePrompt(trimmedPrompt, assetKind, aspectRatio, size),
    };
    if (size !== undefined) requestBody.size = size;
    if (aspectRatio !== undefined) requestBody.aspect_ratio = aspectRatio;
    if (resolution !== undefined) requestBody.resolution = resolution;

    const response = await fetchWithTimeout(
      this.imageEndpoint,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${trimmedKey}`,
          'Content-Type': 'application/json',
          'X-OpenRouter-Title': 'AgenticDesigner',
        },
        body: JSON.stringify(requestBody),
      },
      60,
      this.fetchImpl,
    );
    const raw = await response.text();

    if (!(response.status >= 200 && response.status < 300)) {
      throw AIProviderError.httpError(response.status, extractErrorMessage(raw));
    }

    const decodedResponse = JSON.parse(raw) as { data?: { b64_json?: string; url?: string }[] };
    const first = decodedResponse.data?.[0];

    if (first?.b64_json) {
      const imageData = decodeBase64(first.b64_json);
      if (imageData) return this.saveGeneratedImageData(imageData, 'png');
    }

    if (first?.url) {
      const url = first.url;
      const download = await fetchWithTimeout(url, { method: 'GET' }, 60, this.fetchImpl);
      const buffer = download.arrayBuffer ? await download.arrayBuffer() : undefined;
      if (buffer) {
        const extension = pathExtension(url);
        return this.saveGeneratedImageData(new Uint8Array(buffer), extension.length === 0 ? 'png' : extension);
      }
    }

    throw AIProviderError.emptyContent();
  }

  /**
   * Draw Things / AUTOMATIC1111-compatible local image generation (mflux on
   * :7860). The bridge process is auto-started by the server-side adapter.
   */
  private async generateLocalImage(prompt: string, size: string | undefined): Promise<string> {
    await getLocalBridges().ensureMfluxBridge();
    let width = 1024;
    let height = 1024;
    if (size && size.toLowerCase().includes('x')) {
      const parts = size.toLowerCase().split('x');
      const w = Number.parseInt(parts[0] ?? '', 10);
      const h = Number.parseInt(parts[1] ?? '', 10);
      if (Number.isFinite(w) && Number.isFinite(h)) {
        width = Math.min(w, 1536);
        height = Math.min(h, 1536);
      }
    }

    const response = await fetchWithTimeout(
      'http://127.0.0.1:7860/sdapi/v1/txt2img',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, width, height, steps: 8 }),
      },
      300,
      this.fetchImpl,
    );
    const raw = await response.text();
    let images: unknown;
    try {
      images = (JSON.parse(raw) as { images?: unknown }).images;
    } catch {
      throw AIProviderError.emptyContent();
    }
    const base64 = Array.isArray(images) && typeof images[0] === 'string' ? (images[0] as string) : undefined;
    const imageData = base64 ? decodeBase64(base64) : null;
    if (response.status !== 200 || !imageData) {
      throw AIProviderError.emptyContent();
    }

    getPlatform().logger.info(`🖼️ Image generated locally (${width}x${height})`);
    return this.saveGeneratedImageData(imageData, 'png');
  }

  /** `Application Support/AgenticDesigner/GeneratedAssets/<uuid>.<ext>` */
  private async saveGeneratedImageData(data: Uint8Array, preferredExtension: string): Promise<string> {
    const fileSystem = getPlatform().fileSystem;
    const assetsDirectory = fileSystem.join(fileSystem.applicationSupportDirectory(), 'GeneratedAssets');
    await fileSystem.mkdirp(assetsDirectory);

    const sanitizedExtension = preferredExtension.replace(/^\.+|\.+$/g, '').trim();
    const fileExtension = sanitizedExtension.length === 0 ? 'png' : sanitizedExtension;
    const fileURL = fileSystem.join(assetsDirectory, `${newUUID()}.${fileExtension}`);
    await fileSystem.writeBytes(fileURL, data);
    return fileURL;
  }

  // MARK: - Response parsing helpers

  private decodeAgentResponse(json: string): DesignAgentResponse {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (error) {
      throw new ResponseDecodingError(
        'dataCorrupted',
        `The given data was not valid JSON. ${(error as Error).message}`,
        [],
      );
    }
    try {
      return decodeDesignAgentResponse(parsed);
    } catch (responseError) {
      if (!Array.isArray(parsed)) throw responseError;
      const lossy = decodeLossyDesignActions(parsed);
      const actions = lossy.map((entry) => entry.action).filter((action): action is DesignAction => action !== null);
      if (actions.length === 0) throw responseError;
      return {
        plan: ['Provider returned legacy action array; decoded actions directly.'],
        actions,
      };
    }
  }

  private extractJSONCandidates(content: string): string[] {
    const trimmed = content
      .replaceAll('```json', '```')
      .replaceAll('```JSON', '```')
      .trim();

    let candidates = this.balancedJSONCandidates(trimmed);
    if (candidates.length === 0) candidates = [trimmed];

    const seen = new Set<string>();
    const uniqueCandidates = candidates.filter((candidate) => {
      const normalized = candidate.trim();
      if (normalized.length === 0 || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
    const agentCandidates = uniqueCandidates.filter((candidate) => this.isLikelyAgentJSONCandidate(candidate));

    return (agentCandidates.length === 0 ? uniqueCandidates : agentCandidates)
      .slice()
      .sort((a, b) => this.jsonCandidateScore(b) - this.jsonCandidateScore(a));
  }

  private isLikelyAgentJSONCandidate(candidate: string): boolean {
    const trimmed = candidate.trim();
    if (trimmed.startsWith('{')) return trimmed.includes('"actions"');
    if (trimmed.startsWith('[')) return trimmed.includes('"type"');
    return false;
  }

  private balancedJSONCandidates(text: string): string[] {
    const characters = Array.from(text);
    const candidates: string[] = [];

    for (let start = 0; start < characters.length; start++) {
      if (characters[start] !== '{' && characters[start] !== '[') continue;
      const stack: string[] = [];
      let isInsideString = false;
      let isEscaped = false;

      for (let index = start; index < characters.length; index++) {
        const character = characters[index]!;

        if (isInsideString) {
          if (isEscaped) isEscaped = false;
          else if (character === '\\') isEscaped = true;
          else if (character === '"') isInsideString = false;
          continue;
        }

        if (character === '"') {
          isInsideString = true;
          continue;
        }

        if (character === '{') {
          stack.push('}');
        } else if (character === '[') {
          stack.push(']');
        } else if (stack.length > 0 && character === stack[stack.length - 1]) {
          stack.pop();
          if (stack.length === 0) {
            candidates.push(characters.slice(start, index + 1).join(''));
            break;
          }
        }
      }
    }

    return candidates;
  }

  private jsonCandidateScore(candidate: string): number {
    let score = charCount(candidate);
    if (candidate.includes('"actions"')) score += 1_000_000;
    if (candidate.includes('"plan"')) score += 250_000;
    if (candidate.trim().startsWith('{')) score += 10_000;
    return score;
  }

  private repairCommonJSONMistakes(json: string): string {
    let repaired = json.trim();

    if (repaired.startsWith('```') && repaired.endsWith('```')) {
      repaired = repaired.slice(3, repaired.length - 3).trim();
    }

    // Common model typo: "height": "height": 28
    repaired = repaired.replace(/"([A-Za-z_][A-Za-z0-9_]*)"\s*:\s*"\1"\s*:/g, '"$1":');

    // Same typo without the opening quote around the repeated key: "width":width": 1
    repaired = repaired.replace(/"([A-Za-z_][A-Za-z0-9_]*)"\s*:\s*\1"\s*:/g, '"$1":');

    // Remove trailing commas before closing containers.
    repaired = repaired.replace(/,\s*([}\]])/g, '$1');

    return repaired;
  }

  // MARK: - Image prompt enrichment

  private enrichedImagePrompt(
    prompt: string,
    assetKind: string | undefined,
    aspectRatio?: string,
    size?: string,
  ): string {
    const base = this.baseEnrichedImagePrompt(prompt, assetKind);

    if (aspectRatio === undefined && size === undefined) return base;

    const framingParts: string[] = [];
    if (aspectRatio !== undefined) framingParts.push(`"targetAspectRatio": "${aspectRatio}"`);
    if (size !== undefined) framingParts.push(`"targetSize": "${size}"`);
    framingParts.push('"instruction": "Compose specifically for this exact crop: keep the full subject inside the frame, keep important details away from all edges, and balance negative space for this ratio. Do not letterbox, pad, or add borders."');

    return base + '\n{ "framing": { ' + framingParts.join(', ') + ' } }';
  }

  private baseEnrichedImagePrompt(prompt: string, assetKind: string | undefined): string {
    const kind = assetKind?.trim().toLowerCase() ?? 'hero';

    switch (kind) {
      case 'icon':
      case 'appicon':
      case 'symbol':
        return `{
  "task": "Generate one premium app icon or symbolic image asset for use inside a product UI.",
  "assetKind": "${kind}",
  "coreBrief": "${jsonEscaped(prompt)}",
  "visualIntent": {
    "roleInInterface": "A polished visual symbol that can sit inside a button, card, navigation tile, feature tile, or compact hero area.",
    "subject": "Use the core brief as the exact subject. Keep the symbol instantly recognizable at small sizes.",
    "composition": "Single centered subject, balanced negative space, strong silhouette, no clutter, no cropped edges.",
    "style": "Premium contemporary app-design asset, refined 3D/vector-like finish, crisp geometry, subtle depth, clean edges.",
    "lighting": "Soft studio lighting with gentle highlights and controlled shadows.",
    "background": "Simple transparent-looking or minimal background, never a full app screen.",
    "colorDirection": "Use a cohesive 2-4 color palette that can fit a modern mobile UI. Avoid muddy colors."
  },
  "qualityBar": {
    "detailLevel": "High detail where useful, but readable at icon size.",
    "finish": "Polished, intentional, commercially usable, no rough artifacts.",
    "contrast": "Clear contrast between subject and background."
  },
  "strictConstraints": {
    "noText": true,
    "noLetters": true,
    "noNumbers": true,
    "noWatermarks": true,
    "noMockupChrome": true,
    "noButtons": true,
    "noMenus": true,
    "noFullUIScreen": true
  },
  "negativePrompt": "readable text, letters, numbers, watermark, logo text, app screenshot, phone mockup, UI controls, buttons, menu bars, low resolution, blurry, distorted, messy composition, extra objects"
}`;
      case 'product':
      case 'productcutout':
      case 'cutout':
      case 'object':
        return `{
  "task": "Generate one premium product/object image asset for placement inside a mobile app UI. The output is an asset only, not a UI mockup.",
  "assetKind": "${kind}",
  "coreBrief": "${jsonEscaped(prompt)}",
  "visualIntent": {
    "roleInInterface": "A clean product cutout or hero object that can sit inside a card, product detail screen, gallery tile, or editorial hero.",
    "subject": "Follow the core brief precisely. The subject must be the clear focus and recognizable at mobile size.",
    "composition": "Single product/object, centered or slightly off-center, fully visible, elegant negative space, no cropped important edges.",
    "style": "Premium commercial product photography or polished 3D/product render, refined material detail, crisp contours, app-design ready.",
    "lighting": "Soft studio lighting, controlled highlights, subtle grounding shadow, no harsh glare.",
    "background": "Clean transparent-looking, seamless, or very minimal background that is easy to mask into UI cards.",
    "colorDirection": "Cohesive palette that can drive the UI accent color and background tint.",
    "edgeQuality": "Clean silhouette and contours suitable for rounded masks or floating above cards."
  },
  "strictConstraints": {
    "noText": true,
    "noLetters": true,
    "noNumbers": true,
    "noWatermarks": true,
    "noAppScreenshot": true,
    "noPhoneMockup": true,
    "noButtons": true,
    "noMenus": true
  },
  "negativePrompt": "text, letters, numbers, watermark, logo text, app screenshot, phone mockup, UI, buttons, menu bars, clutter, messy background, cropped product, distorted object, blurry, low quality"
}`;
      case 'sprite':
      case 'gamesprite':
      case 'character':
      case 'gameasset':
        return `{
  "task": "Generate one 2D game sprite asset for a mobile game. The output is a single game object on a plain, easily-removable background — NOT a scene, NOT a UI.",
  "assetKind": "${kind}",
  "coreBrief": "${jsonEscaped(prompt)}",
  "visualIntent": {
    "roleInInterface": "A single game sprite (character, obstacle, projectile, coin, tile) that will be cut out and composited into a live SpriteKit scene.",
    "subject": "Exactly the core brief, one subject only, whole and uncropped, centered, facing right or 3/4 view unless the brief says otherwise.",
    "composition": "Single centered subject filling ~70% of the frame, generous even margin on all sides, no ground shadow touching edges.",
    "style": "Clean modern 2D game art — crisp vector/illustrated or polished game-render look, bold readable silhouette, saturated game-friendly colors, thick clean edges.",
    "lighting": "Even flat lighting, minimal cast shadow, no dramatic gradients that bleed into the background.",
    "background": "A COMPLETELY FLAT, SOLID, UNIFORM background of a single distinct color (bright magenta or pure white) with NO gradient, NO texture, NO scenery — so it mattes out perfectly."
  },
  "strictConstraints": {
    "noScene": true,
    "noBackgroundDetail": true,
    "noGradientBackground": true,
    "noText": true,
    "noUI": true,
    "noMultipleObjects": true,
    "noCroppedSubject": true,
    "singleSubjectOnly": true
  },
  "negativePrompt": "scene, landscape, background scenery, gradient background, textured background, multiple objects, text, letters, UI, buttons, cropped subject, drop shadow on floor, photo, realistic photograph, watermark, low quality, blurry"
}`;
      case 'poster':
      case 'cover':
      case 'thumbnail':
      case 'avatar':
        return `{
  "task": "Generate one premium cropped image asset for use as a poster, cover, thumbnail, avatar, or gallery image inside an app UI.",
  "assetKind": "${kind}",
  "coreBrief": "${jsonEscaped(prompt)}",
  "visualIntent": {
    "roleInInterface": "A compact visual asset that works inside rounded cards, circular masks, poster stacks, thumbnail rails, or content previews.",
    "subject": "Use the core brief as the exact subject. Keep the subject readable at small size.",
    "composition": "Strong central focal point, clean crop, useful negative space, balanced edges, no overcrowding.",
    "style": "Editorial, premium, modern, commercially usable, cohesive with a polished mobile UI.",
    "lighting": "Soft controlled lighting and clear depth.",
    "palette": "Limited cohesive palette that can harmonize with nearby UI controls."
  },
  "strictConstraints": {
    "noText": true,
    "noWatermarks": true,
    "noAppScreenshot": true,
    "noPhoneMockup": true,
    "noButtons": true
  },
  "negativePrompt": "readable text, watermark, UI screenshot, phone frame, buttons, menus, clutter, low resolution, bad crop, blurry"
}`;
      default:
        return `{
  "task": "Generate one premium visual image asset for a designed app screen. The output is an image asset only, not a UI mockup.",
  "assetKind": "${kind}",
  "coreBrief": "${jsonEscaped(prompt)}",
  "visualIntent": {
    "roleInInterface": "A high-impact asset for a hero section, card, background, artwork tile, product panel, or editorial visual inside a mobile app.",
    "subject": "Follow the core brief precisely. Make the subject category-specific and visually memorable.",
    "composition": "Strong focal point, intentional hierarchy, generous negative space for possible overlay text, no overcrowding, professional crop.",
    "cameraAndFraming": "Design-friendly framing, subject fully intentional in frame, avoid awkward crops, avoid excessive empty corners unless useful for overlay text.",
    "style": "Premium product-design imagery, modern editorial quality, cinematic but clean, commercially usable in a polished app.",
    "lighting": "High-quality controlled lighting, soft gradients, believable highlights, tasteful shadows, no harsh amateur contrast.",
    "palette": "Cohesive palette that can pair with modern UI tokens; avoid random rainbow color, avoid muddy gray unless requested.",
    "textureAndDepth": "Use refined texture, depth, and atmosphere only when it supports the brief. Keep it crisp and usable.",
    "background": "No app chrome. No fake UI. Background may be photographic, abstract, product-studio, environmental, or illustrated according to the core brief."
  },
  "usabilityForUI": {
    "overlaySafety": "Leave some visually calm area for text overlays when the brief sounds like a hero/background.",
    "edgeSafety": "Keep important subject details away from extreme edges.",
    "readability": "Avoid busy patterns behind where UI text may sit.",
    "contentPolicy": "No readable typography inside the generated image unless the user explicitly requested a real-world sign or label."
  },
  "qualityBar": {
    "finish": "Senior art-director quality, polished, coherent, premium.",
    "detailLevel": "Rich enough to feel real and intentional, not generic stock.",
    "artifactControl": "Clean anatomy/objects, no distortions, no malformed hands/faces/products, no duplicated weird details."
  },
  "strictConstraints": {
    "noReadableText": true,
    "noWatermarks": true,
    "noLogosUnlessRequested": true,
    "noPhoneMockups": true,
    "noAppScreenshots": true,
    "noButtonsOrInputFields": true,
    "noNavigationBars": true,
    "noPlaceholderText": true
  },
  "negativePrompt": "readable text, watermark, logo text, app UI, app screenshot, phone mockup, browser chrome, buttons, input fields, navigation bar, placeholder text, low quality, blurry, noisy, distorted objects, generic stock photo, cluttered composition, ugly crop"
}`;
    }
  }
}

/**
 * cache_control lives on a content BLOCK, so a plain string body has to be
 * promoted to block form first. Messages with no textual content (an
 * assistant turn that is only tool_calls) are left untouched.
 */
function markedForCaching(message: JSONObject): JSONObject {
  const result: JSONObject = { ...message };
  const cacheControl: JSONValue = { type: 'ephemeral' };

  if (typeof result.content === 'string' && result.content.length > 0) {
    result.content = [{ type: 'text', text: result.content, cache_control: cacheControl }];
  } else if (Array.isArray(result.content) && result.content.length > 0) {
    const blocks = result.content.map((block) => (isPlainObject(block) ? { ...block } : block)) as JSONValue[];
    const lastIndex = blocks.length - 1;
    const last = blocks[lastIndex];
    if (isPlainObject(last)) {
      (last as JSONObject).cache_control = cacheControl;
      blocks[lastIndex] = last as JSONValue;
    }
    result.content = blocks;
  }
  return result;
}

function parseJSONOrThrow(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ResponseDecodingError(
      'dataCorrupted',
      `The given data was not valid JSON. ${(error as Error).message}`,
      [],
    );
  }
}

/** `URL.pathExtension` */
function pathExtension(url: string): string {
  const withoutQuery = url.split('?')[0] ?? '';
  const lastComponent = withoutQuery.split('/').pop() ?? '';
  const dot = lastComponent.lastIndexOf('.');
  return dot <= 0 ? '' : lastComponent.slice(dot + 1);
}

/** `extractErrorMessage(from:)` */
export function extractErrorMessage(body: string): string {
  const fallback = body.length > 0 ? body : 'No response body';
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return fallback;
  }
  if (!isPlainObject(json)) return fallback;
  const errorInfo = json.error;
  if (!isPlainObject(errorInfo)) return fallback;

  const metadata = errorInfo.metadata;
  if (isPlainObject(metadata) && typeof metadata.raw === 'string' && metadata.raw.length > 0) {
    const raw = metadata.raw;
    try {
      const rawJson = JSON.parse(raw) as unknown;
      if (isPlainObject(rawJson) && isPlainObject(rawJson.error) && typeof rawJson.error.message === 'string') {
        return rawJson.error.message;
      }
    } catch {
      /* fall through to the raw text */
    }
    return raw;
  }

  if (typeof errorInfo.message === 'string' && errorInfo.message.length > 0) return errorInfo.message;

  return fallback;
}
