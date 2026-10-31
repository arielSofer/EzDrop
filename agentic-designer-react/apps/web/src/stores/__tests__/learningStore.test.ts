// apps/web/src/stores/__tests__/learningStore.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import { useLearningStore } from '../learningStore';
import { useProjectStore } from '../projectStore';

describe('useLearningStore', () => {
  const storeMap = new Map<string, string>();
  const mockStorage = {
    getItem: (key: string) => storeMap.get(key) ?? null,
    setItem: (key: string, value: string) => storeMap.set(key, value),
    removeItem: (key: string) => storeMap.delete(key),
    clear: () => storeMap.clear(),
    key: (i: number) => Array.from(storeMap.keys())[i] ?? null,
    length: storeMap.size,
  };

  beforeEach(() => {
    (globalThis as any).localStorage = mockStorage;
    storeMap.clear();
    useLearningStore.getState().resetProgress();
    useLearningStore.getState().setLearningMode(true);
  });

  it('initializes with learning mode active and first task', () => {
    const state = useLearningStore.getState();
    expect(state.learningModeActive).toBe(true);
    expect(state.activeTaskId).toBe('signup_1_create_screen');
    expect(state.activeTemplate.stepNumber).toBe(1);
    expect(state.rightPanelTab).toBe('inspector');
  });

  it('toggles learning mode and changes panel tab', () => {
    const store = useLearningStore.getState();
    store.toggleLearningMode();
    expect(useLearningStore.getState().learningModeActive).toBe(false);

    store.setLearningMode(true);
    expect(useLearningStore.getState().learningModeActive).toBe(true);

    store.setRightPanelTab('layers');
    expect(useLearningStore.getState().rightPanelTab).toBe('layers');
  });

  it('triggers showMeWhere and sets highlight target', () => {
    const store = useLearningStore.getState();
    expect(store.highlightTarget).toBeNull();

    store.showMeWhere();
    expect(useLearningStore.getState().highlightTarget).toBe('toolbar-add-screen');
  });

  it('requests hint and updates helpLevel', () => {
    const store = useLearningStore.getState();
    expect(store.hintIndex).toBe(0);

    store.requestHint();
    expect(useLearningStore.getState().hintIndex).toBe(1);
    const activeTask = useLearningStore.getState().learningRecord.tasks['signup_1_create_screen'];
    expect(activeTask?.helpLevel).toBe('first_hint');
  });

  it('automatically detects screen addition and marks task 1 completed', async () => {
    // Add screen via projectStore
    useProjectStore.getState().addScreenNode();

    // Check task
    useLearningStore.getState().checkCurrentTask();
    const activeTask = useLearningStore.getState().learningRecord.tasks['signup_1_create_screen'];
    expect(activeTask.status).toBe('completed');

    // Proceed to next task
    useLearningStore.getState().proceedToNextTask();
    expect(useLearningStore.getState().activeTaskId).toBe('signup_2_name_screen');
  });

  it('persists and restores learning session', () => {
    useLearningStore.getState().requestHint();
    useLearningStore.getState().persistSession();

    const projectName = useProjectStore.getState().project.name;
    const projectId = useProjectStore.getState().project.learningProjectId!;
    const key = `agentic_learning_session_${projectId}`;
    expect(localStorage.getItem(key)).not.toBeNull();

    // Reset state in memory
    useLearningStore.setState({ hintIndex: 0 });
    expect(useLearningStore.getState().hintIndex).toBe(0);

    // Restore from storage
    useLearningStore.getState().restoreSession(projectId, projectName);
    expect(useLearningStore.getState().learningRecord.tasks['signup_1_create_screen']?.helpLevel).toBe('first_hint');
  });

  it('switches between curriculum units', () => {
    useLearningStore.getState().switchUnit('login_screen');
    expect(useLearningStore.getState().activeUnitId).toBe('login_screen');
    expect(useLearningStore.getState().activeTaskId).toBe('login_1_create_screen');

    useLearningStore.getState().switchUnit('home_screen');
    expect(useLearningStore.getState().activeUnitId).toBe('home_screen');
    expect(useLearningStore.getState().activeTaskId).toBe('home_1_create_screen');
  });

  it('answers questions via askAI', async () => {
    const res = await useLearningStore.getState().askAI('מה זה מסך?');
    expect(res.source).toBe('local_approved');
    expect(res.answer).toContain('המעטפת הראשית');
  });

  it('transitions to writing Kotlin screens and populates sourceOverrides', () => {
    // Add screen to project
    useProjectStore.getState().addScreenNode();

    const snapshot = useLearningStore.getState().startWritingMyScreens();
    expect(snapshot).not.toBeNull();
    expect(snapshot!.screens.length).toBeGreaterThan(0);

    const kotlinTasks = useLearningStore.getState().kotlinTasks;
    expect(kotlinTasks.length).toBe(5);
    expect(useLearningStore.getState().activeKotlinTaskId).toBe(kotlinTasks[0].id);

    // Verify sourceOverrides contains the starter code
    const project = useProjectStore.getState().project;
    expect(project.sourceOverrides).toBeDefined();
    const keys = Object.keys(project.sourceOverrides || {});
    expect(keys.length).toBeGreaterThan(0);
    expect(project.sourceOverrides![keys[0]]).toContain('@Composable');
  });

  it('advances through Kotlin tasks and returns to design mode', () => {
    useProjectStore.getState().addScreenNode();
    useLearningStore.getState().startWritingMyScreens();

    const tasks = useLearningStore.getState().kotlinTasks;
    expect(useLearningStore.getState().activeKotlinTaskId).toBe(tasks[0].id);

    useLearningStore.getState().saveKotlinDraft(tasks[0].targetFile, '@Composable fun Screen() { Column {} }');
    useLearningStore.getState().proceedToNextKotlinTask();
    expect(useLearningStore.getState().activeKotlinTaskId).toBe(tasks[1].id);

    useLearningStore.getState().backToDesignMode();
    expect(useLearningStore.getState().learningStage).toBe('design');
    expect(useLearningStore.getState().designSnapshot).not.toBeNull();
    expect(useLearningStore.getState().activeKotlinTaskId).toBe(tasks[1].id);
  });
  it('preserves student code and active task across design-code roundtrips', () => {
    useProjectStore.getState().addScreenNode();
    useLearningStore.getState().startWritingMyScreens();
    const tasks = useLearningStore.getState().kotlinTasks;
    const code = '@Composable fun StudentScreen() { Column { Text("mine") } }';
    useLearningStore.getState().saveKotlinDraft(tasks[0].targetFile, code);
    useLearningStore.getState().proceedToNextKotlinTask();
    useLearningStore.getState().backToDesignMode();
    useLearningStore.getState().startWritingMyScreens();
    expect(useProjectStore.getState().project.sourceOverrides![tasks[0].targetFile]).toBe(code);
    expect(useLearningStore.getState().activeKotlinTaskId).toBe(tasks[1].id);
  });
  it('restores the complete Kotlin workspace after memory is cleared, including a renamed project', () => {
    useProjectStore.getState().addScreenNode();
    useLearningStore.getState().startWritingMyScreens();
    const task = useLearningStore.getState().kotlinTasks[0];
    useLearningStore.getState().saveKotlinDraft(task.targetFile, '@Composable fun S() { Column {} }');
    useLearningStore.getState().proceedToNextKotlinTask();
    useProjectStore.getState().mutateProject(p => { p.name = 'Renamed project'; });
    useLearningStore.getState().persistSession();
    const id = useProjectStore.getState().project.learningProjectId!;
    const active = useLearningStore.getState().activeKotlinTaskId;
    useLearningStore.setState({ designSnapshot: null, kotlinTasks: [], activeKotlinTaskId: null, learningStage: 'design' });
    useProjectStore.getState().mutateProject(p => { p.sourceOverrides = {}; });
    useLearningStore.getState().restoreSession(id, 'Renamed project');
    expect(useLearningStore.getState().learningStage).toBe('code');
    expect(useLearningStore.getState().activeKotlinTaskId).toBe(active);
    expect(useLearningStore.getState().designSnapshot).not.toBeNull();
    expect(useProjectStore.getState().project.sourceOverrides![task.targetFile]).toContain('Column');
  });
  it('reports failed persistence instead of claiming saved', () => {
    (globalThis as any).localStorage = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
    useLearningStore.getState().persistSession();
    expect(useLearningStore.getState().sessionSavedAt).toBeNull();
    expect(useLearningStore.getState().saveError).toContain('נכשלה');
  });
  it('prevents advancing without a matching structural check', () => {
    useProjectStore.getState().addScreenNode();
    useLearningStore.getState().startWritingMyScreens();
    const task = useLearningStore.getState().kotlinTasks[0];
    useLearningStore.getState().saveKotlinDraft(task.targetFile, 'invalid');
    useLearningStore.getState().proceedToNextKotlinTask();
    expect(useLearningStore.getState().activeKotlinTaskId).toBe(task.id);
  });

  it('keeps source from an explicitly opened project when attaching its saved learning record', () => {
    useProjectStore.getState().addScreenNode();
    useLearningStore.getState().startWritingMyScreens();
    const task = useLearningStore.getState().kotlinTasks[0];
    useLearningStore.getState().saveKotlinDraft(task.targetFile, 'older code');
    const project = useProjectStore.getState().project;
    useProjectStore.getState().mutateProject(p => { p.sourceOverrides![task.targetFile] = 'newly imported code'; });
    useLearningStore.getState().restoreSession(project.learningProjectId!, project.name, false);
    expect(useProjectStore.getState().project.sourceOverrides![task.targetFile]).toBe('newly imported code');
  });

  it('keeps separate source and task progress for each design screen across reload', () => {
    useProjectStore.getState().addScreenNode();
    useProjectStore.getState().addScreenNode();
    const snapshot = useLearningStore.getState().startWritingMyScreens()!;
    const [first, second] = snapshot.screens;
    const firstTasks = useLearningStore.getState().kotlinTasks;
    const firstCode = '@Composable fun First() { Column {} }';
    useLearningStore.getState().saveKotlinDraft(firstTasks[0].targetFile, firstCode);
    useLearningStore.getState().proceedToNextKotlinTask();
    useLearningStore.getState().selectKotlinScreen(second.id);
    const secondTasks = useLearningStore.getState().kotlinTasks;
    expect(secondTasks[0].targetFile).not.toBe(firstTasks[0].targetFile);
    useLearningStore.getState().saveKotlinDraft(secondTasks[0].targetFile, '// second screen draft');
    useLearningStore.getState().selectKotlinScreen(first.id);
    expect(useLearningStore.getState().activeKotlinTaskId).toBe(firstTasks[1].id);
    useLearningStore.getState().selectKotlinScreen(second.id);
    const project = useProjectStore.getState().project;
    useLearningStore.getState().persistSession();
    useLearningStore.setState({ kotlinTasks: [], kotlinScreenSteps: {}, activeKotlinTaskId: null });
    useLearningStore.getState().restoreSession(project.learningProjectId!, project.name);
    expect(useLearningStore.getState().activeKotlinTaskId).toBe(secondTasks[0].id);
    expect(useLearningStore.getState().kotlinTasks[0].targetFile).toBe(secondTasks[0].targetFile);
    useLearningStore.getState().selectKotlinScreen(first.id);
    expect(useLearningStore.getState().activeKotlinTaskId).toBe(firstTasks[1].id);
    expect(useProjectStore.getState().project.sourceOverrides![firstTasks[0].targetFile]).toBe(firstCode);
    expect(useProjectStore.getState().project.sourceOverrides![secondTasks[0].targetFile]).toBe('// second screen draft');
  });

  it('resets only the selected screen and ignores unknown screen IDs', () => {
    useProjectStore.getState().addScreenNode();
    useProjectStore.getState().addScreenNode();
    const snapshot = useLearningStore.getState().startWritingMyScreens()!;
    const firstTask = useLearningStore.getState().kotlinTasks[0];
    useLearningStore.getState().saveKotlinDraft(firstTask.targetFile, '// keep first screen');
    useLearningStore.getState().selectKotlinScreen(snapshot.screens[1].id);
    const secondTask = useLearningStore.getState().kotlinTasks[0];
    useLearningStore.getState().saveKotlinDraft(secondTask.targetFile, '// reset this screen');
    useLearningStore.getState().resetKotlinStarterCode();
    expect(useProjectStore.getState().project.sourceOverrides![firstTask.targetFile]).toBe('// keep first screen');
    expect(useProjectStore.getState().project.sourceOverrides![secondTask.targetFile]).toContain('package com.example.app.ui');
    useLearningStore.getState().selectKotlinScreen('missing-id');
    expect(useLearningStore.getState().activeKotlinTaskId).toBe(secondTask.id);
  });

});
