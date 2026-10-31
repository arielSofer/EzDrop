// Ported 1:1 from AgenticDesigner/ViewModels/LogicViewModel.swift
//
// State management for Logic Mode: block CRUD, connections, selection,
// parameter editing, variables, validation, undo/redo and persistence
// into the design project.
//
// Framework-free: every `@Published` property is a plain property whose
// setter notifies `subscribe(listener)` subscribers (the web app wraps the
// instance in a zustand store).

import { BlockCatalog } from '../models/BlockDefinitions';
import { AllNodeLogicBindingKind, type DesignNode, type NodeLogicBindingKind } from '../models/DesignNode';
import type { AppPlatform } from '../models/DesignProject';
import type { FlowTemplate } from '../models/FlowTemplateLibrary';
import type { Point, Size } from '../models/Geometry';
import {
  makeBlockConnection,
  makeLogicFlow,
  makeLogicIssue,
  makeLogicVariable,
  type LogicBlock,
  type LogicBlockType,
  type LogicFlow,
  type LogicIssue,
  type LogicVariable,
  type VariableScope,
  type VariableType,
} from '../models/LogicModels';
import { newUUID } from '../models/uuid';
import type { DesignHostForLogic, SimulatorLogicHost } from '../services/hosts';

export type { DesignHostForLogic } from '../services/hosts';

export interface DesignNodeSummary {
  id: string;
  name: string;
  type: string;
}

export interface DesignScreenSummary {
  id: string;
  name: string;
}

/** Swift arrays are values: snapshots/persisted copies must not alias the live flows. */
function cloneFlows(flows: LogicFlow[]): LogicFlow[] {
  return JSON.parse(JSON.stringify(flows)) as LogicFlow[];
}

export class LogicViewModel implements SimulatorLogicHost {
  // MARK: - Published state

  private _flows: LogicFlow[] = [];
  private _currentFlowId: string | undefined;
  private _selectedBlockId: string | undefined;
  private _selectedConnectionId: string | undefined;
  private _validationIssues: LogicIssue[] = [];

  // Connection dragging (wire rubber-band)
  private _isConnecting = false;
  private _connectionDragStart: Point | undefined;
  private _connectionDragEnd: Point | undefined;
  connectionSourceBlockId: string | undefined;
  connectionSourcePortIndex = 0;

  // Canvas viewport
  private _canvasOffset: Size = { width: 0, height: 0 };
  private _canvasZoom = 1.0;

  // Sheets
  private _showFirebaseConfig = false;
  private _showAPIManager = false;
  // Presented from EditorView so the running-app preview can open in any
  // editor mode — including remotely via the MCP preview_app tool.
  private _showAppPreview = false;

  // Simulator: the block currently executing (drives the canvas highlight)
  private _simActiveBlockId: string | undefined;

  designViewModel: DesignHostForLogic | undefined;

  private undoStack: LogicFlow[][] = [];
  private redoStack: LogicFlow[][] = [];

  // MARK: - Observation (ObservableObject stand-in)

  private listeners = new Set<() => void>();

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }

  get flows(): LogicFlow[] {
    return this._flows;
  }
  set flows(value: LogicFlow[]) {
    this._flows = value;
    this.emit();
  }
  get currentFlowId(): string | undefined {
    return this._currentFlowId;
  }
  set currentFlowId(value: string | undefined) {
    this._currentFlowId = value;
    this.emit();
  }
  get selectedBlockId(): string | undefined {
    return this._selectedBlockId;
  }
  set selectedBlockId(value: string | undefined) {
    this._selectedBlockId = value;
    this.emit();
  }
  get selectedConnectionId(): string | undefined {
    return this._selectedConnectionId;
  }
  set selectedConnectionId(value: string | undefined) {
    this._selectedConnectionId = value;
    this.emit();
  }
  get validationIssues(): LogicIssue[] {
    return this._validationIssues;
  }
  set validationIssues(value: LogicIssue[]) {
    this._validationIssues = value;
    this.emit();
  }
  get isConnecting(): boolean {
    return this._isConnecting;
  }
  set isConnecting(value: boolean) {
    this._isConnecting = value;
    this.emit();
  }
  get connectionDragStart(): Point | undefined {
    return this._connectionDragStart;
  }
  set connectionDragStart(value: Point | undefined) {
    this._connectionDragStart = value;
    this.emit();
  }
  get connectionDragEnd(): Point | undefined {
    return this._connectionDragEnd;
  }
  set connectionDragEnd(value: Point | undefined) {
    this._connectionDragEnd = value;
    this.emit();
  }
  get canvasOffset(): Size {
    return this._canvasOffset;
  }
  set canvasOffset(value: Size) {
    this._canvasOffset = value;
    this.emit();
  }
  get canvasZoom(): number {
    return this._canvasZoom;
  }
  set canvasZoom(value: number) {
    this._canvasZoom = value;
    this.emit();
  }
  get showFirebaseConfig(): boolean {
    return this._showFirebaseConfig;
  }
  set showFirebaseConfig(value: boolean) {
    this._showFirebaseConfig = value;
    this.emit();
  }
  get showAPIManager(): boolean {
    return this._showAPIManager;
  }
  set showAPIManager(value: boolean) {
    this._showAPIManager = value;
    this.emit();
  }
  get showAppPreview(): boolean {
    return this._showAppPreview;
  }
  set showAppPreview(value: boolean) {
    this._showAppPreview = value;
    this.emit();
  }
  get simActiveBlockId(): string | undefined {
    return this._simActiveBlockId;
  }
  set simActiveBlockId(value: string | undefined) {
    this._simActiveBlockId = value;
    this.emit();
  }

  // MARK: - Attach / persist

  // Loads flows for the current design page and keeps a back-reference for
  // node pickers, the screen overlay, and persistence.
  attach(design: DesignHostForLogic): void {
    this.designViewModel = design;
    const pageIndex = design.currentPageIndex;
    const page = design.project.pages[pageIndex];
    if (!page) return;

    this.flows = cloneFlows(page.logicFlows);

    if (this.flows.length === 0) {
      const flow = makeLogicFlow({ name: 'Flow 1' });
      this.flows = [flow];
    }

    if (this.currentFlowId === undefined || !this.flows.some((f) => f.id === this.currentFlowId)) {
      this.currentFlowId = this.flows[0]?.id;
    }

    this.validate();
  }

  persist(): void {
    const design = this.designViewModel;
    if (!design) return;
    const pageIndex = design.currentPageIndex;
    if (!design.project.pages[pageIndex]) return;
    const copy = cloneFlows(this._flows);
    design.mutateProject((project) => {
      const page = project.pages[pageIndex];
      if (page) page.logicFlows = copy;
    });
  }

  // MARK: - Flow management

  get currentFlow(): LogicFlow | undefined {
    return this._flows.find((f) => f.id === this._currentFlowId);
  }

  private get currentFlowIndex(): number | undefined {
    const index = this._flows.findIndex((f) => f.id === this._currentFlowId);
    return index >= 0 ? index : undefined;
  }

  /** Replaces flow `index` with a shallow-updated copy (value semantics for store consumers). */
  private updateFlow(index: number, mutate: (flow: LogicFlow) => void): void {
    const original = this._flows[index];
    if (!original) return;
    const copy: LogicFlow = {
      ...original,
      blocks: original.blocks.map((b) => ({ ...b })),
      connections: [...original.connections],
      variables: [...original.variables],
    };
    mutate(copy);
    const next = [...this._flows];
    next[index] = copy;
    this.flows = next;
  }

  createFlow(name: string, screenId?: string): void {
    this.snapshot();
    const flow = makeLogicFlow({ name, screenNodeId: screenId });
    this.flows = [...this._flows, flow];
    this.currentFlowId = flow.id;
    this.persist();
  }

  deleteFlow(id: string): void {
    this.snapshot();
    this.flows = this._flows.filter((f) => f.id !== id);
    if (this._flows.length === 0) {
      this.flows = [makeLogicFlow({ name: 'Flow 1' })];
    }
    if (this._currentFlowId === id) {
      this.currentFlowId = this._flows[0]?.id;
    }
    this.persist();
    this.validate();
  }

  renameFlow(id: string, name: string): void {
    const index = this._flows.findIndex((f) => f.id === id);
    if (index < 0) return;
    this.updateFlow(index, (flow) => {
      flow.name = name;
    });
    this.persist();
  }

  // Adds AI-generated flows and focuses the first one. An empty default
  // flow left over from attach() is replaced instead of kept around.
  applyGenerated(generated: LogicFlow[]): void {
    if (generated.length === 0) return;
    this.snapshot();

    const kept = this._flows.filter((f) => !(f.blocks.length === 0 && f.connections.length === 0));
    this.flows = [...kept, ...generated];
    this.currentFlowId = generated[0]?.id;
    this.selectedBlockId = undefined;
    this.persist();
    this.validate();
  }

  // Inserts a ready-made flow (see FlowTemplateLibrary). Its event/element
  // references start unbound, same as any block dragged from the palette —
  // the user wires it to real screen elements via the block inspector.
  insertTemplate(template: FlowTemplate): void {
    this.snapshot();
    const kept = this._flows.filter((f) => !(f.blocks.length === 0 && f.connections.length === 0));
    const flow = template.build();
    const existingNames = new Set(kept.map((f) => f.name));
    if (existingNames.has(flow.name)) {
      let index = 2;
      while (existingNames.has(`${flow.name} ${index}`)) index += 1;
      flow.name = `${flow.name} ${index}`;
    }
    this.flows = [...kept, flow];
    this.currentFlowId = flow.id;
    this.selectedBlockId = undefined;
    this.persist();
    this.validate();
  }

  // MARK: - Block management

  get selectedBlock(): LogicBlock | undefined {
    const flow = this.currentFlow;
    const selectedBlockId = this._selectedBlockId;
    if (!flow || selectedBlockId === undefined) return undefined;
    return flow.blocks.find((b) => b.id === selectedBlockId);
  }

  addBlock(type: LogicBlockType, at: Point): LogicBlock | undefined {
    const flowIndex = this.currentFlowIndex;
    if (flowIndex === undefined) return undefined;
    const block = BlockCatalog.makeBlock(type, at);
    if (!block) return undefined;

    this.snapshot();
    this.updateFlow(flowIndex, (flow) => {
      flow.blocks.push(block);
    });
    this.selectedBlockId = block.id;
    this.persist();
    this.validate();
    return block;
  }

  deleteBlock(id: string): void {
    const flowIndex = this.currentFlowIndex;
    if (flowIndex === undefined) return;
    this.snapshot();
    this.updateFlow(flowIndex, (flow) => {
      flow.blocks = flow.blocks.filter((b) => b.id !== id);
      flow.connections = flow.connections.filter((c) => c.sourceBlockId !== id && c.targetBlockId !== id);
    });
    if (this._selectedBlockId === id) this.selectedBlockId = undefined;
    this.persist();
    this.validate();
  }

  deleteSelected(): void {
    const selectedBlockId = this._selectedBlockId;
    const selectedConnectionId = this._selectedConnectionId;
    if (selectedBlockId !== undefined) {
      this.deleteBlock(selectedBlockId);
    } else if (selectedConnectionId !== undefined) {
      this.disconnectBlocks(selectedConnectionId);
      this.selectedConnectionId = undefined;
    }
  }

  duplicateBlock(id: string): void {
    const flowIndex = this.currentFlowIndex;
    if (flowIndex === undefined) return;
    const original = this._flows[flowIndex]?.blocks.find((b) => b.id === id);
    if (!original) return;

    this.snapshot();
    const copy: LogicBlock = { ...original };
    copy.id = newUUID();
    copy.x += 32;
    copy.y += 32;
    copy.parameters = original.parameters.map((param) => {
      const newParam = { ...param };
      newParam.id = newUUID();
      return newParam;
    });
    this.updateFlow(flowIndex, (flow) => {
      flow.blocks.push(copy);
    });
    this.selectedBlockId = copy.id;
    this.persist();
  }

  moveBlock(id: string, to: Point): void {
    const flowIndex = this.currentFlowIndex;
    if (flowIndex === undefined) return;
    const blockIndex = this._flows[flowIndex]?.blocks.findIndex((b) => b.id === id) ?? -1;
    if (blockIndex < 0) return;

    this.updateFlow(flowIndex, (flow) => {
      const block = flow.blocks[blockIndex]!;
      block.x = to.x;
      block.y = to.y;
    });
  }

  commitBlockMove(): void {
    this.persist();
  }

  toggleCollapsed(id: string): void {
    const flowIndex = this.currentFlowIndex;
    if (flowIndex === undefined) return;
    const blockIndex = this._flows[flowIndex]?.blocks.findIndex((b) => b.id === id) ?? -1;
    if (blockIndex < 0) return;
    this.updateFlow(flowIndex, (flow) => {
      const block = flow.blocks[blockIndex]!;
      block.isCollapsed = !block.isCollapsed;
    });
    this.persist();
  }

  updateComment(blockId: string, comment: string | undefined): void {
    const flowIndex = this.currentFlowIndex;
    if (flowIndex === undefined) return;
    const blockIndex = this._flows[flowIndex]?.blocks.findIndex((b) => b.id === blockId) ?? -1;
    if (blockIndex < 0) return;
    this.updateFlow(flowIndex, (flow) => {
      const block = flow.blocks[blockIndex]!;
      if (comment === undefined || comment.length === 0) delete block.comment;
      else block.comment = comment;
    });
    this.persist();
  }

  updateLabel(blockId: string, label: string): void {
    const flowIndex = this.currentFlowIndex;
    if (flowIndex === undefined) return;
    const blockIndex = this._flows[flowIndex]?.blocks.findIndex((b) => b.id === blockId) ?? -1;
    if (blockIndex < 0) return;
    this.updateFlow(flowIndex, (flow) => {
      flow.blocks[blockIndex]!.label = label;
    });
    this.persist();
  }

  // MARK: - Parameter editing

  updateParameter(blockId: string, paramKey: string, value: string | undefined): void {
    this.mutateParameter(blockId, paramKey, (param) => {
      if (value === undefined) delete param.value;
      else param.value = value;
    });
  }

  linkParameterToNode(blockId: string, paramKey: string, nodeId: string | undefined): void {
    this.mutateParameter(blockId, paramKey, (param) => {
      if (nodeId === undefined) delete param.nodeReference;
      else param.nodeReference = nodeId;
    });
  }

  linkParameterToVariable(blockId: string, paramKey: string, variableName: string | undefined): void {
    this.mutateParameter(blockId, paramKey, (param) => {
      if (variableName === undefined) delete param.variableReference;
      else param.variableReference = variableName;
    });
  }

  private mutateParameter(
    blockId: string,
    paramKey: string,
    mutate: (param: LogicBlock['parameters'][number]) => void,
  ): void {
    const flowIndex = this.currentFlowIndex;
    if (flowIndex === undefined) return;
    const blocks = this._flows[flowIndex]?.blocks ?? [];
    const blockIndex = blocks.findIndex((b) => b.id === blockId);
    if (blockIndex < 0) return;
    const paramIndex = blocks[blockIndex]!.parameters.findIndex((p) => p.key === paramKey);
    if (paramIndex < 0) return;

    this.updateFlow(flowIndex, (flow) => {
      const block = flow.blocks[blockIndex]!;
      const parameters = block.parameters.map((p) => ({ ...p }));
      mutate(parameters[paramIndex]!);
      block.parameters = parameters;
    });
    this.persist();
    this.syncBindingIfNeeded(this._flows[flowIndex]!.blocks[blockIndex]!);
    this.validate();
  }

  private syncBindingIfNeeded(block: LogicBlock): void {
    if (block.type !== 'bindProperty') return;
    const nodeId = block.parameters.find((p) => p.key === 'element')?.nodeReference;
    const property = block.parameters.find((p) => p.key === 'property')?.value;
    if (nodeId === undefined || property === undefined) return;
    if (!(AllNodeLogicBindingKind as readonly string[]).includes(property)) return;
    const kind = property as NodeLogicBindingKind;

    const variableName = block.parameters.find((p) => p.key === 'variable')?.variableReference;
    this.designViewModel?.setLogicBinding(nodeId, kind, variableName);
  }

  // MARK: - Connections

  // Validation rules: no self-connection, no cycles, events can't receive,
  // one connection max per input port.
  validateConnection(sourceId: string, targetId: string, targetPort: number): boolean {
    if (sourceId === targetId) return false;
    const flow = this.currentFlow;
    if (!flow) return false;

    const target = flow.blocks.find((b) => b.id === targetId);
    if (!target) return false;
    const targetDef = BlockCatalog.definition(target.type);
    if (!targetDef || !(targetDef.inputPortCount > 0)) return false;

    const inputTaken = flow.connections.some((c) => c.targetBlockId === targetId && c.targetPortIndex === targetPort);
    if (inputTaken) return false;

    // Reject cycles: can the target already reach the source?
    const visited = new Set<string>();
    const stack = [targetId];
    for (;;) {
      const current = stack.pop();
      if (current === undefined) break;
      if (current === sourceId) return false;
      if (visited.has(current)) continue;
      visited.add(current);
      const next = flow.connections.filter((c) => c.sourceBlockId === current).map((c) => c.targetBlockId);
      stack.push(...next);
    }

    return true;
  }

  connectBlocks(sourceId: string, sourcePort: number, targetId: string, targetPort: number): boolean {
    const flowIndex = this.currentFlowIndex;
    if (flowIndex === undefined) return false;
    if (!this.validateConnection(sourceId, targetId, targetPort)) return false;

    this.snapshot();
    this.updateFlow(flowIndex, (flow) => {
      flow.connections.push(
        makeBlockConnection({
          sourceBlockId: sourceId,
          sourcePortIndex: sourcePort,
          targetBlockId: targetId,
          targetPortIndex: targetPort,
        }),
      );
    });
    this.persist();
    this.validate();
    return true;
  }

  disconnectBlocks(connectionId: string): void {
    const flowIndex = this.currentFlowIndex;
    if (flowIndex === undefined) return;
    this.snapshot();
    this.updateFlow(flowIndex, (flow) => {
      flow.connections = flow.connections.filter((c) => c.id !== connectionId);
    });
    this.persist();
    this.validate();
  }

  // MARK: - Connection dragging

  beginConnectionDrag(blockId: string, port: number, at: Point): void {
    this.connectionSourceBlockId = blockId;
    this.connectionSourcePortIndex = port;
    this.connectionDragStart = at;
    this.connectionDragEnd = at;
    this.isConnecting = true;
  }

  updateConnectionDrag(to: Point): void {
    this.connectionDragEnd = to;
  }

  // Completes the drag: snaps to the nearest input port within reach.
  endConnectionDrag(at: Point): void {
    try {
      const sourceId = this.connectionSourceBlockId;
      const flow = this.currentFlow;
      if (sourceId === undefined || !flow) return;

      const snapDistance = 28;
      let best: { blockId: string; distance: number } | undefined;

      for (const block of flow.blocks) {
        const def = BlockCatalog.definition(block.type);
        if (!def || !(def.inputPortCount > 0)) continue;
        const portPoint = BlockGeometry.inputPortPosition(block);
        const distance = Math.hypot(portPoint.x - at.x, portPoint.y - at.y);
        if (distance <= snapDistance && distance < (best?.distance ?? Number.MAX_VALUE)) {
          best = { blockId: block.id, distance };
        }
      }

      if (best) {
        this.connectBlocks(sourceId, this.connectionSourcePortIndex, best.blockId, 0);
      }
    } finally {
      // `defer` in the Swift source.
      this.isConnecting = false;
      this.connectionDragStart = undefined;
      this.connectionDragEnd = undefined;
      this.connectionSourceBlockId = undefined;
    }
  }

  // MARK: - Variables

  get allVariables(): LogicVariable[] {
    const flowVars = this.currentFlow?.variables ?? [];
    const globalVars = this.designViewModel?.project.globalVariables ?? [];
    return [...flowVars, ...globalVars];
  }

  addVariable(name: string, type: VariableType, scope: VariableScope, defaultValue?: string): void {
    const variable = makeLogicVariable({ name, type, defaultValue, scope });

    if (scope === 'global') {
      this.designViewModel?.mutateProject((project) => {
        project.globalVariables.push(variable);
      });
    } else {
      const flowIndex = this.currentFlowIndex;
      if (flowIndex !== undefined) {
        this.snapshot();
        this.updateFlow(flowIndex, (flow) => {
          flow.variables.push(variable);
        });
        this.persist();
      }
    }
  }

  setPlatform(platform: AppPlatform, enabled: boolean): void {
    const design = this.designViewModel;
    if (!design) return;
    const settings = { ...design.project.platformSettings, enabledPlatforms: [...design.project.platformSettings.enabledPlatforms] };
    if (enabled) {
      if (!settings.enabledPlatforms.includes(platform)) {
        settings.enabledPlatforms.push(platform);
      }
    } else {
      settings.enabledPlatforms = settings.enabledPlatforms.filter((p) => p !== platform);
      if (settings.enabledPlatforms.length === 0) {
        settings.enabledPlatforms = ['iPhone'];
      }
      if (!settings.enabledPlatforms.includes(settings.defaultPreviewPlatform)) {
        settings.defaultPreviewPlatform = settings.enabledPlatforms[0] ?? 'iPhone';
      }
    }
    design.mutateProject((project) => {
      project.platformSettings = settings;
    });
  }

  setDefaultPreviewPlatform(platform: AppPlatform): void {
    const design = this.designViewModel;
    if (!design) return;
    const settings = { ...design.project.platformSettings, enabledPlatforms: [...design.project.platformSettings.enabledPlatforms] };
    if (!settings.enabledPlatforms.includes(platform)) {
      settings.enabledPlatforms.push(platform);
    }
    settings.defaultPreviewPlatform = platform;
    design.mutateProject((project) => {
      project.platformSettings = settings;
    });
  }

  deleteVariable(id: string): void {
    const flowIndex = this.currentFlowIndex;
    if (flowIndex !== undefined && this._flows[flowIndex]!.variables.some((v) => v.id === id)) {
      this.snapshot();
      this.updateFlow(flowIndex, (flow) => {
        flow.variables = flow.variables.filter((v) => v.id !== id);
      });
      this.persist();
      return;
    }
    this.designViewModel?.mutateProject((project) => {
      project.globalVariables = project.globalVariables.filter((v) => v.id !== id);
    });
  }

  // MARK: - Design node access (for pickers + overlay)

  get designNodesFlat(): DesignNodeSummary[] {
    const design = this.designViewModel;
    const page = design?.project.pages[design.currentPageIndex];
    if (!design || !page) return [];

    const result: DesignNodeSummary[] = [];
    const walk = (nodes: DesignNode[]): void => {
      for (const node of nodes) {
        result.push({ id: node.id, name: node.name, type: node.type });
        walk(node.children);
      }
    };
    walk(page.nodes);
    return result;
  }

  get designScreens(): DesignScreenSummary[] {
    const design = this.designViewModel;
    const page = design?.project.pages[design.currentPageIndex];
    if (!design || !page) return [];

    return page.nodes.filter((n) => n.type === 'Frame').map((n) => ({ id: n.id, name: n.name }));
  }

  designNodeName(id: string | undefined): string | undefined {
    if (id === undefined) return undefined;
    return this.designNodesFlat.find((n) => n.id === id)?.name;
  }

  // MARK: - Undo / Redo

  snapshot(): void {
    this.undoStack.push(cloneFlows(this._flows));
    if (this.undoStack.length > 60) {
      this.undoStack.shift();
    }
    this.redoStack = [];
  }

  undo(): void {
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.redoStack.push(cloneFlows(this._flows));
    this.flows = previous;
    this.persist();
    this.validate();
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(cloneFlows(this._flows));
    this.flows = next;
    this.persist();
    this.validate();
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  // MARK: - Validation

  validate(): void {
    const issues: LogicIssue[] = [];
    const flow = this.currentFlow;
    if (!flow) {
      this.validationIssues = [];
      return;
    }

    for (const block of flow.blocks) {
      const def = BlockCatalog.definition(block.type);
      if (!def) continue;

      for (const param of block.parameters) {
        if (!param.isRequired) continue;
        const hasValue =
          (param.value ?? '').length > 0 || param.nodeReference !== undefined || (param.variableReference ?? '').length > 0;
        if (!hasValue) {
          issues.push(
            makeLogicIssue({
              blockId: block.id,
              message: `${block.label}: '${param.label}' is required`,
              severity: 'error',
            }),
          );
        }
      }

      if (def.inputPortCount === 0) {
        const hasOutgoing = flow.connections.some((c) => c.sourceBlockId === block.id);
        if (!hasOutgoing) {
          issues.push(
            makeLogicIssue({
              blockId: block.id,
              message: `${block.label}: event is not connected to anything`,
              severity: 'warning',
            }),
          );
        }
      } else {
        const hasIncoming = flow.connections.some((c) => c.targetBlockId === block.id);
        if (!hasIncoming) {
          issues.push(
            makeLogicIssue({
              blockId: block.id,
              message: `${block.label}: unreachable — no incoming connection`,
              severity: 'warning',
            }),
          );
        }
      }
    }

    this.validationIssues = issues;
  }

  hasIssue(blockId: string): boolean {
    return this._validationIssues.some((i) => i.blockId === blockId && i.severity === 'error');
  }
}

// MARK: - Block geometry (shared by canvas, block view, and wire endpoints)

export const BlockGeometry = {
  headerHeight: 34,
  paramRowHeight: 26,
  footerHeight: 22,

  /** `BlockGeometry.height(for:)` */
  height(block: LogicBlock): number {
    if (block.isCollapsed) return BlockGeometry.headerHeight;
    const def = BlockCatalog.definition(block.type);
    const paramsHeight = block.parameters.length * BlockGeometry.paramRowHeight;
    const footer = def?.outputPortLabels !== undefined ? BlockGeometry.footerHeight : 10;
    return BlockGeometry.headerHeight + paramsHeight + footer;
  },

  /** `BlockGeometry.inputPortPosition(for:)` — top centre. */
  inputPortPosition(block: LogicBlock): Point {
    return { x: block.x + block.width / 2, y: block.y };
  },

  /** `BlockGeometry.outputPortPosition(for:portIndex:)` — bottom edge, evenly divided. */
  outputPortPosition(block: LogicBlock, portIndex: number): Point {
    const count = Math.max(1, BlockCatalog.definition(block.type)?.outputPortCount ?? 1);
    const x = (block.width * (portIndex + 1)) / (count + 1);
    return { x: block.x + x, y: block.y + BlockGeometry.height(block) };
  },
} as const;
