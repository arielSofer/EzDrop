// WebSocket client for the editor ⇄ server bridge.
// Speaks the envelope declared in apps/server/src/bridge/protocol.ts (copied
// verbatim to ./protocol.ts): requests flow BOTH ways, plus fire-and-forget
// events pushed from the server.

import {
  BRIDGE_DEFAULT_PORT,
  decodeEnvelope,
  encodeEnvelope,
  type BridgeEnvelope,
  type BridgeEventName,
  type BridgeEvents,
  type EditorRequestName,
  type EditorRequests,
  type ServerRequestName,
  type ServerRequests,
} from './protocol';

export type BridgeEventHandler<N extends BridgeEventName> = (payload: BridgeEvents[N]) => void;
export type BridgeRequestHandler<N extends EditorRequestName> = (
  args: EditorRequests[N]['args'],
) => EditorRequests[N]['result'] | Promise<EditorRequests[N]['result']>;

/** The Swift app's wording when a server-backed feature has no server. */
export const BridgeNotConnectedMessage = 'The AgenticDesigner server is not running.';

export class BridgeNotConnectedError extends Error {
  constructor(requestName?: string) {
    super(requestName ? `${BridgeNotConnectedMessage} (${requestName})` : BridgeNotConnectedMessage);
    this.name = 'BridgeNotConnectedError';
  }
}

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

type ConnectedListener = (connected: boolean) => void;

/** Minimal structural WebSocket so this file compiles without DOM lib quirks. */
interface SocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
}
type SocketConstructor = new (url: string) => SocketLike;

function socketConstructor(): SocketConstructor | undefined {
  return (globalThis as { WebSocket?: SocketConstructor }).WebSocket;
}

export function bridgeURL(port: number = BRIDGE_DEFAULT_PORT): string {
  return `ws://127.0.0.1:${port}`;
}

export class BridgeClient {
  readonly url: string;
  /** Observable connection state — `bridge.connected`. */
  private connectedValue = false;
  private socket: SocketLike | null = null;
  private nextId = 1;
  private readonly pending = new Map<string, PendingCall>();
  private readonly eventHandlers = new Map<string, Set<(payload: unknown) => void>>();
  private readonly requestHandlers = new Map<string, (args: unknown) => unknown | Promise<unknown>>();
  private readonly connectedListeners = new Set<ConnectedListener>();
  private reconnectDelayMs = 500;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(url: string = bridgeURL()) {
    this.url = url;
  }

  get connected(): boolean {
    return this.connectedValue;
  }

  /** Subscribe to connection changes; returns an unsubscribe function. */
  onConnectedChange(listener: ConnectedListener): () => void {
    this.connectedListeners.add(listener);
    listener(this.connectedValue);
    return () => this.connectedListeners.delete(listener);
  }

  connect(): void {
    this.stopped = false;
    if (this.socket) return;
    const Socket = socketConstructor();
    if (!Socket) return;
    let socket: SocketLike;
    try {
      socket = new Socket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      this.reconnectDelayMs = 500;
      this.setConnected(true);
    };
    socket.onclose = () => {
      this.socket = null;
      this.setConnected(false);
      this.failAllPending(new BridgeNotConnectedError());
      this.scheduleReconnect();
    };
    socket.onerror = () => {
      // `onclose` always follows; nothing to do but keep the console quiet.
    };
    socket.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      let envelope: BridgeEnvelope;
      try {
        envelope = decodeEnvelope(event.data);
      } catch {
        return;
      }
      void this.handleEnvelope(envelope);
    };
  }

  disconnect(): void {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const socket = this.socket;
    this.socket = null;
    this.setConnected(false);
    socket?.close();
    this.failAllPending(new BridgeNotConnectedError());
  }

  /** `bridge.call(name, args)` — editor → server request/response. */
  call<N extends ServerRequestName>(name: N, args?: ServerRequests[N]['args']): Promise<ServerRequests[N]['result']>;
  call(name: string, args?: unknown): Promise<unknown>;
  call(name: string, args?: unknown): Promise<unknown> {
    const socket = this.socket;
    if (!socket || !this.connectedValue) {
      return Promise.reject(new BridgeNotConnectedError(name));
    }
    const id = `web-${this.nextId++}`;
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        socket.send(encodeEnvelope({ id, type: 'request', name, args }));
      } catch (error) {
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  /** `bridge.on(event, handler)` — server → editor pushes. Returns an unsubscribe. */
  on<N extends BridgeEventName>(event: N, handler: BridgeEventHandler<N>): () => void;
  on(event: string, handler: (payload: unknown) => void): () => void;
  on(event: string, handler: (payload: never) => void): () => void {
    const set = this.eventHandlers.get(event) ?? new Set<(payload: unknown) => void>();
    set.add(handler as (payload: unknown) => void);
    this.eventHandlers.set(event, set);
    return () => {
      set.delete(handler as (payload: unknown) => void);
    };
  }

  /** `bridge.registerRequestHandler(name, handler)` — server → editor requests. */
  registerRequestHandler<N extends EditorRequestName>(name: N, handler: BridgeRequestHandler<N>): () => void;
  registerRequestHandler(name: string, handler: (args: unknown) => unknown | Promise<unknown>): () => void;
  registerRequestHandler(name: string, handler: (args: never) => unknown): () => void {
    this.requestHandlers.set(name, handler as (args: unknown) => unknown);
    return () => {
      if (this.requestHandlers.get(name) === (handler as unknown)) this.requestHandlers.delete(name);
    };
  }

  private async handleEnvelope(envelope: BridgeEnvelope): Promise<void> {
    switch (envelope.type) {
      case 'response': {
        const pending = this.pending.get(envelope.id);
        if (!pending) return;
        this.pending.delete(envelope.id);
        if (envelope.ok) pending.resolve(envelope.result);
        else pending.reject(new Error(envelope.error ?? 'Bridge request failed.'));
        return;
      }
      case 'event': {
        const handlers = this.eventHandlers.get(envelope.name);
        if (!handlers) return;
        for (const handler of [...handlers]) handler(envelope.payload);
        return;
      }
      case 'request': {
        const handler = this.requestHandlers.get(envelope.name);
        const socket = this.socket;
        if (!socket) return;
        if (!handler) {
          socket.send(
            encodeEnvelope({
              id: envelope.id,
              type: 'response',
              ok: false,
              error: `No editor handler for '${envelope.name}'.`,
            }),
          );
          return;
        }
        try {
          const result = await handler(envelope.args);
          socket.send(encodeEnvelope({ id: envelope.id, type: 'response', ok: true, result }));
        } catch (error) {
          socket.send(
            encodeEnvelope({
              id: envelope.id,
              type: 'response',
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        }
        return;
      }
    }
  }

  private setConnected(connected: boolean): void {
    if (this.connectedValue === connected) return;
    this.connectedValue = connected;
    for (const listener of [...this.connectedListeners]) listener(connected);
  }

  private failAllPending(error: Error): void {
    for (const [, pending] of this.pending) pending.reject(error);
    this.pending.clear();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, 10_000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}

/** The app-wide bridge instance. */
export const bridge = new BridgeClient();
