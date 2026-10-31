// Ported 1:1 from AgenticDesigner/Services/MCPServerController.swift
// (lifecycle half: port, on/off, persistence, call log, bind retries).
// The tool registry half is the browser's; see toolRelay.ts.
import { uuidString } from '../platform/Paths.js';
import { Settings } from '../services/Settings.js';
import type { MCPStatus } from '../bridge/protocol.js';
import { MCPServer } from './MCPServer.js';
import { makePrompts, serverInstructions } from './prompts.js';
import type { ToolRelay } from './toolRelay.js';

export interface MCPCallLogEntry {
  id: string;
  date: number;
  message: string;
}

export interface MCPControllerEvents {
  log?: (entry: MCPCallLogEntry) => void;
  statusChanged?: (status: MCPStatus) => void;
  editorConnected?: () => boolean;
}

export class MCPServerController {
  isRunning = false;
  lastError: string | null = null;
  callLog: MCPCallLogEntry[] = [];
  port: number;

  private server: MCPServer | null = null;
  private readonly relay: ToolRelay;
  private readonly events: MCPControllerEvents;
  private static readonly portKey = 'mcpServerPort';
  private static readonly enabledKey = 'mcpServerEnabled';

  // A bind failure at launch is usually a previous instance still holding
  // the port. Keep retrying for a while as long as the server should be on.
  private static readonly maxBindRetries = 30;
  private bindRetriesRemaining = MCPServerController.maxBindRetries;
  private retryTimer: NodeJS.Timeout | null = null;

  constructor(relay: ToolRelay, events: MCPControllerEvents = {}) {
    this.relay = relay;
    this.events = events;
    // AGENTIC_MCP_PORT lets a second instance run its own server — env beats
    // the stored setting because the settings file is shared between instances.
    const envPort = process.env.AGENTIC_MCP_PORT ? parseInt(process.env.AGENTIC_MCP_PORT, 10) : NaN;
    if (Number.isInteger(envPort) && envPort >= 1024 && envPort <= 65535) {
      this.port = envPort;
    } else {
      const storedPort = Settings.integer(MCPServerController.portKey);
      this.port = storedPort >= 1024 && storedPort <= 65535 ? storedPort : 8765;
    }
  }

  get endpointURL(): string {
    return `http://127.0.0.1:${this.port}/mcp`;
  }

  get claudeCodeCommand(): string {
    return `claude mcp add --transport http agenticdesigner ${this.endpointURL}`;
  }

  get isEnabled(): boolean {
    return Settings.bool(MCPServerController.enabledKey);
  }

  /// Re-enables the server on launch when it was on last session. An explicit
  /// AGENTIC_MCP_PORT is itself the request to serve.
  attach(): void {
    const forcedByEnvironment = process.env.AGENTIC_MCP_PORT !== undefined;
    if ((this.isEnabled || forcedByEnvironment) && !this.isRunning && this.server === null) {
      this.start();
    }
  }

  setEnabled(enabled: boolean): void {
    Settings.set(MCPServerController.enabledKey, enabled);
    if (enabled) {
      this.start();
    } else {
      this.stop();
    }
  }

  /// `@Published var port { didSet { UserDefaults…set(Int(port)) } }` plus the
  /// restart the UI performs when the port field changes while running.
  setPort(port: number): void {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      throw new Error('Port must be an integer between 1024 and 65535.');
    }
    const wasRunning = this.server !== null;
    this.port = port;
    Settings.set(MCPServerController.portKey, port);
    if (wasRunning) {
      this.stop();
      this.start();
    } else {
      this.publishStatus();
    }
  }

  start(): void {
    if (this.server !== null) return;
    this.lastError = null;

    const server = new MCPServer(
      { port: this.port, instructions: serverInstructions },
      () => this.relay.definitions(),
      makePrompts(),
      (message) => this.appendLog(message),
    );

    server.start((running, error) => {
      if (this.server !== server && !running) return; // a stale instance closing after a restart
      this.isRunning = running;
      if (running) {
        this.bindRetriesRemaining = MCPServerController.maxBindRetries;
      }
      if (error) {
        this.lastError = error;
        this.server = null;
        this.retryStartIfNeeded();
      }
      this.publishStatus();
    });
    this.server = server;
  }

  private retryStartIfNeeded(): void {
    if (!this.isEnabled || this.bindRetriesRemaining <= 0) return;
    this.bindRetriesRemaining -= 1;
    this.appendLog(`🔌 MCP: retrying start in 2s (${this.bindRetriesRemaining} attempts left)`);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.server !== null || !this.isEnabled) return;
      this.start();
    }, 2000);
    this.retryTimer.unref?.();
  }

  stop(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.server?.stop();
    this.server = null;
    this.isRunning = false;
    this.publishStatus();
  }

  appendLog(message: string): void {
    console.log(message);
    const entry: MCPCallLogEntry = { id: uuidString(), date: Date.now(), message };
    this.callLog.push(entry);
    if (this.callLog.length > 200) {
      this.callLog.splice(0, this.callLog.length - 200);
    }
    this.events.log?.(entry);
  }

  status(): MCPStatus {
    return {
      isRunning: this.isRunning,
      port: this.port,
      enabled: this.isEnabled,
      lastError: this.lastError,
      endpointURL: this.endpointURL,
      claudeCodeCommand: this.claudeCodeCommand,
      editorConnected: this.events.editorConnected?.() ?? false,
      toolCount: this.relay.toolCount,
    };
  }

  publishStatus(): void {
    this.events.statusChanged?.(this.status());
  }
}
