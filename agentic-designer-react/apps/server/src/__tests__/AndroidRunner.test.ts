import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AndroidRunner, parseAndroidDiagnostics, validateAndroidRequest } from '../services/AndroidRunner';
import { setApplicationSupportDirectoryForTesting } from '../platform/Paths';
import type { AndroidRunRequest } from '../bridge/protocol';
import type { RunOptions } from '../platform/ProcessRunner';

const request: AndroidRunRequest = { projectId: 'test-project', runId: 'test-run',
  entryFile: 'app/src/main/java/com/example/Test.kt', entryFunction: 'Test',
  files: { 'app/src/main/java/com/example/Test.kt': 'package com.example\n@Composable fun Test() {}' } };
let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'android-run-test-'));
  setApplicationSupportDirectoryForTesting(root);
  vi.stubEnv('ANDROID_HOME', path.join(root, 'sdk'));
  vi.stubEnv('AGENTIC_ANDROID_JAVA_HOME', path.join(root, 'java'));
  vi.stubEnv('AGENTIC_ANDROID_GRADLE', path.join(root, 'gradle'));
  for (const file of ['sdk/platform-tools/adb', 'sdk/emulator/emulator', 'java/bin/java', 'gradle']) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), '');
  }
});
afterEach(() => { setApplicationSupportDirectoryForTesting(undefined); vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });

describe('Android build and launch', () => {
  it.each(['../../outside.kt', '/tmp/Outside.kt', 'app/build.gradle.kts', 'app/src/main/java/a/../Bad.kt', 'app/src/main/java/AgenticLauncherActivity.kt'])(
    'rejects unsafe source path %s before writing', file => {
      expect(() => validateAndroidRequest({ ...request, files: { [file]: 'bad' } })).toThrow();
    });
  it('parses file URI diagnostics with spaces and preserves source line/column', () => {
    expect(parseAndroidDiagnostics('e: file:///tmp/My%20App/app/src/main/java/Test.kt:7:12 Unresolved reference: Text', '/tmp/My App'))
      .toEqual([{ fileName: 'app/src/main/java/Test.kt', line: 7, column: 12, severity: 'error', message: 'Unresolved reference: Text' }]);
  });
  it('never installs or starts an emulator after a compiler failure', async () => {
    const process = vi.fn().mockResolvedValue({ status: 1, output: 'e: file:///tmp/Test.kt:3:1 Unresolved reference' });
    const result = await new AndroidRunner(process).run(request);
    expect(result.success).toBe(false); expect(result.phase).toBe('build');
    expect(result.diagnostics[0].line).toBe(3); expect(process).toHaveBeenCalledOnce();
  });
  it('points missing screen errors back to the student source', async () => {
    const process = vi.fn(async (_exe: string, _args: string[], options?: RunOptions) => ({ status: 1,
      output: `e: file://${options!.cwd}/app/src/main/java/com/agenticdesigner/runtime/AgenticLauncherActivity.kt:6:20 Unresolved reference 'Test'.` }));
    const result = await new AndroidRunner(process).run(request);
    expect(result.diagnostics[0].fileName).toBe(request.entryFile);
    expect(result.diagnostics[0].message).toContain('@Composable fun Test()');
  });
  function successfulBuild(executable: string, options?: RunOptions) {
    if (executable === path.join(root, 'gradle')) {
      const apk = path.join(options!.cwd!, 'app/build/outputs/apk/debug/app-debug.apk');
      fs.mkdirSync(path.dirname(apk), { recursive: true }); fs.writeFileSync(apk, 'test apk');
      return { status: 0, output: 'BUILD SUCCESSFUL' };
    }
    return null;
  }
  it('targets only its named emulator, installs and checks the app process', async () => {
    const process = vi.fn(async (exe: string, args: string[], options?: RunOptions) => {
      const build = successfulBuild(exe, options); if (build) return build;
      if (args[0] === 'devices') return { status: 0, output: 'physical-123\tdevice\nemulator-5554\tdevice\nemulator-5556\tdevice\n' };
      if (args.includes('name')) return { status: 0, output: args[1] === 'emulator-5554' ? 'Personal_AVD\nOK\n' : 'AgenticDesigner_API_35\nOK\n' };
      if (args.includes('getprop')) return { status: 0, output: '1\n' };
      if (args.includes('install')) return { status: 0, output: 'Success' };
      if (args.includes('pidof')) return { status: 0, output: '1234' };
      return { status: 0, output: 'Status: ok' };
    });
    const result = await new AndroidRunner(process, async () => {}).run(request);
    expect(result.success).toBe(true); expect(result.serial).toBe('emulator-5556');
    for (const [, args] of process.mock.calls.filter(([, args]) => args.includes('install') || args.includes('start') || args.includes('pidof'))) {
      expect(args[1]).toBe('emulator-5556');
    }
    const changed = await new AndroidRunner(vi.fn().mockResolvedValue({ status: 1, output: '' })).run({ ...request, files: { [request.entryFile]: request.files[request.entryFile] + '\n// changed' } });
    expect(changed.sourceHash).not.toBe(result.sourceHash);
  });
  it('does not report success when the launched app crashes', async () => {
    const process = vi.fn(async (exe: string, args: string[], options?: RunOptions) => {
      const build = successfulBuild(exe, options); if (build) return build;
      if (args[0] === 'devices') return { status: 0, output: 'emulator-5554\tdevice\n' };
      if (args.includes('name')) return { status: 0, output: 'AgenticDesigner_API_35\nOK\n' };
      if (args.includes('getprop')) return { status: 0, output: '1' };
      if (args.includes('install')) return { status: 0, output: 'Success' };
      if (args.includes('pidof')) return { status: 1, output: '' };
      return { status: 0, output: 'runtime exception' };
    });
    const result = await new AndroidRunner(process, async () => {}).run(request);
    expect(result.success).toBe(false); expect(result.phase).toBe('launch');
    expect(result.message).toContain('נסגרה');
  });
});
