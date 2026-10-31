// Ported 1:1 from AgenticDesigner/Services/ChatGPTSubscriptionService.swift
//
// "Connect my ChatGPT subscription" — done the only way that is actually
// legitimate: OpenAI's own Codex CLI has a first-party "sign in with ChatGPT"
// flow, and Codex speaks MCP. The user signs in through OpenAI's browser flow
// and we drive the CLI they already authenticated, pointed at this app's MCP
// server. Credentials never pass through this app.
import type { ChildProcess } from 'node:child_process';
import { isExecutableFile } from '../platform/Paths.js';
import { extendedPATH, runProcess } from '../platform/ProcessRunner.js';

export type ChatGPTStatus =
  | { kind: 'notInstalled' }
  | { kind: 'signedOut' }
  | { kind: 'ready'; account: string };

export function isReady(status: ChatGPTStatus): boolean {
  return status.kind === 'ready';
}

export interface ChatGPTState {
  status: ChatGPTStatus;
  isBusy: boolean;
  transcript: string[];
  codexPath: string | null;
  installHint: string;
}

export interface ChatGPTSubscriptionEvents {
  transcriptLine?: (line: string) => void;
  stateChanged?: (state: ChatGPTState) => void;
}

export class ChatGPTSubscriptionService {
  status: ChatGPTStatus = { kind: 'notInstalled' };
  isBusy = false;
  transcript: string[] = [];

  private runningProcess: ChildProcess | null = null;
  private readonly events: ChatGPTSubscriptionEvents;

  /// Homebrew and npm global installs; PATH is minimal inside a GUI app.
  private static readonly candidatePaths = [
    '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex',
    '/usr/bin/codex',
  ];

  static get codexPath(): string | null {
    return ChatGPTSubscriptionService.candidatePaths.find((candidate) => isExecutableFile(candidate)) ?? null;
  }

  readonly installHint = 'brew install codex   (or: npm i -g @openai/codex)';

  constructor(events: ChatGPTSubscriptionEvents = {}) {
    this.events = events;
  }

  state(): ChatGPTState {
    return {
      status: this.status,
      isBusy: this.isBusy,
      transcript: [...this.transcript],
      codexPath: ChatGPTSubscriptionService.codexPath,
      installHint: this.installHint,
    };
  }

  private publish(): void {
    this.events.stateChanged?.(this.state());
  }

  // MARK: - Status

  async refreshStatus(): Promise<void> {
    const path = ChatGPTSubscriptionService.codexPath;
    if (!path) {
      this.status = { kind: 'notInstalled' };
      this.publish();
      return;
    }
    const result = await ChatGPTSubscriptionService.run(path, ['login', 'status'], 20);
    const output = result.output.trim();
    // "Logged in using ChatGPT" / "Logged in using an API key" / "Not logged in"
    if (result.status === 0 && output.toLowerCase().includes('logged in')) {
      this.status = { kind: 'ready', account: output };
    } else {
      this.status = { kind: 'signedOut' };
    }
    this.publish();
  }

  /// Runs OpenAI's own login flow — it opens a browser and handles the whole
  /// exchange. We never see a token; we just poll the CLI afterwards.
  async signIn(): Promise<void> {
    const path = ChatGPTSubscriptionService.codexPath;
    if (!path) return;
    this.isBusy = true;
    this.publish();
    try {
      await ChatGPTSubscriptionService.run(path, ['login'], 300);
      await this.refreshStatus();
    } finally {
      this.isBusy = false;
      this.publish();
    }
  }

  // MARK: - Wiring this app's tools into Codex

  /// Registers this app's MCP server with Codex (idempotent). After this,
  /// Codex can drive every design/logic/export tool the app exposes.
  async ensureMCPServerRegistered(port: number): Promise<boolean> {
    const path = ChatGPTSubscriptionService.codexPath;
    if (!path) return false;
    const url = `http://127.0.0.1:${port}/mcp`;
    const existing = await ChatGPTSubscriptionService.run(path, ['mcp', 'list'], 30);
    if (existing.output.includes(url)) return true;
    const added = await ChatGPTSubscriptionService.run(path, ['mcp', 'add', 'agenticdesigner', '--url', url], 30);
    return added.status === 0;
  }

  // MARK: - Running a goal on the subscription

  /// Streams `codex exec`, which runs on the user's ChatGPT plan rather than
  /// per-token API billing.
  ///
  /// `--sandbox danger-full-access` is required, not casual: Codex's default
  /// sandbox blocks network, including loopback, so the MCP call to this app
  /// never arrives (it surfaces as "user cancelled MCP tool call"). Approvals
  /// are deliberately NOT bypassed — shell commands still go through Codex's
  /// own approval policy.
  async run(goal: string, workingDirectory: string): Promise<void> {
    const path = ChatGPTSubscriptionService.codexPath;
    if (!path || !isReady(this.status)) return;
    this.isBusy = true;
    this.transcript = [];
    this.publish();

    const env = { ...process.env, PATH: extendedPATH() };
    let pending = '';
    const appendLines = (chunk: string) => {
      pending += chunk;
      const parts = pending.split('\n');
      pending = parts.pop() ?? '';
      for (const line of parts) {
        if (line.length === 0) continue;
        this.transcript.push(line);
        this.events.transcriptLine?.(line);
      }
    };

    try {
      await runProcess(path, [
        'exec',
        '--sandbox', 'danger-full-access',
        '--skip-git-repo-check',
        '-C', workingDirectory,
        goal,
      ], {
        env,
        onChunk: appendLines,
        onSpawn: (child) => {
          this.runningProcess = child;
        },
      });
      if (pending.length > 0) appendLines('\n');
    } catch (error) {
      const line = `Failed to start Codex: ${(error as Error).message}`;
      this.transcript.push(line);
      this.events.transcriptLine?.(line);
    } finally {
      this.isBusy = false;
      this.runningProcess = null;
      this.publish();
    }
  }

  cancel(): void {
    this.runningProcess?.kill('SIGTERM');
    this.runningProcess = null;
    this.isBusy = false;
    this.publish();
  }

  // MARK: - Process helper

  private static async run(executable: string, args: string[], timeoutSeconds: number): Promise<{ status: number; output: string }> {
    const env = { ...process.env, PATH: extendedPATH() };
    try {
      return await runProcess(executable, args, { env, timeoutMs: timeoutSeconds * 1000 });
    } catch (error) {
      return { status: 1, output: `Could not launch ${executable}: ${(error as Error).message}` };
    }
  }
}
