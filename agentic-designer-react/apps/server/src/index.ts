// AgenticDesigner server entry point — the OS-bound half of the macOS app.
//
//   MCPServer (Streamable HTTP, 127.0.0.1:8765)  ←  external agents
//   BridgeServer (ws://127.0.0.1:8766, POST /proxy) ↔ the editor in the browser
//
// MCP tool calls are relayed to the editor (live state lives there); the
// bridge request handlers below expose the ported OS services (git, files,
// simulator, firebase CLI, codex CLI, local model workers) to the editor.
import fs from 'node:fs';
import path from 'node:path';
import { BridgeServer } from './bridge/BridgeServer.js';
import {
  BRIDGE_DEFAULT_PORT,
  BRIDGE_PORT_ENV,
  ServerRequestNames,
  type ServerRequests,
} from './bridge/protocol.js';
import { MCPServerController } from './mcp/MCPServerController.js';
import { ToolRelay } from './mcp/toolRelay.js';
import { agenticSupportDirectory, applicationSupportDirectory, expandingTildeInPath, homeDirectory, temporaryDirectory } from './platform/Paths.js';
import { runProcess } from './platform/ProcessRunner.js';
import { AppBuildOrchestrator } from './services/AppBuildOrchestrator.js';
import { ChatGPTSubscriptionService } from './services/ChatGPTSubscriptionService.js';
import { CheckpointStore } from './services/CheckpointStore.js';
import { ComponentLibrary } from './services/ComponentLibrary.js';
import { ExportWriter } from './services/ExportWriter.js';
import { FirebaseProvisioner } from './services/FirebaseProvisioner.js';
import { GitSyncService } from './services/GitSyncService.js';
import { LocalBridges } from './services/LocalBridges.js';
import { ProjectDocumentService } from './services/ProjectDocumentService.js';
import { Settings } from './services/Settings.js';
import { AndroidSetupService } from './services/AndroidSetupService.js';
import { AndroidRunner } from './services/AndroidRunner.js';
import { LearningTutorService } from './services/LearningTutorService.js';
import { SimulatorControl } from './services/SimulatorControl.js';
import { SimulatorRunner } from './services/SimulatorRunner.js';
import { SpriteGenerator } from './services/SpriteGenerator.js';

export const SERVER_WS_URL = `ws://127.0.0.1:${BRIDGE_DEFAULT_PORT}`;

type Args<K extends keyof ServerRequests> = ServerRequests[K]['args'];
type Result<K extends keyof ServerRequests> = ServerRequests[K]['result'];

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`'${name}' is required.`);
  return value;
}

function requireObject(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`'${name}' must be an object.`);
  return value as Record<string, unknown>;
}

export interface RunningServer {
  bridge: BridgeServer;
  controller: MCPServerController;
  relay: ToolRelay;
  codex: ChatGPTSubscriptionService;
  stop: () => Promise<void>;
}

export async function createServer(options: { bridgePort?: number; log?: (message: string) => void } = {}): Promise<RunningServer> {
  const log = options.log ?? ((message: string) => console.log(message));
  const bridgePort = options.bridgePort ?? (parseInt(process.env[BRIDGE_PORT_ENV] ?? "", 10) || BRIDGE_DEFAULT_PORT);

  const bridge = new BridgeServer({ port: bridgePort, log });
  const relay = new ToolRelay(bridge, log);
  const controller = new MCPServerController(relay, {
    log: (entry) => bridge.broadcast('mcp.log', entry),
    statusChanged: (status) => bridge.broadcast('mcp.status', status),
    editorConnected: () => bridge.editorConnected,
  });
  const codex = new ChatGPTSubscriptionService({
    transcriptLine: (line) => bridge.broadcast('codex.transcript', { line }),
    stateChanged: (state) => bridge.broadcast('codex.status', state),
  });
  const progress = (message: string) => bridge.broadcast('simulator.progress', { message });

  bridge.on('editorDisconnected', () => {
    log('🔌 MCP: editor disconnected — tool calls will fail with "Designer is not available." until it reconnects');
    bridge.broadcast('bridge.editor', { connected: false, toolCount: relay.toolCount });
    controller.publishStatus();
  });

  const on = <K extends keyof ServerRequests>(name: K, handler: (args: Args<K>, context: { socket: import('ws').WebSocket }) => Result<K> | Promise<Result<K>>) => {
    bridge.handle(name, handler as never);
  };

  const androidSetup = new AndroidSetupService();
  on('android.setupStatus', () => androidSetup.status());
  on('android.setupInstall', args => androidSetup.start(args.acceptLicenses));
  const android = new AndroidRunner();
  on('android.buildAndLaunch', args => android.run(args, message => bridge.broadcast('android.progress', { runId: args.runId, message })));
  const tutor = new LearningTutorService();
  on('learning.ask', args => tutor.ask(args));
  on('learning.configure', args => {
    const key = requireString(args.apiKey, 'apiKey').trim();
    if (key.length > 4096) throw new Error('Invalid key');
    // Migrate an existing local editor credential without overwriting server configuration.
    if (!process.env.OPENROUTER_API_KEY && !Settings.string('openRouterAPIKey')) Settings.set('openRouterAPIKey', key);
    return { configured: true };
  });

  // MARK: Registration / MCP lifecycle
  on('editor.register', (args, context) => {
    const report = relay.register(args.tools);
    bridge.setEditor(context.socket);
    bridge.broadcast('bridge.editor', { connected: true, toolCount: relay.toolCount }, context.socket);
    controller.publishStatus();
    return { ...report, mcp: controller.status() };
  });
  on('bridge.ping', () => ({ pong: true, time: Date.now() }));
  on('mcp.status', () => controller.status());
  on('mcp.setEnabled', (args) => {
    controller.setEnabled(args.enabled === true);
    return controller.status();
  });
  on('mcp.setPort', (args) => {
    controller.setPort(Number(args.port));
    return controller.status();
  });
  on('mcp.callLog', () => controller.callLog);

  // MARK: Settings
  on('settings.all', () => Settings.all());
  on('settings.get', (args) => ({ value: Settings.get(requireString(args.key, 'key')) }));
  on('settings.set', (args) => {
    Settings.set(requireString(args.key, 'key'), args.value as never);
    return { ok: true };
  });

  // MARK: Filesystem
  on('fs.readFile', (args) => {
    const file = expandingTildeInPath(requireString(args.path, 'path'));
    return { contents: fs.readFileSync(file).toString(args.encoding === 'base64' ? 'base64' : 'utf8') };
  });
  on('fs.writeFile', (args) => {
    const file = expandingTildeInPath(requireString(args.path, 'path'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, args.encoding === 'base64' ? Buffer.from(String(args.contents), 'base64') : String(args.contents));
    return { path: file };
  });
  on('fs.exists', (args) => {
    const file = expandingTildeInPath(requireString(args.path, 'path'));
    try {
      return { exists: true, isDirectory: fs.statSync(file).isDirectory() };
    } catch {
      return { exists: false, isDirectory: false };
    }
  });
  on('fs.readDir', (args) => {
    const dir = expandingTildeInPath(requireString(args.path, 'path'));
    const entries = fs.readdirSync(dir, { withFileTypes: true }).map((entry) => {
      const full = path.join(dir, entry.name);
      let size = 0;
      let modified = 0;
      try {
        const stat = fs.statSync(full);
        size = stat.size;
        modified = stat.mtimeMs;
      } catch { /* ignore */ }
      return { name: entry.name, path: full, isDirectory: entry.isDirectory(), modified, size };
    });
    return { entries };
  });
  on('fs.mkdir', (args) => {
    const dir = expandingTildeInPath(requireString(args.path, 'path'));
    fs.mkdirSync(dir, { recursive: true });
    return { path: dir };
  });
  on('fs.remove', (args) => {
    const target = expandingTildeInPath(requireString(args.path, 'path'));
    const existed = fs.existsSync(target);
    fs.rmSync(target, { recursive: true, force: true });
    return { removed: existed };
  });
  on('fs.stat', (args) => {
    const target = expandingTildeInPath(requireString(args.path, 'path'));
    try {
      const stat = fs.statSync(target);
      return { exists: true, isDirectory: stat.isDirectory(), size: stat.size, modified: stat.mtimeMs };
    } catch {
      return { exists: false, isDirectory: false, size: 0, modified: 0 };
    }
  });
  on('fs.paths', () => ({
    home: homeDirectory(),
    temporaryDirectory: temporaryDirectory(),
    applicationSupport: applicationSupportDirectory(),
    agenticSupport: agenticSupportDirectory(),
    savedProjects: agenticSupportDirectory('SavedProjects'),
    checkpoints: agenticSupportDirectory('Checkpoints'),
    components: agenticSupportDirectory('Components'),
    gitRepos: agenticSupportDirectory('GitRepos'),
    exports: agenticSupportDirectory('Exports'),
    generatedAssets: agenticSupportDirectory('GeneratedAssets'),
    studioAssets: agenticSupportDirectory('Assets', 'Studio'),
    translation: agenticSupportDirectory('Translation'),
  }));

  // MARK: Processes / open
  on('process.run', async (args) => {
    const executable = requireString(args.executable, 'executable');
    const result = await runProcess(executable, Array.isArray(args.args) ? args.args.map(String) : [], {
      cwd: args.cwd ? expandingTildeInPath(args.cwd) : undefined,
      env: args.env ? { ...process.env, ...args.env } : undefined,
      timeoutMs: args.timeoutMs,
    });
    return { status: result.status, output: result.output };
  });
  on('os.open', async (args) => { await ExportWriter.open(requireString(args.path, 'path')); return { ok: true }; });
  on('os.revealInFinder', async (args) => { await ExportWriter.revealInFinder(requireString(args.path, 'path')); return { ok: true }; });
  on('os.openURL', async (args) => { await ExportWriter.openURL(requireString(args.url, 'url')); return { ok: true }; });
  on('os.openInXcode', async (args) => { await ExportWriter.openInXcode(requireString(args.path, 'path')); return { ok: true }; });

  // MARK: Project documents
  on('project.save', (args) => ({ path: ProjectDocumentService.save(requireObject(args.project, 'project'), args.path ?? null) }));
  on('project.load', (args) => {
    const loaded = ProjectDocumentService.load(requireString(args.path, 'path'));
    return { project: loaded.project, path: loaded.url };
  });
  on('project.listSavedProjects', () => ({ files: ProjectDocumentService.listSavedProjects() }));

  // MARK: Checkpoints
  on('checkpoints.save', (args) => CheckpointStore.save(requireObject(args.project, 'project'), String(args.label ?? '')));
  on('checkpoints.list', (args) => CheckpointStore.list(String(args.projectName ?? '')));
  on('checkpoints.load', (args) => ({ project: CheckpointStore.load({ url: requireString(args.url, 'url') }) }));

  // MARK: Components
  on('components.save', (args) => ComponentLibrary.save(requireObject(args.node, 'node'), requireString(args.name, 'name'), args.category ?? 'General'));
  on('components.all', () => ComponentLibrary.all());
  on('components.delete', (args) => ({ deleted: ComponentLibrary.delete({ id: requireString(args.id, 'id') }) }));

  // MARK: Git
  on('git.isGitAvailable', () => ({ available: GitSyncService.isGitAvailable }));
  on('git.isEnabled', (args) => ({ enabled: GitSyncService.isEnabled(String(args.projectName ?? '')) }));
  on('git.repoDirectory', (args) => ({ path: GitSyncService.repoDirectory(String(args.projectName ?? '')) }));
  on('git.enable', async (args) => ({ repo: await GitSyncService.enable(requireObject(args.project, 'project')) }));
  on('git.disable', (args) => { GitSyncService.disable(String(args.projectName ?? '')); return { ok: true }; });
  on('git.recordCheckpoint', (args) => ({ queued: GitSyncService.recordCheckpoint(requireObject(args.project, 'project'), String(args.label ?? '')) }));
  on('git.syncExport', async (args) => ({ note: await GitSyncService.syncExport(String(args.projectName ?? ''), requireString(args.kind, 'kind'), requireString(args.from, 'from')) }));
  on('git.commitNow', async (args) => ({ message: await GitSyncService.commitNow(requireObject(args.project, 'project'), args.message ?? null) }));
  on('git.status', async (args) => ({ text: await GitSyncService.status(String(args.projectName ?? '')) }));
  on('git.remoteURL', async (args) => ({ url: await GitSyncService.remoteURL(String(args.projectName ?? '')) }));
  on('git.push', async (args) => ({ message: await GitSyncService.push(requireObject(args.project, 'project'), args.repoName ?? null, args.isPrivate !== false) }));

  // MARK: Export writing
  on('export.write', (args) => ExportWriter.write(requireString(args.rootDir, 'rootDir'), requireObject(args.files, 'files') as never, args.clean === true));
  on('export.temporaryDirectory', (args) => ({ path: ExportWriter.temporaryDirectory(requireString(args.name, 'name'), args.clean === true) }));

  // MARK: Simulator
  on('simulator.buildAndLaunch', (args) => SimulatorRunner.buildAndLaunch(requireString(args.exportRoot, 'exportRoot'), requireString(args.appName, 'appName'), args.target ?? 'iPhone', progress));
  on('simulator.buildAndLaunchWatch', (args) => SimulatorRunner.buildAndLaunchWatch(requireString(args.projectRoot, 'projectRoot'), requireString(args.appName, 'appName'), progress));
  on('simulator.buildAndLaunchXcodeProject', (args) => SimulatorRunner.buildAndLaunchXcodeProject(requireString(args.projectRoot, 'projectRoot'), requireString(args.appName, 'appName'), requireString(args.bundleId, 'bundleId'), progress));
  on('simulator.archiveIPA', (args) => SimulatorRunner.archiveIPA(requireString(args.projectRoot, 'projectRoot'), requireString(args.appName, 'appName'), args.teamId ?? null, args.method || 'app-store-connect', progress));
  on('simulator.setAppearance', async (args) => ({ device: await SimulatorRunner.setAppearance(requireString(args.mode, 'mode')) }));
  on('simulator.runInSimulator', async (args) => {
    // run_in_simulator: LogicExporter.exportSwiftUISource(to: temporaryDirectory/AgenticDesignerSimulatorRun) → <workDir>/<AppName>
    const appName = requireString(args.appName, 'appName');
    const workDir = ExportWriter.temporaryDirectory('AgenticDesignerSimulatorRun');
    const exportRoot = path.join(workDir, appName);
    ExportWriter.write(exportRoot, requireObject(args.files, 'files') as never, true);
    const result = await SimulatorRunner.buildAndLaunch(exportRoot, appName, args.target ?? 'iPhone', progress);
    return { ...result, exportRoot };
  });
  on('simulator.screenshot', async () => ({ base64: (await SimulatorControl.screenshotPNG()).toString('base64'), mimeType: 'image/png' }));
  on('simulator.tap', async (args) => { await SimulatorControl.tap(Number(args.x), Number(args.y)); return { ok: true }; });
  on('simulator.type', async (args) => { await SimulatorControl.typeText(requireString(args.text, 'text')); return { ok: true }; });

  // MARK: Typecheck
  on('typecheck.run', (args) => AppBuildOrchestrator.typecheck(requireObject(args.files, 'files') as never));

  // MARK: Firebase
  on('firebase.cliPath', () => ({ path: FirebaseProvisioner.cliPath() }));
  on('firebase.loginProblem', async () => ({ problem: await FirebaseProvisioner.loginProblem() }));
  on('firebase.provision', (args) => FirebaseProvisioner.provision(requireString(args.projectId, 'projectId'), requireString(args.displayName, 'displayName'), requireString(args.bundleId, 'bundleId')));
  on('firebase.deployRules', async (args) => ({ output: await FirebaseProvisioner.deployRules(expandingTildeInPath(requireString(args.exportDir, 'exportDir')), requireString(args.projectId, 'projectId')) }));

  // MARK: Codex (ChatGPT subscription)
  on('codex.state', () => codex.state());
  on('codex.refreshStatus', async () => { await codex.refreshStatus(); return codex.state(); });
  on('codex.signIn', async () => { await codex.signIn(); return codex.state(); });
  on('codex.ensureMCPServerRegistered', async (args) => ({ registered: await codex.ensureMCPServerRegistered(Number(args.port) || controller.port) }));
  on('codex.run', (args) => {
    // Streams: codex.transcript events; resolves immediately with the busy state.
    void codex.run(requireString(args.goal, 'goal'), expandingTildeInPath(requireString(args.workingDirectory, 'workingDirectory')));
    return codex.state();
  });
  on('codex.cancel', () => { codex.cancel(); return codex.state(); });

  // MARK: Local workers
  on('bridges.isPortOpen', async (args) => ({ open: await LocalBridges.isPortOpen(Number(args.port)) }));
  on('bridges.ensureImageBridge', async () => ({ running: await LocalBridges.ensureImageBridge() }));
  on('bridges.ensureHelsinkiWorker', async () => { await LocalBridges.ensureHelsinkiWorker(); return { running: true }; });
  on('bridges.helsinkiTranslate', async (args) => ({ translation: await LocalBridges.translateWithHelsinki(requireString(args.text, 'text')) }));
  on('bridges.runGooglePDFTranslation', (args) => LocalBridges.runGooglePDFTranslation(
    expandingTildeInPath(requireString(args.fileURL, 'fileURL')),
    (update) => bridge.broadcast('pdf.translationProgress', { ...update, done: update.progress.startsWith('Done:'), failed: update.progress.startsWith('Failed:') || update.progress.startsWith('Missing') }),
  ));

  // MARK: Generated assets / sprites
  on('assets.saveGeneratedImage', (args) => ({ path: SpriteGenerator.saveGeneratedImageData(Buffer.from(requireString(args.base64, 'base64'), 'base64'), String(args.preferredExtension ?? 'png')) }));
  on('sprites.library', () => ({ paths: SpriteGenerator.librarySprites() }));
  on('sprites.cutoutSubject', async (args) => ({ path: await SpriteGenerator.cutoutSubject(expandingTildeInPath(requireString(args.path, 'path'))) }));
  on('sprites.flipHorizontal', async (args) => ({ path: await SpriteGenerator.flipHorizontal(expandingTildeInPath(requireString(args.path, 'path'))) }));
  on('sprites.dominantPalette', async (args) => ({ palette: await SpriteGenerator.dominantPalette(Array.isArray(args.paths) ? args.paths.map(String) : [], args.maxColors ?? 5) }));
  on('sprites.styleDirective', async (args) => ({ directive: await SpriteGenerator.styleDirective(Array.isArray(args.paths) ? args.paths.map(String) : []) }));

  // MARK: Provider proxy (non-streaming twin of POST /proxy)
  on('proxy.fetch', async (args) => {
    const url = requireString(args.url, 'url');
    const method = (args.method ?? 'POST').toUpperCase();
    const body = args.body === undefined || args.body === null ? undefined : typeof args.body === 'string' ? args.body : JSON.stringify(args.body);
    const response = await fetch(url, { method, headers: args.headers ?? {}, body: method === 'GET' || method === 'HEAD' ? undefined : body });
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => { headers[key] = value; });
    return { status: response.status, headers, body: await response.text() };
  });

  // Every catalogued request must have a handler — fail loudly at startup otherwise.
  const registered = new Set(bridge.handlerNames());
  const unhandled = ServerRequestNames.filter((name) => !registered.has(name));
  if (unhandled.length > 0) {
    throw new Error(`Bridge requests without handlers: ${unhandled.join(', ')}`);
  }

  await bridge.start();
  controller.attach();
  if (!controller.isRunning && !controller.isEnabled && process.env.AGENTIC_MCP_PORT === undefined) {
    log(`🔌 MCP: off — enable it from the editor's MCP panel (mcp.setEnabled) or start with AGENTIC_MCP_PORT=${controller.port}`);
  }

  const stop = async () => {
    controller.stop();
    LocalBridges.shutdown();
    codex.cancel();
    await bridge.stop();
  };
  return { bridge, controller, relay, codex, stop };
}

export function describeServer(): string {
  return `AgenticDesigner server — MCP http://127.0.0.1:${process.env.AGENTIC_MCP_PORT ?? 8765}/mcp, bridge ${SERVER_WS_URL}`;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  createServer()
    .then((running) => {
      const shutdown = () => {
        void running.stop().finally(() => process.exit(0));
      };
      process.once('SIGINT', shutdown);
      process.once('SIGTERM', shutdown);
    })
    .catch((error: Error) => {
      console.error(`🌉 Bridge: could not start — ${error.message}`);
      process.exit(1);
    });
}
