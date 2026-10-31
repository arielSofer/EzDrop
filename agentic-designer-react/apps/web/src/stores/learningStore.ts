// apps/web/src/stores/learningStore.ts
//
// Zustand store for the Hebrew Guided Learning Companion.
// Supports multi-unit 3-screen curriculum (Signup, Login, Home),
// cost-effective AI companion service, and Design-to-Kotlin transition.

import { create } from 'zustand';
import {
  type LearningProjectRecord,
  type TaskTemplate,
  type TaskEvaluationResult,
  type DesignSnapshot,
  type KotlinLearningTask,
  type AIUsageLogEntry,
  type AskAgentResult,
  CURRICULUM_UNITS,
  getAllTaskTemplates,
  findTaskTemplateById,
  getUnitById,
  SIGNUP_TASK_TEMPLATES,
  createInitialLearningRecord,
  evaluateActiveTask,
  advanceToNextTask,
  verifyAllCompletedTasks,
  LearningAIService,
  createDesignSnapshot,
  generateKotlinLearningTasks,
  generateStarterKotlinFile,
  evaluateKotlinCode,
  type DesignProject,
} from '@agentic/core';
import { useProjectStore } from './projectStore';
import { bridge } from '../bridge/bridgeClient';

const STORAGE_KEY_PREFIX = 'agentic_learning_session_';
const ACTIVE_KEY = 'agentic_learning_active_v2';
let restoring = false;
let initialized = false;
let knownProjectId: string | undefined;

function projectIdentity(): string {
  const project = useProjectStore.getState().project;
  if (project.learningProjectId) return project.learningProjectId;
  const id = crypto.randomUUID();
  useProjectStore.getState().mutateProject(p => { p.learningProjectId = id; });
  return id;
}

export interface LearningState {
  learningModeActive: boolean;
  learningRecord: LearningProjectRecord;
  activeUnitId: string;
  activeTaskId: string;
  activeTemplate: TaskTemplate;
  hintIndex: number;
  highlightTarget: string | null;
  rightPanelTab: 'inspector' | 'layers';
  lastEvaluationResult: TaskEvaluationResult | null;
  sessionSavedAt: number | null;
  saveError: string | null;
  hasRestoredProject: boolean;
  learningStage: 'design' | 'code';
  codeDiagnostics: string;
  initializeSession: () => void;
  saveKotlinDraft: (path: string, code: string) => void;
  setCodeDiagnostics: (text: string) => void;

  // AI Service & Usage
  aiService: LearningAIService;
  aiUsageLog: AIUsageLogEntry[];

  // Code Mode Transition
  designSnapshot: DesignSnapshot | null;
  kotlinTasks: KotlinLearningTask[];
  kotlinScreenSteps: Record<string, string>;
  selectKotlinScreen: (screenId: string) => void;
  activeKotlinTaskId: string | null;

  // Actions
  toggleLearningMode: () => void;
  setLearningMode: (active: boolean) => void;
  setRightPanelTab: (tab: 'inspector' | 'layers') => void;
  setHighlightTarget: (target: string | null) => void;
  showMeWhere: () => void;
  requestHint: () => void;
  proceedToNextTask: () => void;
  checkCurrentTask: () => void;
  switchUnit: (unitId: string) => void;
  askAI: (question: string, recentMessages?: Array<{ sender: 'user' | 'agent'; text: string }>) => Promise<AskAgentResult>;
  startWritingMyScreens: () => DesignSnapshot | null;
  proceedToNextKotlinTask: () => void;
  resetKotlinStarterCode: () => void;
  backToDesignMode: () => void;
  resetProgress: () => void;
  persistSession: () => void;
  restoreSession: (projectId: string, projectName: string, restoreProject?: boolean) => void;
}

function getStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
    if (typeof globalThis !== 'undefined' && (globalThis as any).localStorage) return (globalThis as any).localStorage;
  } catch {}
  return null;
}

const allTemplates = getAllTaskTemplates();
const initialRecord = createInitialLearningRecord('default-project', 'My First App', allTemplates);
let credentialMigrated = false;
const aiServiceInstance = new LearningAIService({ transport: async options => {
  const existingKey = getStorage()?.getItem('openRouterAPIKey');
  if (existingKey && !credentialMigrated) {
    await bridge.call('learning.configure', { apiKey: existingKey });
    credentialMigrated = true;
  }
  return bridge.call('learning.ask', options);
} });

export const useLearningStore = create<LearningState>((set, get) => ({
  learningModeActive: true,
  learningRecord: initialRecord,
  activeUnitId: 'signup_screen',
  activeTaskId: initialRecord.activeTaskId || SIGNUP_TASK_TEMPLATES[0].id,
  activeTemplate: SIGNUP_TASK_TEMPLATES[0],
  hintIndex: 0,
  highlightTarget: null,
  rightPanelTab: 'inspector',
  lastEvaluationResult: null,
  sessionSavedAt: null,
  saveError: null,
  hasRestoredProject: false,
  learningStage: 'design',
  codeDiagnostics: '',

  aiService: aiServiceInstance,
  aiUsageLog: [],

  designSnapshot: null,
  kotlinTasks: [],
  kotlinScreenSteps: {},
  activeKotlinTaskId: null,

  toggleLearningMode() {
    set((s) => ({ learningModeActive: !s.learningModeActive }));
  },

  setLearningMode(active: boolean) {
    set({ learningModeActive: active });
  },

  setRightPanelTab(tab: 'inspector' | 'layers') {
    set({ rightPanelTab: tab });
  },

  setHighlightTarget(target: string | null) {
    set({ highlightTarget: target });
  },

  showMeWhere() {
    const { activeTemplate } = get();
    if (activeTemplate.toolHighlightTarget) {
      set({ highlightTarget: activeTemplate.toolHighlightTarget });
      if (activeTemplate.toolHighlightTarget.startsWith('inspector-')) {
        set({ rightPanelTab: 'inspector' });
      }
    }
  },

  requestHint() {
    const state = get();
    const hintsCount = state.activeTemplate.hintsHe.length;
    if (hintsCount === 0) return;
    const nextIndex = Math.min(state.hintIndex + 1, hintsCount);

    const currentTaskId = state.activeTaskId;
    const record = state.learningRecord;
    const taskState = record.tasks[currentTaskId];
    if (taskState) {
      const helpLevel = nextIndex === 1 ? 'first_hint' : 'second_hint';
      const updatedRecord: LearningProjectRecord = {
        ...record,
        tasks: {
          ...record.tasks,
          [currentTaskId]: {
            ...taskState,
            helpLevel,
          },
        },
      };
      set({ hintIndex: nextIndex, learningRecord: updatedRecord });
      get().persistSession();
      return;
    }
    set({ hintIndex: nextIndex });
  },

  proceedToNextTask() {
    const state = get();
    const currentTemplates = getAllTaskTemplates();
    const updated = advanceToNextTask(state.learningRecord, currentTemplates);
    const nextTemplate =
      findTaskTemplateById(updated.activeTaskId) ?? currentTemplates[0];

    set({
      learningRecord: updated,
      activeTaskId: updated.activeTaskId,
      activeTemplate: nextTemplate,
      activeUnitId: nextTemplate.unitId,
      hintIndex: 0,
      highlightTarget: null,
      lastEvaluationResult: null,
    });

    get().persistSession();
    get().checkCurrentTask();
  },

  checkCurrentTask() {
    const state = get();
    const project = useProjectStore.getState().project;
    const currentTemplates = getAllTaskTemplates();

    const verifiedRecord = verifyAllCompletedTasks(project, state.learningRecord, currentTemplates);

    const { updatedRecord, result } = evaluateActiveTask(
      project,
      verifiedRecord,
      currentTemplates,
    );

    set({
      learningRecord: updatedRecord,
      lastEvaluationResult: result,
    });

    get().persistSession();
  },

  switchUnit(unitId: string) {
    const unit = getUnitById(unitId);
    if (!unit || unit.templates.length === 0) return;

    const firstTask = unit.templates[0];
    const state = get();
    const record = state.learningRecord;

    const nextTasks = { ...record.tasks };
    if (!nextTasks[firstTask.id] || nextTasks[firstTask.id].status === 'pending_dependencies') {
      nextTasks[firstTask.id] = {
        taskId: firstTask.id,
        templateId: firstTask.id,
        status: 'active',
        helpLevel: 'none',
        assignedNodeIds: [],
      };
    }

    set({
      activeUnitId: unitId,
      activeTaskId: firstTask.id,
      activeTemplate: firstTask,
      learningRecord: {
        ...record,
        activeTaskId: firstTask.id,
        tasks: nextTasks,
      },
      hintIndex: 0,
      highlightTarget: null,
    });

    get().checkCurrentTask();
  },

  async askAI(question, recentMessages = []): Promise<AskAgentResult> {
    const state = get();
    const project = useProjectStore.getState().project;
    const task = state.kotlinTasks.find(t => t.id === state.activeKotlinTaskId);
    const context = state.learningStage === 'code' && task ? {
      stage: 'code' as const,
      filePath: task.targetFile,
      code: project.sourceOverrides?.[task.targetFile] ?? '',
      diagnostics: state.codeDiagnostics,
      design: state.designSnapshot?.screens.find(s => task.id.startsWith(s.id)),
    } : {
      stage: 'design' as const,
      design: createDesignSnapshot(project, state.learningRecord.roles).screens,
    };
    const result = await state.aiService.ask({
      question,
      activeTask: state.learningStage === 'code' && task ? {
        id: task.id, titleHe: task.titleHe, promptHe: task.promptHe, whyHe: task.explanationHe,
      } : state.activeTemplate,
      context,
      recentMessages: recentMessages.slice(-6),
    });
    set({ aiUsageLog: state.aiService.getUsageHistory() });
    return result;
  },

  saveKotlinDraft(path, code) {
    useProjectStore.getState().mutateProject(p => {
      p.sourceOverrides = { ...p.sourceOverrides, [path]: code };
    });
    set({ codeDiagnostics: '' });
    get().persistSession();
  },

  setCodeDiagnostics(text) { set({ codeDiagnostics: text }); },

  startWritingMyScreens(): DesignSnapshot | null {
    const state = get();
    // Resume the frozen target and task. Returning to design never discards it.
    if (state.designSnapshot && state.kotlinTasks.length) {
      set({ learningStage: 'code' });
      get().persistSession();
      return state.designSnapshot;
    }
    const project = useProjectStore.getState().project;
    const snapshot = createDesignSnapshot(project, state.learningRecord.roles);
    if (!snapshot.screens.length) return null;
    const targetScreen = snapshot.screens[0];
    const tasks = generateKotlinLearningTasks(targetScreen);
    const targetPath = tasks[0].targetFile;
    const legacyName = `${targetScreen.name.replace(/[^a-zA-Z0-9]/g, '') || 'SignupScreen'}.kt`;
    const existing = project.sourceOverrides?.[legacyName];
    useProjectStore.getState().mutateProject(p => {
      if (p.sourceOverrides?.[targetPath] === undefined) {
        p.sourceOverrides = { ...p.sourceOverrides,
          [targetPath]: existing ?? generateStarterKotlinFile(targetScreen) };
      }
    });
    set({ designSnapshot: snapshot, kotlinTasks: tasks,
      activeKotlinTaskId: tasks[0]?.id ?? null, learningStage: 'code', codeDiagnostics: '' });
    get().persistSession();
    return snapshot;
  },

  selectKotlinScreen(screenId) {
    const state = get();
    const screen = state.designSnapshot?.screens.find(screen => screen.id === screenId);
    if (!screen) return;
    const tasks = generateKotlinLearningTasks(screen);
    const previousScreen = state.designSnapshot?.screens.find(screen => state.activeKotlinTaskId?.startsWith(`${screen.id}_kotlin_`));
    const steps = { ...state.kotlinScreenSteps };
    if (previousScreen && state.activeKotlinTaskId) steps[previousScreen.id] = state.activeKotlinTaskId;
    const selectedTask = tasks.find(task => task.id === steps[screen.id]) ?? tasks[0];
    const targetPath = selectedTask.targetFile;
    useProjectStore.getState().mutateProject(project => {
      if (project.sourceOverrides?.[targetPath] === undefined) {
        project.sourceOverrides = { ...project.sourceOverrides, [targetPath]: generateStarterKotlinFile(screen) };
      }
    });
    set({ kotlinTasks: tasks, activeKotlinTaskId: selectedTask.id,
      kotlinScreenSteps: { ...steps, [screen.id]: selectedTask.id }, learningStage: 'code', codeDiagnostics: '' });
    get().persistSession();
  },

  proceedToNextKotlinTask() {
    const state = get();
    const index = state.kotlinTasks.findIndex(t => t.id === state.activeKotlinTaskId);
    const task = state.kotlinTasks[index];
    if (!task || index >= state.kotlinTasks.length - 1) return;
    const code = useProjectStore.getState().project.sourceOverrides?.[task.targetFile] ?? '';
    if (!evaluateKotlinCode(code, task).passed) return;
    set({ activeKotlinTaskId: state.kotlinTasks[index + 1].id, codeDiagnostics: '' });
    get().persistSession();
  },

  resetKotlinStarterCode() {
    const state = get();
    const screen = state.designSnapshot?.screens.find(screen => state.activeKotlinTaskId?.startsWith(`${screen.id}_kotlin_`));
    const task = state.kotlinTasks[0];
    if (!screen || !task) return;
    useProjectStore.getState().snapshot();
    get().saveKotlinDraft(task.targetFile, generateStarterKotlinFile(screen));
    set({ activeKotlinTaskId: task.id });
    get().persistSession();
  },

  backToDesignMode() {
    set({ learningStage: 'design' });
    get().persistSession();
  },

  resetProgress() {
    const project = useProjectStore.getState().project;
    const fresh = createInitialLearningRecord(projectIdentity(), project.name, getAllTaskTemplates());
    set({
      learningRecord: fresh,
      activeUnitId: 'signup_screen',
      designSnapshot: null, kotlinTasks: [], kotlinScreenSteps: {}, activeKotlinTaskId: null, learningStage: 'design',
      activeTaskId: fresh.activeTaskId,
      activeTemplate: SIGNUP_TASK_TEMPLATES[0],
      hintIndex: 0,
      highlightTarget: null,
      lastEvaluationResult: null,
    });
    get().persistSession();
  },

  persistSession() {
    if (restoring) return;
    try {
      const storage = getStorage();
      if (!storage) throw new Error('אחסון מקומי אינו זמין');
      const id = projectIdentity();
      const state = get();
      const project = useProjectStore.getState().project;
      const envelope = {
        version: 2, project,
        learningRecord: { ...state.learningRecord, designProjectId: id, name: project.name },
        designSnapshot: state.designSnapshot, kotlinTasks: state.kotlinTasks,
        activeKotlinTaskId: state.activeKotlinTaskId, learningStage: state.learningStage, kotlinScreenSteps: state.kotlinScreenSteps,
        hintIndex: state.hintIndex, currentPageIndex: useProjectStore.getState().currentPageIndex,
      };
      storage.setItem(`${STORAGE_KEY_PREFIX}${id}`, JSON.stringify(envelope));
      storage.setItem(ACTIVE_KEY, id);
      set({ sessionSavedAt: Date.now(), saveError: null });
    } catch {
      set({ saveError: 'השמירה המקומית נכשלה. שמור עותק של הפרויקט לפני סגירה.', sessionSavedAt: null });
    }
  },

  restoreSession(projectId, projectName, restoreProject = true) {
    restoring = true;
    try {
      const storage = getStorage();
      const raw = storage?.getItem(`${STORAGE_KEY_PREFIX}${projectId}`)
        ?? storage?.getItem(`${STORAGE_KEY_PREFIX}${projectName}`);
      if (raw) {
        const saved = JSON.parse(raw);
        const record = saved.version === 2 ? saved.learningRecord : saved;
        if (!record?.tasks || !findTaskTemplateById(record.activeTaskId) || !record.roles || !Array.isArray(record.evidenceLog)) {
          throw new Error('Invalid session');
        }
        if (saved.version === 2) {
          if (!saved.project?.pages?.length || saved.project.learningProjectId !== projectId ||
              !Array.isArray(saved.kotlinTasks) ||
              (saved.learningStage === 'code' && (!saved.designSnapshot?.screens?.length ||
                !saved.kotlinTasks.some((t: KotlinLearningTask) => t.id === saved.activeKotlinTaskId)))) {
            throw new Error('Invalid workspace');
          }
          if (restoreProject) useProjectStore.getState().replaceProject(saved.project as DesignProject);
          if (restoreProject && Number.isInteger(saved.currentPageIndex) && saved.currentPageIndex >= 0 && saved.currentPageIndex < saved.project.pages.length) {
            useProjectStore.setState({ currentPageIndex: saved.currentPageIndex });
          }
        }
        const template = findTaskTemplateById(record.activeTaskId)!;
        const selectedScreen = saved.designSnapshot?.screens?.find((screen: { id: string }) =>
          typeof saved.activeKotlinTaskId === 'string' && saved.activeKotlinTaskId.startsWith(`${screen.id}_kotlin_`)) ?? saved.designSnapshot?.screens?.[0];
        const restoredTasks = selectedScreen ? generateKotlinLearningTasks(selectedScreen) : [];
        const restoredTask = restoredTasks.find(task => task.id === saved.activeKotlinTaskId) ?? restoredTasks[0];
        const restoredSteps = Object.fromEntries(Object.entries(saved.kotlinScreenSteps ?? {}).filter(([, value]) => typeof value === 'string'));
        set({ learningRecord: record, activeTaskId: record.activeTaskId,
          activeTemplate: template, activeUnitId: template.unitId,
          hintIndex: saved.hintIndex ?? 0, highlightTarget: null, lastEvaluationResult: null,
          designSnapshot: saved.designSnapshot ?? null, kotlinTasks: restoredTasks, kotlinScreenSteps: restoredSteps as Record<string, string>,
          activeKotlinTaskId: restoredTask?.id ?? null,
          learningStage: saved.learningStage === 'code' ? 'code' : 'design',
          hasRestoredProject: saved.version === 2, saveError: null, codeDiagnostics: '',
          sessionSavedAt: Date.now() });
        knownProjectId = projectId;
        return;
      }
      const record = createInitialLearningRecord(projectId, projectName, getAllTaskTemplates());
      set({ learningRecord: record, activeTaskId: record.activeTaskId,
        activeTemplate: SIGNUP_TASK_TEMPLATES[0], activeUnitId: 'signup_screen',
        hintIndex: 0, highlightTarget: null, lastEvaluationResult: null,
        designSnapshot: null, kotlinTasks: [], kotlinScreenSteps: {}, activeKotlinTaskId: null,
        learningStage: 'design', codeDiagnostics: '', sessionSavedAt: null });
      knownProjectId = projectId;
    } catch {
      set({ saveError: 'לא ניתן לשחזר את המפגש השמור; העותק המקורי לא הוחלף.', sessionSavedAt: null });
    } finally { restoring = false; }
  },

  initializeSession() {
    if (initialized) return;
    initialized = true;
    const active = getStorage()?.getItem(ACTIVE_KEY);
    if (active) get().restoreSession(active, useProjectStore.getState().project.name);
    else {
      restoring = true;
      knownProjectId = projectIdentity();
      restoring = false;
      get().restoreSession(knownProjectId!, useProjectStore.getState().project.name);
    }
  },
}));

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
useProjectStore.subscribe((curr, prev) => {
  if (restoring || curr.project === prev.project) return;
  if (initialized) {
    const id = curr.project.learningProjectId;
    if (!id || id !== knownProjectId) {
      restoring = true;
      knownProjectId = projectIdentity();
      restoring = false;
      useLearningStore.getState().restoreSession(knownProjectId!, curr.project.name, false);
    }
  }
  if (!useLearningStore.getState().learningModeActive) return;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    useLearningStore.getState().checkCurrentTask();
  }, 150);
});
