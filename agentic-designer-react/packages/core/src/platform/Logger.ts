// Platform adapter: logging (Swift `print(...)` / os_log).

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(message: string, ...meta: unknown[]): void;
  info(message: string, ...meta: unknown[]): void;
  warn(message: string, ...meta: unknown[]): void;
  error(message: string, ...meta: unknown[]): void;
}

type ConsoleLike = { [K in LogLevel]?: (...args: unknown[]) => void } & { log?: (...args: unknown[]) => void };

function hostConsole(): ConsoleLike | undefined {
  return (globalThis as { console?: ConsoleLike }).console;
}

/** Writes to the host `console` (browser devtools / Node stdout); silent when there is none. */
export class ConsoleLogger implements Logger {
  constructor(private readonly prefix = '') {}
  private write(level: LogLevel, message: string, meta: unknown[]): void {
    const c = hostConsole();
    if (!c) return;
    const fn = c[level] ?? c.log;
    if (fn) fn.call(c, this.prefix + message, ...meta);
  }
  debug(message: string, ...meta: unknown[]): void { this.write('debug', message, meta); }
  info(message: string, ...meta: unknown[]): void { this.write('info', message, meta); }
  warn(message: string, ...meta: unknown[]): void { this.write('warn', message, meta); }
  error(message: string, ...meta: unknown[]): void { this.write('error', message, meta); }
}

export interface LogRecord {
  level: LogLevel;
  message: string;
  meta: unknown[];
}

/** Collects records in memory (tests / UI log panes). */
export class MemoryLogger implements Logger {
  readonly records: LogRecord[] = [];
  constructor(private readonly forwardTo?: Logger) {}
  private push(level: LogLevel, message: string, meta: unknown[]): void {
    this.records.push({ level, message, meta });
    this.forwardTo?.[level](message, ...meta);
  }
  debug(message: string, ...meta: unknown[]): void { this.push('debug', message, meta); }
  info(message: string, ...meta: unknown[]): void { this.push('info', message, meta); }
  warn(message: string, ...meta: unknown[]): void { this.push('warn', message, meta); }
  error(message: string, ...meta: unknown[]): void { this.push('error', message, meta); }
}

export class SilentLogger implements Logger {
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
}
