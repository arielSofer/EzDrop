// Server-side equivalents of the FileManager / ProcessInfo lookups the Swift
// services share (application support root, temporary directory, "~" expansion).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

let applicationSupportOverride: string | undefined;

export function homeDirectory(): string {
  return os.homedir();
}

/// NSString.expandingTildeInPath
export function expandingTildeInPath(input: string): string {
  if (input === '~') return homeDirectory();
  if (input.startsWith('~/')) return path.join(homeDirectory(), input.slice(2));
  return input;
}

/// FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
export function applicationSupportDirectory(): string {
  return (
    applicationSupportOverride
    ?? process.env.AGENTIC_APP_SUPPORT_DIR
    ?? path.join(homeDirectory(), 'Library', 'Application Support')
  );
}

/// Tests point the services at a scratch directory instead of the real
/// ~/Library/Application Support/AgenticDesigner.
export function setApplicationSupportDirectoryForTesting(directory: string | undefined): void {
  applicationSupportOverride = directory;
}

/// ~/Library/Application Support/AgenticDesigner/<segments…>
export function agenticSupportDirectory(...segments: string[]): string {
  return path.join(applicationSupportDirectory(), 'AgenticDesigner', ...segments);
}

/// ~/.agenticdesigner — the server-side settings home.
export function agenticDotDirectory(): string {
  return process.env.AGENTIC_DOT_DIR ?? path.join(homeDirectory(), '.agenticdesigner');
}

/// FileManager.default.temporaryDirectory ($TMPDIR on macOS).
export function temporaryDirectory(): string {
  return os.tmpdir();
}

export function fileExists(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export function isDirectory(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

/// FileManager.default.isExecutableFile(atPath:)
export function isExecutableFile(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

/// UUID().uuidString — uppercase, as Swift prints it.
export function uuidString(): string {
  return crypto.randomUUID().toUpperCase();
}

export function lastPathComponent(filePath: string): string {
  return path.basename(filePath);
}

export function pathExtension(filePath: string): string {
  const ext = path.extname(filePath);
  return ext.startsWith('.') ? ext.slice(1) : ext;
}

export function deletingPathExtension(filePath: string): string {
  const ext = path.extname(filePath);
  return ext ? filePath.slice(0, -ext.length) : filePath;
}

/// Swift's String.trimmingCharacters(in: .whitespacesAndNewlines)
export function trimmed(text: string): string {
  return text.trim();
}

export function ensureDirectory(directory: string): void {
  fs.mkdirSync(directory, { recursive: true });
}

/// `Data.write(to:options:[.atomic])` — write to a sibling temp file, then rename.
export function writeFileAtomic(filePath: string, contents: string | Buffer): void {
  ensureDirectory(path.dirname(filePath));
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, contents);
  fs.renameSync(tmp, filePath);
}

export function contentModificationDate(filePath: string): number {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return -Infinity; // Date.distantPast
  }
}
