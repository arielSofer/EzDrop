import { create } from 'zustand';
import { bridge } from '../bridge/bridgeClient';
import type { AndroidSetupStatus } from '../bridge/protocol';
interface SetupState {
  open: boolean;
  checking: boolean;
  status: AndroidSetupStatus | null;
  error: string | null;
  show: () => Promise<void>;
  close: () => void;
  refresh: () => Promise<AndroidSetupStatus | null>;
  install: (acceptLicenses: boolean) => Promise<void>;
}
export const useAndroidSetupStore = create<SetupState>((set, get) => ({
  open: false, checking: false, status: null, error: null,
  show: async () => { set({ open: true }); await get().refresh(); },
  close: () => set({ open: false }),
  refresh: async () => {
    if (get().checking) return null;
    set({ checking: true, error: null });
    try { const status = await bridge.call('android.setupStatus', {}); set({ status }); return status; }
    catch (error) { set({ error: `לא ניתן לבדוק את המחשב. ודא שהשרת המקומי של המערכת פועל. ${(error as Error).message}`, status: null }); return null; }
    finally { set({ checking: false }); }
  },
  install: async acceptLicenses => {
    try {
      set({ error: null });
      await bridge.call('android.setupInstall', { acceptLicenses });
      await get().refresh();
    } catch (error) { set({ error: (error as Error).message }); }
  },
}));
