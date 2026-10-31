// Ported 1:1 from AgenticDesigner/Services/GeneratedSourcePreview.swift
//
// Code Mode's engine: the Swift that WOULD ship, before any export. It runs
// the real LogicExporter (the same code path as export_ios_source) and reads
// the tree back as strings — so the panel can never drift from what the
// exporter actually produces. Read-only by design: the design document stays
// the single source of truth.
//
// The Swift version exports into a throwaway directory and enumerates it; the
// port asks the exporter for the same tree in memory (LogicExporter returns
// `ExportResult`), so `generate` needs no filesystem at all. `typecheck` still
// materialises the tree, because swiftc reads files.

import type { DesignProject } from '../models/DesignProject';
import type { LogicFlow } from '../models/LogicModels';
import { newUUID } from '../models/uuid';
import type { FileSystem } from '../platform/FileSystem';
import { getPlatform } from '../platform/platform';
import { isBinaryEntry } from './GeneratedFileTree';
import { exportSwiftUISource, writeExport } from './LogicExporter';
import type { ExportOptions } from './logicExporter/types';
import type { TypecheckRunner } from './themeHosts';

export interface GeneratedSourceFile {
  relativePath: string;
  content: string;
  /**
   * True when this file's content comes from a Code Mode hand-edit
   * (project.sourceOverrides) rather than pure generation.
   */
  isOverridden: boolean;
}

/** `GeneratedSourceFile.id` */
export function generatedSourceFileId(file: GeneratedSourceFile): string {
  return file.relativePath;
}

/** `GeneratedSourceFile.fileName` — `(relativePath as NSString).lastPathComponent` */
export function generatedSourceFileName(file: GeneratedSourceFile): string {
  return lastPathComponent(file.relativePath);
}

/** `GeneratedSourceFile.directory` */
export function generatedSourceFileDirectory(file: GeneratedSourceFile): string {
  const dir = deletingLastPathComponent(file.relativePath);
  return dir.length === 0 ? 'Root' : dir;
}

/** `GeneratedSourceFile.lineCount` */
export function generatedSourceFileLineCount(file: GeneratedSourceFile): number {
  let count = 1;
  for (const ch of file.content) if (ch === '\n') count += 1;
  return count;
}

function lastPathComponent(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function deletingLastPathComponent(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '' : path.slice(0, slash);
}

function pathExtension(path: string): string {
  const name = lastPathComponent(path);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot + 1);
}

const textExtensions: ReadonlySet<string> = new Set([
  'swift', 'plist', 'entitlements', 'storekit', 'rules', 'md', 'xcprivacy', 'json',
]);

/**
 * `GeneratedSourcePreview.generate(project:flows:currentPageId:)` — the full
 * export source tree, as text files, Swift sources first.
 */
export function generate(
  project: DesignProject,
  flows: LogicFlow[],
  currentPageId: string | undefined,
  options: ExportOptions = {},
): GeneratedSourceFile[] {
  const exportOptions: ExportOptions = { ...options };
  if (currentPageId !== undefined) exportOptions.currentPageId = currentPageId;
  const result = exportSwiftUISource(project, flows, exportOptions);

  const overriddenNames = new Set(Object.keys(project.sourceOverrides ?? {}));
  const files: GeneratedSourceFile[] = [];
  for (const relative of Object.keys(result.files)) {
    if (!textExtensions.has(pathExtension(relative).toLowerCase())) continue;
    const entry = result.files[relative]!;
    // `String(contentsOf:encoding: .utf8)` fails for binary payloads — those
    // files are skipped exactly as the `try?` does in Swift.
    if (isBinaryEntry(entry)) continue;
    files.push({
      relativePath: relative,
      content: entry,
      isOverridden: pathExtension(relative) === 'swift' && overriddenNames.has(lastPathComponent(relative)),
    });
  }
  // Swift sources first (that's what people came to read), then the rest,
  // each alphabetically by path.
  return files.sort((a, b) => {
    const aSwift = a.relativePath.endsWith('.swift');
    const bSwift = b.relativePath.endsWith('.swift');
    if (aSwift !== bSwift) return aSwift ? -1 : 1;
    return a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0;
  });
}

/**
 * `GeneratedSourcePreview.defaultSelection(in:pageName:)` — best-effort
 * "open the file for the screen I'm looking at": matches the current page's
 * name against generated screen-view file names, then falls back to the most
 * interesting code — a screen, the root view — never Package.swift or a README.
 */
export function defaultSelection(
  files: GeneratedSourceFile[],
  pageName: string,
): GeneratedSourceFile | undefined {
  const compact = [...pageName]
    .map((c) => (/[A-Za-z0-9]/.test(c) ? c : ' '))
    .join('')
    .split(' ')
    .join('')
    .toLowerCase();
  if (compact.length > 0) {
    const match = files.find(
      (f) =>
        generatedSourceFileName(f).endsWith('.swift') &&
        generatedSourceFileName(f).toLowerCase().includes(compact),
    );
    if (match) return match;
  }
  return (
    files.find((f) => f.relativePath.includes('/Screens/')) ??
    files.find((f) => generatedSourceFileName(f) === 'RootView.swift') ??
    files.find(
      (f) => generatedSourceFileName(f).endsWith('.swift') && generatedSourceFileName(f) !== 'Package.swift',
    ) ??
    files[0]
  );
}

// MARK: - Recompile (typecheck)

export interface CodeDiagnostic {
  id: string;
  fileName: string;
  line: number;
  column: number;
  /** "error" | "warning" */
  severity: string;
  message: string;
}

export interface TypecheckResult {
  success: boolean;
  diagnostics: CodeDiagnostic[];
  checkedFileCount: number;
}

/**
 * `GeneratedSourcePreview.typecheck(project:flows:currentPageId:)` — the
 * Recompile button's engine: exports the current design + overrides to a temp
 * directory and runs the REAL iOS-simulator swiftc in -typecheck mode over
 * every generated .swift (the `TypecheckRunner` adapter, implemented by the
 * server as `xcrun -sdk iphonesimulator swiftc -typecheck -target
 * <arch>-apple-ios17.0-simulator -parse-as-library …`). Returns parsed
 * per-file diagnostics.
 */
export async function typecheck(
  project: DesignProject,
  flows: LogicFlow[],
  currentPageId: string | undefined,
  runner: TypecheckRunner,
  options: { fs?: FileSystem } & ExportOptions = {},
): Promise<TypecheckResult> {
  const { fs, ...exportOptionsRest } = options;
  const system = fs ?? getPlatform().fileSystem;
  const temp = system.join(system.temporaryDirectory(), `AgenticDesigner-Typecheck-${newUUID()}`);
  try {
    await system.mkdirp(temp);

    const exportOptions: ExportOptions = { ...exportOptionsRest };
    if (currentPageId !== undefined) exportOptions.currentPageId = currentPageId;
    const result = exportSwiftUISource(project, flows, exportOptions);
    const root = await writeExport(system, temp, result);

    const sourceFiles = Object.keys(result.files)
      .filter((relative) => relative.startsWith('Sources/') && pathExtension(relative) === 'swift')
      .map((relative) => system.join(root, relative));
    if (sourceFiles.length === 0) {
      // `GitSyncError.message`
      throw new Error('No generated Swift sources to compile.');
    }

    const { status, output } = await runner.run([...sourceFiles].sort());

    // swiftc diagnostics: /path/File.swift:12:5: error: message
    const pattern = /^(.+?\.swift):(\d+):(\d+): (error|warning): (.+)$/;
    const diagnostics: CodeDiagnostic[] = [];
    for (const lineText of output.split('\n')) {
      const match = pattern.exec(lineText);
      if (match === null) continue;
      diagnostics.push({
        id: newUUID(),
        fileName: lastPathComponent(match[1]!),
        line: Number.parseInt(match[2]!, 10) || 0,
        column: Number.parseInt(match[3]!, 10) || 0,
        severity: match[4]!,
        message: match[5]!,
      });
    }
    // A crash/misconfiguration with no parseable diagnostics still has to
    // surface — otherwise a failed compile reads as "Build OK".
    if (status !== 0 && diagnostics.length === 0) {
      diagnostics.push({
        id: newUUID(),
        fileName: 'swiftc',
        line: 0,
        column: 0,
        severity: 'error',
        message: output.slice(Math.max(0, output.length - 400)),
      });
    }
    return { success: status === 0, diagnostics, checkedFileCount: sourceFiles.length };
  } finally {
    try {
      await system.remove(temp);
    } catch {
      // `defer { try? FileManager.default.removeItem(at: temp) }`
    }
  }
}

// MARK: - Syntax highlighting

/**
 * `CodeTheme` (Views/CodeTextView.swift) as hex — the dark palette the
 * highlighter colours with. NSColor(srgbRed:green:blue:alpha:) → #RRGGBB.
 */
export const CodeTheme = {
  background: '#1E1F23',
  gutterBackground: '#19191D',
  gutterText: '#6B707A',
  plainText: '#DFE0E1',
  /** Xcode pink */
  keyword: '#FC5FA3',
  /** cyan */
  typeName: '#5DD8FF',
  /** coral */
  string: '#FC6A5D',
  /** khaki */
  number: '#D0BF69',
  /** slate */
  comment: '#7F8C98',
  fontSize: 12,
  gutterFontSize: 10,
} as const;

export interface HighlightToken {
  /** UTF-16 offsets, as NSRange uses. */
  start: number;
  end: number;
  color: string;
}

export interface HighlightedCode {
  text: string;
  tokens: HighlightToken[];
}

const keywords = [
  'import', 'struct', 'class', 'enum', 'extension', 'protocol', 'func', 'var', 'let',
  'if', 'else', 'guard', 'switch', 'case', 'default', 'for', 'while', 'repeat', 'in',
  'return', 'break', 'continue', 'throw', 'throws', 'rethrows', 'try', 'catch', 'defer',
  'init', 'deinit', 'self', 'Self', 'super', 'static', 'final', 'private', 'public',
  'internal', 'fileprivate', 'open', 'override', 'mutating', 'nonmutating', 'lazy',
  'weak', 'unowned', 'some', 'any', 'async', 'await', 'actor', 'nil', 'true', 'false',
  'where', 'as', 'is', 'typealias', 'associatedtype', 'do', '@State', '@Binding',
  '@Published', '@ObservedObject', '@StateObject', '@EnvironmentObject', '@Environment',
  '@MainActor', '@ViewBuilder', '@main', '@escaping', '@discardableResult',
];

/** `NSRegularExpression.escapedPattern(for:)` */
function escapedPattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
}

const keywordPattern =
  '(?<![A-Za-z0-9_@])(' + keywords.map(escapedPattern).join('|') + ')(?![A-Za-z0-9_])';

/**
 * Order matters: literals and keywords first, strings and comments last so
 * they override what they contain.
 */
const rules: [RegExp, string][] = [
  [/(?<![A-Za-z0-9_])[0-9]+(?:\.[0-9]+)?/g, CodeTheme.number],
  [/(?<![A-Za-z0-9_])[A-Z][A-Za-z0-9_]*/g, CodeTheme.typeName],
  [new RegExp(keywordPattern, 'g'), CodeTheme.keyword],
  [/"(?:[^"\\\n]|\\.)*"/g, CodeTheme.string],
  [/\/\/[^\n]*/g, CodeTheme.comment],
];

/**
 * Files past this size render plain — highlighting is O(file · rules) and
 * the payoff on a huge generated file is nil.
 */
const highlightLimit = 150_000;

/**
 * Live refresh re-evaluates the view body often; cache by file + content
 * so unchanged files never pay the regex pass twice (Swift: NSCache).
 */
const cache = new Map<string, HighlightedCode>();

/** `SwiftCodeHighlighter.attributedCode(_:isSwift:cacheKey:)` */
export function attributedCode(code: string, isSwift: boolean, cacheKey: string): HighlightedCode {
  const key = `${cacheKey}#${isSwift}#${stringHash(code)}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const highlighted: HighlightedCode = { text: code, tokens: applyColorPass(code, isSwift) };
  cache.set(key, highlighted);
  return highlighted;
}

/**
 * `SwiftCodeHighlighter.rehighlight(_:isSwift:)` — in place while the user
 * types: only attributes change, so selection/caret/scroll all survive.
 */
export function rehighlight(code: string, isSwift: boolean): HighlightedCode {
  return { text: code, tokens: applyColorPass(code, isSwift) };
}

/**
 * The colour pass, as spans. Later rules overwrite earlier ones on the same
 * characters, exactly like `addAttribute(.foregroundColor:)` does.
 */
export function applyColorPass(code: string, isSwift: boolean): HighlightToken[] {
  if (!isSwift || charCount(code) > highlightLimit) return [];
  const colors: (string | undefined)[] = new Array<string | undefined>(code.length).fill(undefined);
  for (const [regex, color] of rules) {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(code)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      for (let i = start; i < end; i += 1) colors[i] = color;
      if (match[0].length === 0) regex.lastIndex += 1;
    }
  }
  const tokens: HighlightToken[] = [];
  let index = 0;
  while (index < colors.length) {
    const color = colors[index];
    if (color === undefined) {
      index += 1;
      continue;
    }
    let end = index + 1;
    while (end < colors.length && colors[end] === color) end += 1;
    tokens.push({ start: index, end, color });
    index = end;
  }
  return tokens;
}

/** Swift `String.count` (code points) — the highlight-limit check. */
function charCount(text: string): number {
  let count = 0;
  for (const _ of text) count += 1;
  return count;
}

/** A cheap content hash standing in for Swift's `hashValue`. */
function stringHash(text: string): number {
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
  return hash;
}

export const SwiftCodeHighlighter = { attributedCode, rehighlight, applyColorPass, CodeTheme } as const;

/** Static members of the Swift `GeneratedSourcePreview` enum. */
export const GeneratedSourcePreview = { generate, defaultSelection, typecheck } as const;
