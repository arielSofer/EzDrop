import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MCPServer, MCPToolError, MCPToolResult, type MCPToolDefinition } from '../mcp/MCPServer.js';
import { makePrompts, serverInstructions } from '../mcp/prompts.js';

const logs: string[] = [];
let server: MCPServer;
let base: string;

const tools: MCPToolDefinition[] = [
  {
    name: 'echo_tool',
    description: 'Echoes its argument.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
    handler: async (args) => MCPToolResult.text(`echo: ${String(args['text'] ?? '')}`),
  },
  {
    name: 'failing_tool',
    description: 'Throws.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => { throw new MCPToolError('Designer is not available.'); },
  },
];

async function rpc(body: unknown, headers: Record<string, string> = {}, method = 'POST', path = '/mcp') {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });
  const text = await response.text();
  return { status: response.status, headers: response.headers, text, json: text && (response.headers.get("content-type") ?? "").includes("json") ? JSON.parse(text) : null };
}

beforeAll(async () => {
  server = new MCPServer({ port: 0, instructions: serverInstructions }, tools, makePrompts(), (message) => logs.push(message));
  await new Promise<void>((resolve, reject) => {
    server.start((running, error) => (running ? resolve() : error ? reject(new Error(error)) : undefined));
  });
  base = `http://127.0.0.1:${server.boundPort}`;
});

afterAll(() => {
  server.stop();
});

describe('MCPServer transport (MCPServer.swift)', () => {
  it('negotiates initialize with the Swift server info', async () => {
    const { status, json } = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', clientInfo: { name: 'vitest' } } });
    expect(status).toBe(200);
    expect(json.result.protocolVersion).toBe('2025-03-26');
    expect(json.result.serverInfo).toEqual({ name: 'AgenticDesigner', title: 'Agentic Designer', version: '1.0.0' });
    expect(json.result.capabilities).toEqual({ tools: {}, prompts: { listChanged: false } });
    expect(json.result.instructions).toContain('AgenticDesigner is a macOS visual app-design tool');
    expect(logs).toContain('🔌 MCP: initialize from vitest (protocol 2025-03-26)');
  });

  it('falls back to the newest protocol version for unknown requests', async () => {
    const { json } = await rpc({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } });
    expect(json.result.protocolVersion).toBe('2025-06-18');
  });

  it('answers ping with an empty result', async () => {
    const { json } = await rpc({ jsonrpc: '2.0', id: 3, method: 'ping' });
    expect(json).toEqual({ jsonrpc: '2.0', id: 3, result: {} });
  });

  it('lists tools with name/description/inputSchema', async () => {
    const { json } = await rpc({ jsonrpc: '2.0', id: 4, method: 'tools/list' });
    expect(json.result.tools).toEqual(tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })));
    expect(logs).toContain('🔌 MCP: tools/list → 2 tools');
  });

  it('calls a tool and wraps the result', async () => {
    const { json } = await rpc({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'echo_tool', arguments: { text: 'hi' } } });
    expect(json.result).toEqual({ content: [{ type: 'text', text: 'echo: hi' }], isError: false });
    expect(logs.some((line) => /^🔌 MCP: called echo_tool \(\d+ms\)$/.test(line))).toBe(true);
  });

  it('turns a throwing handler into an Error: … isError result', async () => {
    const { json } = await rpc({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'failing_tool', arguments: {} } });
    expect(json.result).toEqual({ content: [{ type: 'text', text: 'Error: Designer is not available.' }], isError: true });
  });

  it('rejects unknown tools and missing names with -32602', async () => {
    const unknown = await rpc({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'nope' } });
    expect(unknown.json.error).toEqual({ code: -32602, message: 'Unknown tool: nope' });
    const missing = await rpc({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: {} });
    expect(missing.json.error.message).toBe("Missing tool 'name'.");
  });

  it('serves prompts/list and prompts/get', async () => {
    const list = await rpc({ jsonrpc: '2.0', id: 9, method: 'prompts/list' });
    expect(list.json.result.prompts[0].name).toBe('build_production_app');
    expect(list.json.result.prompts[0].arguments).toHaveLength(7);
    const get = await rpc({ jsonrpc: '2.0', id: 10, method: 'prompts/get', params: { name: 'build_production_app', arguments: { app_name: 'PaceGuard' } } });
    expect(get.json.result.messages[0].role).toBe('user');
    expect(get.json.result.messages[0].content.text).toContain('App name: PaceGuard   Bundle id: [BUNDLE_ID]');
    const bad = await rpc({ jsonrpc: '2.0', id: 11, method: 'prompts/get', params: { name: 'zzz' } });
    expect(bad.json.error).toEqual({ code: -32602, message: 'Unknown prompt: zzz' });
  });

  it('returns 202 for notifications', async () => {
    const { status, text } = await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(status).toBe(202);
    expect(text).toBe('');
  });

  it('returns -32601 for unknown methods', async () => {
    const { json } = await rpc({ jsonrpc: '2.0', id: 12, method: 'resources/list' });
    expect(json.error).toEqual({ code: -32601, message: 'Method not found: resources/list' });
  });

  it('returns 400 parse / batch / missing-method errors', async () => {
    const parse = await rpc('{not json');
    expect(parse.status).toBe(400);
    expect(parse.json.error.code).toBe(-32700);
    const batch = await rpc([{ jsonrpc: '2.0', id: 1, method: 'ping' }]);
    expect(batch.status).toBe(400);
    expect(batch.json.error.message).toBe('Batched JSON-RPC messages are not supported — send one message per request.');
    const missing = await rpc({ jsonrpc: '2.0', id: 13 });
    expect(missing.status).toBe(400);
    expect(missing.json.error.message).toBe("Missing 'method'.");
  });

  it('returns 405 with Allow: POST on GET and DELETE', async () => {
    const get = await rpc(null, {}, 'GET');
    expect(get.status).toBe(405);
    expect(get.headers.get('allow')).toBe('POST');
    const del = await rpc(null, {}, 'DELETE');
    expect(del.status).toBe(405);
  });

  it('rejects non-loopback origins with 403 and accepts local ones', async () => {
    const evil = await rpc({ jsonrpc: '2.0', id: 14, method: 'ping' }, { Origin: 'https://evil.example.com' });
    expect(evil.status).toBe(403);
    expect(evil.text).toBe('Forbidden origin');
    const local = await rpc({ jsonrpc: '2.0', id: 15, method: 'ping' }, { Origin: 'http://localhost:5173' });
    expect(local.status).toBe(200);
  });

  it('404s other paths but accepts /', async () => {
    const other = await rpc({ jsonrpc: '2.0', id: 16, method: 'ping' }, {}, 'POST', '/nope');
    expect(other.status).toBe(404);
    expect(other.text).toBe('Not found — MCP endpoint is /mcp');
    const root = await rpc({ jsonrpc: '2.0', id: 17, method: 'ping' }, {}, 'POST', '/');
    expect(root.status).toBe(200);
  });
});
