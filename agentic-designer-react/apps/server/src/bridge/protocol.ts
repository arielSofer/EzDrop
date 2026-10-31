import type { AskAgentOptions, AskAgentResult } from '@agentic/core';
// Bridge protocol between the AgenticDesigner server (Node) and the editor
// (browser). Copy this file verbatim into apps/web — it is the single source
// of truth for the envelope and the request names.
//
// Transport: WebSocket on ws://127.0.0.1:8766 (env AGENTIC_BRIDGE_PORT).
// Requests flow BOTH ways with the same envelope:
//   { id, type: 'request', name, args }  →  { id, type: 'response', ok, result | error }
// plus fire-and-forget pushes:
//   { type: 'event', name, payload }

export const BRIDGE_DEFAULT_PORT = 8766;
export const BRIDGE_PORT_ENV = 'AGENTIC_BRIDGE_PORT';
export const MCP_DEFAULT_PORT = 8765;
export const MCP_PORT_ENV = 'AGENTIC_MCP_PORT';

export interface BridgeRequestEnvelope {
  id: string;
  type: 'request';
  name: string;
  args?: unknown;
}

export interface BridgeResponseEnvelope {
  id: string;
  type: 'response';
  ok: boolean;
  result?: unknown;
  /// Present when ok === false: the same error text the Swift app would show.
  error?: string;
}

export interface BridgeEventEnvelope {
  type: 'event';
  name: string;
  payload?: unknown;
}

export type BridgeEnvelope = BridgeRequestEnvelope | BridgeResponseEnvelope | BridgeEventEnvelope;

export function encodeEnvelope(envelope: BridgeEnvelope): string {
  return JSON.stringify(envelope);
}

export class BridgeProtocolError extends Error {}

export function decodeEnvelope(text: string): BridgeEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BridgeProtocolError('Bridge message is not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object') throw new BridgeProtocolError('Bridge message must be an object.');
  const message = parsed as Record<string, unknown>;
  switch (message.type) {
    case 'request':
      if (typeof message.id !== 'string' || typeof message.name !== 'string') {
        throw new BridgeProtocolError("Bridge request needs string 'id' and 'name'.");
      }
      return { id: message.id, type: 'request', name: message.name, args: message.args };
    case 'response':
      if (typeof message.id !== 'string' || typeof message.ok !== 'boolean') {
        throw new BridgeProtocolError("Bridge response needs string 'id' and boolean 'ok'.");
      }
      return {
        id: message.id,
        type: 'response',
        ok: message.ok,
        result: message.result,
        error: typeof message.error === 'string' ? message.error : undefined,
      };
    case 'event':
      if (typeof message.name !== 'string') throw new BridgeProtocolError("Bridge event needs string 'name'.");
      return { type: 'event', name: message.name, payload: message.payload };
    default:
      throw new BridgeProtocolError(`Unknown bridge message type: ${String(message.type)}`);
  }
}

// MARK: - Shared shapes

/// MCPToolResult as it crosses the bridge (MCPServer.swift).
export type BridgeContentItem =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };
export interface BridgeToolResult {
  content: BridgeContentItem[];
  isError: boolean;
}

/// One entry of the editor's tool registry (MCPToolDefinition minus the handler).
export interface BridgeToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface MCPStatus {
  isRunning: boolean;
  port: number;
  enabled: boolean;
  lastError: string | null;
  endpointURL: string;
  claudeCodeCommand: string;
  editorConnected: boolean;
  toolCount: number;
}

export interface MCPCallLogEntry {
  id: string;
  date: number; // ms since epoch
  message: string;
}

/// ProjectCheckpoint (CheckpointStore.swift) — `id` is the file path.
export interface ProjectCheckpointInfo {
  id: string;
  url: string;
  label: string;
  date: number; // ms since epoch
}

/// SavedComponent (ComponentLibrary.swift) as stored on disk.
export interface SavedComponentJSON {
  id: string;
  name: string;
  category: string;
  node: Record<string, unknown>;
  createdAt: string; // ISO-8601
}

export interface ExportFiles {
  /// relativePath → UTF-8 text, or { base64 } for binary payloads.
  [relativePath: string]: string | { base64: string };
}

export interface LaunchResult {
  deviceName: string;
  bundleIdentifier: string;
}

export interface XcodeProjectLaunchResult extends LaunchResult {
  deviceUDID: string;
  aliveAfterLaunch: boolean;
}

export interface ArchiveResult {
  archivePath: string;
  ipaPath: string | null;
}

export interface CodeDiagnostic {
  fileName: string;
  line: number;
  column: number;
  severity: string; // "error" | "warning"
  message: string;
}

export interface AndroidSetupStatus {
  supported: boolean;
  ready: boolean;
  components: Array<{ id: string; label: string; ready: boolean }>;
  running: boolean;
  message: string;
  error: string | null;
}

export interface AndroidRunRequest {
  capturePreview?: boolean;
  projectId: string;
  runId: string;
  files: Record<string, string>;
  entryFile: string;
  entryFunction: string;
}
export interface AndroidRunResult {
  previewImage?: string;
  previewError?: string;
  success: boolean;
  phase: 'build' | 'emulator' | 'install' | 'launch';
  message: string;
  diagnostics: CodeDiagnostic[];
  output: string;
  sourceHash: string;
  serial?: string;
  packageName?: string;
  apkPath?: string;
}

export interface TypecheckResult {
  success: boolean;
  diagnostics: CodeDiagnostic[];
  checkedFileCount: number;
}

export interface ProvisionResult {
  projectId: string;
  appId: string;
  apiKey: string;
  messagingSenderId: string;
  storageBucket: string;
  steps: string[];
  warnings: string[];
}

export type ChatGPTStatus =
  | { kind: 'notInstalled' }
  | { kind: 'signedOut' }
  | { kind: 'ready'; account: string };

export interface ChatGPTState {
  status: ChatGPTStatus;
  isBusy: boolean;
  transcript: string[];
  codexPath: string | null;
  installHint: string;
}

export interface SpriteGenerationResult {
  framePaths: string[];
  cutout: boolean;
}

// MARK: - Request catalogue: editor → server
// Each entry: args shape → result shape. Handlers live in apps/server/src/index.ts.

export interface ServerRequests {
  'android.setupStatus': { args: Record<string, never>; result: AndroidSetupStatus };
  'android.setupInstall': { args: { acceptLicenses: boolean }; result: { started: boolean } };
  'android.buildAndLaunch': { args: AndroidRunRequest; result: AndroidRunResult };
  'learning.ask': { args: AskAgentOptions; result: AskAgentResult };
  'learning.configure': { args: { apiKey: string }; result: { configured: boolean } };
  // Registration / liveness
  'editor.register': {
    args: { tools: BridgeToolDefinition[]; clientInfo?: { name: string; version?: string } };
    result: { accepted: number; unknown: string[]; missing: string[]; mcp: MCPStatus };
  };
  'bridge.ping': { args: Record<string, never>; result: { pong: true; time: number } };

  // MCP lifecycle (MCPServerController.swift)
  'mcp.status': { args: Record<string, never>; result: MCPStatus };
  'mcp.setEnabled': { args: { enabled: boolean }; result: MCPStatus };
  'mcp.setPort': { args: { port: number }; result: MCPStatus };
  'mcp.callLog': { args: Record<string, never>; result: MCPCallLogEntry[] };

  // Settings (~/.agenticdesigner/settings.json)
  'settings.all': { args: Record<string, never>; result: Record<string, unknown> };
  'settings.get': { args: { key: string }; result: { value: unknown } };
  'settings.set': { args: { key: string; value: unknown }; result: { ok: true } };

  // Filesystem (platform FileSystem adapter)
  'fs.readFile': { args: { path: string; encoding?: 'utf8' | 'base64' }; result: { contents: string } };
  'fs.writeFile': { args: { path: string; contents: string; encoding?: 'utf8' | 'base64' }; result: { path: string } };
  'fs.exists': { args: { path: string }; result: { exists: boolean; isDirectory: boolean } };
  'fs.readDir': { args: { path: string }; result: { entries: { name: string; path: string; isDirectory: boolean; modified: number; size: number }[] } };
  'fs.mkdir': { args: { path: string }; result: { path: string } };
  'fs.remove': { args: { path: string }; result: { removed: boolean } };
  'fs.stat': { args: { path: string }; result: { exists: boolean; isDirectory: boolean; size: number; modified: number } };
  'fs.paths': { args: Record<string, never>; result: { home: string; temporaryDirectory: string; applicationSupport: string; agenticSupport: string; savedProjects: string; checkpoints: string; components: string; gitRepos: string; exports: string; generatedAssets: string; studioAssets: string; translation: string } };

  // Generic process runner (platform ProcessRunner adapter)
  'process.run': { args: { executable: string; args: string[]; cwd?: string; env?: Record<string, string>; timeoutMs?: number }; result: { status: number; output: string } };

  // Open things (NSWorkspace / /usr/bin/open)
  'os.open': { args: { path: string }; result: { ok: true } };
  'os.revealInFinder': { args: { path: string }; result: { ok: true } };
  'os.openURL': { args: { url: string }; result: { ok: true } };
  'os.openInXcode': { args: { path: string }; result: { ok: true } };

  // ProjectDocumentService.swift
  'project.save': { args: { project: Record<string, unknown>; path?: string | null }; result: { path: string } };
  'project.load': { args: { path: string }; result: { project: Record<string, unknown>; path: string } };
  'project.listSavedProjects': { args: Record<string, never>; result: { files: { path: string; name: string; modified: number }[] } };

  // CheckpointStore.swift
  'checkpoints.save': { args: { project: Record<string, unknown>; label: string }; result: ProjectCheckpointInfo | null };
  'checkpoints.list': { args: { projectName: string }; result: ProjectCheckpointInfo[] };
  'checkpoints.load': { args: { url: string }; result: { project: Record<string, unknown> } };

  // ComponentLibrary.swift (disk half)
  'components.save': { args: { node: Record<string, unknown>; name: string; category?: string }; result: SavedComponentJSON };
  'components.all': { args: Record<string, never>; result: SavedComponentJSON[] };
  'components.delete': { args: { id: string }; result: { deleted: boolean } };

  // GitSyncService.swift
  'git.isGitAvailable': { args: Record<string, never>; result: { available: boolean } };
  'git.isEnabled': { args: { projectName: string }; result: { enabled: boolean } };
  'git.repoDirectory': { args: { projectName: string }; result: { path: string } };
  'git.enable': { args: { project: Record<string, unknown> }; result: { repo: string } };
  'git.disable': { args: { projectName: string }; result: { ok: true } };
  'git.recordCheckpoint': { args: { project: Record<string, unknown>; label: string }; result: { queued: boolean } };
  'git.syncExport': { args: { projectName: string; kind: string; from: string }; result: { note: string | null } };
  'git.commitNow': { args: { project: Record<string, unknown>; message?: string | null }; result: { message: string } };
  'git.status': { args: { projectName: string }; result: { text: string } };
  'git.remoteURL': { args: { projectName: string }; result: { url: string | null } };
  'git.push': { args: { project: Record<string, unknown>; repoName?: string | null; isPrivate: boolean }; result: { message: string } };

  // ExportWriter.ts
  'export.write': { args: { rootDir: string; files: ExportFiles; clean?: boolean }; result: { rootDir: string; written: number; paths: string[] } };
  'export.temporaryDirectory': { args: { name: string; clean?: boolean }; result: { path: string } };

  // SimulatorRunner.swift / SimulatorControl.swift
  'simulator.buildAndLaunch': { args: { exportRoot: string; appName: string; target?: 'iPhone' | 'iPad' }; result: LaunchResult };
  'simulator.buildAndLaunchWatch': { args: { projectRoot: string; appName: string }; result: LaunchResult };
  'simulator.buildAndLaunchXcodeProject': { args: { projectRoot: string; appName: string; bundleId: string }; result: XcodeProjectLaunchResult };
  'simulator.archiveIPA': { args: { projectRoot: string; appName: string; teamId?: string | null; method: string }; result: ArchiveResult };
  'simulator.setAppearance': { args: { mode: string }; result: { device: string } };
  'simulator.runInSimulator': { args: { appName: string; files: ExportFiles; target?: 'iPhone' | 'iPad' }; result: LaunchResult & { exportRoot: string } };
  'simulator.screenshot': { args: Record<string, never>; result: { base64: string; mimeType: 'image/png' } };
  'simulator.tap': { args: { x: number; y: number }; result: { ok: true } };
  'simulator.type': { args: { text: string }; result: { ok: true } };

  // GeneratedSourcePreview.typecheck (AppBuildOrchestrator.ts)
  'typecheck.run': { args: { files: ExportFiles }; result: TypecheckResult };

  // FirebaseProvisioner.swift
  'firebase.cliPath': { args: Record<string, never>; result: { path: string | null } };
  'firebase.loginProblem': { args: Record<string, never>; result: { problem: string | null } };
  'firebase.provision': { args: { projectId: string; displayName: string; bundleId: string }; result: ProvisionResult };
  'firebase.deployRules': { args: { exportDir: string; projectId: string }; result: { output: string } };

  // ChatGPTSubscriptionService.swift (codex CLI)
  'codex.state': { args: Record<string, never>; result: ChatGPTState };
  'codex.refreshStatus': { args: Record<string, never>; result: ChatGPTState };
  'codex.signIn': { args: Record<string, never>; result: ChatGPTState };
  'codex.ensureMCPServerRegistered': { args: { port: number }; result: { registered: boolean } };
  'codex.run': { args: { goal: string; workingDirectory: string }; result: ChatGPTState };
  'codex.cancel': { args: Record<string, never>; result: ChatGPTState };

  // LocalBridges.ts (mflux / Helsinki workers)
  'bridges.isPortOpen': { args: { port: number }; result: { open: boolean } };
  'bridges.ensureImageBridge': { args: Record<string, never>; result: { running: boolean } };
  'bridges.ensureHelsinkiWorker': { args: Record<string, never>; result: { running: boolean } };
  'bridges.helsinkiTranslate': { args: { text: string }; result: { translation: string } };
  'bridges.runGooglePDFTranslation': { args: { fileURL: string }; result: { outputDir: string; readablePDF: string } };

  // Generated assets (OpenRouterProvider.saveGeneratedImageData / SpriteGenerator.swift)
  'assets.saveGeneratedImage': { args: { base64: string; preferredExtension: string }; result: { path: string } };
  'sprites.library': { args: Record<string, never>; result: { paths: string[] } };
  'sprites.cutoutSubject': { args: { path: string }; result: { path: string } };
  'sprites.flipHorizontal': { args: { path: string }; result: { path: string } };
  'sprites.dominantPalette': { args: { paths: string[]; maxColors?: number }; result: { palette: string[] } };
  'sprites.styleDirective': { args: { paths: string[] }; result: { directive: string | null } };

  // Provider proxy (also exposed as HTTP POST /proxy for streaming)
  'proxy.fetch': { args: { url: string; method?: string; headers?: Record<string, string>; body?: string | Record<string, unknown> | null }; result: { status: number; headers: Record<string, string>; body: string } };
}

export type ServerRequestName = keyof ServerRequests;
export const ServerRequestNames = [
  'editor.register', 'bridge.ping', 'learning.ask', 'learning.configure',
  'mcp.status', 'mcp.setEnabled', 'mcp.setPort', 'mcp.callLog',
  'settings.all', 'settings.get', 'settings.set',
  'fs.readFile', 'fs.writeFile', 'fs.exists', 'fs.readDir', 'fs.mkdir', 'fs.remove', 'fs.stat', 'fs.paths',
  'process.run',
  'os.open', 'os.revealInFinder', 'os.openURL', 'os.openInXcode',
  'project.save', 'project.load', 'project.listSavedProjects',
  'checkpoints.save', 'checkpoints.list', 'checkpoints.load',
  'components.save', 'components.all', 'components.delete',
  'git.isGitAvailable', 'git.isEnabled', 'git.repoDirectory', 'git.enable', 'git.disable', 'git.recordCheckpoint',
  'git.syncExport', 'git.commitNow', 'git.status', 'git.remoteURL', 'git.push',
  'export.write', 'export.temporaryDirectory',
  'simulator.buildAndLaunch', 'simulator.buildAndLaunchWatch', 'simulator.buildAndLaunchXcodeProject',
  'android.setupStatus', 'android.setupInstall', 'android.buildAndLaunch',
  'simulator.archiveIPA', 'simulator.setAppearance', 'simulator.runInSimulator',
  'simulator.screenshot', 'simulator.tap', 'simulator.type',
  'typecheck.run',
  'firebase.cliPath', 'firebase.loginProblem', 'firebase.provision', 'firebase.deployRules',
  'codex.state', 'codex.refreshStatus', 'codex.signIn', 'codex.ensureMCPServerRegistered', 'codex.run', 'codex.cancel',
  'bridges.isPortOpen', 'bridges.ensureImageBridge', 'bridges.ensureHelsinkiWorker', 'bridges.helsinkiTranslate',
  'bridges.runGooglePDFTranslation',
  'assets.saveGeneratedImage',
  'sprites.library', 'sprites.cutoutSubject', 'sprites.flipHorizontal', 'sprites.dominantPalette', 'sprites.styleDirective',
  'proxy.fetch',
] as const satisfies readonly ServerRequestName[];

// MARK: - Request catalogue: server → editor

export interface EditorRequests {
  /// Execute one MCP tool against the live editor state; returns MCPToolResult.
  'mcp.callTool': { args: { name: string; arguments: Record<string, unknown> }; result: BridgeToolResult };
  'editor.ping': { args: Record<string, never>; result: { pong: true } };
}
export type EditorRequestName = keyof EditorRequests;
export const EditorRequestNames = ['mcp.callTool', 'editor.ping'] as const satisfies readonly EditorRequestName[];

// MARK: - Events: server → editor (push)

export interface BridgeEvents {
  'android.progress': { runId: string; message: string };
  /// One MCPCallLogEntry as it is appended (the "🔌 MCP: …" console line).
  'mcp.log': MCPCallLogEntry;
  /// MCP server started / stopped / failed / port changed.
  'mcp.status': MCPStatus;
  /// The editor connected or disconnected (sent to every other client).
  'bridge.editor': { connected: boolean; toolCount: number };
  /// Codex transcript line (ChatGPTSubscriptionService.transcript.append).
  'codex.transcript': { line: string };
  'codex.status': ChatGPTState;
  /// SimulatorRunner progress("…") messages.
  'simulator.progress': { message: string };
  /// PDFEditorViewModel external translation progress strings.
  'pdf.translationProgress': { progress: string; statusMessage: string; done: boolean; failed: boolean };
}
export type BridgeEventName = keyof BridgeEvents;
export const BridgeEventNames = [
  'android.progress', 'mcp.log', 'mcp.status', 'bridge.editor', 'codex.transcript', 'codex.status', 'simulator.progress', 'pdf.translationProgress',
] as const satisfies readonly BridgeEventName[];
