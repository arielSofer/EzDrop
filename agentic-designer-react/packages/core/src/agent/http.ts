// HTTP plumbing shared by the ported providers.
//
// Swift uses URLSession with explicit timeouts; the port uses global `fetch`
// with an injectable implementation so the web app can route CORS-blocked
// vendor hosts through the server's `POST /proxy` without changing any call
// site, and tests can script responses.

export interface AgentFetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** AbortSignal when the host has one (typed loosely: core has no DOM lib). */
  signal?: unknown;
}

export interface AgentFetchResponse {
  status: number;
  text(): Promise<string>;
  /** Present in every real fetch; used for binary image downloads. */
  arrayBuffer?(): Promise<ArrayBuffer>;
}

export type AgentFetch = (url: string, init?: AgentFetchInit) => Promise<AgentFetchResponse>;

let injectedFetch: AgentFetch | undefined;

/** Route every provider call through this implementation (web: the proxy). */
export function setAgentFetch(fetchImpl: AgentFetch | undefined): void {
  injectedFetch = fetchImpl;
}

export function globalFetch(): AgentFetch | undefined {
  const g = globalThis as { fetch?: AgentFetch };
  return typeof g.fetch === 'function' ? (g.fetch.bind(globalThis) as AgentFetch) : undefined;
}

export function getAgentFetch(override?: AgentFetch): AgentFetch {
  const impl = override ?? injectedFetch ?? globalFetch();
  if (!impl) {
    throw new Error('No fetch implementation available — inject one with setAgentFetch().');
  }
  return impl;
}

/** `URLError.timedOut` / `.networkConnectionLost` equivalent. */
export class AgentRequestTimeoutError extends Error {
  constructor(public readonly seconds: number, message?: string) {
    super(message ?? `The request timed out.`);
    this.name = 'AgentRequestTimeoutError';
  }
}

interface AbortSignalFactory {
  timeout(ms: number): unknown;
}

function timeoutSignal(ms: number): unknown {
  const factory = (globalThis as { AbortSignal?: AbortSignalFactory }).AbortSignal;
  if (!factory || typeof factory.timeout !== 'function') return undefined;
  try {
    return factory.timeout(ms);
  } catch {
    return undefined;
  }
}

/** `request.timeoutInterval = seconds` — aborts the request when it elapses. */
export async function fetchWithTimeout(
  url: string,
  init: AgentFetchInit,
  timeoutSeconds: number,
  fetchImpl?: AgentFetch,
): Promise<AgentFetchResponse> {
  const impl = getAgentFetch(fetchImpl);
  const signal = timeoutSignal(timeoutSeconds * 1000);
  try {
    return await impl(url, signal === undefined ? init : { ...init, signal });
  } catch (error) {
    if (isTimeoutError(error)) {
      throw new AgentRequestTimeoutError(timeoutSeconds, (error as Error).message);
    }
    throw error;
  }
}

export function isTimeoutError(error: unknown): boolean {
  if (error instanceof AgentRequestTimeoutError) return true;
  const named = error as { name?: string; message?: string };
  if (!named) return false;
  if (named.name === 'TimeoutError' || named.name === 'AbortError') return true;
  return typeof named.message === 'string' && /timed? out|timeout|network connection was lost/i.test(named.message);
}

/** `error.code != .cannotConnectToHost` in `isPortOpen`. */
export function isConnectionRefused(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string } }).cause;
  if (cause?.code === 'ECONNREFUSED') return true;
  const message = (error as { message?: string }).message ?? '';
  return /ECONNREFUSED|cannot connect|connection refused/i.test(message);
}

/** `ProcessInfo.processInfo.environment[name]` */
export function environmentValue(name: string): string | undefined {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.[name];
}

// MARK: - base64 (no atob/Buffer in a pure-TS core)

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** `Data(base64Encoded:)` — nil (null here) for malformed input. */
export function decodeBase64(text: string): Uint8Array | null {
  const clean = text.replace(/[\r\n\s]/g, '');
  if (clean.length % 4 !== 0) return null;
  const lookup = new Map<string, number>();
  for (let i = 0; i < BASE64_ALPHABET.length; i++) lookup.set(BASE64_ALPHABET[i]!, i);
  let padding = 0;
  if (clean.endsWith('==')) padding = 2;
  else if (clean.endsWith('=')) padding = 1;
  const bytes = new Uint8Array((clean.length / 4) * 3 - padding);
  let offset = 0;
  for (let i = 0; i < clean.length; i += 4) {
    let block = 0;
    for (let j = 0; j < 4; j++) {
      const char = clean[i + j]!;
      if (char === '=') {
        block <<= 6;
        continue;
      }
      const value = lookup.get(char);
      if (value === undefined) return null;
      block = (block << 6) | value;
    }
    if (offset < bytes.length) bytes[offset++] = (block >> 16) & 0xff;
    if (offset < bytes.length) bytes[offset++] = (block >> 8) & 0xff;
    if (offset < bytes.length) bytes[offset++] = block & 0xff;
  }
  return bytes;
}

export function encodeBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = i + 1 < bytes.length ? bytes[i + 1]! : undefined;
    const b2 = i + 2 < bytes.length ? bytes[i + 2]! : undefined;
    out += BASE64_ALPHABET[b0 >> 2];
    out += BASE64_ALPHABET[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    out += b1 === undefined ? '=' : BASE64_ALPHABET[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    out += b2 === undefined ? '=' : BASE64_ALPHABET[b2 & 0x3f];
  }
  return out;
}
