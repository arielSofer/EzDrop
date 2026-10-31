// Ported 1:1 from AgenticDesigner/Services/MCPServer.swift
//
// Embedded MCP server (Streamable HTTP transport, JSON-RPC 2.0) so external
// agents — Claude Code, Claude Desktop, any MCP client — can connect and
// drive the editor. Stateless (no session ids), single JSON-RPC message per
// POST, responses are plain application/json. Binds to 127.0.0.1 only and
// rejects non-local Origin headers (anti DNS-rebinding).
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export type JSONObject = Record<string, unknown>;

// MARK: - Tool surface (implemented by MCPServerController / ToolRelay)

export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: JSONObject;
  handler: (args: JSONObject) => Promise<MCPToolResult>;
}

// MARK: - Prompts

export interface MCPPromptArgument {
  name: string;
  description: string;
  required: boolean;
}

export interface MCPPromptDefinition {
  name: string;
  description: string;
  arguments: MCPPromptArgument[];
  /// Builds the prompt text from the (optional) argument values a client passes.
  build: (args: Record<string, string>) => string;
}

export type MCPContentItem =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

export interface MCPToolResult {
  content: MCPContentItem[];
  isError: boolean;
}

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

/// MCPContentItem.jsonObject
export function contentItemJSONObject(item: MCPContentItem): JSONObject {
  switch (item.type) {
    case 'text':
      return { type: 'text', text: item.text };
    case 'image':
      return { type: 'image', data: item.data, mimeType: item.mimeType };
  }
}

/// Normalises whatever the editor sent back over the bridge into MCPToolResult.
export function normalizeToolResult(value: unknown): MCPToolResult {
  if (typeof value === 'string') return MCPToolResult.text(value);
  if (value && typeof value === 'object' && Array.isArray((value as MCPToolResult).content)) {
    const raw = value as { content: unknown[]; isError?: unknown };
    const content: MCPContentItem[] = [];
    for (const item of raw.content) {
      if (!item || typeof item !== 'object') continue;
      const entry = item as Record<string, unknown>;
      if (entry.type === 'image' && typeof entry.data === 'string') {
        content.push({ type: 'image', data: entry.data, mimeType: typeof entry.mimeType === 'string' ? entry.mimeType : 'image/png' });
      } else if (typeof entry.text === 'string') {
        content.push({ type: 'text', text: entry.text });
      }
    }
    return { content, isError: raw.isError === true };
  }
  return MCPToolResult.text(JSON.stringify(value ?? null));
}

export class MCPToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MCPToolError';
  }
  /// LocalizedError.errorDescription
  get errorDescription(): string {
    return this.message;
  }
}

// MARK: - Server

export interface MCPServerConfiguration {
  port: number;
  path?: string;
  serverName?: string;
  serverVersion?: string;
  instructions?: string;
}

interface ResolvedConfiguration {
  port: number;
  path: string;
  serverName: string;
  serverVersion: string;
  instructions: string;
}

export function makeMCPServerConfiguration(partial: MCPServerConfiguration): ResolvedConfiguration {
  return {
    port: partial.port,
    path: partial.path ?? '/mcp',
    serverName: partial.serverName ?? 'AgenticDesigner',
    serverVersion: partial.serverVersion ?? '1.0.0',
    instructions: partial.instructions ?? '',
  };
}

interface RPCError {
  code: number;
  message: string;
}

const RPCError = {
  methodNotFound(method: string): RPCError {
    return { code: -32601, message: `Method not found: ${method}` };
  },
  invalidParams(message: string): RPCError {
    return { code: -32602, message };
  },
  invalidRequest(message: string): RPCError {
    return { code: -32600, message };
  },
};

type RPCOutcome = { success: JSONObject } | { failure: RPCError };

export type MCPToolSource = MCPToolDefinition[] | (() => MCPToolDefinition[]);

export class MCPServer {
  static readonly supportedProtocolVersions = ['2024-11-05', '2025-03-26', '2025-06-18'];
  private static readonly maxBodyBytes = 20 * 1024 * 1024;

  readonly configuration: ResolvedConfiguration;
  private readonly toolSource: MCPToolSource;
  private readonly prompts: MCPPromptDefinition[];
  private readonly log: (message: string) => void;
  private listener: http.Server | null = null;

  constructor(
    configuration: MCPServerConfiguration,
    tools: MCPToolSource,
    prompts: MCPPromptDefinition[] = [],
    log: (message: string) => void = () => {},
  ) {
    this.configuration = makeMCPServerConfiguration(configuration);
    this.toolSource = tools;
    this.prompts = prompts;
    this.log = log;
  }

  private get tools(): MCPToolDefinition[] {
    return typeof this.toolSource === 'function' ? this.toolSource() : this.toolSource;
  }

  /// The port actually bound (differs from configuration.port only when 0 was requested by a test).
  get boundPort(): number {
    const address = this.listener?.address() as AddressInfo | null | undefined;
    return address?.port ?? this.configuration.port;
  }

  get isListening(): boolean {
    return this.listener?.listening ?? false;
  }

  start(onStateChange: (running: boolean, error: string | null) => void): void {
    const listener = http.createServer((request, response) => {
      this.handle(request, response);
    });
    listener.keepAliveTimeout = 65_000;
    listener.on('error', (error: NodeJS.ErrnoException) => {
      const description = error.code === 'EADDRINUSE'
        ? `Address already in use (port ${this.configuration.port})`
        : error.message;
      this.log(`🔌 MCP: server failed — ${description}`);
      this.listener = null;
      onStateChange(false, description);
    });
    listener.on('close', () => {
      onStateChange(false, null);
    });
    // Loopback binding: the server must never be reachable from the network.
    listener.listen(this.configuration.port, '127.0.0.1', () => {
      this.log(`🔌 MCP: server listening on 127.0.0.1:${this.boundPort}`);
      onStateChange(true, null);
    });
    this.listener = listener;
  }

  stop(): void {
    const listener = this.listener;
    this.listener = null;
    if (listener) {
      listener.close();
      listener.closeAllConnections?.();
    }
  }

  // MARK: - Connection handling

  private handle(request: http.IncomingMessage, response: http.ServerResponse): void {
    const chunks: Buffer[] = [];
    let total = 0;
    let tooLarge = false;
    request.on('data', (chunk: Buffer) => {
      if (tooLarge) return;
      total += chunk.length;
      if (total > MCPServer.maxBodyBytes) {
        tooLarge = true;
        MCPServer.writeResponse(response, 413, null);
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', async () => {
      if (tooLarge) return;
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(request.headers)) {
        if (typeof value === 'string') headers[key.toLowerCase()] = value;
        else if (Array.isArray(value)) headers[key.toLowerCase()] = value.join(', ');
      }
      const { status, body, contentType, extraHeaders, close } = await this.respond({
        method: (request.method ?? 'GET').toUpperCase(),
        path: request.url ?? '/',
        headers,
        body: Buffer.concat(chunks),
      });
      if (close) response.setHeader('Connection', 'close');
      MCPServer.writeResponse(response, status, body, contentType, extraHeaders);
    });
    request.on('error', () => {
      MCPServer.writeResponse(response, 400, null);
    });
  }

  // MARK: - Routing

  private async respond(request: { method: string; path: string; headers: Record<string, string>; body: Buffer }): Promise<{
    status: number;
    body: Buffer | null;
    contentType?: string;
    extraHeaders?: Record<string, string>;
    close?: boolean;
  }> {
    // Reject cross-origin browser calls: local tools only.
    const origin = request.headers['origin'];
    if (origin) {
      const host = MCPServer.hostOf(origin);
      if (host !== null && !['127.0.0.1', 'localhost', '::1'].includes(host.toLowerCase())) {
        return { status: 403, body: Buffer.from('Forbidden origin', 'utf8'), contentType: 'text/plain', close: true };
      }
    }

    const normalizedPath = request.path.split('?')[0] ?? request.path;
    if (normalizedPath !== this.configuration.path && normalizedPath !== '/') {
      return {
        status: 404,
        body: Buffer.from(`Not found — MCP endpoint is ${this.configuration.path}`, 'utf8'),
        contentType: 'text/plain',
      };
    }

    switch (request.method) {
      case 'POST': {
        const [status, payload] = await this.handleRPC(request.body);
        return { status, body: payload };
      }
      case 'OPTIONS':
        return { status: 204, body: null };
      case 'GET':
      case 'DELETE':
        // Stateless server: no SSE stream to open, no session to delete.
        return { status: 405, body: null, extraHeaders: { Allow: 'POST' } };
      default:
        return { status: 405, body: null, extraHeaders: { Allow: 'POST' } };
    }
  }

  private static hostOf(origin: string): string | null {
    try {
      const url = new URL(origin);
      // URL.hostname keeps the brackets on IPv6 literals; Swift's URL.host does not.
      return url.hostname.replace(/^\[|\]$/g, '');
    } catch {
      return null;
    }
  }

  // MARK: - JSON-RPC

  async handleRPC(body: Buffer | string): Promise<[number, Buffer | null]> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(typeof body === 'string' ? body : body.toString('utf8'));
    } catch {
      return [400, MCPServer.encodeErrorEnvelope(null, { code: -32700, message: 'Parse error: body is not valid JSON' })];
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return [400, MCPServer.encodeErrorEnvelope(null, RPCError.invalidRequest('Batched JSON-RPC messages are not supported — send one message per request.'))];
    }

    const message = parsed as JSONObject;
    const method = message['method'];
    if (typeof method !== 'string') {
      return [400, MCPServer.encodeErrorEnvelope(message['id'] ?? null, RPCError.invalidRequest("Missing 'method'."))];
    }

    const id = message['id'];
    const isNotification = id === undefined || id === null;
    const params = (message['params'] && typeof message['params'] === 'object' ? message['params'] : {}) as JSONObject;

    if (isNotification) {
      // notifications/initialized, notifications/cancelled, …
      return [202, null];
    }

    const outcome = await this.dispatch(method, params);
    if ('success' in outcome) {
      return [200, MCPServer.encodeResultEnvelope(id, outcome.success)];
    }
    return [200, MCPServer.encodeErrorEnvelope(id, outcome.failure)];
  }

  private async dispatch(method: string, params: JSONObject): Promise<RPCOutcome> {
    switch (method) {
      case 'initialize': {
        const requested = typeof params['protocolVersion'] === 'string' ? params['protocolVersion'] : '';
        const negotiated = MCPServer.supportedProtocolVersions.includes(requested)
          ? requested
          : MCPServer.supportedProtocolVersions[MCPServer.supportedProtocolVersions.length - 1]!;
        const clientInfo = params['clientInfo'] as JSONObject | undefined;
        const clientName = typeof clientInfo?.['name'] === 'string' ? (clientInfo['name'] as string) : 'unknown client';
        this.log(`🔌 MCP: initialize from ${clientName} (protocol ${negotiated})`);

        const capabilities: JSONObject = { tools: {} };
        if (this.prompts.length > 0) capabilities['prompts'] = { listChanged: false };
        return {
          success: {
            protocolVersion: negotiated,
            capabilities,
            serverInfo: {
              name: this.configuration.serverName,
              title: 'Agentic Designer',
              version: this.configuration.serverVersion,
            },
            instructions: this.configuration.instructions,
          },
        };
      }

      case 'ping':
        return { success: {} };

      case 'prompts/list':
        this.log(`🔌 MCP: prompts/list → ${this.prompts.length} prompts`);
        return {
          success: {
            prompts: this.prompts.map((prompt) => ({
              name: prompt.name,
              description: prompt.description,
              arguments: prompt.arguments.map((argument) => ({
                name: argument.name,
                description: argument.description,
                required: argument.required,
              })),
            })),
          },
        };

      case 'prompts/get': {
        const name = params['name'];
        if (typeof name !== 'string') {
          return { failure: RPCError.invalidParams("Missing prompt 'name'.") };
        }
        const prompt = this.prompts.find((candidate) => candidate.name === name);
        if (!prompt) {
          return { failure: RPCError.invalidParams(`Unknown prompt: ${name}`) };
        }
        const rawArgs = (params['arguments'] && typeof params['arguments'] === 'object' ? params['arguments'] : {}) as JSONObject;
        const args: Record<string, string> = {};
        for (const [key, value] of Object.entries(rawArgs)) {
          args[key] = typeof value === 'string' ? value : String(value);
        }
        this.log(`🔌 MCP: prompts/get ${name}`);
        return {
          success: {
            description: prompt.description,
            messages: [
              {
                role: 'user',
                content: { type: 'text', text: prompt.build(args) },
              },
            ],
          },
        };
      }

      case 'tools/list': {
        const tools = this.tools;
        this.log(`🔌 MCP: tools/list → ${tools.length} tools`);
        return {
          success: {
            tools: tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              inputSchema: tool.inputSchema,
            })),
          },
        };
      }

      case 'tools/call': {
        const name = params['name'];
        if (typeof name !== 'string') {
          return { failure: RPCError.invalidParams("Missing tool 'name'.") };
        }
        const tool = this.tools.find((candidate) => candidate.name === name);
        if (!tool) {
          return { failure: RPCError.invalidParams(`Unknown tool: ${name}`) };
        }

        const args = (params['arguments'] && typeof params['arguments'] === 'object' ? params['arguments'] : {}) as JSONObject;
        const started = Date.now();

        try {
          const result = await tool.handler(args);
          const ms = Date.now() - started;
          this.log(`🔌 MCP: called ${name} (${ms}ms)${result.isError ? ' — tool error' : ''}`);
          return {
            success: {
              content: result.content.map(contentItemJSONObject),
              isError: result.isError,
            },
          };
        } catch (error) {
          const ms = Date.now() - started;
          const description = error instanceof Error ? error.message : String(error);
          this.log(`🔌 MCP: called ${name} (${ms}ms) — failed: ${description}`);
          return {
            success: {
              content: [{ type: 'text', text: `Error: ${description}` }],
              isError: true,
            },
          };
        }
      }

      default:
        return { failure: RPCError.methodNotFound(method) };
    }
  }

  private static encodeResultEnvelope(id: unknown, result: JSONObject): Buffer {
    return Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: id ?? null, result }), 'utf8');
  }

  private static encodeErrorEnvelope(id: unknown, error: RPCError): Buffer {
    return Buffer.from(
      JSON.stringify({ jsonrpc: '2.0', id: id ?? null, error: { code: error.code, message: error.message } }),
      'utf8',
    );
  }

  // MARK: - HTTP response builder

  static readonly statusReasons: Record<number, string> = {
    200: 'OK', 202: 'Accepted', 204: 'No Content',
    400: 'Bad Request', 403: 'Forbidden', 404: 'Not Found',
    405: 'Method Not Allowed', 413: 'Payload Too Large', 500: 'Internal Server Error',
  };

  private static writeResponse(
    response: http.ServerResponse,
    status: number,
    body: Buffer | null,
    contentType: string = 'application/json',
    extraHeaders: Record<string, string> = {},
  ): void {
    if (response.headersSent || response.writableEnded) return;
    response.statusMessage = MCPServer.statusReasons[status] ?? 'Unknown';
    response.statusCode = status;
    if (body && body.length > 0) {
      response.setHeader('Content-Type', contentType);
      response.setHeader('Content-Length', String(body.length));
    } else {
      response.setHeader('Content-Length', '0');
    }
    for (const [key, value] of Object.entries(extraHeaders)) {
      response.setHeader(key, value);
    }
    response.end(body && body.length > 0 ? body : undefined);
  }
}
