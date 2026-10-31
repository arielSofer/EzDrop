// Foundation `Process` + `Pipe` equivalent. Every Swift service merges stdout
// and stderr into one pipe and reads it to the end; this mirrors that with an
// async spawn so long builds never block the bridge's event loop.
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import path from 'node:path';

export interface RunResult {
  /// Process.terminationStatus (or 1 when the process could not be launched).
  status: number;
  /// Combined stdout + stderr, in arrival order.
  output: string;
}

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  /// Called for each chunk as it arrives (Codex transcript streaming).
  onChunk?: (chunk: string) => void;
  /// Receives the child so callers can `terminate()` it (Codex cancel).
  onSpawn?: (child: ChildProcess) => void;
}

export class ProcessLaunchError extends Error {
  constructor(public readonly executable: string, message: string) {
    super(message);
    this.name = 'ProcessLaunchError';
  }
}

/// The PATH GUI apps do not inherit; each Swift service prepends the same
/// Homebrew / local bin directories before shelling out.
export function extendedPATH(base: NodeJS.ProcessEnv = process.env): string {
  return '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:' + (base.PATH ?? '');
}

/// Runs `executable arguments…`, resolving with the exit status and merged output.
/// Rejects with ProcessLaunchError only when the process could not be started
/// (missing binary) — the Swift `try process.run()` failure.
export function runProcess(executable: string, args: string[], options: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const spawnOptions: SpawnOptions = {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    };
    let child: ChildProcess;
    try {
      child = spawn(executable, args, spawnOptions);
    } catch (error) {
      reject(new ProcessLaunchError(executable, (error as Error).message));
      return;
    }
    options.onSpawn?.(child);

    const chunks: string[] = [];
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const collect = (data: Buffer) => {
      const text = data.toString('utf8');
      chunks.push(text);
      options.onChunk?.(text);
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);

    if (options.timeoutMs && options.timeoutMs > 0) {
      timer = setTimeout(() => {
        child.kill('SIGTERM');
      }, options.timeoutMs);
    }

    child.once('error', (error: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      reject(new ProcessLaunchError(executable, error.message));
    });
    child.once('close', (code, signal) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ status: code ?? (signal ? 1 : 0), output: chunks.join('') });
    });
  });
}

/// Launches a long-lived worker (mflux bridge, Helsinki translator) with its
/// output discarded — `FileHandle.nullDevice` in the Swift code.
export function launchDetachedWorker(executable: string, args: string[], env?: NodeJS.ProcessEnv): ChildProcess {
  const child = spawn(executable, args, {
    env: env ?? process.env,
    stdio: 'ignore',
  });
  return child;
}

export function executableName(executable: string): string {
  return path.basename(executable);
}
