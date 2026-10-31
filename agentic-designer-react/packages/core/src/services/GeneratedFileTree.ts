// Shared shape for every exporter's output: relative path → file contents.
// Text files are plain strings; binary files (icons, images) are `{ base64 }`.
// Swift exporters write straight to disk with FileManager; the port produces
// the tree in memory and `writeTree` materialises it through the FileSystem
// adapter (server: node:fs; web: forwarded to the server or zipped).

import type { FileSystem } from '../platform/FileSystem';

export type GeneratedFileTree = Record<string, string | { base64: string }>;

export function isBinaryEntry(entry: string | { base64: string }): entry is { base64: string } {
  return typeof entry !== 'string';
}

/** `FileManager.createDirectory(withIntermediateDirectories:)` + `write(to:)` for every entry. */
export async function writeTree(fs: FileSystem, root: string, tree: GeneratedFileTree): Promise<void> {
  await fs.mkdirp(root);
  const paths = Object.keys(tree).sort();
  for (const relative of paths) {
    const full = fs.join(root, relative);
    const slash = relative.lastIndexOf('/');
    if (slash > 0) await fs.mkdirp(fs.join(root, relative.slice(0, slash)));
    const entry = tree[relative];
    if (isBinaryEntry(entry)) {
      await fs.writeBytes(full, base64ToBytes(entry.base64));
    } else {
      await fs.writeText(full, entry);
    }
  }
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Dependency-free base64 decoder (no `atob`/`Buffer` in lib.es2022). */
export function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, '');
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of clean) {
    buffer = (buffer << 6) | B64.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : undefined;
    const c = i + 2 < bytes.length ? bytes[i + 2] : undefined;
    const triple = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += B64[(triple >> 18) & 63] + B64[(triple >> 12) & 63];
    out += b === undefined ? '=' : B64[(triple >> 6) & 63];
    out += c === undefined ? '=' : B64[triple & 63];
  }
  return out;
}
