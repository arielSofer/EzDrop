// The MCP tool registry lives in the browser (the web port of
// MCPServerController.makeTools). On connect the editor sends every tool's
// name / description / inputSchema verbatim; `tools/list` serves that list and
// `tools/call` forwards to the editor, which executes against the live state
// and returns an MCPToolResult. Without an editor the handler throws the same
// message the Swift controller throws for an unattached view model
// ("Designer is not available.") so tools/call yields the identical
// `Error: …` isError result.
import fs from 'node:fs';
import path from 'node:path';
import { agenticDotDirectory, ensureDirectory } from '../platform/Paths.js';
import { BridgeServer, editorNotConnectedMessage } from '../bridge/BridgeServer.js';
import type { BridgeToolDefinition } from '../bridge/protocol.js';
import { MCPToolError, normalizeToolResult, type JSONObject, type MCPToolDefinition } from './MCPServer.js';
import { MCPToolNameSet, MCPToolNames } from './toolNames.js';

export interface RegistrationReport {
  accepted: number;
  /// Names the editor sent that the Swift controller does not define.
  unknown: string[];
  /// Swift controller tools the editor did not register.
  missing: string[];
}

export class ToolRelay {
  private registry: BridgeToolDefinition[] = [];
  private readonly bridge: BridgeServer;
  private readonly log: (message: string) => void;

  constructor(bridge: BridgeServer, log: (message: string) => void = () => {}) {
    this.bridge = bridge;
    this.log = log;
    this.registry = ToolRelay.loadCache();
  }

  static cachePath(): string {
    return path.join(agenticDotDirectory(), 'mcp-tools-cache.json');
  }

  /// The last registry the editor sent, so `tools/list` still describes the
  /// tools while the tab is closed (calls then fail with the unattached message).
  private static loadCache(): BridgeToolDefinition[] {
    try {
      const parsed = JSON.parse(fs.readFileSync(ToolRelay.cachePath(), 'utf8'));
      return Array.isArray(parsed) ? parsed.filter(ToolRelay.isDefinition) : [];
    } catch {
      return [];
    }
  }

  private static saveCache(tools: BridgeToolDefinition[]): void {
    try {
      ensureDirectory(path.dirname(ToolRelay.cachePath()));
      fs.writeFileSync(ToolRelay.cachePath(), JSON.stringify(tools), 'utf8');
    } catch {
      // A cache miss only costs the offline tools/list.
    }
  }

  private static isDefinition(value: unknown): value is BridgeToolDefinition {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Record<string, unknown>;
    return typeof candidate.name === 'string' && typeof candidate.description === 'string'
      && !!candidate.inputSchema && typeof candidate.inputSchema === 'object';
  }

  get toolCount(): number {
    return this.registry.length;
  }

  get registeredTools(): readonly BridgeToolDefinition[] {
    return this.registry;
  }

  register(tools: unknown): RegistrationReport {
    const list = Array.isArray(tools) ? tools.filter(ToolRelay.isDefinition) : [];
    const seen = new Set<string>();
    const accepted: BridgeToolDefinition[] = [];
    for (const tool of list) {
      if (seen.has(tool.name)) continue;
      seen.add(tool.name);
      accepted.push({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema });
    }
    const unknown = accepted.map((tool) => tool.name).filter((name) => !MCPToolNameSet.has(name));
    const missing = MCPToolNames.filter((name) => !seen.has(name));
    this.registry = accepted;
    ToolRelay.saveCache(accepted);
    this.log(`🔌 MCP: editor registered ${accepted.length} tools${unknown.length ? ` (unknown: ${unknown.join(', ')})` : ''}${missing.length ? ` (missing ${missing.length}: ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ', …' : ''})` : ''}`);
    return { accepted: accepted.length, unknown, missing };
  }

  /// MCPToolDefinition[] for MCPServer — one relay handler per registered tool.
  definitions(): MCPToolDefinition[] {
    return this.registry.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      handler: (args: JSONObject) => this.call(tool.name, args),
    }));
  }

  async call(name: string, args: JSONObject) {
    if (!this.bridge.editorConnected) {
      throw new MCPToolError(editorNotConnectedMessage);
    }
    let result: unknown;
    try {
      result = await this.bridge.requestEditor('mcp.callTool', { name, arguments: args });
    } catch (error) {
      throw new MCPToolError(error instanceof Error ? error.message : String(error));
    }
    return normalizeToolResult(result);
  }
}
