// WebSocket bridge between this server and the editor running in the browser.
// One envelope, both directions (see protocol.ts). The same listener also
// serves plain HTTP: `POST /proxy` (provider calls the browser cannot make
// because of CORS — Ollama, Cerebras, …) and `GET /health`.
// Loopback-only and Origin-checked exactly like MCPServer.
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import type { AddressInfo, Socket } from 'node:net';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import {
  decodeEnvelope,
  encodeEnvelope,
  type BridgeEnvelope,
  type BridgeRequestEnvelope,
  type BridgeResponseEnvelope,
} from './protocol.js';

export interface BridgeContext {
  socket: WebSocket;
  bridge: BridgeServer;
  isEditor: boolean;
}

export type BridgeHandler = (args: any, context: BridgeContext) => unknown | Promise<unknown>;

export interface BridgeServerOptions {
  port: number;
  log?: (message: string) => void;
  /// Default timeout for server→editor requests (0 = none; tool calls can take minutes).
  editorRequestTimeoutMs?: number;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer?: NodeJS.Timeout;
}

const loopbackHosts = ['127.0.0.1', 'localhost', '::1'];

export function isLoopbackOrigin(origin: string | undefined): boolean {
  if (!origin) return true; // non-browser clients (curl, MCP clients) send none
  try {
    const host = new URL(origin).hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return loopbackHosts.includes(host);
  } catch {
    return true; // unparsable Origin: mirror Swift, which only rejects a parsed non-local host
  }
}

export const editorNotConnectedMessage = 'Designer is not available.';

export class BridgeServer extends EventEmitter {
  readonly port: number;
  private readonly log: (message: string) => void;
  private readonly editorRequestTimeoutMs: number;
  private readonly handlers = new Map<string, BridgeHandler>();
  private httpServer: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private editorSocket: WebSocket | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly clients = new Set<WebSocket>();
  private nextId = 1;

  constructor(options: BridgeServerOptions) {
    super();
    this.port = options.port;
    this.log = options.log ?? (() => {});
    this.editorRequestTimeoutMs = options.editorRequestTimeoutMs ?? 0;
  }

  // MARK: - Handlers

  handle(name: string, handler: BridgeHandler): void {
    this.handlers.set(name, handler);
  }

  handlerNames(): string[] {
    return [...this.handlers.keys()];
  }

  // MARK: - Lifecycle

  get boundPort(): number {
    const address = this.httpServer?.address() as AddressInfo | null | undefined;
    return address?.port ?? this.port;
  }

  start(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((request, response) => {
        void this.handleHTTP(request, response);
      });
      const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 * 1024 });
      server.on('upgrade', (request, socket: Socket, head) => {
        if (!isLoopbackOrigin(request.headers.origin)) {
          socket.write('HTTP/1.1 403 Forbidden\r\nContent-Length: 16\r\n\r\nForbidden origin');
          socket.destroy();
          return;
        }
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit('connection', ws, request);
        });
      });
      wss.on('connection', (ws) => this.attachSocket(ws));
      server.once('error', (error) => reject(error));
      server.listen(this.port, '127.0.0.1', () => {
        this.httpServer = server;
        this.wss = wss;
        this.log(`🌉 Bridge: listening on ws://127.0.0.1:${this.boundPort} (POST /proxy, GET /health)`);
        resolve(this.boundPort);
      });
    });
  }

  async stop(): Promise<void> {
    for (const [id, request] of this.pending) {
      request.reject(new Error('Bridge server stopped.'));
      if (request.timer) clearTimeout(request.timer);
      this.pending.delete(id);
    }
    for (const client of this.clients) {
      try { client.close(1001, 'server stopping'); } catch { /* ignore */ }
    }
    this.clients.clear();
    this.editorSocket = null;
    await new Promise<void>((resolve) => {
      this.wss?.close(() => resolve());
      if (!this.wss) resolve();
    });
    await new Promise<void>((resolve) => {
      const server = this.httpServer;
      this.httpServer = null;
      if (!server) return resolve();
      server.close(() => resolve());
      server.closeAllConnections?.();
    });
    this.wss = null;
  }

  // MARK: - Editor role

  get editorConnected(): boolean {
    return this.editorSocket !== null && this.editorSocket.readyState === WebSocket.OPEN;
  }

  get clientCount(): number {
    return this.clients.size;
  }

  /// Marks the socket that sent `editor.register` as the live editor. The most
  /// recent registration wins (a reloaded tab replaces the stale one).
  setEditor(socket: WebSocket): void {
    this.editorSocket = socket;
    this.emit('editorRegistered', socket);
  }

  isEditor(socket: WebSocket): boolean {
    return this.editorSocket === socket;
  }

  /// Sends a request to the editor and resolves with its result. Rejects with
  /// the Swift controller's unattached message when no editor is connected.
  requestEditor<T = unknown>(name: string, args: unknown, timeoutMs: number = this.editorRequestTimeoutMs): Promise<T> {
    const socket = this.editorSocket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(editorNotConnectedMessage));
    }
    return this.request<T>(socket, name, args, timeoutMs);
  }

  /// Sends a request to an arbitrary connected client (used by tests and by
  /// editor-to-editor relays if more than one tab is open).
  request<T = unknown>(socket: WebSocket, name: string, args: unknown, timeoutMs: number = 0): Promise<T> {
    const id = `s${this.nextId++}`;
    return new Promise<T>((resolve, reject) => {
      const pending: PendingRequest = {
        resolve: (value) => resolve(value as T),
        reject,
      };
      if (timeoutMs > 0) {
        pending.timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error(`Bridge request '${name}' timed out after ${timeoutMs}ms.`));
        }, timeoutMs);
      }
      this.pending.set(id, pending);
      const envelope: BridgeRequestEnvelope = { id, type: 'request', name, args };
      socket.send(encodeEnvelope(envelope), (error) => {
        if (error) {
          this.pending.delete(id);
          if (pending.timer) clearTimeout(pending.timer);
          reject(error);
        }
      });
    });
  }

  // MARK: - Events

  broadcast(name: string, payload: unknown, except?: WebSocket): void {
    const text = encodeEnvelope({ type: 'event', name, payload });
    for (const client of this.clients) {
      if (client === except || client.readyState !== WebSocket.OPEN) continue;
      client.send(text);
    }
  }

  sendEvent(socket: WebSocket, name: string, payload: unknown): void {
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(encodeEnvelope({ type: 'event', name, payload }));
  }

  // MARK: - Socket plumbing

  private attachSocket(socket: WebSocket): void {
    this.clients.add(socket);
    this.emit('clientConnected', socket);
    socket.on('message', (data: RawData) => {
      void this.receive(socket, data);
    });
    socket.on('close', () => {
      this.clients.delete(socket);
      if (this.editorSocket === socket) {
        this.editorSocket = null;
        for (const [id, request] of this.pending) {
          request.reject(new Error(editorNotConnectedMessage));
          if (request.timer) clearTimeout(request.timer);
          this.pending.delete(id);
        }
        this.emit('editorDisconnected', socket);
      }
      this.emit('clientDisconnected', socket);
    });
    socket.on('error', () => {
      // 'close' follows; nothing else to do.
    });
  }

  private async receive(socket: WebSocket, data: RawData): Promise<void> {
    let envelope: BridgeEnvelope;
    try {
      envelope = decodeEnvelope(typeof data === 'string' ? data : data.toString());
    } catch (error) {
      socket.send(encodeEnvelope({ id: '', type: 'response', ok: false, error: (error as Error).message }));
      return;
    }
    switch (envelope.type) {
      case 'request':
        await this.dispatch(socket, envelope);
        return;
      case 'response': {
        const pending = this.pending.get(envelope.id);
        if (!pending) return;
        this.pending.delete(envelope.id);
        if (pending.timer) clearTimeout(pending.timer);
        if (envelope.ok) pending.resolve(envelope.result);
        else pending.reject(new Error(envelope.error ?? 'Bridge request failed.'));
        return;
      }
      case 'event':
        this.emit('event', envelope.name, envelope.payload, socket);
        return;
    }
  }

  private async dispatch(socket: WebSocket, request: BridgeRequestEnvelope): Promise<void> {
    const handler = this.handlers.get(request.name);
    let response: BridgeResponseEnvelope;
    if (!handler) {
      response = { id: request.id, type: 'response', ok: false, error: `Unknown bridge request: ${request.name}` };
    } else {
      try {
        const result = await handler(request.args ?? {}, { socket, bridge: this, isEditor: this.isEditor(socket) });
        response = { id: request.id, type: 'response', ok: true, result: result ?? null };
      } catch (error) {
        response = { id: request.id, type: 'response', ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
    if (socket.readyState === WebSocket.OPEN) socket.send(encodeEnvelope(response));
  }

  // MARK: - HTTP: /health and /proxy

  private async handleHTTP(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const origin = request.headers.origin;
    if (!isLoopbackOrigin(origin)) {
      response.writeHead(403, { 'Content-Type': 'text/plain' });
      response.end('Forbidden origin');
      return;
    }
    // The browser app is served from another loopback port: answer CORS.
    if (origin) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Vary', 'Origin');
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      response.setHeader('Access-Control-Allow-Headers', '*');
      response.setHeader('Access-Control-Expose-Headers', '*');
    }
    const url = (request.url ?? '/').split('?')[0];
    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }
    if (url === '/health' && request.method === 'GET') {
      const body = JSON.stringify({
        ok: true,
        bridgePort: this.boundPort,
        editorConnected: this.editorConnected,
        clients: this.clients.size,
        handlers: this.handlers.size,
      });
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(body);
      return;
    }
    if (url === '/proxy' && request.method === 'POST') {
      await this.proxy(request, response);
      return;
    }
    response.writeHead(404, { 'Content-Type': 'text/plain' });
    response.end('Not found — bridge endpoints are ws://, POST /proxy, GET /health');
  }

  /// Forwards `{url, method, headers, body}` to the target and streams the
  /// response back verbatim. Raw mode: set `X-Agentic-Proxy-Url` (+ optional
  /// `X-Agentic-Proxy-Method`, `X-Agentic-Proxy-Headers` JSON) and send the
  /// upstream body as the request body unchanged.
  private async proxy(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks);

    let targetURL: string;
    let method = 'POST';
    let headers: Record<string, string> = {};
    let body: string | Buffer | undefined;

    const rawTarget = request.headers['x-agentic-proxy-url'];
    if (typeof rawTarget === 'string' && rawTarget.length > 0) {
      targetURL = rawTarget;
      const rawMethod = request.headers['x-agentic-proxy-method'];
      if (typeof rawMethod === 'string' && rawMethod.length > 0) method = rawMethod.toUpperCase();
      const rawHeaders = request.headers['x-agentic-proxy-headers'];
      if (typeof rawHeaders === 'string') {
        try { headers = JSON.parse(rawHeaders); } catch { headers = {}; }
      }
      if (!Object.keys(headers).some((key) => key.toLowerCase() === 'content-type') && typeof request.headers['content-type'] === 'string') {
        headers['Content-Type'] = request.headers['content-type'];
      }
      body = raw.length > 0 ? raw : undefined;
    } else {
      let parsed: { url?: unknown; method?: unknown; headers?: unknown; body?: unknown };
      try {
        parsed = JSON.parse(raw.toString('utf8'));
      } catch {
        response.writeHead(400, { 'Content-Type': 'text/plain' });
        response.end('POST /proxy expects JSON {url, method, headers, body}');
        return;
      }
      if (typeof parsed.url !== 'string') {
        response.writeHead(400, { 'Content-Type': 'text/plain' });
        response.end("'url' is required");
        return;
      }
      targetURL = parsed.url;
      if (typeof parsed.method === 'string') method = parsed.method.toUpperCase();
      if (parsed.headers && typeof parsed.headers === 'object') {
        for (const [key, value] of Object.entries(parsed.headers as Record<string, unknown>)) {
          if (typeof value === 'string') headers[key] = value;
        }
      }
      if (parsed.body !== undefined && parsed.body !== null) {
        body = typeof parsed.body === 'string' ? parsed.body : JSON.stringify(parsed.body);
      }
    }

    let target: URL;
    try {
      target = new URL(targetURL);
    } catch {
      response.writeHead(400, { 'Content-Type': 'text/plain' });
      response.end(`Invalid proxy url: ${targetURL}`);
      return;
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      response.writeHead(400, { 'Content-Type': 'text/plain' });
      response.end('Only http(s) urls can be proxied');
      return;
    }

    let upstream: Response;
    try {
      upstream = await fetch(target, {
        method,
        headers,
        body: method === 'GET' || method === 'HEAD' ? undefined : body,
        redirect: 'follow',
      });
    } catch (error) {
      const cause = (error as { cause?: { code?: string; message?: string } }).cause;
      response.writeHead(502, { 'Content-Type': 'text/plain' });
      response.end(`Proxy request failed: ${cause?.code ?? ''} ${cause?.message ?? (error as Error).message}`.trim());
      return;
    }

    const outHeaders: Record<string, string> = {};
    upstream.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      // fetch already decoded the body; these no longer describe it.
      if (['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive'].includes(lower)) return;
      if (lower.startsWith('access-control-')) return;
      outHeaders[key] = value;
    });
    response.writeHead(upstream.status, outHeaders);
    if (!upstream.body) {
      response.end();
      return;
    }
    Readable.fromWeb(upstream.body as import('node:stream/web').ReadableStream).pipe(response);
  }
}
