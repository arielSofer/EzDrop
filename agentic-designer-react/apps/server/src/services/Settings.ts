// Server-side stand-in for UserDefaults / @AppStorage: ~/.agenticdesigner/settings.json.
// Key names are identical to the Swift app's (the browser mirrors them in
// localStorage; this copy serves server-side provider calls and the MCP
// server's own persisted port / enabled flag).
import fs from 'node:fs';
import path from 'node:path';
import { agenticDotDirectory, ensureDirectory, writeFileAtomic } from '../platform/Paths.js';

/// Every UserDefaults / @AppStorage key the Swift app reads (CONVENTIONS.md +
/// MCPServerController / GitSyncService / LocalModelTranslator).
export const KnownSettingsKeys = [
  'agentLoopCostApprovalUSD',
  'agentRunMode',
  'autoCriticEnabled',
  'autoHugTextBoxes',
  'cerebrasAPIKey',
  'designChatEngine',
  'geminiAPIKey',
  'groqAPIKey',
  'helsinkiTranslatorPython',
  'localFallbackModel',
  'nvidiaAPIKey',
  'openRouterAPIKey',
  'openRouterGenerationModel',
  'openRouterModel',
  'mcpServerPort',
  'mcpServerEnabled',
  'localTranslatorEndpoint',
  'localTranslatorModel',
  'localTranslatorLanguage',
  // Prefixed families: "AgenticDesignerPreview.<key>", "gitSync.enabled.<project>"
] as const;

export type SettingsValue = string | number | boolean | null | SettingsValue[] | { [key: string]: SettingsValue };

export function settingsPath(): string {
  return process.env.AGENTIC_SETTINGS_PATH ?? path.join(agenticDotDirectory(), 'settings.json');
}

function readAll(): Record<string, SettingsValue> {
  try {
    const text = fs.readFileSync(settingsPath(), 'utf8');
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(values: Record<string, SettingsValue>): void {
  const file = settingsPath();
  ensureDirectory(path.dirname(file));
  writeFileAtomic(file, JSON.stringify(values, null, 2) + '\n');
}

export const Settings = {
  all(): Record<string, SettingsValue> {
    return readAll();
  },

  get(key: string): SettingsValue | undefined {
    return readAll()[key];
  },

  set(key: string, value: SettingsValue | undefined): void {
    const values = readAll();
    if (value === undefined || value === null) {
      delete values[key];
    } else {
      values[key] = value;
    }
    writeAll(values);
  },

  remove(key: string): void {
    Settings.set(key, undefined);
  },

  /// UserDefaults.standard.string(forKey:)
  string(key: string): string | undefined {
    const value = readAll()[key];
    return typeof value === 'string' ? value : value === undefined || value === null ? undefined : String(value);
  },

  /// UserDefaults.standard.bool(forKey:) — false when missing.
  bool(key: string): boolean {
    const value = readAll()[key];
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return value === 'true' || value === '1' || value === 'YES';
    if (typeof value === 'number') return value !== 0;
    return false;
  },

  /// UserDefaults.standard.integer(forKey:) — 0 when missing.
  integer(key: string): number {
    const value = readAll()[key];
    if (typeof value === 'number') return Math.trunc(value);
    if (typeof value === 'string') {
      const parsed = parseInt(value, 10);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    if (typeof value === 'boolean') return value ? 1 : 0;
    return 0;
  },
};
