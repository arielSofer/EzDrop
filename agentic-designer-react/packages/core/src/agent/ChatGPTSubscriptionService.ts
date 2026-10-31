// Ported 1:1 from AgenticDesigner/Services/ChatGPTSubscriptionService.swift
//
// Core interface for the ChatGPT subscription bridge.
// Process execution (codex CLI) is hosted on the server.

export type ChatGPTStatus =
  | { kind: 'notInstalled' }
  | { kind: 'signedOut' }
  | { kind: 'ready'; account: string };

export function isChatGPTReady(status: ChatGPTStatus): boolean {
  return status.kind === 'ready';
}

export interface ChatGPTState {
  status: ChatGPTStatus;
  isBusy: boolean;
  transcript: string[];
  codexPath: string | null;
  installHint: string;
}

export interface ChatGPTSubscriptionBridge {
  state(): Promise<ChatGPTState>;
  refreshStatus(): Promise<ChatGPTState>;
  signIn(): Promise<ChatGPTState>;
  ensureMCPServerRegistered(port: number): Promise<boolean>;
  run(goal: string, workingDirectory: string): Promise<void>;
  cancel(): Promise<void>;
}

export class ChatGPTSubscriptionService {
  private _status: ChatGPTStatus = { kind: 'notInstalled' };
  private _isBusy = false;
  private _transcript: string[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly bridge?: ChatGPTSubscriptionBridge;

  readonly installHint = 'brew install codex   (or: npm i -g @openai/codex)';

  constructor(bridge?: ChatGPTSubscriptionBridge) {
    this.bridge = bridge;
  }

  get status(): ChatGPTStatus {
    return this._status;
  }

  get isBusy(): boolean {
    return this._isBusy;
  }

  get transcript(): readonly string[] {
    return this._transcript;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // ignore
      }
    }
  }

  async refreshStatus(): Promise<void> {
    if (!this.bridge) return;
    const state = await this.bridge.refreshStatus();
    this._status = state.status;
    this._isBusy = state.isBusy;
    this._transcript = state.transcript;
    this.notify();
  }

  async signIn(): Promise<void> {
    if (!this.bridge) return;
    this._isBusy = true;
    this.notify();
    try {
      const state = await this.bridge.signIn();
      this._status = state.status;
      this._isBusy = state.isBusy;
      this._transcript = state.transcript;
    } finally {
      this._isBusy = false;
      this.notify();
    }
  }

  async ensureMCPServerRegistered(port: number): Promise<boolean> {
    if (!this.bridge) return false;
    return this.bridge.ensureMCPServerRegistered(port);
  }

  async run(goal: string, workingDirectory: string): Promise<void> {
    if (!this.bridge || !isChatGPTReady(this._status)) return;
    this._isBusy = true;
    this._transcript = [];
    this.notify();
    try {
      await this.bridge.run(goal, workingDirectory);
    } finally {
      this._isBusy = false;
      this.notify();
    }
  }

  cancel(): void {
    this.bridge?.cancel();
    this._isBusy = false;
    this.notify();
  }

  appendTranscriptLine(line: string): void {
    this._transcript.push(line);
    this.notify();
  }
}
