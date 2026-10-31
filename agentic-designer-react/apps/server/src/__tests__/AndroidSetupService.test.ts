import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AndroidSetupService } from '../services/AndroidSetupService';
import { setApplicationSupportDirectoryForTesting } from '../platform/Paths';
import { androidEnvironment } from '../services/AndroidEnvironment';
let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'android-setup-test-'));
  setApplicationSupportDirectoryForTesting(root);
  vi.stubEnv('ANDROID_HOME', path.join(root, 'sdk'));
  vi.stubEnv('AGENTIC_ANDROID_JAVA_HOME', path.join(root, 'java'));
  vi.stubEnv('AGENTIC_ANDROID_GRADLE', path.join(root, 'gradle'));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); setApplicationSupportDirectoryForTesting(undefined); fs.rmSync(root, { recursive: true, force: true }); });
describe('local Android setup', () => {
  it('reports all missing components on a clean machine without installing anything', async () => {
    const status = await new AndroidSetupService('darwin', 'arm64').status();
    expect(status.supported).toBe(true); expect(status.ready).toBe(false);
    expect(status.components.every(component => !component.ready)).toBe(true);
    expect(fs.readdirSync(root)).toEqual([]);
  });
  it('does not offer an unsupported platform or accept unapproved installation', () => {
    expect(() => new AndroidSetupService('win32', 'x64').start(true)).toThrow('Apple Silicon');
    expect(() => new AndroidSetupService('darwin', 'arm64').start(false)).toThrow('רישיון');
  });
  it('deduplicates installation and exposes a recoverable failure through status', async () => {
    const service = new AndroidSetupService('darwin', 'arm64');
    let reject!: (error: Error) => void;
    const install = vi.spyOn(service as any, 'install').mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
    expect(service.start(true).started).toBe(true);
    expect(service.start(true).started).toBe(false);
    expect((await service.status()).running).toBe(true);
    reject(new Error('network unavailable'));
    await new Promise(resolve => setTimeout(resolve, 0));
    const status = await service.status();
    expect(status.running).toBe(false); expect(status.error).toBe('network unavailable'); expect(install).toHaveBeenCalledOnce();
  });
  it('rejects checksum mismatches and removes the corrupt download before extraction', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('corrupted archive')));
    const service = new AndroidSetupService();
    const file = path.join(root, 'download.zip');
    try {
      await expect((service as any).download('https://example.test/archive', file, 'a'.repeat(64))).rejects.toThrow('תקינות');
      expect(fs.existsSync(file)).toBe(false);
    } finally { vi.unstubAllGlobals(); }
  });
  it('shares explicitly configured paths with the Android runner', () => {
    const env = androidEnvironment();
    expect(env.sdk).toBe(path.join(root, 'sdk'));
    expect(env.javaHome).toBe(path.join(root, 'java'));
    expect(env.gradle).toBe(path.join(root, 'gradle'));
  });
});
