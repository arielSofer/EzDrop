// Ported 1:1 from AgenticDesigner/Services/GeneratedSourcePreview.swift
// (the Recompile / typecheck half — the syntax highlighter and file listing
// are browser work). The editor generates the export with @agentic/core's
// LogicExporter and sends the files; this writes them to the same temp
// directory the Swift code used and runs the REAL iOS-simulator swiftc in
// -typecheck mode over every generated .swift.
import fs from 'node:fs';
import path from 'node:path';
import { ensureDirectory, fileExists, temporaryDirectory, uuidString } from '../platform/Paths.js';
import { runProcess } from '../platform/ProcessRunner.js';
import { ExportWriter, type ExportFiles } from './ExportWriter.js';
import { enumerateSwiftFiles } from './SimulatorRunner.js';

export interface CodeDiagnostic {
  fileName: string;
  line: number;
  column: number;
  severity: string; // "error" | "warning"
  message: string;
}

export interface TypecheckResult {
  success: boolean;
  diagnostics: CodeDiagnostic[];
  checkedFileCount: number;
}

export const GeneratedSourcePreview = {
  /// The Recompile button's engine. `files` are the exporter's output relative
  /// to the export root (Sources/…, Package.swift, Info.plist, …).
  async typecheck(files: ExportFiles): Promise<TypecheckResult> {
    const temp = path.join(temporaryDirectory(), `AgenticDesigner-Typecheck-${uuidString()}`);
    try {
      ensureDirectory(temp);
      const root = ExportWriter.write(temp, files).rootDir;
      const sourcesDir = path.join(root, 'Sources');
      const sourceFiles = enumerateSwiftFiles(sourcesDir);
      if (sourceFiles.length === 0) {
        throw new Error('No generated Swift sources to compile.');
      }

      const arch = process.arch === 'arm64' ? 'arm64' : 'x86_64';
      const { status, output } = await runCompiler(
        '/usr/bin/xcrun',
        ['-sdk', 'iphonesimulator', 'swiftc', '-typecheck',
          '-target', `${arch}-apple-ios17.0-simulator`,
          '-parse-as-library',
          ...sourceFiles.sort()],
        await developerDir(),
      );

      // swiftc diagnostics: /path/File.swift:12:5: error: message
      const pattern = /^(.+?\.swift):(\d+):(\d+): (error|warning): (.+)$/;
      const diagnostics: CodeDiagnostic[] = [];
      for (const lineText of output.split('\n')) {
        const match = pattern.exec(lineText);
        if (!match) continue;
        diagnostics.push({
          fileName: path.basename(match[1]!),
          line: parseInt(match[2]!, 10) || 0,
          column: parseInt(match[3]!, 10) || 0,
          severity: match[4]!,
          message: match[5]!,
        });
      }
      // A crash/misconfiguration with no parseable diagnostics still has to
      // surface — otherwise a failed compile reads as "Build OK".
      if (status !== 0 && diagnostics.length === 0) {
        diagnostics.push({
          fileName: 'swiftc', line: 0, column: 0, severity: 'error',
          message: output.slice(Math.max(0, output.length - 400)),
        });
      }
      return { success: status === 0, diagnostics, checkedFileCount: sourceFiles.length };
    } finally {
      try { fs.rmSync(temp, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  },
};

async function developerDir(): Promise<string> {
  const simulatorPlatform = '/Platforms/iPhoneSimulator.platform';
  const { status, output } = await runCompiler('/usr/bin/xcode-select', ['-p'], null);
  if (status === 0) {
    const selected = output.trim();
    if (fileExists(selected + simulatorPlatform)) return selected;
  }
  return '/Applications/Xcode.app/Contents/Developer';
}

async function runCompiler(executable: string, args: string[], developerDirValue: string | null): Promise<{ status: number; output: string }> {
  const env = developerDirValue ? { ...process.env, DEVELOPER_DIR: developerDirValue } : undefined;
  try {
    return await runProcess(executable, args, { env });
  } catch (error) {
    return { status: 1, output: `Failed to launch ${executable}: ${(error as Error).message}` };
  }
}
