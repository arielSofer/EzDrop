// Ported 1:1 from AgenticDesigner/Agent/LogicAgentPromptBuilder.swift
//
// Lets the AI agent create logic chains: prompts describing the block
// catalog and the current screen, a response schema, and a translator
// that resolves element names to node IDs and lays out the graph.

import { BlockCatalog } from '../models/BlockDefinitions';
import {
  AllLogicBlockCategory,
  isLogicBlockType,
  makeBlockConnection,
  makeLogicFlow,
  makeLogicVariable,
  type BlockConnection,
  type LogicBlock,
  type LogicBlockType,
  type LogicFlow,
  type LogicVariable,
} from '../models/LogicModels';
import { getPlatform } from '../platform';
import { AIProviderError } from './AIProvider';

// MARK: - Response models

export interface LogicAgentResponse {
  plan?: string[];
  flows: GeneratedFlow[];
}

export interface GeneratedFlow {
  name: string;
  blocks: GeneratedBlock[];
  connections: GeneratedConnection[];
}

export interface GeneratedBlock {
  ref: string;
  type: string;
  x?: number;
  y?: number;
  comment?: string;
  parameters?: Record<string, string>;
}

export interface GeneratedConnection {
  from: string;
  fromPort?: number;
  to: string;
  toPort?: number;
}

/** Element/screen tuples the translator resolves names against. */
export interface LogicAgentElement {
  id: string;
  name: string;
  type: string;
}

export interface LogicAgentScreen {
  id: string;
  name: string;
}

// MARK: - Decoding (Swift's synthesized Decodable, so a wrong shape throws)

class LogicAgentDecodingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LogicAgentDecodingError';
  }
}

function requireObject(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new LogicAgentDecodingError(`Expected keyed container for ${what}.`);
  }
  return value as Record<string, unknown>;
}

function decodeGeneratedBlock(value: unknown): GeneratedBlock {
  const container = requireObject(value, 'GeneratedBlock');
  if (typeof container.ref !== 'string') throw new LogicAgentDecodingError('GeneratedBlock.ref must be a String.');
  if (typeof container.type !== 'string') throw new LogicAgentDecodingError('GeneratedBlock.type must be a String.');
  const block: GeneratedBlock = { ref: container.ref, type: container.type };
  if (typeof container.x === 'number') block.x = container.x;
  else if (container.x !== undefined && container.x !== null) throw new LogicAgentDecodingError('GeneratedBlock.x must be a number.');
  if (typeof container.y === 'number') block.y = container.y;
  else if (container.y !== undefined && container.y !== null) throw new LogicAgentDecodingError('GeneratedBlock.y must be a number.');
  if (typeof container.comment === 'string') block.comment = container.comment;
  else if (container.comment !== undefined && container.comment !== null) throw new LogicAgentDecodingError('GeneratedBlock.comment must be a String.');
  if (container.parameters !== undefined && container.parameters !== null) {
    const parameters = requireObject(container.parameters, 'GeneratedBlock.parameters');
    const mapped: Record<string, string> = {};
    for (const [key, raw] of Object.entries(parameters)) {
      if (typeof raw !== 'string') throw new LogicAgentDecodingError('GeneratedBlock.parameters must be [String: String].');
      mapped[key] = raw;
    }
    block.parameters = mapped;
  }
  return block;
}

function decodeGeneratedConnection(value: unknown): GeneratedConnection {
  const container = requireObject(value, 'GeneratedConnection');
  if (typeof container.from !== 'string') throw new LogicAgentDecodingError('GeneratedConnection.from must be a String.');
  if (typeof container.to !== 'string') throw new LogicAgentDecodingError('GeneratedConnection.to must be a String.');
  const connection: GeneratedConnection = { from: container.from, to: container.to };
  if (typeof container.fromPort === 'number') connection.fromPort = container.fromPort;
  else if (container.fromPort !== undefined && container.fromPort !== null) throw new LogicAgentDecodingError('GeneratedConnection.fromPort must be an Int.');
  if (typeof container.toPort === 'number') connection.toPort = container.toPort;
  else if (container.toPort !== undefined && container.toPort !== null) throw new LogicAgentDecodingError('GeneratedConnection.toPort must be an Int.');
  return connection;
}

function decodeGeneratedFlow(value: unknown): GeneratedFlow {
  const container = requireObject(value, 'GeneratedFlow');
  if (typeof container.name !== 'string') throw new LogicAgentDecodingError('GeneratedFlow.name must be a String.');
  if (!Array.isArray(container.blocks)) throw new LogicAgentDecodingError('GeneratedFlow.blocks must be an array.');
  if (!Array.isArray(container.connections)) throw new LogicAgentDecodingError('GeneratedFlow.connections must be an array.');
  return {
    name: container.name,
    blocks: container.blocks.map(decodeGeneratedBlock),
    connections: container.connections.map(decodeGeneratedConnection),
  };
}

export function decodeLogicAgentResponse(value: unknown): LogicAgentResponse {
  const container = requireObject(value, 'LogicAgentResponse');
  if (!Array.isArray(container.flows)) throw new LogicAgentDecodingError('LogicAgentResponse.flows must be an array.');
  const response: LogicAgentResponse = { flows: container.flows.map(decodeGeneratedFlow) };
  if (container.plan !== undefined && container.plan !== null) {
    if (!Array.isArray(container.plan)) throw new LogicAgentDecodingError('LogicAgentResponse.plan must be an array.');
    const plan: string[] = [];
    for (const item of container.plan) {
      if (typeof item !== 'string') throw new LogicAgentDecodingError('LogicAgentResponse.plan must be [String].');
      plan.push(item);
    }
    response.plan = plan;
  }
  return response;
}

// MARK: - Prompts

/**
 * Generates the block catalog listing from the real definitions so the
 * prompt never drifts from what the editor actually supports.
 */
function blockCatalogSection(): string {
  const lines: string[] = ['AVAILABLE BLOCKS (type — required parameters — outputs):'];

  for (const category of AllLogicBlockCategory) {
    lines.push(`\n${category}:`);
    for (const def of BlockCatalog.definitions(category)) {
      const params = def.defaultParameters
        .map((param) => {
          let kind: string;
          switch (param.type) {
            case 'nodeReference': kind = 'element name'; break;
            case 'screenReference': kind = 'screen name'; break;
            case 'variable': kind = 'variable name'; break;
            case 'dropdown':
            case 'httpMethod': kind = (param.options ?? []).join('|'); break;
            default: kind = param.type;
          }
          return `${param.key}(${kind})${param.isRequired ? '' : '?'}`;
        })
        .join(', ');

      const outputs = def.outputPortCount > 1
        ? ` — 2 outputs: 0=${def.outputPortLabels?.[0] ?? 'ok'}, 1=${def.outputPortLabels?.[def.outputPortLabels.length - 1] ?? 'error'}`
        : '';

      lines.push(`- ${def.type}: ${def.description}. Params: ${params.length === 0 ? 'none' : params}${outputs}`);
    }
  }

  return lines.join('\n');
}

export const LogicAgentPromptBuilder = {
  buildSystemPrompt(): string {
    return `You are a visual logic programmer inside a native macOS design editor.
The user has designed app screens; you now wire up their BEHAVIOR by creating flows of connected logic blocks (like a node-based visual programming tool).

Output contract — return ONLY one valid JSON object:
{
  "plan": ["Step 1: ...", "Step 2: ..."],
  "flows": [
    {
      "name": "Login Flow",
      "blocks": [
        { "ref": "b1", "type": "onTap", "parameters": { "element": "Login Button" } },
        { "ref": "b2", "type": "setLoading", "parameters": { "element": "Login Button", "loading": "true" } },
        { "ref": "b3", "type": "firebaseLogin", "parameters": { "email": "Email Input", "password": "Password Input" } },
        { "ref": "b4", "type": "navigate", "parameters": { "screen": "Home Screen" } },
        { "ref": "b5", "type": "showAlert", "parameters": { "title": "Login Failed", "message": "Check your credentials" } }
      ],
      "connections": [
        { "from": "b1", "to": "b2" },
        { "from": "b2", "to": "b3" },
        { "from": "b3", "fromPort": 0, "to": "b4" },
        { "from": "b3", "fromPort": 1, "to": "b5" }
      ]
    }
  ]
}

RULES:
1. Every flow starts with exactly ONE event block (an Events-category block). Events are triggers — they never receive connections.
2. Connect blocks in execution order. "fromPort" 0 is the main/success output (default); "fromPort" 1 is the error/else branch — only blocks listed below with 2 outputs have it. Omit fromPort/toPort when 0.
3. Every non-event block must be reachable from the event via connections. No cycles.
4. Element parameters must use the EXACT element name from SCREEN ELEMENTS in the context. Screen parameters must use exact screen names.
5. Fill every required parameter with a realistic value: real alert copy, real Firestore collection names, real URLs — no placeholders like "TODO".
6. Variables: reference existing VARIABLES by name, or introduce new camelCase names — they will be created automatically.
7. Keep flows focused: one user intention per flow (login, search, save, refresh...). Use "x"/"y" only if you want a specific layout; otherwise omit them and the editor auto-arranges the chain.
8. Handle errors: any block with a port-1 error output should have its error branch wired to user feedback (showAlert/showToast) when that matters for UX.

${blockCatalogSection()}`;
  },

  buildUserPrompt(
    request: string,
    elements: LogicAgentElement[],
    screens: LogicAgentScreen[],
    variables: LogicVariable[],
    existingFlowNames: string[],
    firebaseConfigured: boolean,
  ): string {
    const elementLines = elements.map((element) => `- ${element.name} (${element.type})`).join('\n');
    const screenLines = screens.map((screen) => `- ${screen.name}`).join('\n');
    const variableLines = variables.length === 0
      ? '(none defined yet)'
      : variables.map((variable) => `- ${variable.name} (${variable.type}, ${variable.scope})`).join('\n');

    return `User request:
${request}

SCREEN ELEMENTS (use these exact names for element parameters):
${elementLines.length === 0 ? '(no elements on canvas)' : elementLines}

SCREENS (for navigate/presentSheet targets):
${screenLines.length === 0 ? '(none)' : screenLines}

VARIABLES:
${variableLines}

Existing flows (do not duplicate their names): ${existingFlowNames.length === 0 ? 'none' : existingFlowNames.join(', ')}
Firebase configured: ${firebaseConfigured ? 'yes' : 'no — you may still use Firebase blocks; the user will configure credentials later'}

Return only the JSON object described in the system prompt. No explanations.`;
  },
} as const;

// MARK: - Translator

// Turns a decoded LogicAgentResponse into real LogicFlows: resolves element
// names to node IDs, matches parameters by key/type, and auto-lays-out the
// graph in execution order when the model didn't position blocks.

function resolveBlockType(raw: string): LogicBlockType | undefined {
  if (isLogicBlockType(raw)) return raw;
  const normalized = raw.toLowerCase().replaceAll('_', '');
  return BlockCatalog.all.find((definition) => definition.type.toLowerCase() === normalized)?.type;
}

function resolveElement(name: string, elements: LogicAgentElement[]): string | undefined {
  const query = name.toLowerCase().trim();
  const exact = elements.find((element) => element.name.toLowerCase() === query);
  if (exact) return exact.id;
  return elements.find((element) => element.name.toLowerCase().includes(query) || query.includes(element.name.toLowerCase()))?.id;
}

function resolveScreen(name: string, screens: LogicAgentScreen[]): string | undefined {
  const query = name.toLowerCase().trim();
  const exact = screens.find((screen) => screen.name.toLowerCase() === query);
  if (exact) return exact.id;
  return screens.find((screen) => screen.name.toLowerCase().includes(query))?.id;
}

function makeFlow(
  generated: GeneratedFlow,
  elements: LogicAgentElement[],
  screens: LogicAgentScreen[],
): LogicFlow | undefined {
  const refToId = new Map<string, string>();
  const blocks: LogicBlock[] = [];
  const newVariables = new Set<string>();

  for (const generatedBlock of generated.blocks) {
    const type = resolveBlockType(generatedBlock.type);
    const block = type === undefined
      ? undefined
      : BlockCatalog.makeBlock(type, { x: generatedBlock.x ?? 0, y: generatedBlock.y ?? 0 });
    if (!block) {
      getPlatform().logger.warn(`⚠️ Logic agent: unknown block type '${generatedBlock.type}' skipped`);
      continue;
    }

    if (generatedBlock.comment !== undefined) block.comment = generatedBlock.comment;

    const parameters = generatedBlock.parameters;
    if (parameters) {
      for (let paramIndex = 0; paramIndex < block.parameters.length; paramIndex++) {
        const parameter = block.parameters[paramIndex]!;
        const rawValue = parameters[parameter.key];
        if (rawValue === undefined || rawValue.length === 0) continue;

        switch (parameter.type) {
          case 'nodeReference': {
            const nodeId = resolveElement(rawValue, elements);
            if (nodeId !== undefined) parameter.nodeReference = nodeId;
            else parameter.value = rawValue;
            break;
          }
          case 'screenReference': {
            const screenId = resolveScreen(rawValue, screens);
            if (screenId !== undefined) parameter.nodeReference = screenId;
            else parameter.value = rawValue;
            break;
          }
          case 'variable':
            parameter.variableReference = rawValue;
            newVariables.add(rawValue);
            break;
          default:
            parameter.value = rawValue;
        }
      }
    }

    refToId.set(generatedBlock.ref, block.id);
    blocks.push(block);
  }

  if (blocks.length === 0) return undefined;

  const connections: BlockConnection[] = [];
  for (const generatedConnection of generated.connections) {
    const sourceId = refToId.get(generatedConnection.from);
    const targetId = refToId.get(generatedConnection.to);
    if (sourceId === undefined || targetId === undefined || sourceId === targetId) continue;

    connections.push(makeBlockConnection({
      sourceBlockId: sourceId,
      sourcePortIndex: generatedConnection.fromPort ?? 0,
      targetBlockId: targetId,
      targetPortIndex: generatedConnection.toPort ?? 0,
    }));
  }

  LogicAgentTranslator.layoutIfNeeded(blocks, connections);

  // .screen (not .flow): counters/toggles/fetched-data variables the
  // AI invents should survive between separate taps on this screen —
  // that's the whole point of state existing. .flow scope means
  // "reset every run", which would make them useless for exactly the
  // things AI-authored flows use variables for.
  const variables = [...newVariables].map((name) => makeLogicVariable({ name, type: 'string', scope: 'screen' }));

  return makeLogicFlow({ name: generated.name, blocks, connections, variables });
}

export const LogicAgentTranslator = {
  /** `decodeResponse(from:)` */
  decodeResponse(content: string): LogicAgentResponse {
    const cleaned = content
      .replaceAll('```json', '')
      .replaceAll('```', '')
      .trim();

    try {
      return decodeLogicAgentResponse(JSON.parse(cleaned));
    } catch {
      /* fall through to the brace-slice recovery */
    }

    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end < 0) {
      throw AIProviderError.invalidJSON('No JSON object in logic agent response.');
    }

    const candidate = cleaned.slice(start, end + 1);
    return decodeLogicAgentResponse(JSON.parse(candidate));
  },

  /** `makeFlows(from:elements:screens:)` */
  makeFlows(
    response: LogicAgentResponse,
    elements: LogicAgentElement[],
    screens: LogicAgentScreen[],
  ): LogicFlow[] {
    return response.flows
      .map((generated) => makeFlow(generated, elements, screens))
      .filter((flow): flow is LogicFlow => flow !== undefined);
  },

  // Auto-layout: BFS depth from event blocks sets the row; error branches
  // (port > 0) shift one lane to the right so branches read left-to-right.
  layoutIfNeeded(blocks: LogicBlock[], connections: BlockConnection[]): void {
    const unpositioned = blocks.every((b) => b.x === 0 && b.y === 0);
    if (!unpositioned) return;

    const depth = new Map<string, number>();
    const lane = new Map<string, number>();

    const targetIds = new Set(connections.map((c) => c.targetBlockId));
    const roots = blocks.filter((b) => !targetIds.has(b.id));

    roots.forEach((root, rootIndex) => {
      depth.set(root.id, 0);
      lane.set(root.id, rootIndex * 2);

      const queue: string[] = [root.id];
      while (queue.length > 0) {
        const current = queue.shift()!;
        for (const connection of connections) {
          if (connection.sourceBlockId !== current) continue;
          const target = connection.targetBlockId;
          const nextDepth = (depth.get(current) ?? 0) + 1;
          const nextLane = (lane.get(current) ?? 0) + (connection.sourcePortIndex > 0 ? 1 : 0);

          if (nextDepth > (depth.get(target) ?? -1)) {
            depth.set(target, nextDepth);
            lane.set(target, Math.max(lane.get(target) ?? 0, nextLane));
            queue.push(target);
          }
        }
      }
    });

    for (const block of blocks) {
      block.x = 80 + (lane.get(block.id) ?? 0) * 250;
      block.y = 70 + (depth.get(block.id) ?? 0) * 175;
    }
  },
};
