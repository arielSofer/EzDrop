// Ported 1:1 from AgenticDesigner/ViewModels/ProjectViewModel.swift
//
// zustand + immer replacement for the ObservableObject: every `@Published`
// property is a state field with the same name, every method keeps its Swift
// name, and undo/redo store whole `DesignProject` snapshots exactly like the
// Swift stacks. The `project` object stays JSON-plain so the codec and the
// exporters can work on it directly.

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { enableMapSet } from 'immer';
import {
  decodeDesignProject,
  getPlatform,
  makeDesignNode,
  makeDesignPage,
  makeDesignProject,
  makeNodeLogicBinding,
  makeNodeStyle,
  newUUID,
  rectStandardized,
  rectUnion,
  storageGetBool,
  DevicePresetLibrary,
  type DesignAction,
  type DesignNode,
  type DesignPage,
  type DesignProject,
  type DevicePreset,
  type NodeLogicBindingKind,
  type Point,
  type Rect,
  type Size,
  type VisualStylePreset,
} from '@agentic/core';
import starterProjectJson from '../data/starterProject.json';
import { ComponentLibrary, type SavedComponent } from '@agentic/core/services/ComponentLibrary';
import type { AgentContext } from '@agentic/core/agent/AgentContext';
import {
  makeAgentContext as buildAgentContext,
} from './project/agentContext';
import type { AgentRequestIntent, PresentationMode } from './project/agentIntent';
import {
  exactCreateTypes,
  insertNode as insertNodeIntoContext,
  applyDesignAction,
  prepareImplicitScreenFrameIfNeeded,
  rootScreenActionCount,
  sanitizedActionsForCurrentIntent,
  type ActionContext,
} from './project/designActions';
import {
  collectMarqueeSelectableNodes,
  hitTestChain as hitTestChainIn,
  hitTestNodeIdInChain,
  isMarqueePassthroughNode,
} from './project/hitTesting';
import {
  applyAutoLayoutToNodes,
  applyConstraintsInNodes,
  applyPaddingBoundsInNodes,
  alignChildrenIn,
  distributeChildrenIn,
} from './project/layout';
import {
  addChildNode,
  allZIndexes,
  assignFreshIds,
  cloneNode,
  deleteNode as deleteNodeFromTree,
  duplicateNode,
  findGlobalRect,
  findNode,
  firstFrameNodeId,
  markManuallyPositioned,
  parentNode,
  removeNode,
  updateNode,
} from './project/nodeTree';
import {
  applyDesignQualityPass,
  clipRoundedContainers,
  expandContainersToFitChildren,
  fittedTextBox,
  hugTextBoxesToContent,
  nestLooseRootNodesIntoMobileFrame,
  normalizeAgentScreenRoots,
  normalizeIconLabelClusterLayouts,
  normalizeMobileScreenLayouts,
  normalizeNavigationLayouts,
  removePromptArtifactText,
  repairGeneratedDesignSemantics,
  repairTextContrast,
  repairTextSizing,
  screensPerRow,
  type NormalizationContext,
} from './project/normalization';
import { mizmorLetodahLines, studioAssetPath } from './project/studioAssets';
import {
  makeCanvasFocusRequest,
  resizeHandleAffectsHorizontally,
  resizeHandleAffectsVertically,
  resizeHandleAnchorsBottom,
  resizeHandleAnchorsRight,
  resizeHandleHorizontalSign,
  resizeHandleVerticalSign,
  type CanvasFocusRequest,
  type CanvasHitMode,
  type CanvasStudioAlignment,
  type CanvasStudioDistributionAxis,
  type ResizeHandle,
} from './project/types';

enableMapSet();

export * from './project/types';
export { screensPerRow } from './project/normalization';

/** `ProjectViewModel.screensPerRow` — how many screens sit in one row. */
export const ProjectViewModelScreensPerRow = screensPerRow;

/**
 * `static var autoHugTextBoxes` — UserDefaults key "autoHugTextBoxes",
 * default true.
 */
export function autoHugTextBoxes(): boolean {
  return storageGetBool(getPlatform().storage, 'autoHugTextBoxes', true);
}

// MARK: - State

export interface ProjectStoreState {
  project: DesignProject;
  selectedNodeId: string | undefined;
  /** Multi-selection (shift-click). Always contains `selectedNodeId`. */
  selectedNodeIds: Set<string>;
  /** `private(set)` — a layer-row click emits a fresh request every time. */
  canvasFocusRequest: CanvasFocusRequest | undefined;
  currentPageIndex: number;
  undoStack: DesignProject[];
  redoStack: DesignProject[];

  // The Swift view model's private run state.
  currentAgentStylePreset: VisualStylePreset;
  currentAgentRequestIntent: AgentRequestIntent;
  currentAgentPresentationMode: PresentationMode;
  currentAgentUserPrompt: string;
  shouldAutoParentUnreferencedAgentActions: boolean;
  allowsRootScreenDeletion: boolean;
  clipboard: DesignNode[];
}

export interface GroupResizeStart {
  frames: Record<string, Rect>;
  bounds: Rect;
}

/** `Binding<DesignNode>` — a get/set pair over the live node. */
export interface DesignNodeBinding {
  get(): DesignNode;
  set(node: DesignNode): void;
}

export interface ProjectStoreActions {
  // Computed properties (Swift `var`s).
  currentPage(): DesignPage;
  selectedNode(): DesignNode | undefined;
  selectedContainerNodeId(): string | undefined;
  agentContainerNodeId(): string | undefined;
  selectedNodeGlobalRect(): Rect | undefined;
  selectionGlobalRect(): Rect | undefined;
  selectedNodeBinding(): DesignNodeBinding | undefined;

  // Pages & document.
  selectPage(index: number): void;
  snapshot(): void;
  undo(): void;
  redo(): void;
  replaceProject(newProject: DesignProject): void;
  /** Not in Swift (value-type document); the store's single write path for hosts. */
  mutateProject(update: (project: DesignProject) => void): void;
  addPage(name?: string): void;
  deletePage(index: number): void;
  renamePage(index: number, name: string): void;

  // Selection.
  selectNode(id: string): void;
  selectAndRevealNode(id: string): void;
  toggleNodeInSelection(id: string): void;
  clearSelection(): void;
  selectNodes(rect: Rect, extending?: boolean): void;
  shouldBeginMarqueeSelection(id: string): boolean;
  safeDeleteSelectedNode(): void;
  deleteSelectedNode(): void;

  // Lookup.
  node(id: string): DesignNode | undefined;
  parentOfNode(id: string): DesignNode | undefined;
  isRootNode(id: string): boolean;
  globalRect(id: string): Rect | undefined;
  rootScreen(id: string): DesignNode | undefined;
  nodesExcluding(id: string): DesignNode[];
  studioExportNodes(): DesignNode[];
  repeatTemplateForOrAncestorOf(id: string): DesignNode | undefined;

  // Geometry / interaction.
  moveNode(id: string, x: number, y: number): void;
  moveSelectedNode(x: number, y: number): void;
  resizeSelectedNode(x: number, y: number, width: number, height: number): void;
  clampedPositionForMove(nodeId: string, proposedX: number, proposedY: number): Point;
  reparentNode(id: string, targetId: string): void;
  canReparentNode(id: string, targetId: string): boolean;
  hitTestChain(point: Point): string[];
  hitTestNodeId(point: Point, mode?: CanvasHitMode): string | undefined;
  groupResizeStart(): GroupResizeStart | undefined;
  applyGroupResize(
    handle: ResizeHandle,
    translation: Size,
    startFrames: Record<string, Rect>,
    startBounds: Rect,
    uniform: boolean,
  ): void;

  // Editing.
  updateSelectedNode(update: (node: DesignNode) => void): void;
  updateSelectedNodeAndRelayout(update: (node: DesignNode) => void): void;
  updateSelectedNodes(update: (node: DesignNode) => void): void;
  updateSelectedNodesAndRelayout(update: (node: DesignNode) => void): void;
  setSelectedImageSource(source: string): void;
  duplicateSelection(): void;
  copySelection(): void;
  cutSelection(): void;
  pasteSelection(): void;
  nudgeSelection(deltaX: number, deltaY: number): void;
  bringSelectionToFront(): void;
  sendSelectionToBack(): void;

  // Creation.
  addTextNode(): void;
  addButtonNode(): void;
  addInputNode(): void;
  addScreenNode(preset?: DevicePreset): void;
  addDeviceFrame(preset: DevicePreset): void;
  addFrameNode(): void;
  addArtboard(name: string, width: number, height: number, fill?: string): void;
  addMizmorLetodahArtboard(): void;
  addMizmorShapeArtboard(): void;
  addStudioText(): void;
  addStudioShape(name: string, fill: string, cornerRadius: number): void;
  addImageNode(): void;
  /** `addImageNode(source:name:)` */
  addImageNodeWithSource(source: string | undefined, name?: string): void;
  addIconNode(): void;

  // Agent pipelines.
  makeAgentContext(userPrompt: string): AgentContext;
  applyDesignActions(actions: DesignAction[]): Record<string, string>;
  applyDesignActionsExactly(actions: DesignAction[]): Record<string, string>;

  // Logic simulation bridge.
  nodeForSimulation(id: string): DesignNode | undefined;
  simulateUpdateNode(id: string, update: (node: DesignNode) => void): void;
  snapshotNodesForSimulation(): DesignNode[];
  restoreNodesFromSimulation(nodes: DesignNode[]): void;
  setLogicBinding(nodeId: string, kind: NodeLogicBindingKind, variableName: string | undefined): void;

  // Generated art.
  currentArtReferenceImagePaths(limit?: number): Promise<string[]>;
  setGeneratedImage(nodeId: string, imagePath: string): void;

  // Text hugging & clipping.
  fitTextNodeToContent(id: string): boolean;
  hugTextBoxIfEnabled(id: string): void;
  fitTextNodesToContent(parentId: string | undefined): number;
  /** `clipRoundedContainers(in:)` applied to the current page. */
  clipRoundedContainersInCurrentPage(): void;

  // Components.
  saveSelectionAsComponent(name: string, category?: string): Promise<SavedComponent | undefined>;
  insertComponent(component: SavedComponent, at?: Point): string;

  // Alignment / distribution.
  alignChildren(parentId: string, alignment: CanvasStudioAlignment): void;
  distributeChildren(parentId: string, axis: CanvasStudioDistributionAxis): void;
  alignSelection(alignment: CanvasStudioAlignment): void;
  distributeSelection(axis: CanvasStudioDistributionAxis): void;

  // Running app preset
  loadRunningApp(): void;
}

export type ProjectStore = ProjectStoreState & ProjectStoreActions;

type Draft = ProjectStore;

// MARK: - Initial document (`ProjectViewModel.init()`)

export function makeRunningAppProject(): DesignProject {
  try {
    const project = decodeDesignProject(starterProjectJson);
    if (project && project.pages.length > 0) {
      if (autoHugTextBoxes()) {
        for (const page of project.pages) {
          hugTextBoxesToContent(page.nodes);
        }
      }
      return project;
    }
  } catch (err) {
    console.error('Failed to decode starterProjectJson:', err);
  }
  return makeStarterProject();
}

export function makeStarterProject(): DesignProject {
  const titleNode = makeDesignNode({
    id: newUUID(),
    type: 'Text',
    name: 'Title',
    x: 32,
    y: 80,
    width: 260,
    height: 44,
    text: 'Welcome Back',
    style: makeNodeStyle({ fill: '#FFFFFF', cornerRadius: 0, opacity: 1.0, fontSize: 32 }),
    children: [],
  });

  const loginButton = makeDesignNode({
    id: newUUID(),
    type: 'Button',
    name: 'Login Button',
    x: 32,
    y: 680,
    width: 326,
    height: 56,
    text: 'Log In',
    style: makeNodeStyle({
      fill: '#2563EB',
      cornerRadius: 14,
      opacity: 1.0,
      fontSize: 16,
      textColor: '#FFFFFF',
    }),
    children: [],
  });

  const loginFrame = makeDesignNode({
    id: newUUID(),
    type: 'Frame',
    name: 'Login Screen',
    x: 100,
    y: 100,
    width: 390,
    height: 844,
    style: makeNodeStyle({ fill: '#111827', stroke: '#3B82F6', cornerRadius: 24, opacity: 1.0 }),
    children: [titleNode, loginButton],
  });

  const project = makeDesignProject({
    name: 'Untitled Project',
    pages: [makeDesignPage({ id: newUUID(), name: 'App Screens', nodes: [loginFrame] })],
  });

  if (autoHugTextBoxes()) {
    for (const page of project.pages) {
      hugTextBoxesToContent(page.nodes);
    }
  }

  return project;
}

// MARK: - Helpers over the immer draft

/** `selectedNodeId`'s `didSet` — keeps the multi-selection set consistent. */
function assignSelectedNodeId(draft: Draft, id: string | undefined): void {
  draft.selectedNodeId = id;
  if (id !== undefined) {
    if (!draft.selectedNodeIds.has(id)) {
      draft.selectedNodeIds = new Set<string>([id]);
    }
  } else if (draft.selectedNodeIds.size > 0) {
    draft.selectedNodeIds.clear();
  }
}

function safePageIndex(project: DesignProject, currentPageIndex: number): number {
  return Math.max(0, Math.min(currentPageIndex, project.pages.length - 1));
}

function currentPageOf(state: Pick<ProjectStoreState, 'project' | 'currentPageIndex'>): DesignPage {
  return state.project.pages[safePageIndex(state.project, state.currentPageIndex)];
}

/** `project.pages[currentPageIndex].nodes` — the Swift code indexes directly. */
function currentNodes(draft: Draft): DesignNode[] {
  return draft.project.pages[draft.currentPageIndex].nodes;
}

function normalizationContextOf(draft: Draft): NormalizationContext {
  return {
    currentAgentRequestIntent: draft.currentAgentRequestIntent,
    currentAgentPresentationMode: draft.currentAgentPresentationMode,
    currentAgentUserPrompt: draft.currentAgentUserPrompt,
  };
}

function actionContextOf(draft: Draft): ActionContext {
  return {
    nodes: currentNodes(draft),
    pages: draft.project.pages,
    get selectedNodeId(): string | undefined {
      return draft.selectedNodeId;
    },
    setSelectedNodeId(id: string | undefined) {
      assignSelectedNodeId(draft, id);
    },
    get currentAgentRequestIntent(): AgentRequestIntent {
      return draft.currentAgentRequestIntent;
    },
    get currentAgentStylePreset(): VisualStylePreset {
      return draft.currentAgentStylePreset;
    },
    get shouldAutoParentUnreferencedAgentActions(): boolean {
      return draft.shouldAutoParentUnreferencedAgentActions;
    },
    get allowsRootScreenDeletion(): boolean {
      return draft.allowsRootScreenDeletion;
    },
  };
}

/** `resolveLayoutForCurrentPage()` */
function resolveLayoutForCurrentPage(draft: Draft): void {
  applyAutoLayoutToNodes(currentNodes(draft));
  applyPaddingBoundsInNodes(currentNodes(draft));
  applyConstraintsInNodes(currentNodes(draft));
}

/**
 * `runNormalizationPass(_:_:)` — logging which pass mutated the scene makes
 * "why does the result look different from the actions" debuggable.
 */
function runNormalizationPass(draft: Draft, name: string, body: () => void): void {
  const before = JSON.stringify(currentNodes(draft));
  body();
  const after = JSON.stringify(currentNodes(draft));

  if (before !== after) {
    console.log(`🔧 post-pass '${name}' modified the scene graph`);
  }
}

/** `parentGlobalOrigin(of:)` — where a node's parent sits in canvas coordinates. */
function parentGlobalOrigin(nodes: readonly DesignNode[], id: string): Point {
  const parent = parentNode(id, nodes);
  if (!parent) return { x: 0, y: 0 };
  const rect = findGlobalRect(parent.id, nodes, { x: 0, y: 0 });
  if (!rect) return { x: 0, y: 0 };
  return { x: rect.x, y: rect.y };
}

function cloneProject(project: DesignProject): DesignProject {
  return JSON.parse(JSON.stringify(project)) as DesignProject;
}

// MARK: - Store

export const useProjectStore = create<ProjectStore>()(
  immer((set, get) => ({
    project: makeStarterProject(),
    selectedNodeId: undefined,
    selectedNodeIds: new Set<string>(),
    canvasFocusRequest: undefined,
    currentPageIndex: 0,
    undoStack: [],
    redoStack: [],

    currentAgentStylePreset: 'minimalEditorial',
    currentAgentRequestIntent: 'createNewDesign',
    currentAgentPresentationMode: 'appScreen',
    currentAgentUserPrompt: '',
    shouldAutoParentUnreferencedAgentActions: true,
    allowsRootScreenDeletion: false,
    clipboard: [],

    // MARK: Computed

    /** העמוד הנוכחי — מאובטח מפני out-of-bounds */
    currentPage() {
      return currentPageOf(get());
    },

    selectedNode() {
      const { selectedNodeId } = get();
      if (selectedNodeId === undefined) return undefined;
      return findNode(selectedNodeId, currentPageOf(get()).nodes);
    },

    // מחזיר את ה־id של ה־Node הנבחר רק אם הוא יכול להכיל children
    selectedContainerNodeId() {
      const selected = get().selectedNode();
      if (!selected) return undefined;

      switch (selected.type) {
        case 'Frame':
          return selected.id;
        case 'Text':
        case 'Rectangle':
        case 'Button':
        case 'Input':
        case 'Image':
        case 'Icon':
          return undefined;
      }
    },

    // מחזיר Container מתאים ל-Agent גם כשלא בחרנו Frame ידנית
    agentContainerNodeId() {
      const state = get();
      const container = state.selectedContainerNodeId();
      if (container !== undefined) return container;

      const { selectedNodeId } = state;
      if (selectedNodeId !== undefined) {
        const parent = parentNode(selectedNodeId, currentPageOf(state).nodes);
        if (parent && parent.type === 'Frame') return parent.id;
      }

      return firstFrameNodeId(currentPageOf(state).nodes);
    },

    // המסגרת הגלובלית של ה־Node הנבחר בקנבס
    selectedNodeGlobalRect() {
      const { selectedNodeId } = get();
      if (selectedNodeId === undefined) return undefined;
      return get().globalRect(selectedNodeId);
    },

    /** The box around EVERY selected node. */
    selectionGlobalRect() {
      const state = get();
      const rects = [...state.selectedNodeIds]
        .map((id) => state.globalRect(id))
        .filter((rect): rect is Rect => rect !== undefined);
      const first = rects[0];
      if (first === undefined) return state.selectedNodeGlobalRect();
      return rects.slice(1).reduce((accumulated, rect) => rectUnion(accumulated, rect), first);
    },

    /** Binding ישיר לתוך ה-node הנבחר — מונע stale snapshot ורצד ב-SelectionOverlay */
    selectedNodeBinding() {
      const state = get();
      const { selectedNodeId } = state;
      if (selectedNodeId === undefined) return undefined;
      if (state.project.pages.length === 0) return undefined;
      const pageIndex = 0;
      const nodeIndex = state.project.pages[pageIndex].nodes.findIndex((node) => node.id === selectedNodeId);
      if (nodeIndex < 0) return undefined;

      return {
        get: () => get().project.pages[pageIndex].nodes[nodeIndex],
        set: (node: DesignNode) => {
          set((draft) => {
            draft.project.pages[pageIndex].nodes[nodeIndex] = cloneNode(node);
          });
        },
      };
    },

    // MARK: Pages & document

    selectPage(index) {
      set((draft) => {
        if (index >= draft.project.pages.length) return;
        draft.currentPageIndex = index;
        assignSelectedNodeId(draft, undefined);
      });
    },

    // MARK: - Undo / Redo

    snapshot() {
      set((draft) => {
        draft.undoStack.push(draft.project);
        draft.redoStack.length = 0;
        if (draft.undoStack.length > 50) draft.undoStack.shift(); // Keep last 50 states
      });
    },

    undo() {
      set((draft) => {
        const prev = draft.undoStack.pop();
        if (prev === undefined) return;
        draft.redoStack.push(draft.project);
        draft.project = prev;
        assignSelectedNodeId(draft, undefined);
      });
    },

    redo() {
      set((draft) => {
        const next = draft.redoStack.pop();
        if (next === undefined) return;
        draft.undoStack.push(draft.project);
        draft.project = next;
        assignSelectedNodeId(draft, undefined);
      });
    },

    replaceProject(newProject) {
      set((draft) => {
        draft.project = cloneProject(newProject);
        // Projects saved before hugging existed (and templates) arrive full of
        // text frames far wider than their words.
        if (autoHugTextBoxes()) {
          for (const page of draft.project.pages) {
            hugTextBoxesToContent(page.nodes);
          }
        }
        // Projects saved before clipping existed carry cards whose artwork
        // bleeds past the corner radius.
        for (const page of draft.project.pages) {
          clipRoundedContainers(page.nodes);
        }
        draft.currentPageIndex =
          draft.project.pages.length === 0 ? 0 : Math.min(draft.currentPageIndex, draft.project.pages.length - 1);
        assignSelectedNodeId(draft, undefined);
        draft.undoStack.length = 0;
        draft.redoStack.length = 0;
      });
    },

    mutateProject(update) {
      set((draft) => {
        update(draft.project);
      });
    },

    // ─── Page management (ממשק ציבורי) ───────────────────────────────

    addPage(name = 'New Page') {
      get().snapshot();
      set((draft) => {
        draft.project.pages.push(makeDesignPage({ id: newUUID(), name, nodes: [] }));
      });
    },

    deletePage(index) {
      const state = get();
      if (!(state.project.pages.length > 1 && index < state.project.pages.length)) return;
      state.snapshot();
      set((draft) => {
        draft.project.pages.splice(index, 1);
        if (draft.currentPageIndex >= draft.project.pages.length) {
          draft.currentPageIndex = draft.project.pages.length - 1;
        }
      });
    },

    renamePage(index, name) {
      set((draft) => {
        if (index >= draft.project.pages.length) return;
        draft.project.pages[index].name = name;
      });
    },

    // MARK: Selection

    selectNode(id) {
      set((draft) => {
        draft.selectedNodeIds = new Set<string>([id]);
        assignSelectedNodeId(draft, id);
      });
    },

    selectAndRevealNode(id) {
      get().selectNode(id);
      set((draft) => {
        draft.canvasFocusRequest = makeCanvasFocusRequest(id);
      });
    },

    // Shift-click: adds the node to the selection, or removes it when it is
    // already selected. The primary selection follows the last click.
    toggleNodeInSelection(id) {
      set((draft) => {
        if (draft.selectedNodeIds.has(id)) {
          draft.selectedNodeIds.delete(id);
          if (draft.selectedNodeId === id) {
            const first = draft.selectedNodeIds.values().next();
            assignSelectedNodeId(draft, first.done ? undefined : first.value);
          }
        } else {
          draft.selectedNodeIds.add(id);
          assignSelectedNodeId(draft, id);
        }
      });
    },

    clearSelection() {
      set((draft) => {
        assignSelectedNodeId(draft, undefined);
      });
    },

    selectNodes(rect, extending = false) {
      const state = get();
      const selectionRect = rectStandardized(rect);
      if (!(selectionRect.width > 0 && selectionRect.height > 0)) {
        if (!extending) state.clearSelection();
        return;
      }

      const pageNodes = currentPageOf(state).nodes;
      const isScreenRoot = (node: DesignNode): boolean =>
        node.type === 'Frame' && pageNodes.some((root) => root.id === node.id);

      const matches: string[] = [];
      collectMarqueeSelectableNodes(pageNodes, { x: 0, y: 0 }, selectionRect, matches, isScreenRoot);

      set((draft) => {
        if (extending) {
          const updatedSelection = new Set<string>(draft.selectedNodeIds);
          for (const id of matches) updatedSelection.add(id);
          draft.selectedNodeIds = updatedSelection;
          if (draft.selectedNodeId === undefined) {
            const first = matches[0] ?? draft.selectedNodeIds.values().next().value;
            draft.selectedNodeId = first;
          }
        } else {
          draft.selectedNodeIds = new Set<string>(matches);
          draft.selectedNodeId = matches[0];
        }
      });
    },

    /**
     * A marquee starts only from the stage — a screen's own background, or a
     * decorative backdrop.
     */
    shouldBeginMarqueeSelection(id) {
      const state = get();
      const node = state.node(id);
      if (!node) return false;
      const isScreenRoot =
        node.type === 'Frame' && currentPageOf(state).nodes.some((root) => root.id === node.id);
      return isScreenRoot || isMarqueePassthroughNode(node);
    },

    safeDeleteSelectedNode() {
      // Prevent deleting when typing in a text field (the AppKit firstResponder
      // check becomes the DOM's active element).
      const doc = (globalThis as { document?: { activeElement?: { tagName?: string; isContentEditable?: boolean } } })
        .document;
      const active = doc?.activeElement;
      const tag = active?.tagName?.toLowerCase();
      const isFocused = tag === 'input' || tag === 'textarea' || active?.isContentEditable === true;
      if (!isFocused) {
        get().deleteSelectedNode();
      }
    },

    // מוחק את ה־Node הנבחר מכל מקום בעץ — וכשיש בחירה מרובה, את כולם.
    deleteSelectedNode() {
      const state = get();
      const idsToDelete =
        state.selectedNodeIds.size === 0
          ? [state.selectedNodeId].filter((id): id is string => id !== undefined)
          : [...state.selectedNodeIds];
      if (idsToDelete.length === 0) return;
      state.snapshot();

      set((draft) => {
        for (const id of idsToDelete) {
          deleteNodeFromTree(id, currentNodes(draft));
        }
        assignSelectedNodeId(draft, undefined);
      });
    },

    // MARK: Lookup

    node(id) {
      return findNode(id, currentPageOf(get()).nodes);
    },

    // Public parent lookup — shift-drag snapping aligns a node to the center
    // line of its parent in the tree.
    parentOfNode(id) {
      return parentNode(id, currentPageOf(get()).nodes);
    },

    isRootNode(id) {
      return currentPageOf(get()).nodes.some((node) => node.id === id);
    },

    globalRect(id) {
      return findGlobalRect(id, currentPageOf(get()).nodes, { x: 0, y: 0 });
    },

    /** The top-level screen frame that contains `id` (itself or any descendant). */
    rootScreen(id) {
      return currentPageOf(get()).nodes.find((node) => findNode(id, [node]) !== undefined);
    },

    // מחזיר את כל ה־Nodes חוץ מה־Node שקיבלנו
    nodesExcluding(id) {
      return currentPageOf(get()).nodes.filter((node) => node.id !== id);
    },

    studioExportNodes() {
      const state = get();
      const { selectedNodeId } = state;
      const pageNodes = currentPageOf(state).nodes;
      const selected = selectedNodeId !== undefined ? findNode(selectedNodeId, pageNodes) : undefined;
      if (selectedNodeId === undefined || !selected) {
        return pageNodes;
      }

      if (selected.type === 'Frame') {
        return [selected];
      }

      const parent = parentNode(selectedNodeId, pageNodes);
      if (parent && parent.type === 'Frame') {
        return [parent];
      }

      return [selected];
    },

    /**
     * The repeat-list template that owns `id` — `id`'s node if it is itself a
     * template, otherwise its nearest ancestor carrying a repeatBinding.
     */
    repeatTemplateForOrAncestorOf(id) {
      const search = (nodes: readonly DesignNode[], ancestorTemplate: DesignNode | undefined): DesignNode | undefined => {
        for (const node of nodes) {
          const template = node.repeatBinding !== undefined ? node : ancestorTemplate;
          if (node.id === id) return template;
          const found = search(node.children, template);
          if (found) return found;
        }
        return undefined;
      };
      return search(get().project.pages[get().currentPageIndex].nodes, undefined);
    },

    // MARK: Geometry / interaction

    // Moves any node by id — used for group drags where several selected nodes
    // move together by the same delta.
    moveNode(id, x, y) {
      set((draft) => {
        updateNode(id, currentNodes(draft), (node) => {
          node.x = x;
          node.y = y;
          delete node.constraints;
          node.manuallyPositioned = true;
        });
      });
    },

    moveSelectedNode(x, y) {
      get().updateSelectedNode((node) => {
        node.x = x;
        node.y = y;
        // A hand-placed position must survive layout resolves.
        delete node.constraints;
        node.manuallyPositioned = true;
      });
    },

    resizeSelectedNode(x, y, width, height) {
      get().updateSelectedNode((node) => {
        node.x = x;
        node.y = y;
        node.width = Math.max(1, width);
        node.height = Math.max(1, height);
      });
    },

    clampedPositionForMove(nodeId, proposedX, proposedY) {
      const state = get();
      const pageNodes = currentPageOf(state).nodes;
      const node = findNode(nodeId, pageNodes);
      const parent = parentNode(nodeId, pageNodes);
      if (!node || !parent) {
        return { x: proposedX, y: proposedY };
      }

      const maxX = Math.max(0, parent.width - node.width);
      const maxY = Math.max(0, parent.height - node.height);

      return {
        x: Math.min(Math.max(proposedX, 0), maxX),
        y: Math.min(Math.max(proposedY, 0), maxY),
      };
    },

    reparentNode(id, targetId) {
      const state = get();
      const pageNodes = currentPageOf(state).nodes;
      const currentGlobalRect = findGlobalRect(id, pageNodes, { x: 0, y: 0 });
      const movingNode = findNode(id, pageNodes);
      const targetGlobalRect = findGlobalRect(targetId, pageNodes, { x: 0, y: 0 });
      if (
        !currentGlobalRect ||
        !movingNode ||
        targetId === id ||
        findNode(targetId, movingNode.children) !== undefined ||
        !targetGlobalRect
      ) {
        return;
      }

      state.snapshot();
      set((draft) => {
        const nodeToMove = removeNode(id, currentNodes(draft));
        if (!nodeToMove) return;

        nodeToMove.x = currentGlobalRect.x - targetGlobalRect.x;
        nodeToMove.y = currentGlobalRect.y - targetGlobalRect.y;

        updateNode(targetId, currentNodes(draft), (target) => {
          const maxX = Math.max(0, target.width - nodeToMove.width);
          const maxY = Math.max(0, target.height - nodeToMove.height);

          nodeToMove.x = Math.min(Math.max(nodeToMove.x, 0), maxX);
          nodeToMove.y = Math.min(Math.max(nodeToMove.y, 0), maxY);

          target.children.push(nodeToMove);
        });

        assignSelectedNodeId(draft, id);
      });
    },

    canReparentNode(id, targetId) {
      const movingNode = get().node(id);
      if (!movingNode) return false;
      return id !== targetId && findNode(targetId, movingNode.children) === undefined;
    },

    hitTestChain(point) {
      const state = get();
      return hitTestChainIn(currentPageOf(state).nodes, point, state.selectedNodeId);
    },

    hitTestNodeId(point, mode = 'smart') {
      const state = get();
      const chain = state.hitTestChain(point);
      return hitTestNodeIdInChain(chain, mode, state.selectedNodeId);
    },

    // MARK: - Group resize

    /**
     * Every selected node's global frame, plus their union — captured once when
     * a resize drag starts.
     */
    groupResizeStart() {
      const state = get();
      const frames: Record<string, Rect> = {};
      for (const id of state.selectedNodeIds) {
        const rect = state.globalRect(id);
        if (!rect) continue;
        frames[id] = rect;
      }
      const values = Object.values(frames);
      const first = values[0];
      if (first === undefined) return undefined;
      const bounds = values.reduce((accumulated, rect) => rectUnion(accumulated, rect), first);
      return { frames, bounds };
    },

    /**
     * Scales the whole selection as one object: each node keeps its position
     * and size RELATIVE to the group's bounding box.
     */
    applyGroupResize(handle, translation, startFrames, startBounds, uniform) {
      const minSize = 24;
      let dx = translation.width;
      let dy = translation.height;

      const affectsHorizontally = resizeHandleAffectsHorizontally(handle);
      const affectsVertically = resizeHandleAffectsVertically(handle);
      const horizontalSign = resizeHandleHorizontalSign(handle);
      const verticalSign = resizeHandleVerticalSign(handle);

      if (uniform) {
        // One factor for both axes — the drag's dominant direction wins.
        const sx = affectsHorizontally
          ? (startBounds.width + dx * horizontalSign) / Math.max(startBounds.width, 1)
          : 1;
        const sy = affectsVertically
          ? (startBounds.height + dy * verticalSign) / Math.max(startBounds.height, 1)
          : 1;
        const scale =
          affectsHorizontally && affectsVertically
            ? Math.abs(dx) > Math.abs(dy)
              ? sx
              : sy
            : affectsHorizontally
              ? sx
              : sy;
        dx = affectsHorizontally ? (startBounds.width * scale - startBounds.width) * horizontalSign : 0;
        dy = affectsVertically ? (startBounds.height * scale - startBounds.height) * verticalSign : 0;
        // Corner handles scale both axes even if the drag was mostly one way.
        if (affectsHorizontally && affectsVertically) {
          dx = (startBounds.width * scale - startBounds.width) * horizontalSign;
          dy = (startBounds.height * scale - startBounds.height) * verticalSign;
        }
      }

      const newBounds: Rect = { ...startBounds };
      if (affectsHorizontally) {
        const width = Math.max(minSize, startBounds.width + dx * horizontalSign);
        newBounds.width = width;
        if (resizeHandleAnchorsRight(handle)) newBounds.x = startBounds.x + startBounds.width - width;
      }
      if (affectsVertically) {
        const height = Math.max(minSize, startBounds.height + dy * verticalSign);
        newBounds.height = height;
        if (resizeHandleAnchorsBottom(handle)) newBounds.y = startBounds.y + startBounds.height - height;
      }

      const scaleX = newBounds.width / Math.max(startBounds.width, 1);
      const scaleY = newBounds.height / Math.max(startBounds.height, 1);

      set((draft) => {
        for (const [id, start] of Object.entries(startFrames)) {
          // Position and size scale about the group's box, not each node's.
          const globalX = newBounds.x + (start.x - startBounds.x) * scaleX;
          const globalY = newBounds.y + (start.y - startBounds.y) * scaleY;
          const width = Math.max(1, start.width * scaleX);
          const height = Math.max(1, start.height * scaleY);

          // Back to the node's own parent space.
          const parentOrigin = parentGlobalOrigin(currentNodes(draft), id);
          updateNode(id, currentNodes(draft), (node) => {
            node.x = globalX - parentOrigin.x;
            node.y = globalY - parentOrigin.y;
            node.width = width;
            node.height = height;
            delete node.constraints;
            node.manuallyPositioned = true;
          });
        }
      });
    },

    // MARK: Editing

    // מעדכן את ה־Node הנבחר, גם אם הוא נמצא בתוך children
    updateSelectedNode(update) {
      set((draft) => {
        if (draft.selectedNodeId === undefined) return;
        updateNode(draft.selectedNodeId, currentNodes(draft), update);
      });
    },

    updateSelectedNodeAndRelayout(update) {
      get().updateSelectedNode(update);
      set((draft) => {
        resolveLayoutForCurrentPage(draft);
      });
    },

    /**
     * Applies a style/content edit to every node in the multi-selection.
     * Geometry edits intentionally keep using `updateSelectedNode`.
     */
    updateSelectedNodes(update) {
      set((draft) => {
        const targets =
          draft.selectedNodeIds.size === 0
            ? [draft.selectedNodeId].filter((id): id is string => id !== undefined)
            : [...draft.selectedNodeIds];
        for (const id of targets) {
          updateNode(id, currentNodes(draft), update);
        }
      });
    },

    updateSelectedNodesAndRelayout(update) {
      get().updateSelectedNodes(update);
      set((draft) => {
        resolveLayoutForCurrentPage(draft);
      });
    },

    setSelectedImageSource(source) {
      get().updateSelectedNodeAndRelayout((node) => {
        node.imageName = source;
        node.imageSource = source;
      });
    },

    duplicateSelection() {
      const state = get();
      const idsToDuplicate =
        state.selectedNodeIds.size === 0
          ? [state.selectedNodeId].filter((id): id is string => id !== undefined)
          : [...state.selectedNodeIds];
      if (idsToDuplicate.length === 0) return;

      state.snapshot();
      set((draft) => {
        const newIds: string[] = [];
        for (const id of idsToDuplicate) {
          const newId = duplicateNode(id, currentNodes(draft));
          if (newId !== undefined) newIds.push(newId);
        }

        const first = newIds[0];
        if (first !== undefined) {
          draft.selectedNodeIds = new Set<string>(newIds);
          draft.selectedNodeId = first;
        }
      });
    },

    copySelection() {
      const state = get();
      const ids =
        state.selectedNodeIds.size === 0
          ? [state.selectedNodeId].filter((id): id is string => id !== undefined)
          : [...state.selectedNodeIds];
      if (ids.length === 0) return;
      const copied: DesignNode[] = [];
      for (const id of ids) {
        const found = findNode(id, currentPageOf(state).nodes);
        if (found) copied.push(cloneNode(found));
      }
      set((draft) => {
        draft.clipboard = copied;
      });
    },

    cutSelection() {
      get().copySelection();
      get().safeDeleteSelectedNode();
    },

    pasteSelection() {
      const state = get();
      if (state.clipboard.length === 0) return;
      state.snapshot();
      set((draft) => {
        const newIds: string[] = [];
        const pageNodes = currentNodes(draft);
        for (const item of state.clipboard) {
          const fresh = cloneNode(item);
          assignFreshIds(fresh);
          fresh.name += ' Copy';
          fresh.x += 20;
          fresh.y += 20;
          fresh.manuallyPositioned = true;
          pageNodes.push(fresh);
          newIds.push(fresh.id);
        }
        if (newIds.length > 0) {
          draft.selectedNodeIds = new Set<string>(newIds);
          draft.selectedNodeId = newIds[0];
        }
      });
    },

    nudgeSelection(deltaX, deltaY) {
      const state = get();
      const ids =
        state.selectedNodeIds.size === 0
          ? [state.selectedNodeId].filter((id): id is string => id !== undefined)
          : [...state.selectedNodeIds];
      if (ids.length === 0) return;
      state.snapshot();
      set((draft) => {
        for (const id of ids) {
          const n = findNode(id, currentNodes(draft));
          if (n) {
            n.x += deltaX;
            n.y += deltaY;
            n.manuallyPositioned = true;
          }
        }
      });
    },

    bringSelectionToFront() {
      layerSelection(get(), set, true);
    },

    sendSelectionToBack() {
      layerSelection(get(), set, false);
    },

    // MARK: Creation

    addTextNode() {
      const state = get();
      state.snapshot();
      const newNode = makeDesignNode({
        id: newUUID(),
        type: 'Text',
        name: 'Text',
        x: 160,
        y: 160,
        width: 220,
        height: 40,
        text: 'New Text',
        style: makeNodeStyle({ fill: '#000000', cornerRadius: 0, opacity: 1.0, fontSize: 24 }),
        children: [],
      });

      set((draft) => {
        currentNodes(draft).push(newNode);
        assignSelectedNodeId(draft, newNode.id);
      });
      // The 220x40 default box is much wider than "New Text": hug it now.
      get().hugTextBoxIfEnabled(newNode.id);
    },

    addButtonNode() {
      const state = get();
      state.snapshot();
      const newNode = makeDesignNode({
        id: newUUID(),
        type: 'Button',
        name: 'Button',
        x: 160,
        y: 230,
        width: 160,
        height: 48,
        text: 'Click me',
        style: makeNodeStyle({ fill: '#2563EB', cornerRadius: 12, opacity: 1.0, fontSize: 16 }),
        children: [],
      });

      set((draft) => {
        currentNodes(draft).push(newNode);
        assignSelectedNodeId(draft, newNode.id);
      });
    },

    addInputNode() {
      const state = get();
      state.snapshot();
      const newNode = makeDesignNode({
        id: newUUID(),
        type: 'Input',
        name: 'Input Field',
        x: 160,
        y: 290,
        width: 280,
        height: 48,
        text: 'Enter text...',
        style: makeNodeStyle({
          fill: '#1A1D24',
          stroke: '#374151',
          strokeWidth: 1,
          cornerRadius: 10,
          opacity: 1.0,
          fontSize: 15,
          textColor: '#9CA3AF',
          paddingLeft: 14,
          paddingRight: 14,
        }),
        children: [],
      });

      set((draft) => {
        currentNodes(draft).push(newNode);
        assignSelectedNodeId(draft, newNode.id);
      });
    },

    addScreenNode(preset) {
      const state = get();
      state.snapshot();
      const page = currentPageOf(state);
      const rootScreens = page.nodes.filter((n) => n.type === 'Frame');
      let nextX = 80;
      if (rootScreens.length > 0) {
        let maxRight = 0;
        for (const s of rootScreens) {
          const right = s.x + s.width;
          if (right > maxRight) maxRight = right;
        }
        nextX = maxRight + 60;
      }
      const device = preset ?? DevicePresetLibrary.iPhone15Pro;
      const screenIndex = rootScreens.length + 1;
      const newNode = makeDesignNode({
        id: newUUID(),
        type: 'Frame',
        name: `Screen ${screenIndex}`,
        x: nextX,
        y: 80,
        width: device.width,
        height: device.height,
        style: makeNodeStyle({
          fill: '#0B0D12',
          stroke: '#1E232F',
          strokeWidth: 1,
          cornerRadius: device.cornerRadius,
          opacity: 1.0,
        }),
        devicePresetId: device.id,
        clipContent: true,
        children: [],
      });

      set((draft) => {
        currentNodes(draft).push(newNode);
        assignSelectedNodeId(draft, newNode.id);
      });
    },

    addDeviceFrame(preset) {
      const state = get();
      state.snapshot();
      const newNode = makeDesignNode({
        id: newUUID(),
        type: 'Frame',
        name: preset.name,
        x: 120,
        y: 120,
        width: preset.width,
        height: preset.height,
        style: makeNodeStyle({
          fill: '#FFFFFF',
          stroke: '#E5E7EB',
          cornerRadius: preset.cornerRadius,
          opacity: 1.0,
        }),
        devicePresetId: preset.id,
        children: [],
      });

      set((draft) => {
        currentNodes(draft).push(newNode);
        assignSelectedNodeId(draft, newNode.id);
      });
    },

    addFrameNode() {
      const state = get();
      state.snapshot();
      const newNode = makeDesignNode({
        id: newUUID(),
        type: 'Frame',
        name: 'Frame',
        x: 120,
        y: 120,
        width: 390,
        height: 844,
        style: makeNodeStyle({ fill: '#111827', stroke: '#3B82F6', cornerRadius: 24, opacity: 1.0 }),
        children: [],
      });

      set((draft) => {
        currentNodes(draft).push(newNode);
        assignSelectedNodeId(draft, newNode.id);
      });
    },

    addArtboard(name, width, height, fill = '#FFFFFF') {
      const state = get();
      state.snapshot();
      const offset = currentPageOf(state).nodes.filter((node) => node.type === 'Frame').length * 48;
      const newNode = makeDesignNode({
        id: newUUID(),
        type: 'Frame',
        name,
        x: 120 + offset,
        y: 100 + offset,
        width: Math.max(1, width),
        height: Math.max(1, height),
        style: makeNodeStyle({
          fill,
          stroke: '#D1D5DB',
          strokeWidth: 1,
          cornerRadius: 0,
          opacity: 1.0,
          shadow: { color: '#0F172A', opacity: 0.12, radius: 20, x: 0, y: 12 },
        }),
        clipContent: true,
        children: [],
      });

      set((draft) => {
        currentNodes(draft).push(newNode);
        assignSelectedNodeId(draft, newNode.id);
      });
    },

    addMizmorLetodahArtboard() {
      const state = get();
      state.snapshot();
      const offset = currentPageOf(state).nodes.filter((node) => node.type === 'Frame').length * 48;
      const backgroundPath = studioAssetPath('mizmor-background-100x180cm-150dpi.png');
      const backgroundNode = makeDesignNode({
        id: newUUID(),
        type: 'Image',
        name: 'Mizmor Background',
        x: 0,
        y: 0,
        width: 1000,
        height: 1800,
        imageName: backgroundPath,
        imageSource: backgroundPath,
        contentMode: 'fill',
        style: makeNodeStyle({ fill: '#FFFDF8', cornerRadius: 0, opacity: 1.0 }),
        clipContent: true,
        zIndex: -100,
        children: [],
      });
      const lineHeight = 125;
      const textNodes = mizmorLetodahLines.map((line, index) =>
        makeDesignNode({
          id: newUUID(),
          type: 'Text',
          name: `Mizmor Letodah Line ${index + 1}`,
          x: 70,
          y: 90 + index * lineHeight,
          width: 860,
          height: 110,
          text: line,
          style: makeNodeStyle({
            fill: '#111827',
            cornerRadius: 0,
            opacity: 1.0,
            fontSize: 56,
            fontWeight: 'regular',
            fontFamily: 'Arial Hebrew',
            textColor: '#111827',
            textAlign: 'right',
            letterSpacing: 0,
            lineHeight,
          }),
          zIndex: 10,
          textBehavior: { wrap: false, autoHeight: false, maxLines: 1, truncate: false },
          children: [],
        }),
      );

      const artboard = makeDesignNode({
        id: newUUID(),
        type: 'Frame',
        name: 'Mizmor Letodah 100x180cm',
        x: 120 + offset,
        y: 100 + offset,
        width: 1000,
        height: 1800,
        style: makeNodeStyle({
          fill: '#FFFDF8',
          stroke: '#D8CDBB',
          strokeWidth: 1,
          cornerRadius: 0,
          opacity: 1.0,
          shadow: { color: '#0F172A', opacity: 0.1, radius: 10, x: 0, y: 6 },
        }),
        clipContent: true,
        children: [backgroundNode, ...textNodes],
      });

      set((draft) => {
        currentNodes(draft).push(artboard);
        draft.selectedNodeIds = new Set<string>(textNodes.map((node) => node.id));
        draft.selectedNodeId = textNodes[0]?.id ?? artboard.id;
      });
    },

    /**
     * A blank arch/tombstone-shaped canvas, exactly 100x180cm — the Frame node
     * ITSELF is the arch (archTopRadius = width / 2).
     */
    addMizmorShapeArtboard() {
      const state = get();
      state.snapshot();
      const offset = currentPageOf(state).nodes.filter((node) => node.type === 'Frame').length * 48;

      const artboard = makeDesignNode({
        id: newUUID(),
        type: 'Frame',
        name: 'Mizmor Shape 100x180cm',
        x: 120 + offset,
        y: 100 + offset,
        width: 1000,
        height: 1800,
        style: makeNodeStyle({
          fill: '#FFFFFF',
          stroke: '#D8CDBB',
          strokeWidth: 1,
          cornerRadius: 0,
          opacity: 1.0,
          shadow: { color: '#0F172A', opacity: 0.1, radius: 10, x: 0, y: 6 },
          // Full-width semicircle on top (radius = width / 2), flat bottom.
          archTopRadius: 500,
        }),
        clipContent: true,
        children: [],
      });

      set((draft) => {
        currentNodes(draft).push(artboard);
        assignSelectedNodeId(draft, artboard.id);
      });
    },

    addStudioText() {
      const state = get();
      state.snapshot();
      const newNode = makeDesignNode({
        id: newUUID(),
        type: 'Text',
        name: 'Headline',
        x: 180,
        y: 180,
        width: 360,
        height: 72,
        text: 'Add headline',
        style: makeNodeStyle({
          fill: '#111827',
          cornerRadius: 0,
          opacity: 1.0,
          fontSize: 48,
          fontWeight: 'bold',
          textColor: '#111827',
          textAlign: 'left',
          letterSpacing: 0,
        }),
        textBehavior: { wrap: true, autoHeight: true, truncate: false },
        children: [],
      });

      set((draft) => {
        currentNodes(draft).push(newNode);
        assignSelectedNodeId(draft, newNode.id);
      });
    },

    addStudioShape(name, fill, cornerRadius) {
      const state = get();
      state.snapshot();
      const newNode = makeDesignNode({
        id: newUUID(),
        type: 'Rectangle',
        name,
        x: 180,
        y: 180,
        width: 220,
        height: 160,
        style: makeNodeStyle({ fill, cornerRadius, opacity: 1.0 }),
        children: [],
      });

      set((draft) => {
        currentNodes(draft).push(newNode);
        assignSelectedNodeId(draft, newNode.id);
      });
    },

    // ─── Image & Icon (ממשק ציבורי לtoolbar) ─────────────────────────

    addImageNode() {
      const state = get();
      state.snapshot();
      const newNode = makeDesignNode({
        id: newUUID(),
        type: 'Image',
        name: 'Image',
        x: 160,
        y: 160,
        width: 260,
        height: 180,
        style: makeNodeStyle({ fill: '#1E293B', cornerRadius: 12, opacity: 1.0 }),
        children: [],
      });
      set((draft) => {
        currentNodes(draft).push(newNode);
        assignSelectedNodeId(draft, newNode.id);
      });
    },

    addImageNodeWithSource(source, name = 'Photo') {
      const state = get();
      state.snapshot();
      const newNode = makeDesignNode({
        id: newUUID(),
        type: 'Image',
        name,
        x: 180,
        y: 180,
        width: 360,
        height: 240,
        imageName: source,
        imageSource: source,
        contentMode: 'fill',
        style: makeNodeStyle({ fill: '#E5E7EB', cornerRadius: 0, opacity: 1.0 }),
        children: [],
      });
      set((draft) => {
        currentNodes(draft).push(newNode);
        assignSelectedNodeId(draft, newNode.id);
      });
    },

    addIconNode() {
      const state = get();
      state.snapshot();
      const newNode = makeDesignNode({
        id: newUUID(),
        type: 'Icon',
        name: 'Icon',
        x: 160,
        y: 160,
        width: 48,
        height: 48,
        iconName: 'star',
        style: makeNodeStyle({ fill: '#00000000', cornerRadius: 0, opacity: 1.0, textColor: '#FFFFFF' }),
        children: [],
      });
      set((draft) => {
        currentNodes(draft).push(newNode);
        assignSelectedNodeId(draft, newNode.id);
      });
    },

    // MARK: Agent pipelines

    // בונה Context עבור ה-Agent מתוך מצב הפרויקט הנוכחי
    makeAgentContext(userPrompt) {
      const state = get();
      const result = buildAgentContext(
        userPrompt,
        {
          currentPageNodes: currentPageOf(state).nodes,
          selectedNodeId: state.selectedNodeId,
          agentContainerNodeId: state.agentContainerNodeId(),
        },
        state.currentAgentStylePreset,
      );

      set((draft) => {
        draft.currentAgentUserPrompt = userPrompt;
        draft.currentAgentRequestIntent = result.currentAgentRequestIntent;
        draft.currentAgentPresentationMode = result.currentAgentPresentationMode;
        draft.currentAgentStylePreset = result.currentAgentStylePreset;
      });

      return result.context;
    },

    // מבצע רשימת פעולות עיצוב על הפרויקט
    applyDesignActions(actions) {
      const state = get();
      const actionsToApply = sanitizedActionsForCurrentIntent(
        actions,
        state.currentAgentRequestIntent,
        state.selectedNodeId,
      );
      const shouldRunPostProcessingOnly =
        actionsToApply.length === 0 && state.currentAgentRequestIntent !== 'createNewDesign';
      if (actionsToApply.length === 0 && !shouldRunPostProcessingOnly) return {};

      state.snapshot();
      const temporaryIds: Record<string, string> = {};
      const previousAutoParenting = state.shouldAutoParentUnreferencedAgentActions;

      set((draft) => {
        draft.shouldAutoParentUnreferencedAgentActions = rootScreenActionCount(actionsToApply) <= 1;

        const context = actionContextOf(draft);
        prepareImplicitScreenFrameIfNeeded(context, actionsToApply, temporaryIds);

        for (const action of actionsToApply) {
          applyDesignAction(context, action, temporaryIds);
        }

        const normalizationContext = normalizationContextOf(draft);
        const page = draft.project.pages[draft.currentPageIndex];

        runNormalizationPass(draft, 'normalizeAgentScreenRoots', () => {
          page.nodes = normalizeAgentScreenRoots(
            page.nodes,
            new Set(Object.values(temporaryIds)),
            normalizationContext,
          );
        });
        runNormalizationPass(draft, 'nestLooseRootNodesIntoMobileFrame', () => {
          page.nodes = nestLooseRootNodesIntoMobileFrame(page.nodes, normalizationContext);
        });
        resolveLayoutForCurrentPage(draft);
        runNormalizationPass(draft, 'expandContainersToFitChildren', () => {
          expandContainersToFitChildren(page.nodes);
        });
        runNormalizationPass(draft, 'normalizeMobileScreenLayouts', () => {
          normalizeMobileScreenLayouts(page.nodes);
        });
        runNormalizationPass(draft, 'normalizeNavigationLayouts', () => {
          normalizeNavigationLayouts(page.nodes);
        });
        runNormalizationPass(draft, 'normalizeIconLabelClusterLayouts', () => {
          normalizeIconLabelClusterLayouts(page.nodes);
        });
        runNormalizationPass(draft, 'applyDesignQualityPass', () => {
          applyDesignQualityPass(page.nodes);
        });
        runNormalizationPass(draft, 'repairGeneratedDesignSemantics', () => {
          repairGeneratedDesignSemantics(page.nodes, normalizationContext);
        });
        runNormalizationPass(draft, 'removePromptArtifactText', () => {
          removePromptArtifactText(page.nodes);
        });
        runNormalizationPass(draft, 'repairTextSizing', () => {
          repairTextSizing(page.nodes, undefined);
        });
        runNormalizationPass(draft, 'clipRoundedContainers', () => {
          clipRoundedContainers(page.nodes);
        });
        // Generated text frames arrive far wider than their words.
        if (autoHugTextBoxes()) {
          runNormalizationPass(draft, 'hugTextBoxesToContent', () => {
            hugTextBoxesToContent(page.nodes);
          });
        }
        resolveLayoutForCurrentPage(draft);
        runNormalizationPass(draft, 'repairTextContrast', () => {
          repairTextContrast(page.nodes, '#FFFFFF');
        });

        draft.shouldAutoParentUnreferencedAgentActions = previousAutoParenting;
      });

      return temporaryIds;
    },

    /**
     * Applies actions with exact coordinates — none of the agent-output repair
     * passes run, only text hugging (which never moves the rendered glyphs).
     */
    applyDesignActionsExactly(actions) {
      if (actions.length === 0) return {};

      const state = get();
      state.snapshot();

      // Reference every create action so all created ids can be returned and
      // marked hand-positioned below.
      const preparedActions = actions.map((action, index) =>
        exactCreateTypes.has(action.type) && action.nodeReference === undefined
          ? { ...action, nodeReference: `node${index}` }
          : action,
      );

      const previousIntent = state.currentAgentRequestIntent;
      const previousAutoParenting = state.shouldAutoParentUnreferencedAgentActions;
      const previousRootDeletion = state.allowsRootScreenDeletion;

      const temporaryIds: Record<string, string> = {};

      set((draft) => {
        // .improveExistingCanvas: no forced 390x844 roots, no implicit screen
        // frame, no selection fallback.
        draft.currentAgentRequestIntent = 'improveExistingCanvas';
        draft.shouldAutoParentUnreferencedAgentActions = false;
        draft.allowsRootScreenDeletion = true;

        const context = actionContextOf(draft);
        for (const action of preparedActions) {
          applyDesignAction(context, action, temporaryIds);
        }

        // Hand-positioned semantics: the auto-layout engine skips these nodes.
        markManuallyPositioned(new Set(Object.values(temporaryIds)), currentNodes(draft));

        // Hugging is the one repair this exact-coordinates path still runs.
        if (autoHugTextBoxes()) {
          hugTextBoxesToContent(currentNodes(draft));
        }

        draft.currentAgentRequestIntent = previousIntent;
        draft.shouldAutoParentUnreferencedAgentActions = previousAutoParenting;
        draft.allowsRootScreenDeletion = previousRootDeletion;
      });

      return temporaryIds;
    },

    // MARK: Logic simulation bridge

    // גישה לסימולטור הלוגיקה — קריאה ועדכון של Nodes לפי מזהה
    nodeForSimulation(id) {
      const state = get();
      return findNode(id, state.project.pages[state.currentPageIndex].nodes);
    },

    simulateUpdateNode(id, update) {
      set((draft) => {
        updateNode(id, currentNodes(draft), update);
      });
    },

    snapshotNodesForSimulation() {
      const state = get();
      return state.project.pages[state.currentPageIndex].nodes;
    },

    restoreNodesFromSimulation(nodes) {
      set((draft) => {
        draft.project.pages[draft.currentPageIndex].nodes = nodes.map((node) => cloneNode(node));
      });
    },

    setLogicBinding(nodeId, kind, variableName) {
      set((draft) => {
        updateNode(nodeId, currentNodes(draft), (node) => {
          const bindings = (node.logicBindings ?? []).filter((binding) => binding.kind !== kind);
          if (variableName !== undefined && variableName.length > 0) {
            bindings.push(makeNodeLogicBinding({ kind, variableName }));
          }
          if (bindings.length === 0) delete node.logicBindings;
          else node.logicBindings = bindings;
        });
      });
    },

    // MARK: Generated art

    /**
     * Image files already used by the current page — game-entity sprites,
     * game-scene entities, and image nodes.
     *
     * NOTE: `FileManager.fileExists` is synchronous in Swift; the port's
     * FileSystem adapter is async, so this method returns a promise.
     */
    async currentArtReferenceImagePaths(limit = 8) {
      const state = get();
      if (!(state.currentPageIndex >= 0 && state.currentPageIndex < state.project.pages.length)) return [];
      const found: string[] = [];
      const collect = (nodes: readonly DesignNode[]): void => {
        for (const n of nodes) {
          if (n.imageSource !== undefined) found.push(n.imageSource);
          const sprite = n.gameEntity?.sprite;
          if (sprite !== undefined) found.push(sprite);
          const scene = n.gameScene;
          if (scene) {
            for (const entity of scene.entities) {
              if (entity.sprite !== undefined) found.push(entity.sprite);
            }
          }
          collect(n.children);
        }
      };
      collect(state.project.pages[state.currentPageIndex].nodes);
      const fs = getPlatform().fileSystem;
      const seen = new Set<string>();
      const out: string[] = [];
      for (const path of found) {
        if (seen.has(path)) continue;
        let exists = false;
        try {
          exists = await fs.exists(path);
        } catch {
          exists = false;
        }
        if (!exists) continue;
        seen.add(path);
        out.push(path);
        if (out.length >= limit) break;
      }
      return out;
    },

    // מחליף מקור תמונה של Node אחרי שהתמונה נוצרה ברקע
    setGeneratedImage(nodeId, imagePath) {
      set((draft) => {
        updateNode(nodeId, currentNodes(draft), (node) => {
          node.imageSource = imagePath;
        });
      });
    },

    // MARK: Text hugging & clipping

    /** Shrinks a text node's box down to the glyphs it actually draws. */
    fitTextNodeToContent(id) {
      const state = get();
      const node = state.node(id);
      const fit = node ? fittedTextBox(node) : undefined;
      if (!node || !fit) return false;
      state.snapshot();
      set((draft) => {
        updateNode(id, currentNodes(draft), (target) => {
          target.x += fit.dx;
          target.width = fit.width;
          target.height = fit.height;
          target.manuallyPositioned = true;
        });
      });
      return true;
    },

    /**
     * Re-hugs one node in place, no snapshot and no manual-position flag —
     * used right after the words themselves change.
     */
    hugTextBoxIfEnabled(id) {
      if (!autoHugTextBoxes()) return;
      const node = get().node(id);
      const fit = node ? fittedTextBox(node) : undefined;
      if (!node || !fit) return;
      set((draft) => {
        updateNode(id, currentNodes(draft), (target) => {
          target.x += fit.dx;
          target.width = fit.width;
          target.height = fit.height;
        });
      });
    },

    /** Bulk version for a container: every text node beneath it hugs its content. */
    fitTextNodesToContent(parentId) {
      const state = get();
      let roots: readonly DesignNode[];
      const parent = parentId !== undefined ? state.node(parentId) : undefined;
      if (parentId !== undefined && parent) {
        roots = parent.children;
      } else {
        roots = currentPageOf(state).nodes;
      }
      const textIds: string[] = [];
      const collect = (nodes: readonly DesignNode[]): void => {
        for (const node of nodes) {
          if (node.type === 'Text') textIds.push(node.id);
          collect(node.children);
        }
      };
      collect(roots);

      let changed = 0;
      for (const id of textIds) {
        if (get().fitTextNodeToContent(id)) changed += 1;
      }
      return changed;
    },

    clipRoundedContainersInCurrentPage() {
      set((draft) => {
        clipRoundedContainers(currentNodes(draft));
      });
    },

    // MARK: Components

    /** Saves the selected node as a reusable component in the user's library. */
    async saveSelectionAsComponent(name, category = 'General') {
      const state = get();
      const id = state.selectedNodeId;
      const node = id !== undefined ? state.node(id) : undefined;
      if (id === undefined || !node) return undefined;
      try {
        return await ComponentLibrary.save(node, name, category);
      } catch {
        return undefined;
      }
    },

    /**
     * Drops a library component into the current screen (or the page root when
     * nothing is selected), with fresh ids so instances stay independent.
     */
    insertComponent(component, at) {
      const state = get();
      state.snapshot();
      // Prefer the selected screen frame; otherwise the first screen.
      const selected = state.selectedNodeId !== undefined ? state.node(state.selectedNodeId) : undefined;
      const selectedScreen = selected && selected.type === 'Frame' ? selected : undefined;
      const targetScreen =
        selectedScreen ?? currentPageOf(state).nodes.find((node) => node.type === 'Frame');

      const instance = ComponentLibrary.instantiate(component, at ?? { x: 24, y: 24 });
      set((draft) => {
        insertNodeIntoContext(actionContextOf(draft), instance, targetScreen?.id);
      });
      return instance.id;
    },

    // MARK: Alignment / distribution

    /** Align every direct child inside a selected parent. */
    alignChildren(parentId, alignment) {
      const state = get();
      const parent = state.node(parentId);
      if (!parent || parent.children.length === 0) return;
      state.snapshot();
      set((draft) => {
        updateNode(parentId, currentNodes(draft), (node) => {
          alignChildrenIn(node, alignment);
        });
      });
    },

    distributeChildren(parentId, axis) {
      const state = get();
      const parent = state.node(parentId);
      if (!parent || parent.children.length < 2) return;
      state.snapshot();
      set((draft) => {
        updateNode(parentId, currentNodes(draft), (node) => {
          distributeChildrenIn(
            node,
            axis,
            axis === 'horizontal' ? (node.style.paddingLeft ?? 0) : (node.style.paddingTop ?? 0),
            undefined,
          );
        });
      });
    },

    alignSelection(alignment) {
      const state = get();
      const ids =
        state.selectedNodeIds.size > 0
          ? [...state.selectedNodeIds]
          : state.selectedNodeId !== undefined
            ? [state.selectedNodeId]
            : [];
      // One element selected → align it INSIDE its parent.
      if (ids.length === 1) {
        alignWithinParent(state, ids[0], alignment);
        return;
      }
      if (ids.length < 2) return;
      const rects = ids
        .map((id) => {
          const rect = state.globalRect(id);
          return rect ? ([id, rect] as const) : undefined;
        })
        .filter((entry): entry is readonly [string, Rect] => entry !== undefined);
      if (rects.length < 2) return;

      state.snapshot();
      const bounds = rects.map(([, rect]) => rect).reduce((accumulated, rect) => rectUnion(accumulated, rect), rects[0][1]);
      const boundsMinX = bounds.x;
      const boundsMidX = bounds.x + bounds.width / 2;
      const boundsMaxX = bounds.x + bounds.width;
      const boundsMinY = bounds.y;
      const boundsMidY = bounds.y + bounds.height / 2;
      const boundsMaxY = bounds.y + bounds.height;

      for (const [id, rect] of rects) {
        const node = get().node(id);
        if (!node) continue;
        let x = node.x;
        let y = node.y;
        const parentOrigin = parentGlobalOrigin(currentPageOf(get()).nodes, id);

        switch (alignment) {
          case 'left':
            x = boundsMinX - parentOrigin.x;
            break;
          case 'center':
            x = boundsMidX - rect.width / 2 - parentOrigin.x;
            break;
          case 'right':
            x = boundsMaxX - rect.width - parentOrigin.x;
            break;
          case 'top':
            y = boundsMinY - parentOrigin.y;
            break;
          case 'middle':
            y = boundsMidY - rect.height / 2 - parentOrigin.y;
            break;
          case 'bottom':
            y = boundsMaxY - rect.height - parentOrigin.y;
            break;
        }

        get().moveNode(id, x, y);
      }
    },

    distributeSelection(axis) {
      const state = get();
      const ids = [...state.selectedNodeIds];
      if (ids.length < 3) return;
      const rects = ids
        .map((id) => {
          const rect = state.globalRect(id);
          return rect ? ([id, rect] as const) : undefined;
        })
        .filter((entry): entry is readonly [string, Rect] => entry !== undefined);
      if (rects.length < 3) return;

      state.snapshot();
      switch (axis) {
        case 'horizontal': {
          const sorted = [...rects].sort((lhs, rhs) => lhs[1].x - rhs[1].x);
          const minX = sorted[0]?.[1].x ?? 0;
          const last = sorted[sorted.length - 1];
          const maxX = last ? last[1].x + last[1].width : 0;
          const totalWidth = sorted.reduce((sum, [, rect]) => sum + rect.width, 0);
          const gap = Math.max(0, (maxX - minX - totalWidth) / (sorted.length - 1));
          let cursor = minX;
          for (const [id, rect] of sorted) {
            const parentOrigin = parentGlobalOrigin(currentPageOf(get()).nodes, id);
            const node = get().node(id);
            if (node) {
              get().moveNode(id, cursor - parentOrigin.x, node.y);
            }
            cursor += rect.width + gap;
          }
          break;
        }
        case 'vertical': {
          const sorted = [...rects].sort((lhs, rhs) => lhs[1].y - rhs[1].y);
          const minY = sorted[0]?.[1].y ?? 0;
          const last = sorted[sorted.length - 1];
          const maxY = last ? last[1].y + last[1].height : 0;
          const totalHeight = sorted.reduce((sum, [, rect]) => sum + rect.height, 0);
          const gap = Math.max(0, (maxY - minY - totalHeight) / (sorted.length - 1));
          let cursor = minY;
          for (const [id, rect] of sorted) {
            const parentOrigin = parentGlobalOrigin(currentPageOf(get()).nodes, id);
            const node = get().node(id);
            if (node) {
              get().moveNode(id, node.x, cursor - parentOrigin.y);
            }
            cursor += rect.height + gap;
          }
          break;
        }
      }
    },

    loadRunningApp() {
      set((draft) => {
        draft.project = makeRunningAppProject();
        draft.currentPageIndex = 0;
        draft.selectedNodeId = undefined;
        draft.selectedNodeIds.clear();
      });
    },
  })),
);

// MARK: - Free helpers that need both `get` and `set`

type SetState = (updater: (draft: Draft) => void) => void;

/** `layerSelection(toFront:)` */
function layerSelection(state: ProjectStore, set: SetState, toFront: boolean): void {
  const ids =
    state.selectedNodeIds.size === 0
      ? [state.selectedNodeId].filter((id): id is string => id !== undefined)
      : [...state.selectedNodeIds];
  if (ids.length === 0) return;

  state.snapshot();
  set((draft) => {
    const allZ = allZIndexes(currentNodes(draft));
    const maxZ = allZ.length > 0 ? Math.max(...allZ) : 0;
    const minZ = allZ.length > 0 ? Math.min(...allZ) : 0;
    let nextZ = toFront ? maxZ + 1 : minZ - 1;
    for (const id of ids) {
      const z = nextZ;
      updateNode(id, currentNodes(draft), (node) => {
        node.zIndex = z;
      });
      nextZ += toFront ? 1 : -1;
    }
  });
}

/**
 * `alignWithinParent(_:_:)` — aligns a single node within its parent's inner
 * box (padding-aware). A top-level screen has no parent, so it is left as-is.
 */
function alignWithinParent(state: ProjectStore, id: string, alignment: CanvasStudioAlignment): void {
  const pageNodes = currentPageOf(state).nodes;
  const parent = parentNode(id, pageNodes);
  const node = findNode(id, pageNodes);
  if (!parent || !node) return;
  const padL = parent.style.paddingLeft ?? 0;
  const padR = parent.style.paddingRight ?? 0;
  const padT = parent.style.paddingTop ?? 0;
  const padB = parent.style.paddingBottom ?? 0;
  const innerW = parent.width - padL - padR;
  const innerH = parent.height - padT - padB;
  let x = node.x;
  let y = node.y;
  switch (alignment) {
    case 'left':
      x = padL;
      break;
    case 'center':
      x = padL + (innerW - node.width) / 2;
      break;
    case 'right':
      x = padL + innerW - node.width;
      break;
    case 'top':
      y = padT;
      break;
    case 'middle':
      y = padT + (innerH - node.height) / 2;
      break;
    case 'bottom':
      y = padT + innerH - node.height;
      break;
  }
  state.snapshot();
  state.moveNode(id, x, y);
}

/** Convenience for non-React callers (services, hosts, tests). */
export const projectStore = useProjectStore;
