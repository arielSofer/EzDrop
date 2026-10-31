import { create } from 'zustand';
import { useAndroidSetupStore } from './androidSetupStore';
import { bridge } from '../bridge/bridgeClient';
import type { AndroidRunResult } from '../bridge/protocol';
import { useProjectStore } from './projectStore';
import { useLearningStore } from './learningStore';

export function androidSources(overrides: Record<string, string> | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(overrides ?? {}).filter(([file]) => file.endsWith('.kt'))
    .map(([file, code]) => [file.includes('/') ? file : `app/src/main/java/com/example/app/ui/${file}`, code]));
}
const sourceKey = (files: Record<string, string>) => JSON.stringify(Object.entries(files).sort());
interface AndroidRunState {
  running: boolean;
  message: string;
  result: AndroidRunResult | null;
  completedSources: string | null;
  completedProject: string | null;
  completedEntry: string | null;
  isCurrentSuccess: (entryFile: string) => boolean;
  run: (entryFile?: string) => Promise<AndroidRunResult | null>;
}

export const useAndroidRunStore = create<AndroidRunState>((set, get) => ({
  running: false, message: '', result: null, completedSources: null, completedProject: null, completedEntry: null,
  isCurrentSuccess: entryFile => {
    const project = useProjectStore.getState().project;
    return !get().running && get().result?.success === true && project.learningProjectId === get().completedProject &&
      entryFile === get().completedEntry && sourceKey(androidSources(project.sourceOverrides)) === get().completedSources;
  },
  run: async entryFile => {
    if (get().running) return null;
    const learning = useLearningStore.getState();
    const task = learning.kotlinTasks.find(t => t.id === learning.activeKotlinTaskId);
    const entry = entryFile ?? task?.targetFile;
    const project = useProjectStore.getState().project;
    const files = androidSources(project.sourceOverrides);
    if (!entry || !files[entry]) {
      set({ message: 'יש לפתוח מסך Kotlin ולכתוב את הקוד שלו לפני ההרצה.', result: null }); return null;
    }
    const projectId = project.learningProjectId ?? crypto.randomUUID();
    if (!project.learningProjectId) useProjectStore.getState().mutateProject(p => { p.learningProjectId = projectId; });
    // The learning task names the callable screen. The compiler reports missing functions or required arguments.
    const entryFunction = entry.split('/').pop()!.replace(/\.kt$/, '');
    const runId = crypto.randomUUID();
    const snapshot = sourceKey(files);
    set({ running: true, message: 'מתחבר למנוע Android המקומי…', result: null, completedSources: null, completedEntry: null });
    const unsubscribe = bridge.on('android.progress', event => { if (event.runId === runId) set({ message: event.message }); });
    try {
      const setup = await bridge.call('android.setupStatus', {});
      if (!setup.ready || setup.running) {
        useAndroidSetupStore.setState({ open: true, status: setup, error: null });
        set({ message: 'יש להשלים את הכנת Android לפני ההרצה.' });
        return null;
      }
      const result = await bridge.call('android.buildAndLaunch', { projectId, runId, files, entryFile: entry, entryFunction, capturePreview: true });
      const current = useProjectStore.getState().project;
      const stale = current.learningProjectId !== projectId || sourceKey(androidSources(current.sourceOverrides)) !== snapshot;
      const message = stale ? `${result.message} הקוד או הפרויקט השתנו בזמן הבנייה; יש להריץ שוב את הגרסה הנוכחית.` : result.message;
      set({ result: stale ? { ...result, success: false, message } : result, message, completedSources: stale ? null : snapshot, completedProject: projectId, completedEntry: entry });
      if (current.learningProjectId === projectId) useLearningStore.getState().setCodeDiagnostics(
        [message, ...result.diagnostics.map(d => `${d.fileName}:${d.line}:${d.column} ${d.message}`),
          !result.success ? result.output.slice(-8000) : ''].filter(Boolean).join('\n'));
      return stale ? null : result;
    } catch (error) {
      const message = `הרצת Android נכשלה: ${(error as Error).message}`;
      set({ message, result: null });
      if (useProjectStore.getState().project.learningProjectId === projectId) useLearningStore.getState().setCodeDiagnostics(message);
      return null;
    } finally { unsubscribe(); set({ running: false }); }
  },
}));

// A successful run describes a specific source revision, not all future edits.
useProjectStore.subscribe((current, previous) => {
  if (current.project === previous.project) return;
  const state = useAndroidRunStore.getState();
  if (state.running || !state.completedSources) return;
  if (current.project.learningProjectId !== state.completedProject ||
      sourceKey(androidSources(current.project.sourceOverrides)) !== state.completedSources) {
    useAndroidRunStore.setState({ result: null, completedSources: null,
      message: 'הקוד או הפרויקט השתנו מאז ההרצה. יש להריץ שוב כדי לבדוק את הגרסה הנוכחית.' });
  }
});
