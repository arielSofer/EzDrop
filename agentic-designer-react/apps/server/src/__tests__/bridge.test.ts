import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { BridgeServer } from '../bridge/BridgeServer.js';
import { decodeEnvelope, encodeEnvelope, type BridgeEnvelope } from '../bridge/protocol.js';
import { MCPServer } from '../mcp/MCPServer.js';
import { ToolRelay } from '../mcp/toolRelay.js';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-bridge-test-'));
process.env.AGENTIC_DOT_DIR = scratch;

let bridge: BridgeServer;
let relay: ToolRelay;
let mcp: MCPServer;
let mcpBase: string;

function connect(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${bridge.boundPort}`, { origin: 'http://localhost:5173' });
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function nextMessage(ws: WebSocket, predicate: (envelope: BridgeEnvelope) => boolean = () => true): Promise<BridgeEnvelope> {
  return new Promise((resolve) => {
    const listener = (data: WebSocket.RawData) => {
      const envelope = decodeEnvelope(data.toString());
      if (predicate(envelope)) {
        ws.off('message', listener);
        resolve(envelope);
      }
    };
    ws.on('message', listener);
  });
}

async function call(ws: WebSocket, name: string, args: unknown): Promise<BridgeEnvelope> {
  const id = `c${Math.random().toString(36).slice(2)}`;
  const response = nextMessage(ws, (envelope) => envelope.type === 'response' && envelope.id === id);
  ws.send(encodeEnvelope({ id, type: 'request', name, args }));
  return response;
}

async function rpc(body: unknown) {
  const response = await fetch(`${mcpBase}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return response.json() as Promise<any>;
}

beforeAll(async () => {
  bridge = new BridgeServer({ port: 0 });
  relay = new ToolRelay(bridge);
  bridge.handle('editor.register', (args, context) => {
    const report = relay.register(args.tools);
    bridge.setEditor(context.socket);
    return report;
  });
  bridge.handle('bridge.ping', () => ({ pong: true }));
  bridge.handle('echo', (args) => ({ echoed: args }));
  bridge.handle('boom', () => { throw new Error("'path' is required."); });
  await bridge.start();
  mcp = new MCPServer({ port: 0 }, () => relay.definitions(), []);
  await new Promise<void>((resolve) => mcp.start((running) => running && resolve()));
  mcpBase = `http://127.0.0.1:${mcp.boundPort}`;
});

afterAll(async () => {
  mcp.stop();
  await bridge.stop();
  fs.rmSync(scratch, { recursive: true, force: true });
});

describe('bridge envelope', () => {
  it('round-trips request / response / event envelopes', () => {
    const request: BridgeEnvelope = { id: '1', type: 'request', name: 'git.status', args: { projectName: 'X' } };
    const response: BridgeEnvelope = { id: '1', type: 'response', ok: false, error: 'Designer is not available.' };
    const event: BridgeEnvelope = { type: 'event', name: 'mcp.log', payload: { message: 'hi' } };
    expect(decodeEnvelope(encodeEnvelope(request))).toEqual(request);
    expect(decodeEnvelope(encodeEnvelope(response))).toEqual({ ...response, result: undefined });
    expect(decodeEnvelope(encodeEnvelope(event))).toEqual(event);
  });

  it('rejects malformed messages', () => {
    expect(() => decodeEnvelope('nope')).toThrow('Bridge message is not valid JSON.');
    expect(() => decodeEnvelope('{"type":"request"}')).toThrow("Bridge request needs string 'id' and 'name'.");
    expect(() => decodeEnvelope('{"type":"weird"}')).toThrow('Unknown bridge message type: weird');
  });
});

describe('BridgeServer', () => {
  it('dispatches requests to handlers and reports errors as ok:false', async () => {
    const ws = await connect();
    expect(await call(ws, 'echo', { a: 1 })).toMatchObject({ type: 'response', ok: true, result: { echoed: { a: 1 } } });
    expect(await call(ws, 'boom', {})).toMatchObject({ ok: false, error: "'path' is required." });
    expect(await call(ws, 'missing.handler', {})).toMatchObject({ ok: false, error: 'Unknown bridge request: missing.handler' });
    ws.close();
  });

  it('serves /health and rejects foreign origins', async () => {
    const health = await fetch(`http://127.0.0.1:${bridge.boundPort}/health`);
    expect(health.status).toBe(200);
    expect(((await health.json()) as { ok: boolean }).ok).toBe(true);
    const evil = await fetch(`http://127.0.0.1:${bridge.boundPort}/health`, { headers: { Origin: 'https://evil.example.com' } });
    expect(evil.status).toBe(403);
  });

  it('proxies POST /proxy to a target and streams the body back', async () => {
    const proxied = await fetch(`http://127.0.0.1:${bridge.boundPort}/proxy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
      body: JSON.stringify({ url: `${mcpBase}/mcp`, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { jsonrpc: '2.0', id: 1, method: 'ping' } }),
    });
    expect(proxied.status).toBe(200);
    expect(proxied.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    expect(await proxied.json()).toEqual({ jsonrpc: '2.0', id: 1, result: {} });
  });
});

describe('tool relay (MCPServerController registry lives in the editor)', () => {
  it('fails tools/call with the unattached message when no editor is connected', async () => {
    relay.register([{ name: 'get_project_overview', description: 'Overview.', inputSchema: { type: 'object', properties: {} } }]);
    const result = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_project_overview', arguments: {} } });
    expect(result.result).toEqual({ content: [{ type: 'text', text: 'Error: Designer is not available.' }], isError: true });
  });

  it('lists the editor registry and relays tools/call to the editor', async () => {
    const editor = await connect();
    const registration = (await call(editor, "editor.register", {
      tools: [
        { name: 'get_project_overview', description: 'Project name, pages, screens, node counts.', inputSchema: { type: 'object', properties: {} } },
        { name: 'not_a_swift_tool', description: 'x', inputSchema: { type: 'object' } },
      ],
    })) as { ok: boolean; result: { accepted: number; unknown: string[]; missing: string[] } };
    expect(registration).toMatchObject({ ok: true, result: { accepted: 2, unknown: ['not_a_swift_tool'] } });
    expect(registration.result.missing).toContain('apply_design_actions');
    expect(bridge.editorConnected).toBe(true);

    const list = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    expect(list.result.tools.map((tool: any) => tool.name)).toEqual(['get_project_overview', 'not_a_swift_tool']);

    // The editor answers mcp.callTool with an MCPToolResult.
    editor.on('message', (data) => {
      const envelope = decodeEnvelope(data.toString());
      if (envelope.type === 'request' && envelope.name === 'mcp.callTool') {
        const args = envelope.args as { name: string; arguments: Record<string, unknown> };
        editor.send(encodeEnvelope({
          id: envelope.id, type: 'response', ok: true,
          result: { content: [{ type: 'text', text: `ran ${args.name} with ${JSON.stringify(args.arguments)}` }], isError: false },
        }));
      }
    });
    const called = await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_project_overview', arguments: { pageIndex: 1 } } });
    expect(called.result).toEqual({ content: [{ type: 'text', text: 'ran get_project_overview with {"pageIndex":1}' }], isError: false });

    // The registry is cached for offline tools/list.
    const cache = JSON.parse(fs.readFileSync(ToolRelay.cachePath(), 'utf8'));
    expect(cache).toHaveLength(2);

    editor.close();
    await new Promise((resolve) => bridge.once('editorDisconnected', resolve));
    const after = await rpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_project_overview', arguments: {} } });
    expect(after.result.isError).toBe(true);
    expect(after.result.content[0].text).toBe('Error: Designer is not available.');
  });
});
