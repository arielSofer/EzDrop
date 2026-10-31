// Adapters that expose `useProjectStore` as the host interfaces the framework-
// free services declare. The Swift classes hold
// `weak var designViewModel: ProjectViewModel?` and reach into it directly;
// here each service receives one of these objects instead.

import type { DesignAction, DesignNode, DesignPage, DesignProject, NodeLogicBindingKind, Point } from '@agentic/core';
import type { DesignHostForLogic, SimulatorDesignHost } from '@agentic/core/services/hosts';
import type {
  BackendDesignHost,
  ComposedDesignHost,
  DesignDocumentHost,
  OrchestratorDesignHost,
  ThemeHost,
} from '@agentic/core/services/themeHosts';
import type { AgentContext, DesignAgentDesignHost } from '@agentic/core';
import type { SavedComponent } from '@agentic/core/services/ComponentLibrary';
import { useProjectStore, type ProjectStore } from './projectStore';

function store(): ProjectStore {
  return useProjectStore.getState();
}

/**
 * `Services/LogicSimulator.swift` — exactly the `designViewModel?.…` members
 * it touches.
 */
export const simulatorDesignHost: SimulatorDesignHost = {
  get project(): DesignProject {
    return store().project;
  },
  get currentPageIndex(): number {
    return store().currentPageIndex;
  },
  nodeForSimulation(id: string): DesignNode | undefined {
    return store().nodeForSimulation(id);
  },
  simulateUpdateNode(id: string, update: (node: DesignNode) => void): void {
    store().simulateUpdateNode(id, update);
  },
  snapshotNodesForSimulation(): DesignNode[] {
    return store().snapshotNodesForSimulation();
  },
  restoreNodesFromSimulation(nodes: DesignNode[]): void {
    store().restoreNodesFromSimulation(nodes);
  },
  selectNode(id: string): void {
    store().selectNode(id);
  },
  repeatTemplateForOrAncestorOf(id: string): DesignNode | undefined {
    return store().repeatTemplateForOrAncestorOf(id);
  },
};

/**
 * `ViewModels/LogicViewModel.swift` + `Services/ComposedLogicGenerator.swift` —
 * every write goes through `mutateProject`, since a store cannot observe direct
 * property writes into the document.
 */
export const designHostForLogic: DesignHostForLogic = {
  get project(): DesignProject {
    return store().project;
  },
  get currentPageIndex(): number {
    return store().currentPageIndex;
  },
  mutateProject(update: (project: DesignProject) => void): void {
    store().mutateProject(update);
  },
  setLogicBinding(nodeId: string, kind: NodeLogicBindingKind, variableName: string | undefined): void {
    store().setLogicBinding(nodeId, kind, variableName);
  },
};

/**
 * `Agent/AgentToolLoop.swift` + `Services/MCPServerController.swift` — the
 * `ProjectViewModel` surface the agent tool belt drives.
 *
 * NOTE: `packages/core/src/agent/hosts.ts` did not exist when this was written,
 * so this interface is declared here from the Swift accesses
 * (`design.project`, `design.currentPage`, `design.currentPageIndex`,
 * `design.selectedNodeId`, `design.node(id:)`, `design.selectPage(index:)`,
 * `viewModel.selectNode(_:)`, `design.replaceProject(_:)`,
 * `viewModel.applyDesignActions(_:)`, `viewModel.applyDesignActionsExactly(_:)`,
 * `design.insertComponent(_:at:)`, `design.repeatTemplateForOrAncestorOf(_:)`,
 * `design.currentArtReferenceImagePaths(limit:)`). Swap it for the core
 * declaration at integration — the object below already satisfies it
 * structurally.
 */
export interface AgentDesignHost {
  readonly project: DesignProject;
  readonly currentPage: DesignPage;
  readonly currentPageIndex: number;
  readonly selectedNodeId: string | undefined;
  node(id: string): DesignNode | undefined;
  selectPage(index: number): void;
  selectNode(id: string): void;
  replaceProject(project: DesignProject): void;
  mutateProject(update: (project: DesignProject) => void): void;
  applyDesignActions(actions: DesignAction[]): Record<string, string>;
  applyDesignActionsExactly(actions: DesignAction[]): Record<string, string>;
  insertComponent(component: SavedComponent, at?: Point): string;
  repeatTemplateForOrAncestorOf(id: string): DesignNode | undefined;
  currentArtReferenceImagePaths(limit?: number): Promise<string[]>;
}

export const agentDesignHost: AgentDesignHost = {
  get project(): DesignProject {
    return store().project;
  },
  get currentPage(): DesignPage {
    return store().currentPage();
  },
  get currentPageIndex(): number {
    return store().currentPageIndex;
  },
  get selectedNodeId(): string | undefined {
    return store().selectedNodeId;
  },
  node(id: string): DesignNode | undefined {
    return store().node(id);
  },
  selectPage(index: number): void {
    store().selectPage(index);
  },
  selectNode(id: string): void {
    store().selectNode(id);
  },
  replaceProject(project: DesignProject): void {
    store().replaceProject(project);
  },
  mutateProject(update: (project: DesignProject) => void): void {
    store().mutateProject(update);
  },
  applyDesignActions(actions: DesignAction[]): Record<string, string> {
    return store().applyDesignActions(actions);
  },
  applyDesignActionsExactly(actions: DesignAction[]): Record<string, string> {
    return store().applyDesignActionsExactly(actions);
  },
  insertComponent(component: SavedComponent, at?: Point): string {
    return store().insertComponent(component, at);
  },
  repeatTemplateForOrAncestorOf(id: string): DesignNode | undefined {
    return store().repeatTemplateForOrAncestorOf(id);
  },
  currentArtReferenceImagePaths(limit?: number): Promise<string[]> {
    return store().currentArtReferenceImagePaths(limit);
  },
};

/**
 * `Services/ThemeApplier.swift`, `Services/BrandKit.swift`,
 * `Services/BackendWiringGenerator.swift`, `Services/ComposedAppGenerator.swift`
 * and `Services/AppBuildOrchestrator.swift` — one object satisfies all of the
 * `themeHosts.ts` document interfaces, since the store exposes every member.
 */
export const orchestratorDesignHost: OrchestratorDesignHost = {
  get project(): DesignProject {
    return store().project;
  },
  get currentPageIndex(): number {
    return store().currentPageIndex;
  },
  mutateProject(update: (project: DesignProject) => void): void {
    store().mutateProject(update);
  },
  replaceProject(project: DesignProject): void {
    store().replaceProject(project);
  },
  applyDesignActions(actions: DesignAction[]): Record<string, string> {
    return store().applyDesignActions(actions);
  },
  setGeneratedImage(nodeId: string, imagePath: string): void {
    store().setGeneratedImage(nodeId, imagePath);
  },
  setLogicBinding(nodeId: string, kind: NodeLogicBindingKind, variableName: string): void {
    store().setLogicBinding(nodeId, kind, variableName);
  },
};

/** `ThemeApplier` / `BrandKit`. */
export const themeHost: ThemeHost = orchestratorDesignHost;
/** `BackendWiringGenerator` — the document plus `setLogicBinding`. */
export const backendDesignHost: BackendDesignHost = designHostForLogic;
/** `ComposedAppGenerator`. */
export const composedDesignHost: ComposedDesignHost = orchestratorDesignHost;
/** Any service that only needs the document. */
export const designDocumentHost: DesignDocumentHost = orchestratorDesignHost;

/**
 * `DesignAgentService` / `DesignChatSession` host adapter.
 */
export const designAgentDesignHost: DesignAgentDesignHost = {
  get project(): DesignProject {
    return store().project;
  },
  get currentPage(): DesignPage {
    return store().currentPage();
  },
  get currentPageIndex(): number {
    return store().currentPageIndex;
  },
  get selectedNodeId(): string | undefined {
    return store().selectedNodeId;
  },
  mutateProject(update: (project: DesignProject) => void): void {
    store().mutateProject(update);
  },
  replaceProject(project: DesignProject): void {
    store().replaceProject(project);
  },
  applyDesignActions(actions: DesignAction[]): Record<string, string> {
    return store().applyDesignActions(actions);
  },
  setGeneratedImage(nodeId: string, imagePath: string): void {
    store().setGeneratedImage(nodeId, imagePath);
  },
  rootScreen(containing: string): DesignNode | undefined {
    return store().rootScreen(containing);
  },
  makeAgentContext(userPrompt: string): AgentContext {
    return store().makeAgentContext(userPrompt);
  },
};

/** Every adapter in one object, for wiring at app startup. */
export const projectHosts = {
  simulatorDesignHost,
  designHostForLogic,
  agentDesignHost,
  designAgentDesignHost,
  orchestratorDesignHost,
  themeHost,
  backendDesignHost,
  composedDesignHost,
  designDocumentHost,
} as const;

