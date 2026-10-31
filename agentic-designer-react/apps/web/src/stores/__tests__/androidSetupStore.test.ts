import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bridge } from '../../bridge/bridgeClient';
import { useAndroidSetupStore } from '../androidSetupStore';
const status = { supported: true, ready: false, components: [], running: false, message: '', error: null };
beforeEach(() => useAndroidSetupStore.setState({ open: false, checking: false, status: null, error: null }));
afterEach(() => vi.restoreAllMocks());
describe('Android setup wizard state', () => {
  it('resumes the current installation status when reopened', async () => {
    vi.spyOn(bridge, 'call').mockResolvedValue({ ...status, running: true, message: 'מוריד Android' });
    await useAndroidSetupStore.getState().show();
    expect(useAndroidSetupStore.getState().status?.running).toBe(true);
    useAndroidSetupStore.getState().close();
    await useAndroidSetupStore.getState().show();
    expect(useAndroidSetupStore.getState().status?.message).toBe('מוריד Android');
  });
  it('does not retain a ready state when the local server is unavailable', async () => {
    useAndroidSetupStore.setState({ status: { ...status, ready: true } });
    vi.spyOn(bridge, 'call').mockRejectedValue(new Error('disconnected'));
    await useAndroidSetupStore.getState().show();
    expect(useAndroidSetupStore.getState().status).toBeNull();
    expect(useAndroidSetupStore.getState().error).toContain('השרת המקומי');
  });
  it('surfaces installation rejection without claiming success', async () => {
    vi.spyOn(bridge, 'call').mockRejectedValue(new Error('license approval required'));
    await useAndroidSetupStore.getState().install(false);
    expect(useAndroidSetupStore.getState().error).toBe('license approval required');
    expect(useAndroidSetupStore.getState().status).toBeNull();
  });
});
