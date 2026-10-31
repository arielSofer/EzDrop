// Browser implementations of the `@agentic/core` platform adapters.
//
// Storage → localStorage (the SAME @AppStorage key strings), Logger → console,
// Clock → the system clock, Clipboard → navigator.clipboard, Renderer → the
// canvas snapshot renderer, FileSystem / ProcessRunner → the server bridge
// (with an in-memory fallback carrying the Swift error text when the server is
// not running), TextMeasurer → a 2D-canvas `measureText`.

import {
  ConsoleLogger,
  MemoryFileSystem,
  SystemClock,
  setPlatform,
  setTextMeasurer,
  type Clipboard,
  type FileStat,
  type FileSystem,
  type Platform,
  type ProcessOptions,
  type ProcessResult,
  type ProcessRunner,
  type Storage,
  type TextMeasurer,
} from '@agentic/core';
import { bridge, BridgeNotConnectedError, BridgeNotConnectedMessage } from '../bridge/bridgeClient';
import { CanvasRenderer } from '../helpers/CanvasSnapshotRenderer';
import { setStudioAssetsDirectory } from '../stores/project/studioAssets';

// MARK: - Storage (UserDefaults / @AppStorage)

export class LocalStorage implements Storage {
  private memory = new Map<string, string>();

  private get backing(): globalThis.Storage | undefined {
    try {
      return (globalThis as { localStorage?: globalThis.Storage }).localStorage;
    } catch {
      return undefined;
    }
  }

  get(key: string): string | null {
    const backing = this.backing;
    if (!backing) return this.memory.has(key) ? this.memory.get(key)! : null;
    try {
      return backing.getItem(key);
    } catch {
      return null;
    }
  }

  set(key: string, value: string): void {
    const backing = this.backing;
    if (!backing) {
      this.memory.set(key, value);
      return;
    }
    try {
      backing.setItem(key, value);
    } catch {
      this.memory.set(key, value);
    }
  }

  remove(key: string): void {
    this.memory.delete(key);
    try {
      this.backing?.removeItem(key);
    } catch {
      // ignored
    }
  }

  keys(): string[] {
    const backing = this.backing;
    if (!backing) return [...this.memory.keys()];
    const keys: string[] = [];
    for (let index = 0; index < backing.length; index += 1) {
      const key = backing.key(index);
      if (key !== null) keys.push(key);
    }
    return keys;
  }
}

// MARK: - Clipboard (NSPasteboard)

export class NavigatorClipboard implements Clipboard {
  private fallback: string | null = null;

  private get api(): { readText(): Promise<string>; writeText(text: string): Promise<void> } | undefined {
    return (globalThis as { navigator?: { clipboard?: { readText(): Promise<string>; writeText(text: string): Promise<void> } } })
      .navigator?.clipboard;
  }

  async readText(): Promise<string | null> {
    const api = this.api;
    if (!api) return this.fallback;
    try {
      return await api.readText();
    } catch {
      return this.fallback;
    }
  }

  async writeText(text: string): Promise<void> {
    this.fallback = text;
    const api = this.api;
    if (!api) return;
    try {
      await api.writeText(text);
    } catch {
      // Clipboard permission denied — the value stays readable in-process.
    }
  }
}

// MARK: - FileSystem (server bridge)

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function posixJoin(...parts: string[]): string {
  const joined = parts.filter((part) => part.length > 0).join('/');
  const isAbsolute = joined.startsWith('/');
  const segments: string[] = [];
  for (const part of joined.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      segments.pop();
      continue;
    }
    segments.push(part);
  }
  return (isAbsolute ? '/' : '') + segments.join('/');
}

export interface BridgePaths {
  home: string;
  temporaryDirectory: string;
  applicationSupport: string;
  agenticSupport: string;
  studioAssets: string;
}

/**
 * FileSystem over the bridge. When the server is not running every call falls
 * back to an in-memory file system and surfaces the Swift app's error text.
 */
export class BridgeFileSystem implements FileSystem {
  private readonly memory = new MemoryFileSystem();
  private paths: BridgePaths | undefined;

  constructor() {
    bridge.onConnectedChange((connected) => {
      if (connected) void this.refreshPaths();
    });
  }

  async refreshPaths(): Promise<BridgePaths | undefined> {
    try {
      const paths = await bridge.call('fs.paths', {});
      this.paths = {
        home: paths.home,
        temporaryDirectory: paths.temporaryDirectory,
        applicationSupport: paths.applicationSupport,
        agenticSupport: paths.agenticSupport,
        studioAssets: paths.studioAssets,
      };
      setStudioAssetsDirectory(paths.studioAssets);
      return this.paths;
    } catch {
      return undefined;
    }
  }

  private notConnected(operation: string): Error {
    return new Error(`${BridgeNotConnectedMessage} (${operation})`);
  }

  async readText(path: string): Promise<string> {
    try {
      const result = await bridge.call('fs.readFile', { path, encoding: 'utf8' });
      return result.contents;
    } catch (error) {
      if (error instanceof BridgeNotConnectedError) {
        if (await this.memory.exists(path)) return this.memory.readText(path);
        throw this.notConnected(`readText ${path}`);
      }
      throw error;
    }
  }

  async writeText(path: string, text: string): Promise<void> {
    try {
      await bridge.call('fs.writeFile', { path, contents: text, encoding: 'utf8' });
    } catch (error) {
      if (error instanceof BridgeNotConnectedError) {
        await this.memory.writeText(path, text);
        return;
      }
      throw error;
    }
  }

  async readBytes(path: string): Promise<Uint8Array> {
    try {
      const result = await bridge.call('fs.readFile', { path, encoding: 'base64' });
      return base64ToBytes(result.contents);
    } catch (error) {
      if (error instanceof BridgeNotConnectedError) {
        if (await this.memory.exists(path)) return this.memory.readBytes(path);
        throw this.notConnected(`readBytes ${path}`);
      }
      throw error;
    }
  }

  async writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    try {
      await bridge.call('fs.writeFile', { path, contents: bytesToBase64(bytes), encoding: 'base64' });
    } catch (error) {
      if (error instanceof BridgeNotConnectedError) {
        await this.memory.writeBytes(path, bytes);
        return;
      }
      throw error;
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      const result = await bridge.call('fs.exists', { path });
      return result.exists;
    } catch (error) {
      if (error instanceof BridgeNotConnectedError) return this.memory.exists(path);
      throw error;
    }
  }

  async stat(path: string): Promise<FileStat | null> {
    try {
      const result = await bridge.call('fs.stat', { path });
      if (!result.exists) return null;
      return {
        isDirectory: result.isDirectory,
        isFile: !result.isDirectory,
        size: result.size,
        modifiedAt: result.modified,
      };
    } catch (error) {
      if (error instanceof BridgeNotConnectedError) return this.memory.stat(path);
      throw error;
    }
  }

  async mkdirp(path: string): Promise<void> {
    try {
      await bridge.call('fs.mkdir', { path });
    } catch (error) {
      if (error instanceof BridgeNotConnectedError) {
        await this.memory.mkdirp(path);
        return;
      }
      throw error;
    }
  }

  async readdir(path: string): Promise<string[]> {
    try {
      const result = await bridge.call('fs.readDir', { path });
      return result.entries.map((entry) => entry.name);
    } catch (error) {
      if (error instanceof BridgeNotConnectedError) return this.memory.readdir(path);
      throw error;
    }
  }

  async remove(path: string): Promise<void> {
    try {
      await bridge.call('fs.remove', { path });
    } catch (error) {
      if (error instanceof BridgeNotConnectedError) {
        await this.memory.remove(path);
        return;
      }
      throw error;
    }
  }

  async copy(from: string, to: string): Promise<void> {
    const bytes = await this.readBytes(from);
    await this.writeBytes(to, bytes);
  }

  async move(from: string, to: string): Promise<void> {
    await this.copy(from, to);
    await this.remove(from);
  }

  homeDirectory(): string {
    return this.paths?.home ?? this.memory.homeDirectory();
  }

  temporaryDirectory(): string {
    return this.paths?.temporaryDirectory ?? this.memory.temporaryDirectory();
  }

  applicationSupportDirectory(): string {
    return this.paths?.agenticSupport ?? this.memory.applicationSupportDirectory();
  }

  join(...parts: string[]): string {
    return posixJoin(...parts);
  }
}

// MARK: - ProcessRunner (server bridge)

export class BridgeProcessRunner implements ProcessRunner {
  async run(command: string, args: string[], options?: ProcessOptions): Promise<ProcessResult> {
    try {
      const result = await bridge.call('process.run', {
        executable: command,
        args,
        cwd: options?.cwd,
        env: options?.env,
        timeoutMs: options?.timeoutMs,
      });
      options?.onStdout?.(result.output);
      return { exitCode: result.status, stdout: result.output, stderr: '' };
    } catch (error) {
      if (error instanceof BridgeNotConnectedError) {
        throw new Error(`${BridgeNotConnectedMessage} (${command})`);
      }
      throw error;
    }
  }

  async which(command: string): Promise<string | null> {
    try {
      const result = await bridge.call('process.run', { executable: '/usr/bin/which', args: [command] });
      const path = result.output.trim();
      return result.status === 0 && path.length > 0 ? path : null;
    } catch {
      return null;
    }
  }
}

// MARK: - TextMeasurer (canvas measureText)

const WEIGHT_CSS: Record<string, string> = {
  black: '900',
  heavy: '800',
  bold: '700',
  semibold: '600',
  medium: '500',
  light: '300',
  regular: '400',
};

export class CanvasTextMeasurer implements TextMeasurer {
  private context: CanvasRenderingContext2D | null | undefined;

  private get ctx(): CanvasRenderingContext2D | null {
    if (this.context !== undefined) return this.context;
    if (typeof document === 'undefined') {
      this.context = null;
      return null;
    }
    const canvas = document.createElement('canvas');
    this.context = canvas.getContext('2d');
    return this.context;
  }

  private font(fontSize: number, weight: string): string {
    const cssWeight = WEIGHT_CSS[weight.toLowerCase()] ?? '400';
    return `${cssWeight} ${fontSize}px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif`;
  }

  width(text: string, fontSize: number, weight: string): number {
    const ctx = this.ctx;
    if (!ctx) return text.length * fontSize * (weight === 'bold' || weight === 'semibold' ? 0.56 : 0.52);
    ctx.font = this.font(fontSize, weight);
    return ctx.measureText(text).width;
  }

  fontBoundingHeight(fontSize: number, weight: string): number {
    const ctx = this.ctx;
    if (!ctx) return fontSize * 1.193;
    ctx.font = this.font(fontSize, weight);
    const metrics = ctx.measureText('Hg');
    const ascent = metrics.fontBoundingBoxAscent ?? metrics.actualBoundingBoxAscent ?? fontSize * 0.95;
    const descent = metrics.fontBoundingBoxDescent ?? metrics.actualBoundingBoxDescent ?? fontSize * 0.25;
    const height = ascent + descent;
    return height > 0 ? height : fontSize * 1.193;
  }

  wrappedHeight(text: string, width: number, fontSize: number, weight: string): number {
    if (text.length === 0) return 0;
    const lineHeight = this.fontBoundingHeight(fontSize, weight);
    if (!(width > 0)) return lineHeight;

    let lines = 0;
    for (const paragraph of text.split(/\r\n|\r|\n/)) {
      let current = '';
      let paragraphLines = 1;
      for (const word of paragraph.split(' ')) {
        const candidate = current.length === 0 ? word : `${current} ${word}`;
        if (this.width(candidate, fontSize, weight) <= width || current.length === 0) {
          current = candidate;
        } else {
          paragraphLines += 1;
          current = word;
        }
      }
      lines += paragraphLines;
    }
    return lines * lineHeight;
  }
}

// MARK: - Installation

export interface WebPlatformOptions {
  /** Connect the WebSocket bridge to the local server (default true). */
  connectBridge?: boolean;
}

/** Installs every browser adapter into the core platform registry. */
export function installWebPlatform(options: WebPlatformOptions = {}): Platform {
  const platform = setPlatform({
    clock: new SystemClock(),
    logger: new ConsoleLogger(),
    storage: new LocalStorage(),
    clipboard: new NavigatorClipboard(),
    fileSystem: new BridgeFileSystem(),
    processRunner: new BridgeProcessRunner(),
    renderer: new CanvasRenderer(),
  });

  setTextMeasurer(new CanvasTextMeasurer());

  if (options.connectBridge !== false) {
    bridge.connect();
  }

  return platform;
}
