// Platform adapter: FileManager / Data(contentsOf:) / URL-based file access.
// The server implements it with node:fs; the web app forwards to the server
// over WebSocket (or uses the File System Access API for user-picked files).

export interface FileStat {
  isDirectory: boolean;
  isFile: boolean;
  size: number;
  /** ms since epoch */
  modifiedAt: number;
}

export interface FileSystem {
  readText(path: string): Promise<string>;
  writeText(path: string, text: string): Promise<void>;
  readBytes(path: string): Promise<Uint8Array>;
  writeBytes(path: string, bytes: Uint8Array): Promise<void>;
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<FileStat | null>;
  /** `createDirectory(at:withIntermediateDirectories: true)` */
  mkdirp(path: string): Promise<void>;
  /** Entry names (not full paths) of a directory. */
  readdir(path: string): Promise<string[]>;
  /** `removeItem(at:)` — recursive for directories. */
  remove(path: string): Promise<void>;
  copy(from: string, to: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
  /** `FileManager.default.homeDirectoryForCurrentUser` */
  homeDirectory(): string;
  /** `FileManager.default.temporaryDirectory` */
  temporaryDirectory(): string;
  /** `~/Library/Application Support/AgenticDesigner` */
  applicationSupportDirectory(): string;
  /** POSIX path join. */
  join(...parts: string[]): string;
}

export class PlatformUnsupportedError extends Error {
  constructor(feature: string) {
    super(`${feature} is not available on this platform — inject an adapter with setPlatform()`);
    this.name = 'PlatformUnsupportedError';
  }
}

// TextEncoder/TextDecoder are universal (browsers, Node 11+) but not part of lib.es2022.
interface TextCodecs {
  TextEncoder?: new () => { encode(text: string): Uint8Array };
  TextDecoder?: new () => { decode(bytes: Uint8Array): string };
}

function utf8Encode(text: string): Uint8Array {
  const Ctor = (globalThis as TextCodecs).TextEncoder;
  if (!Ctor) throw new PlatformUnsupportedError('TextEncoder');
  return new Ctor().encode(text);
}

function utf8Decode(bytes: Uint8Array): string {
  const Ctor = (globalThis as TextCodecs).TextDecoder;
  if (!Ctor) throw new PlatformUnsupportedError('TextDecoder');
  return new Ctor().decode(bytes);
}

function normalizePath(path: string): string {
  const segments: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') { segments.pop(); continue; }
    segments.push(part);
  }
  return '/' + segments.join('/');
}

/** In-memory file system (default adapter; tests). */
export class MemoryFileSystem implements FileSystem {
  private files = new Map<string, Uint8Array>();
  private dirs = new Set<string>(['/']);

  private parentOf(path: string): string {
    const idx = path.lastIndexOf('/');
    return idx <= 0 ? '/' : path.slice(0, idx);
  }

  async readText(path: string): Promise<string> {
    return utf8Decode(await this.readBytes(path));
  }
  async writeText(path: string, text: string): Promise<void> {
    await this.writeBytes(path, utf8Encode(text));
  }
  async readBytes(path: string): Promise<Uint8Array> {
    const p = normalizePath(path);
    const data = this.files.get(p);
    if (!data) throw new Error(`No such file: ${p}`);
    return data;
  }
  async writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    const p = normalizePath(path);
    await this.mkdirp(this.parentOf(p));
    this.files.set(p, bytes);
  }
  async exists(path: string): Promise<boolean> {
    const p = normalizePath(path);
    return this.files.has(p) || this.dirs.has(p);
  }
  async stat(path: string): Promise<FileStat | null> {
    const p = normalizePath(path);
    if (this.files.has(p)) {
      return { isDirectory: false, isFile: true, size: this.files.get(p)!.byteLength, modifiedAt: Date.now() };
    }
    if (this.dirs.has(p)) return { isDirectory: true, isFile: false, size: 0, modifiedAt: Date.now() };
    return null;
  }
  async mkdirp(path: string): Promise<void> {
    const p = normalizePath(path);
    const parts = p.split('/').filter(Boolean);
    let cur = '';
    for (const part of parts) {
      cur += '/' + part;
      this.dirs.add(cur);
    }
    this.dirs.add('/');
  }
  async readdir(path: string): Promise<string[]> {
    const p = normalizePath(path);
    if (!this.dirs.has(p)) throw new Error(`No such directory: ${p}`);
    const prefix = p === '/' ? '/' : p + '/';
    const names = new Set<string>();
    for (const f of [...this.files.keys(), ...this.dirs]) {
      if (f !== p && f.startsWith(prefix)) {
        const rest = f.slice(prefix.length);
        const first = rest.split('/')[0];
        if (first) names.add(first);
      }
    }
    return [...names].sort();
  }
  async remove(path: string): Promise<void> {
    const p = normalizePath(path);
    this.files.delete(p);
    const prefix = p + '/';
    for (const f of [...this.files.keys()]) if (f.startsWith(prefix)) this.files.delete(f);
    for (const d of [...this.dirs]) if (d === p || d.startsWith(prefix)) this.dirs.delete(d);
  }
  async copy(from: string, to: string): Promise<void> {
    await this.writeBytes(to, new Uint8Array(await this.readBytes(from)));
  }
  async move(from: string, to: string): Promise<void> {
    await this.copy(from, to);
    await this.remove(from);
  }
  homeDirectory(): string {
    return '/home';
  }
  temporaryDirectory(): string {
    return '/tmp';
  }
  applicationSupportDirectory(): string {
    return '/home/Library/Application Support/AgenticDesigner';
  }
  join(...parts: string[]): string {
    return normalizePath(parts.join('/'));
  }
}
