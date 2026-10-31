// Platform adapter: wall-clock / monotonic time and sleeping (Date(), DispatchQueue.asyncAfter, Task.sleep).

export interface Clock {
  /** Milliseconds since the Unix epoch (`Date().timeIntervalSince1970 * 1000`). */
  now(): number;
  /** Monotonic milliseconds for measuring durations (`CACurrentMediaTime`). */
  monotonic(): number;
  /** Resolves after `ms` milliseconds (`Task.sleep`). */
  sleep(ms: number): Promise<void>;
}

/** Seconds since 2001-01-01 (Swift's `Date.timeIntervalSinceReferenceDate`). */
export const SWIFT_REFERENCE_DATE_MS = Date.UTC(2001, 0, 1, 0, 0, 0, 0);

export function msToSwiftReferenceSeconds(ms: number): number {
  return (ms - SWIFT_REFERENCE_DATE_MS) / 1000;
}

export function swiftReferenceSecondsToMs(seconds: number): number {
  return seconds * 1000 + SWIFT_REFERENCE_DATE_MS;
}

export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
  monotonic(): number {
    const perf = (globalThis as { performance?: { now(): number } }).performance;
    return perf ? perf.now() : Date.now();
  }
  sleep(ms: number): Promise<void> {
    const g = globalThis as { setTimeout?: (handler: () => void, timeout?: number) => unknown };
    if (typeof g.setTimeout !== 'function') return Promise.resolve();
    const schedule = g.setTimeout;
    return new Promise((resolve) => schedule(() => resolve(), Math.max(0, ms)));
  }
}

/** Deterministic clock for tests. */
export class ManualClock implements Clock {
  private current: number;
  constructor(startMs = 0) {
    this.current = startMs;
  }
  now(): number {
    return this.current;
  }
  monotonic(): number {
    return this.current;
  }
  advance(ms: number): void {
    this.current += ms;
  }
  async sleep(ms: number): Promise<void> {
    this.current += Math.max(0, ms);
  }
}
