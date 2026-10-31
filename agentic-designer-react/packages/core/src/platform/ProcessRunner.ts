// Platform adapter: `Process` / `xcrun simctl` / `firebase` CLI / `git`.
// Only the server can implement this (child_process); the web app forwards.

import { PlatformUnsupportedError } from './FileSystem';

export interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ProcessOptions {
  cwd?: string;
  env?: Record<string, string>;
  /** ms; undefined = no timeout */
  timeoutMs?: number;
  stdin?: string;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

export interface ProcessRunner {
  run(command: string, args: string[], options?: ProcessOptions): Promise<ProcessResult>;
  /** `which`-style lookup; null when the executable is not on PATH. */
  which(command: string): Promise<string | null>;
}

export class UnsupportedProcessRunner implements ProcessRunner {
  async run(command: string): Promise<ProcessResult> {
    throw new PlatformUnsupportedError(`ProcessRunner.run(${command})`);
  }
  async which(): Promise<string | null> {
    return null;
  }
}

/** Scripted runner for tests: map "cmd arg1 arg2" → result. */
export class ScriptedProcessRunner implements ProcessRunner {
  readonly calls: { command: string; args: string[]; options?: ProcessOptions }[] = [];
  constructor(private readonly script: (command: string, args: string[]) => ProcessResult | undefined = () => undefined) {}
  async run(command: string, args: string[], options?: ProcessOptions): Promise<ProcessResult> {
    this.calls.push({ command, args, options });
    return this.script(command, args) ?? { exitCode: 0, stdout: '', stderr: '' };
  }
  async which(command: string): Promise<string | null> {
    return `/usr/bin/${command}`;
  }
}
