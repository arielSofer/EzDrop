// Platform adapter: UserDefaults / @AppStorage → key-value store.
// Key strings MUST stay identical to the Swift `@AppStorage("...")` keys.

export interface Storage {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  keys(): string[];
}

export class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  set(key: string, value: string): void {
    this.map.set(key, value);
  }
  remove(key: string): void {
    this.map.delete(key);
  }
  keys(): string[] {
    return [...this.map.keys()];
  }
}

// Typed helpers mirroring UserDefaults accessors.

export function storageGetBool(storage: Storage, key: string, fallback: boolean): boolean {
  const v = storage.get(key);
  if (v === null) return fallback;
  return v === 'true' || v === '1';
}

export function storageSetBool(storage: Storage, key: string, value: boolean): void {
  storage.set(key, value ? 'true' : 'false');
}

export function storageGetNumber(storage: Storage, key: string, fallback: number): number {
  const v = storage.get(key);
  if (v === null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function storageSetNumber(storage: Storage, key: string, value: number): void {
  storage.set(key, String(value));
}

export function storageGetString(storage: Storage, key: string, fallback: string): string {
  return storage.get(key) ?? fallback;
}

export function storageGetJSON<T>(storage: Storage, key: string, fallback: T): T {
  const v = storage.get(key);
  if (v === null) return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}

export function storageSetJSON(storage: Storage, key: string, value: unknown): void {
  storage.set(key, JSON.stringify(value));
}
