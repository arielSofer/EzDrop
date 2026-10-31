// Ported 1:1 from AgenticDesigner/Services/SimulatorControl.swift
//
// Drives the REAL iOS Simulator (not the in-app preview): screenshots it via
// `simctl`, and taps / types into it by mapping normalized device coordinates
// to the Simulator window on screen and posting synthetic CGEvents. The
// CoreGraphics / Accessibility calls run through resources/SimulatorControl.jxa.js
// (osascript's ObjC bridge) because Node has no CGEvent API. Tapping and typing
// require Accessibility permission for the process hosting the server.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileExists, temporaryDirectory, uuidString } from '../platform/Paths.js';
import { ProcessLaunchError, runProcess } from '../platform/ProcessRunner.js';

export class ControlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ControlError';
  }
}

const jxaScriptPath = fileURLToPath(new URL('../../resources/SimulatorControl.jxa.js', import.meta.url));

export const SimulatorControl = {
  // MARK: - Device discovery

  async developerDir(): Promise<string> {
    const out = await run('/usr/bin/xcode-select', ['-p']).catch(() => null);
    if (out !== null) {
      const p = out.trim();
      if (fileExists(p + '/Platforms/iPhoneSimulator.platform')) return p;
    }
    const fallback = '/Applications/Xcode.app/Contents/Developer';
    if (fileExists(fallback + '/Platforms/iPhoneSimulator.platform')) return fallback;
    throw new ControlError('Xcode not found. Install the full Xcode app to control the simulator.');
  },

  async bootedUDID(): Promise<string> {
    const dev = await SimulatorControl.developerDir();
    const json = await run('/usr/bin/xcrun', ['simctl', 'list', 'devices', 'booted', '--json'], dev);
    let devices: Record<string, { state?: unknown; udid?: unknown }[]>;
    try {
      const root = JSON.parse(json);
      if (!root?.devices || typeof root.devices !== 'object') throw new Error();
      devices = root.devices;
    } catch {
      throw new ControlError('Could not query booted simulators.');
    }
    for (const list of Object.values(devices)) {
      for (const device of list) {
        if (device.state === 'Booted' && typeof device.udid === 'string') return device.udid;
      }
    }
    throw new ControlError('No booted simulator. Launch the app first with run_in_simulator.');
  },

  // MARK: - Screenshot

  /// PNG data of the currently booted simulator's screen.
  async screenshotPNG(): Promise<Buffer> {
    const dev = await SimulatorControl.developerDir();
    const udid = await SimulatorControl.bootedUDID();
    const tmp = path.join(temporaryDirectory(), `emberSimShot-${uuidString()}.png`);
    await run('/usr/bin/xcrun', ['simctl', 'io', udid, 'screenshot', tmp], dev);
    try {
      return fs.readFileSync(tmp);
    } finally {
      try { fs.rmSync(tmp); } catch { /* ignore */ }
    }
  },

  // MARK: - Tap

  /// Tap at a normalized position (0…1 of the device screen, top-left origin).
  async tap(normX: number, normY: number): Promise<void> {
    const png = await SimulatorControl.screenshotPNG();
    const size = pngDimensions(png);
    if (!size || size.height <= 0) {
      throw new ControlError('Could not read the screenshot for sizing.');
    }
    const aspect = size.width / size.height;
    await runJXA(['tap', String(aspect), String(normX), String(normY)]);
  },

  // MARK: - Type

  /// Type text into the simulator's currently focused field.
  async typeText(text: string): Promise<void> {
    await SimulatorControl.bootedUDID();
    await runJXA(['type', text]);
  },

  /// Accessibility check on its own (shows the system prompt on first call).
  async requireAccessibility(): Promise<void> {
    await runJXA(['accessibility']);
  },
};

/// IHDR width/height of a PNG (NSBitmapImageRep pixelsWide / pixelsHigh).
export function pngDimensions(data: Buffer): { width: number; height: number } | null {
  if (data.length < 24) return null;
  const signature = data.subarray(0, 8).toString('hex');
  if (signature !== '89504e470d0a1a0a') return null;
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

async function runJXA(args: string[]): Promise<Record<string, unknown>> {
  const output = await run('/usr/bin/osascript', ['-l', 'JavaScript', jxaScriptPath, ...args]);
  const line = output.trim().split('\n').pop() ?? '';
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new ControlError(`osascript failed: ${output}`);
  }
  if (typeof parsed.error === 'string') throw new ControlError(parsed.error);
  return parsed;
}

// MARK: - Process helper

async function run(executable: string, args: string[], developerDir?: string): Promise<string> {
  const env = developerDir ? { ...process.env, DEVELOPER_DIR: developerDir } : undefined;
  let result;
  try {
    result = await runProcess(executable, args, { env });
  } catch (error) {
    if (error instanceof ProcessLaunchError) throw new ControlError(`${path.basename(executable)} failed: ${error.message}`);
    throw error;
  }
  if (result.status !== 0) {
    throw new ControlError(`${path.basename(executable)} failed: ${result.output}`);
  }
  return result.output;
}
