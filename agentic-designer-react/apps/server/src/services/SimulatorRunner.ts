// Ported 1:1 from AgenticDesigner/Services/SimulatorRunner.swift
//
// Builds an exported SwiftUI package into a real .app bundle and launches it
// in the iOS Simulator: the generated sources are compiled directly with
// swiftc into an app bundle, then installed and launched with simctl.
// Requires full Xcode (not just Command Line Tools).
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { ensureDirectory, fileExists, temporaryDirectory } from '../platform/Paths.js';
import { ProcessLaunchError, runProcess } from '../platform/ProcessRunner.js';

export type SimulatorRunErrorCase =
  | { kind: 'xcodeNotFound' }
  | { kind: 'noSimulatorDevice' }
  | { kind: 'commandFailed'; command: string; output: string; logPath: string | null };

export class SimulatorRunError extends Error {
  readonly errorCase: SimulatorRunErrorCase;
  constructor(errorCase: SimulatorRunErrorCase) {
    super(SimulatorRunError.errorDescription(errorCase));
    this.name = 'SimulatorRunError';
    this.errorCase = errorCase;
  }
  static xcodeNotFound(): SimulatorRunError {
    return new SimulatorRunError({ kind: 'xcodeNotFound' });
  }
  static noSimulatorDevice(): SimulatorRunError {
    return new SimulatorRunError({ kind: 'noSimulatorDevice' });
  }
  static commandFailed(command: string, output: string, logPath: string | null): SimulatorRunError {
    return new SimulatorRunError({ kind: 'commandFailed', command, output, logPath });
  }
  static errorDescription(errorCase: SimulatorRunErrorCase): string {
    switch (errorCase.kind) {
      case 'xcodeNotFound':
        return 'Xcode not found. Install the full Xcode app to run in the simulator.';
      case 'noSimulatorDevice':
        return 'No iPhone simulator available. Install an iOS runtime in Xcode ▸ Settings ▸ Platforms.';
      case 'commandFailed': {
        const logLine = errorCase.logPath ? `\nFull log: ${errorCase.logPath}` : '';
        return `${errorCase.command} failed:\n${errorCase.output}${logLine}`;
      }
    }
  }
}

export type Target = 'iPhone' | 'iPad';

export interface LaunchResult {
  deviceName: string;
  bundleIdentifier: string;
}

export interface XcodeProjectLaunchResult {
  deviceName: string;
  deviceUDID: string;
  bundleIdentifier: string;
  /// Still running a few seconds after launch — "simctl launch exited 0"
  /// alone also passes for an app that trapped in FirebaseApp.configure().
  aliveAfterLaunch: boolean;
}

export interface ArchiveResult {
  archivePath: string;
  ipaPath: string | null;
}

type Progress = (message: string) => void;
interface Device { udid: string; name: string; booted: boolean }

export const SimulatorRunner = {
  async buildAndLaunch(exportRoot: string, appName: string, target: Target = 'iPhone', progress: Progress = () => {}): Promise<LaunchResult> {
    const developerDir = await findDeveloperDir();

    progress(`Compiling ${appName}…`);
    const appBundle = await compileAppBundle(exportRoot, appName, developerDir);

    progress('Starting simulator…');
    const device = await pickDevice(target, developerDir);
    if (!device.booted) {
      await run('/usr/bin/xcrun', ['simctl', 'boot', device.udid], developerDir).catch(() => '');
    }
    await run('/usr/bin/open', ['-a', 'Simulator']).catch(() => '');
    await run('/usr/bin/xcrun', ['simctl', 'bootstatus', device.udid, '-b'], developerDir);

    progress(`Installing on ${device.name}…`);
    const bundleId = `com.agenticdesigner.generated.${appName}`;
    await run('/usr/bin/xcrun', ['simctl', 'install', device.udid, appBundle], developerDir);
    await run('/usr/bin/xcrun', ['simctl', 'launch', '--terminate-running-process', device.udid, bundleId], developerDir);

    return { deviceName: device.name, bundleIdentifier: bundleId };
  },

  /// Builds the embedded watchOS target from the exported Xcode project,
  /// boots a real Apple Watch Simulator, installs the watch bundle, and launches it.
  async buildAndLaunchWatch(projectRoot: string, appName: string, progress: Progress = () => {}): Promise<LaunchResult> {
    const developerDir = await findDeveloperDir();
    const project = path.join(projectRoot, `${appName}.xcodeproj`);
    const buildRoot = path.join(projectRoot, 'WatchSimulatorBuild');

    progress(`Compiling ${appName} Watch App…`);
    await run('/usr/bin/xcodebuild', [
      '-project', project,
      '-target', `${appName}Watch`,
      '-sdk', 'watchsimulator',
      '-configuration', 'Debug',
      `SYMROOT=${buildRoot}`,
      'CODE_SIGNING_ALLOWED=NO',
      'build',
    ], developerDir);

    const watchApp = path.join(buildRoot, 'Debug-watchsimulator', `${appName}Watch.app`);
    if (!fileExists(watchApp)) {
      throw SimulatorRunError.commandFailed('xcodebuild', `Watch app bundle was not produced at ${watchApp}`, null);
    }

    progress('Starting Apple Watch Simulator…');
    const device = await pickWatchDevice(developerDir);
    if (!device.booted) {
      await run('/usr/bin/xcrun', ['simctl', 'boot', device.udid], developerDir).catch(() => '');
    }
    await run('/usr/bin/open', ['-a', 'Simulator']).catch(() => '');
    await run('/usr/bin/xcrun', ['simctl', 'bootstatus', device.udid, '-b'], developerDir);

    progress(`Installing on ${device.name}…`);
    await run('/usr/bin/xcrun', ['simctl', 'install', device.udid, watchApp], developerDir);
    const bundleId = await watchBundleIdentifier(watchApp);
    await run('/usr/bin/xcrun', ['simctl', 'launch', '--terminate-running-process', device.udid, bundleId], developerDir);
    return { deviceName: device.name, bundleIdentifier: bundleId };
  },

  /// Builds the EXPORTED .xcodeproj with xcodebuild (which resolves the
  /// firebase-ios-sdk package), installs it on a simulator, launches it, and
  /// verifies the process survives.
  async buildAndLaunchXcodeProject(projectRoot: string, appName: string, bundleId: string, progress: Progress = () => {}): Promise<XcodeProjectLaunchResult> {
    const developerDir = await findDeveloperDir();
    const project = path.join(projectRoot, `${appName}.xcodeproj`);
    if (!fileExists(project)) {
      throw SimulatorRunError.commandFailed('xcodebuild', `No ${appName}.xcodeproj at ${projectRoot} — export_xcode_project first.`, null);
    }
    const buildRoot = path.join(projectRoot, 'SimulatorBuild');

    progress(`Building ${appName}.xcodeproj (resolves Firebase — first build takes minutes)…`);
    await run('/usr/bin/xcodebuild', [
      '-project', project,
      '-scheme', appName,
      '-sdk', 'iphonesimulator',
      '-configuration', 'Debug',
      '-destination', 'generic/platform=iOS Simulator',
      `SYMROOT=${buildRoot}`,
      'CODE_SIGNING_ALLOWED=NO',
      'build',
    ], developerDir);

    const appBundle = path.join(buildRoot, 'Debug-iphonesimulator', `${appName}.app`);
    if (!fileExists(appBundle)) {
      throw SimulatorRunError.commandFailed('xcodebuild', `Build succeeded but no app bundle at ${appBundle}.`, null);
    }

    progress('Starting simulator…');
    const device = await pickDevice('iPhone', developerDir);
    if (!device.booted) {
      await run('/usr/bin/xcrun', ['simctl', 'boot', device.udid], developerDir).catch(() => '');
    }
    await run('/usr/bin/open', ['-a', 'Simulator']).catch(() => '');
    await run('/usr/bin/xcrun', ['simctl', 'bootstatus', device.udid, '-b'], developerDir);

    progress(`Installing on ${device.name}…`);
    await run('/usr/bin/xcrun', ['simctl', 'install', device.udid, appBundle], developerDir);
    await run('/usr/bin/xcrun', ['simctl', 'launch', '--terminate-running-process', device.udid, bundleId], developerDir);

    // The truth check: give the app a moment to reach (or crash in) its
    // first frame, then ask launchd whether it is STILL running.
    await sleep(4000);
    const processes = await run('/usr/bin/xcrun', ['simctl', 'spawn', device.udid, 'launchctl', 'list'], developerDir).catch(() => '');
    const alive = processes.includes(bundleId);

    return { deviceName: device.name, deviceUDID: device.udid, bundleIdentifier: bundleId, aliveAfterLaunch: alive };
  },

  /// `xcodebuild archive` + `-exportArchive` — the TestFlight/App Store leg.
  async archiveIPA(projectRoot: string, appName: string, teamId: string | null | undefined, method: string, progress: Progress = () => {}): Promise<ArchiveResult> {
    const developerDir = await findDeveloperDir();
    const project = path.join(projectRoot, `${appName}.xcodeproj`);
    const archive = path.join(projectRoot, `${appName}.xcarchive`);
    const exportDir = path.join(projectRoot, 'IPA');

    progress(`Archiving ${appName}…`);
    const args = [
      '-project', project,
      '-scheme', appName,
      '-destination', 'generic/platform=iOS',
      '-archivePath', archive,
      'archive',
    ];
    if (teamId && teamId.length > 0) {
      args.push(`DEVELOPMENT_TEAM=${teamId}`);
      args.push('-allowProvisioningUpdates');
    }
    await run('/usr/bin/xcodebuild', args, developerDir);

    progress(`Exporting IPA (${method})…`);
    const options = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
      '<plist version="1.0">',
      '<dict>',
      '\t<key>method</key>',
      `\t<string>${method}</string>`,
      teamId ? `\t<key>teamID</key>\n\t<string>${teamId}</string>` : '',
      '</dict>',
      '</plist>',
    ].join('\n');
    const optionsURL = path.join(projectRoot, 'ExportOptions.plist');
    fs.writeFileSync(optionsURL, options, 'utf8');
    try {
      await run('/usr/bin/xcodebuild', [
        '-exportArchive',
        '-archivePath', archive,
        '-exportPath', exportDir,
        '-exportOptionsPlist', optionsURL,
        '-allowProvisioningUpdates',
      ], developerDir);
    } catch {
      // The archive itself is still a deliverable — Xcode's Organizer
      // can upload it even when headless export needs more setup.
      return { archivePath: archive, ipaPath: null };
    }
    let ipa: string | null = null;
    try {
      const entry = fs.readdirSync(exportDir).find((name) => name.endsWith('.ipa'));
      ipa = entry ? path.join(exportDir, entry) : null;
    } catch {
      ipa = null;
    }
    return { archivePath: archive, ipaPath: ipa };
  },

  /// `simctl ui <udid> appearance dark|light` — lets the agent screenshot
  /// both appearances without a human touching the simulator.
  async setAppearance(mode: string): Promise<string> {
    const developerDir = await findDeveloperDir();
    const json = await run('/usr/bin/xcrun', ['simctl', 'list', 'devices', 'booted', '--json'], developerDir);
    const parsed = parseDevices(json);
    const booted = parsed ? Object.values(parsed).flat().find((device) => device.state === 'Booted') : undefined;
    if (!booted || typeof booted.udid !== 'string') {
      throw SimulatorRunError.noSimulatorDevice();
    }
    await run('/usr/bin/xcrun', ['simctl', 'ui', booted.udid, 'appearance', mode], developerDir);
    return typeof booted.name === 'string' ? booted.name : booted.udid;
  },

  findDeveloperDir,
  summarizedFailureOutput,
  infoPlist,
};

// MARK: - Build

async function compileAppBundle(exportRoot: string, appName: string, developerDir: string): Promise<string> {
  const sourcesDir = path.join(exportRoot, 'Sources');
  const buildDir = path.join(exportRoot, 'SimulatorBuild');
  const appBundle = path.join(buildDir, `${appName}.app`);

  if (fileExists(buildDir)) {
    fs.rmSync(buildDir, { recursive: true, force: true });
  }
  ensureDirectory(appBundle);

  const sourceFiles = enumerateSwiftFiles(sourcesDir);
  if (sourceFiles.length === 0) {
    throw SimulatorRunError.commandFailed('export', `No generated Swift sources found at ${sourcesDir}`, null);
  }

  const arch = process.arch === 'arm64' ? 'arm64' : 'x86_64';

  await run(
    '/usr/bin/xcrun',
    ['-sdk', 'iphonesimulator', 'swiftc',
      '-target', `${arch}-apple-ios17.0-simulator`,
      '-parse-as-library',
      ...sourceFiles.sort(),
      '-o', path.join(appBundle, appName)],
    developerDir,
  );

  const exportedPlist = await readPlist(path.join(exportRoot, 'Info.plist'));
  const usageDescriptions: Record<string, string> = {};
  if (exportedPlist) {
    for (const [key, value] of Object.entries(exportedPlist)) {
      if (typeof value === 'string') usageDescriptions[key] = value;
    }
  }
  // Array-valued keys (the orientation) have to be read separately — without
  // it a landscape game runs portrait-locked in the simulator.
  const rawOrientations = exportedPlist?.['UISupportedInterfaceOrientations'];
  const orientations = Array.isArray(rawOrientations) ? rawOrientations.filter((item): item is string => typeof item === 'string') : [];
  fs.writeFileSync(path.join(appBundle, 'Info.plist'), infoPlist(appName, usageDescriptions, orientations), 'utf8');

  const resourcesDir = path.join(sourcesDir, appName, 'Resources');
  if (fileExists(resourcesDir)) {
    for (const item of fs.readdirSync(resourcesDir)) {
      fs.cpSync(path.join(resourcesDir, item), path.join(appBundle, item), { recursive: true });
    }
  }

  return appBundle;
}

export function enumerateSwiftFiles(directory: string): string[] {
  const results: string[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.swift')) results.push(full);
    }
  };
  walk(directory);
  return results;
}

function infoPlist(appName: string, usageDescriptions: Record<string, string>, orientations: string[] = []): string {
  const usageEntries = Object.keys(usageDescriptions).sort()
    .map((key) => `    <key>${key}</key>\n    <string>${usageDescriptions[key]}</string>`)
    .join('\n');
  const orientationEntry = orientations.length === 0 ? '' :
    '    <key>UISupportedInterfaceOrientations</key>\n    <array>\n'
    + orientations.map((value) => `        <string>${value}</string>`).join('\n')
    + '\n    </array>';
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>${appName}</string>
    <key>CFBundleIdentifier</key>
    <string>com.agenticdesigner.generated.${appName}</string>
    <key>CFBundleName</key>
    <string>${appName}</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0</string>
    <key>CFBundleVersion</key>
    <string>1</string>
    <key>CFBundleSupportedPlatforms</key>
    <array><string>iPhoneSimulator</string></array>
    <key>MinimumOSVersion</key>
    <string>17.0</string>
    <key>UIDeviceFamily</key>
    <array><integer>1</integer><integer>2</integer></array>
${usageEntries}
${orientationEntry}
    <key>UILaunchScreen</key>
    <dict/>
</dict>
</plist>`;
}

// MARK: - Simulator selection

type RawDevice = { name?: unknown; udid?: unknown; state?: unknown };

function parseDevices(json: string): Record<string, RawDevice[]> | null {
  try {
    const root = JSON.parse(json);
    const devices = root?.devices;
    if (!devices || typeof devices !== 'object') return null;
    return devices as Record<string, RawDevice[]>;
  } catch {
    return null;
  }
}

async function pickDevice(target: Target, developerDir: string): Promise<Device> {
  const json = await run('/usr/bin/xcrun', ['simctl', 'list', 'devices', 'available', '--json'], developerDir);
  const runtimes = parseDevices(json);
  if (!runtimes) throw SimulatorRunError.noSimulatorDevice();

  const candidates: Device[] = [];
  const devicePrefix = target === 'iPad' ? 'iPad' : 'iPhone';
  // Newest iOS runtime first so a fresh install lands on a modern device.
  for (const runtime of Object.keys(runtimes).sort().reverse()) {
    if (!runtime.includes('SimRuntime.iOS')) continue;
    for (const device of runtimes[runtime] ?? []) {
      if (typeof device.name !== 'string' || !device.name.startsWith(devicePrefix) || typeof device.udid !== 'string') continue;
      candidates.push({ udid: device.udid, name: device.name, booted: device.state === 'Booted' });
    }
  }

  const booted = candidates.find((device) => device.booted);
  if (booted) return booted;
  const first = candidates[0];
  if (!first) throw SimulatorRunError.noSimulatorDevice();
  return first;
}

async function pickWatchDevice(developerDir: string): Promise<Device> {
  const json = await run('/usr/bin/xcrun', ['simctl', 'list', 'devices', 'available', '--json'], developerDir);
  const runtimes = parseDevices(json);
  if (!runtimes) throw SimulatorRunError.noSimulatorDevice();

  const candidates: Device[] = [];
  for (const runtime of Object.keys(runtimes).sort().reverse()) {
    if (!runtime.includes('SimRuntime.watchOS')) continue;
    for (const device of runtimes[runtime] ?? []) {
      if (typeof device.name !== 'string' || !device.name.includes('Apple Watch') || typeof device.udid !== 'string') continue;
      candidates.push({ udid: device.udid, name: device.name, booted: device.state === 'Booted' });
    }
  }
  const booted = candidates.find((device) => device.booted);
  if (booted) return booted;
  const first = candidates[0];
  if (!first) throw SimulatorRunError.noSimulatorDevice();
  return first;
}

async function watchBundleIdentifier(app: string): Promise<string> {
  const plist = await readPlist(path.join(app, 'Info.plist'));
  const identifier = plist?.['CFBundleIdentifier'];
  if (typeof identifier !== 'string') {
    throw SimulatorRunError.commandFailed('Info.plist', 'Watch bundle identifier is missing', null);
  }
  return identifier;
}

/// NSDictionary(contentsOfFile:) — XML or binary plist via plutil.
export async function readPlist(filePath: string): Promise<Record<string, unknown> | null> {
  if (!fileExists(filePath)) return null;
  try {
    const result = await runProcess('/usr/bin/plutil', ['-convert', 'json', '-o', '-', filePath]);
    if (result.status !== 0) return null;
    const parsed = JSON.parse(result.output);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// MARK: - Process helpers

async function findDeveloperDir(): Promise<string> {
  const simulatorPlatform = '/Platforms/iPhoneSimulator.platform';
  const selected = await run('/usr/bin/xcode-select', ['-p']).catch(() => null);
  if (selected !== null) {
    const selectedPath = selected.trim();
    if (fileExists(selectedPath + simulatorPlatform)) {
      return selectedPath;
    }
  }
  const fallback = '/Applications/Xcode.app/Contents/Developer';
  if (fileExists(fallback + simulatorPlatform)) {
    return fallback;
  }
  throw SimulatorRunError.xcodeNotFound();
}

async function run(executable: string, args: string[], developerDir?: string): Promise<string> {
  const env = developerDir ? { ...process.env, DEVELOPER_DIR: developerDir } : undefined;
  let result;
  try {
    result = await runProcess(executable, args, { env });
  } catch (error) {
    if (error instanceof ProcessLaunchError) {
      const command = [path.basename(executable), ...args.slice(0, 2)].join(' ');
      throw SimulatorRunError.commandFailed(command, error.message, null);
    }
    throw error;
  }
  if (result.status !== 0) {
    const command = [path.basename(executable), ...args.slice(0, 2)].join(' ');
    const fullCommand = [executable, ...args].join(' ');
    const fullOutput = `Command failed (${result.status}):\n${fullCommand}\n\n${result.output}`;
    console.log(`📱 AgenticDesigner simulator run failed:\n${fullOutput}`);
    const logPath = writeFailureLog(fullOutput);
    throw SimulatorRunError.commandFailed(command, summarizedFailureOutput(result.output), logPath);
  }
  return result.output;
}

function summarizedFailureOutput(output: string): string {
  const lines = output.split('\n');
  const errorWindow = lines.findIndex((line) => line.toLowerCase().includes('error:'));
  let selected: string[];
  if (errorWindow >= 0) {
    const start = Math.max(0, errorWindow - 6);
    const end = Math.min(lines.length, errorWindow + 18);
    selected = lines.slice(start, end);
  } else {
    selected = lines.slice(Math.max(0, lines.length - 40));
  }
  return selected.join('\n');
}

function writeFailureLog(output: string): string | null {
  try {
    const directory = path.join(temporaryDirectory(), 'AgenticDesignerSimulatorRun');
    ensureDirectory(directory);
    const url = path.join(directory, 'last-run-error.log');
    fs.writeFileSync(url, output, 'utf8');
    return url;
  } catch (error) {
    console.log(`📱 AgenticDesigner could not write simulator failure log: ${(error as Error).message}`);
    return null;
  }
}
