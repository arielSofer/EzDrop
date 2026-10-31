import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { useAndroidRunStore } from '../androidRunStore';
import { useProjectStore } from '../projectStore';
import { useAndroidSetupStore } from '../androidSetupStore';
import { bridge } from '../../bridge/bridgeClient';
const entry = 'app/src/main/java/com/example/Screen.kt';
const source = 'package com.example\n@Composable fun Screen() {}';
const ready = { supported: true, ready: true, running: false, components: [], message: '', error: null };
const success = { success: true, phase: 'launch' as const, message: 'פועל', diagnostics: [], output: '', sourceHash: 'hash' };
beforeEach(() => {
  useProjectStore.getState().mutateProject(p => { p.learningProjectId = 'android-test'; p.sourceOverrides = { [entry]: source }; });
  useAndroidRunStore.setState({ running: false, result: null, completedSources: null, completedProject: null, completedEntry: null, message: '' });
});
afterEach(() => vi.restoreAllMocks());
describe('Android browser run state', () => {
  it('sends the saved Kotlin source and invalidates success after an edit', async () => {
    const call = vi.spyOn(bridge, 'call').mockImplementation(async name => name === 'android.setupStatus' ? ready : success);
    await useAndroidRunStore.getState().run(entry);
    expect(call).toHaveBeenCalledWith('android.buildAndLaunch', expect.objectContaining({ files: { [entry]: source }, entryFunction: 'Screen', capturePreview: true }));
    expect(useAndroidRunStore.getState().isCurrentSuccess(entry)).toBe(true);
    useProjectStore.getState().mutateProject(p => { p.sourceOverrides![entry] += '\n// edited'; });
    expect(useAndroidRunStore.getState().isCurrentSuccess(entry)).toBe(false);
  });
  it('rejects stale build completion and prevents duplicate clicks', async () => {
    let finish!: (value: typeof success) => void;
    const call = vi.spyOn(bridge, 'call').mockImplementation(name => name === 'android.setupStatus' ? Promise.resolve(ready) : new Promise(resolve => { finish = resolve; }));
    const pending = useAndroidRunStore.getState().run(entry);
    expect(await useAndroidRunStore.getState().run(entry)).toBeNull();
    useProjectStore.getState().mutateProject(p => { p.sourceOverrides![entry] += '\n// new revision'; });
    finish(success);
    expect(await pending).toBeNull(); expect(call).toHaveBeenCalledTimes(2);
    expect(useAndroidRunStore.getState().isCurrentSuccess(entry)).toBe(false);
    expect(useAndroidRunStore.getState().message).toContain('השתנו');
  });
  it('does not keep success after a disconnected bridge', async () => {
    vi.spyOn(bridge, 'call').mockRejectedValue(new Error('server disconnected'));
    await useAndroidRunStore.getState().run(entry);
    expect(useAndroidRunStore.getState().running).toBe(false);
    expect(useAndroidRunStore.getState().isCurrentSuccess(entry)).toBe(false);
    expect(useAndroidRunStore.getState().message).toContain('server disconnected');
  });
  it('opens the setup wizard and never builds when the emulator is missing', async () => {
    const call = vi.spyOn(bridge, 'call').mockResolvedValue({ ...ready, ready: false });
    useAndroidSetupStore.setState({ open: false });
    expect(await useAndroidRunStore.getState().run(entry)).toBeNull();
    expect(useAndroidSetupStore.getState().open).toBe(true);
    expect(call).toHaveBeenCalledOnce();
    expect(call).toHaveBeenCalledWith('android.setupStatus', {});
    expect(useAndroidRunStore.getState().running).toBe(false);
  });

});
