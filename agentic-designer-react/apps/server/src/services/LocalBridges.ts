// Ported from the process-launch + health-check parts of:
//   AgenticDesigner/Agent/OpenRouterProvider.swift   (ensureImageBridge / isPortOpen — mflux on :7860)
//   AgenticDesigner/Services/LocalModelTranslator.swift (ensureHelsinkiWorker / translateWithHelsinki — :17841)
//   AgenticDesigner/ViewModels/PDFEditorViewModel.swift (runGooglePDFTranslation — zsh + pdf-translate-venv)
// The python scripts are the bundle's Resources/, copied unchanged into
// apps/server/resources/.
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import type { ChildProcess } from 'node:child_process';
import { deletingPathExtension, fileExists, isExecutableFile } from '../platform/Paths.js';
import { launchDetachedWorker, runProcess } from '../platform/ProcessRunner.js';
import { Settings } from './Settings.js';

const resourcesDirectory = fileURLToPath(new URL('../../resources/', import.meta.url));

export function resourcePath(fileName: string): string {
  return path.join(resourcesDirectory, fileName);
}

// MARK: - LocalTranslatorError

export type LocalTranslatorErrorCase =
  | { kind: 'noModel' }
  | { kind: 'badEndpoint'; endpoint: string }
  | { kind: 'serverError'; body: string }
  | { kind: 'badResponse' }
  | { kind: 'unsupportedLanguage'; model: string; language: string }
  | { kind: 'helsinkiWorker'; message: string };

export class LocalTranslatorError extends Error {
  constructor(public readonly errorCase: LocalTranslatorErrorCase) {
    super(LocalTranslatorError.errorDescription(errorCase));
    this.name = 'LocalTranslatorError';
  }
  static errorDescription(errorCase: LocalTranslatorErrorCase): string {
    switch (errorCase.kind) {
      case 'noModel': return 'No local model selected — open the Translate tool settings and pick one.';
      case 'badEndpoint': return `Invalid endpoint: ${errorCase.endpoint}`;
      case 'serverError': return `Local model server error: ${errorCase.body}`;
      case 'badResponse': return 'The local model returned an unexpected response.';
      case 'unsupportedLanguage': return `${errorCase.model} only supports English to Hebrew, not ${errorCase.language}.`;
      case 'helsinkiWorker': return `Helsinki translator error: ${errorCase.message}`;
    }
  }
  static helsinkiWorker(message: string): LocalTranslatorError {
    return new LocalTranslatorError({ kind: 'helsinkiWorker', message });
  }
}

export const helsinkiModel = 'Helsinki-NLP/opus-mt-en-he';
const helsinkiHealthURL = 'http://127.0.0.1:17841/health';
const helsinkiTranslateURL = 'http://127.0.0.1:17841/translate';
export const mfluxPort = 7860;

// Draw Things / AUTOMATIC1111-compatible local image generation.
// Keeps the auto-started bridge alive for the server's lifetime.
let imageBridgeProcess: ChildProcess | null = null;
let helsinkiWorker: ChildProcess | null = null;

function isRunning(child: ChildProcess | null): boolean {
  return !!child && child.exitCode === null && child.signalCode === null;
}

export const LocalBridges = {
  /// URLSession probe with a 1.5s timeout: only "cannot connect" means closed —
  /// any answer (or a slow one) means something is listening.
  async isPortOpen(port: number): Promise<boolean> {
    try {
      await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1500) });
      return true;
    } catch (error) {
      const cause = (error as { cause?: { code?: string } }).cause;
      return cause?.code !== 'ECONNREFUSED';
    }
  },

  /// If the MFLUX bridge (A1111-compatible, on :7860) isn't already running,
  /// spawn the bundled `mflux_bridge.py` — so local image generation works
  /// out of the box instead of requiring the user to start it by hand.
  async ensureImageBridge(): Promise<boolean> {
    if (await LocalBridges.isPortOpen(mfluxPort)) return true;
    if (isRunning(imageBridgeProcess)) return true;
    const scriptURL = resourcePath('mflux_bridge.py');
    const python = ['/opt/homebrew/bin/python3', '/usr/bin/python3'].find((candidate) => isExecutableFile(candidate));
    if (!fileExists(scriptURL) || !python) return false;
    try {
      imageBridgeProcess = launchDetachedWorker(python, [scriptURL]);
    } catch {
      return false;
    }
    // Give the HTTP server a few seconds to bind before the first request.
    for (let attempt = 0; attempt < 12; attempt++) {
      if (await LocalBridges.isPortOpen(mfluxPort)) return true;
      await sleep(500);
    }
    return false;
  },

  async ensureHelsinkiWorker(): Promise<void> {
    if (await healthOK()) return;

    if (!isRunning(helsinkiWorker)) {
      const scriptURL = resourcePath('helsinki_translation_server.py');
      if (!fileExists(scriptURL)) throw LocalTranslatorError.helsinkiWorker('Bundled translation worker is missing.');

      const configuredPython = Settings.string('helsinkiTranslatorPython');
      const candidates = [
        configuredPython,
        '/Users/ariel/.agenticdesigner/pdf-translate-venv/bin/python',
        '/opt/homebrew/bin/python3',
        '/usr/bin/python3',
      ].filter((candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0);
      const python = candidates.find((candidate) => isExecutableFile(candidate));
      if (!python) throw LocalTranslatorError.helsinkiWorker('Python 3 is required for the Helsinki model.');
      try {
        helsinkiWorker = launchDetachedWorker(python, [scriptURL]);
      } catch (error) {
        throw LocalTranslatorError.helsinkiWorker((error as Error).message);
      }
    }

    for (let attempt = 0; attempt < 40; attempt++) {
      await sleep(100);
      if (await healthOK()) return;
      if (!isRunning(helsinkiWorker)) break;
    }
    throw LocalTranslatorError.helsinkiWorker('Could not start the local worker. Install transformers, torch, and sentencepiece in the configured Python environment.');
  },

  async translateWithHelsinki(text: string): Promise<string> {
    await LocalBridges.ensureHelsinkiWorker();
    let response: Response;
    let payload: Record<string, unknown>;
    try {
      response = await fetch(helsinkiTranslateURL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(1_200_000),
      });
      payload = (await response.json()) as Record<string, unknown>;
    } catch {
      throw new LocalTranslatorError({ kind: 'badResponse' });
    }
    if (!(response.status >= 200 && response.status < 300) || typeof payload.translation !== 'string') {
      throw LocalTranslatorError.helsinkiWorker(typeof payload.error === 'string' ? payload.error : 'Unexpected worker response');
    }
    const result = payload.translation.trim();
    if (result.length === 0) throw new LocalTranslatorError({ kind: 'badResponse' });
    return result;
  },

  // MARK: - Google PDF translation pipeline (PDFEditorViewModel.runGooglePDFTranslation)

  isExternalPDFTranslationRunning: false,

  async runGooglePDFTranslation(
    fileURL: string,
    onProgress: (update: { progress: string; statusMessage: string }) => void = () => {},
  ): Promise<{ outputDir: string; readablePDF: string }> {
    if (LocalBridges.isExternalPDFTranslationRunning) {
      throw new Error('A PDF translation is already running.');
    }
    const pythonURL = '/Users/ariel/.agenticdesigner/pdf-translate-venv/bin/python';
    const translateScriptURL = '/Users/ariel/Downloads/mml_translate_to_hebrew.py';
    const exportScriptURL = '/Users/ariel/Downloads/mml_export_readable_hebrew_pdf.py';

    if (!isExecutableFile(pythonURL)) {
      onProgress({ progress: 'Missing Python environment', statusMessage: 'Translation Python environment is missing' });
      throw new Error('Translation Python environment is missing');
    }
    if (!fileExists(translateScriptURL) || !fileExists(exportScriptURL)) {
      onProgress({ progress: 'Missing translation scripts', statusMessage: 'Translation scripts are missing' });
      throw new Error('Translation scripts are missing');
    }

    const stem = path.basename(deletingPathExtension(fileURL));
    const outputDir = path.join(path.dirname(fileURL), `${stem}-hebrew-translation`);
    const readablePDFURL = path.join(outputDir, `${stem}-hebrew-readable.pdf`);

    const env = {
      ...process.env,
      MML_TRANSLATOR: 'google',
      MML_PDF_PATH: fileURL,
      MML_OUT_DIR: outputDir,
    };
    LocalBridges.isExternalPDFTranslationRunning = true;
    onProgress({ progress: 'Translating with Google…', statusMessage: 'Translating PDF…' });
    try {
      const result = await runProcess('/bin/zsh', [
        '-lc',
        `"${pythonURL}" "${translateScriptURL}" && "${pythonURL}" "${exportScriptURL}"`,
      ], { env });
      const tail = result.output.split(/\r?\n/).filter((line) => line.length > 0).slice(-3).join(' ');
      if (result.status === 0) {
        onProgress({ progress: `Done: ${path.basename(readablePDFURL)}`, statusMessage: `Created ${path.basename(readablePDFURL)}` });
        await runProcess('/usr/bin/open', ['-R', readablePDFURL]).catch(() => undefined);
        return { outputDir, readablePDF: readablePDFURL };
      }
      onProgress({ progress: `Failed: ${tail}`, statusMessage: 'Google translation failed' });
      throw new Error(`Google translation failed: ${tail}`);
    } finally {
      LocalBridges.isExternalPDFTranslationRunning = false;
    }
  },

  /// deinit { helsinkiWorker?.terminate() } + the image bridge.
  shutdown(): void {
    if (isRunning(helsinkiWorker)) helsinkiWorker?.kill('SIGTERM');
    if (isRunning(imageBridgeProcess)) imageBridgeProcess?.kill('SIGTERM');
    helsinkiWorker = null;
    imageBridgeProcess = null;
  },

  /// Existing sprite / generated-asset files also live here (SpriteGenerator).
  fs,
};

async function healthOK(): Promise<boolean> {
  try {
    const response = await fetch(helsinkiHealthURL, { signal: AbortSignal.timeout(5000) });
    return response.status === 200;
  } catch {
    return false;
  }
}
