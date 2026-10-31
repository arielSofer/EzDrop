// Ported 1:1 from AgenticDesigner/Services/MCPServer.swift (lines 20-80).
//
// The tool/prompt/result surface an MCP server exposes. Only the types the
// agent layer needs live here; the transport itself is `apps/server`. The JSON
// shapes below MUST match what the Node MCP server emits and accepts
// (apps/server/src/mcp/MCPServer.ts) — they are one wire format.

import type { JSONObject } from '../models/JSON';

// MARK: - Tool surface (implemented by MCPServerController)

export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: JSONObject;
  /** `handler: @MainActor ([String: Any]) async throws -> MCPToolResult` */
  handler: (args: JSONObject) => Promise<MCPToolResult>;
}

// MARK: - Prompts
// MCP prompts are reusable, parameterized templates the server offers to every
// client. Clients surface them (slash commands / template pickers), so this is
// how a methodology like "build a real, verified app" reaches ANY model that
// connects — not just one that happens to have been told.

export interface MCPPromptArgument {
  name: string;
  description: string;
  required: boolean;
}

export interface MCPPromptDefinition {
  name: string;
  description: string;
  arguments: MCPPromptArgument[];
  /** Builds the prompt text from the (optional) argument values a client passes. */
  build: (args: Record<string, string>) => string;
}

export type MCPContentItem =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

export interface MCPToolResult {
  content: MCPContentItem[];
  isError: boolean;
}

/** `MCPToolResult.text(_:)` / `.failure(_:)` (Swift static factories). */
export const MCPToolResult = {
  text(string: string): MCPToolResult {
    return { content: [{ type: 'text', text: string }], isError: false };
  },
  failure(message: string): MCPToolResult {
    return { content: [{ type: 'text', text: message }], isError: true };
  },
  image(base64: string, mimeType: string): MCPToolResult {
    return { content: [{ type: 'image', data: base64, mimeType }], isError: false };
  },
};

/** `MCPContentItem.jsonObject` */
export function mcpContentItemJSONObject(item: MCPContentItem): JSONObject {
  switch (item.type) {
    case 'text':
      return { type: 'text', text: item.text };
    case 'image':
      return { type: 'image', data: item.data, mimeType: item.mimeType };
  }
}

/** `struct MCPToolError: LocalizedError` */
export class MCPToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MCPToolError';
  }
  get errorDescription(): string {
    return this.message;
  }
}
