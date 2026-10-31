// Server-side sink for the exporters that run in the browser (@agentic/core
// LogicExporter / WebExporter still emit the Swift source). The editor sends
// `{rootDir, files}` and this writes them where the Swift app's
// FileManager calls would have — export_ios_source, export_xcode_project,
// export_web, Code Mode temp dirs, run_in_simulator's
// AgenticDesignerSimulatorRun work dir. Also the NSWorkspace / `/usr/bin/open`
// calls the Swift views make after an export.
import fs from 'node:fs';
import path from 'node:path';
import { ensureDirectory, expandingTildeInPath, temporaryDirectory } from '../platform/Paths.js';
import { runProcess } from '../platform/ProcessRunner.js';

export interface ExportFiles {
  [relativePath: string]: string | { base64: string };
}

export interface ExportWriteResult {
  rootDir: string;
  written: number;
  paths: string[];
}

export class ExportWriterError extends Error {}

function safeRelativePath(rootDir: string, relativePath: string): string {
  if (typeof relativePath !== 'string' || relativePath.length === 0) {
    throw new ExportWriterError('Export file paths must be non-empty relative paths.');
  }
  if (path.isAbsolute(relativePath)) {
    throw new ExportWriterError(`Export file path must be relative: ${relativePath}`);
  }
  const normalized = path.normalize(relativePath);
  if (normalized.split(path.sep).includes('..')) {
    throw new ExportWriterError(`Export file path escapes the export root: ${relativePath}`);
  }
  const full = path.join(rootDir, normalized);
  if (!full.startsWith(path.resolve(rootDir) + path.sep) && full !== path.resolve(rootDir)) {
    throw new ExportWriterError(`Export file path escapes the export root: ${relativePath}`);
  }
  return full;
}

export const ExportWriter = {
  /// Writes every file under rootDir (created as needed). `clean` removes the
  /// directory first — what the Swift exporters do for their own output root.
  write(rootDirValue: string, files: ExportFiles, clean: boolean = false): ExportWriteResult {
    const rootDir = path.resolve(expandingTildeInPath(rootDirValue));
    if (clean && fs.existsSync(rootDir)) {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
    ensureDirectory(rootDir);
    const written: string[] = [];
    for (const [relativePath, contents] of Object.entries(files)) {
      const full = safeRelativePath(rootDir, relativePath);
      ensureDirectory(path.dirname(full));
      if (typeof contents === 'string') {
        fs.writeFileSync(full, contents, 'utf8');
      } else if (contents && typeof contents === 'object' && typeof contents.base64 === 'string') {
        fs.writeFileSync(full, Buffer.from(contents.base64, 'base64'));
      } else {
        throw new ExportWriterError(`Unsupported contents for ${relativePath}`);
      }
      written.push(full);
    }
    return { rootDir, written: written.length, paths: written };
  },

  /// FileManager.default.temporaryDirectory.appendingPathComponent(name) —
  /// e.g. "AgenticDesignerSimulatorRun", "AgenticDesignerAppleWatchRun".
  temporaryDirectory(name: string, clean: boolean = false): string {
    const dir = path.join(temporaryDirectory(), name);
    if (clean && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    ensureDirectory(dir);
    return dir;
  },

  /// NSWorkspace.shared.open(url) for a file / .xcodeproj.
  async open(target: string): Promise<void> {
    await runProcess('/usr/bin/open', [expandingTildeInPath(target)]);
  },

  /// NSWorkspace.shared.activateFileViewerSelecting([url])
  async revealInFinder(target: string): Promise<void> {
    await runProcess('/usr/bin/open', ['-R', expandingTildeInPath(target)]);
  },

  /// NSWorkspace.shared.open(URL(string:)) — tel:, sms:, https:, …
  async openURL(url: string): Promise<void> {
    await runProcess('/usr/bin/open', [url]);
  },

  /// Opens a project/workspace explicitly in Xcode.
  async openInXcode(target: string): Promise<void> {
    await runProcess('/usr/bin/open', ['-a', 'Xcode', expandingTildeInPath(target)]);
  },
};
