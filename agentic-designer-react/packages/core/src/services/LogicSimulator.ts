// Ported 1:1 from AgenticDesigner/Services/LogicSimulator.swift
//
// In-app flow simulator: walks a LogicFlow block by block, highlighting
// each block as it "executes". HTTP requests really fire, conditions and
// data operations really evaluate, UI-update blocks really mutate the
// designed screen, and Firebase blocks pause for a Success/Error choice.
//
// Framework-free: `@Published` properties are plain properties whose setters
// notify `subscribe(listener)` (the web app wraps this in a zustand store);
// `Task`/`Task.sleep` become promises plus a cancellation token; URLSession
// becomes an injectable `fetchImpl`; AppKit side effects go through
// `SimulatorPlatformActions`; `GameSceneRegistry` through `GameCommandSink`.

import { swiftDouble, swiftInt } from '../agent/DesignAction';
import { BlockCatalog } from '../models/BlockDefinitions';
import { AllNodeLogicBindingKind, type DesignNode, type NodeLogicBindingKind } from '../models/DesignNode';
import type { AppPlatform } from '../models/DesignProject';
import type { GameEvent } from '../models/GameSpec';
import {
  LogicBlockCategory,
  type LogicBlock,
  type LogicBlockType,
  type LogicFlow,
  type VariableType,
} from '../models/LogicModels';
import { supabaseConfigIsConfigured } from '../models/SupabaseConfig';
import { newUUID } from '../models/uuid';
import type { Clock } from '../platform/Clock';
import { getPlatform } from '../platform/platform';
import type { Storage } from '../platform/Storage';
import {
  NullGameCommandSink,
  NullSimulatorPlatformActions,
  defaultFetch,
  type FetchLike,
  type GameCommandSink,
  type SimulatorDesignHost,
  type SimulatorLogicHost,
  type SimulatorPlatformActions,
} from './hosts';

// MARK: - Value types

export interface SimLogEntry {
  id: string;
  icon: string;
  message: string;
  isError: boolean;
}

export interface BranchChoice {
  blockLabel: string;
  labels: string[];
}

/** A cancellable unit of work — the port's stand-in for `Task`. */
interface SimTask {
  cancelled: boolean;
}

export interface LogicSimulatorOptions {
  /** `URLSession.shared` — defaults to `globalThis.fetch`. */
  fetchImpl?: FetchLike;
  /** `GameSceneRegistry` */
  gameSink?: GameCommandSink;
  /** AppKit side effects (NSWorkspace / NSSound / dock badge / haptics). */
  platformActions?: SimulatorPlatformActions;
  /** `UserDefaults.standard` — defaults to the platform Storage adapter. */
  storage?: Storage;
  clock?: Clock;
}

// MARK: - Helpers mirroring Foundation behaviour

// Characters `URL(string:)` refuses (spaces, control characters and the
// RFC 3986 excluded set) - everything else Foundation accepts, including
// relative strings like "/path" or "foo".
const INVALID_URL_CHARACTERS = new RegExp('[\\u0000-\\u0020"<>\\\\^`{|}\\u007F]');

/** `URL(string:)` — nil for empty strings and strings carrying spaces/control characters. */
function swiftURL(text: string): string | undefined {
  if (text.length === 0) return undefined;
  if (INVALID_URL_CHARACTERS.test(text)) return undefined;
  return text;
}

/** `addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed)`. */
export function addingPercentEncodingURLQueryAllowed(text: string): string {
  const allowedBack: Record<string, string> = {
    '24': '$', '26': '&', '2B': '+', '2C': ',', '2F': '/',
    '3A': ':', '3B': ';', '3D': '=', '3F': '?', '40': '@',
  };
  return encodeURIComponent(text).replace(/%(24|26|2B|2C|2F|3A|3B|3D|3F|40)/gi, (match, hex: string) => {
    return allowedBack[hex.toUpperCase()] ?? match;
  });
}

/** `URLComponents.queryItems` value encoding (urlQueryAllowed minus the separators). */
function encodeQueryComponent(text: string): string {
  return addingPercentEncodingURLQueryAllowed(text).replace(/&/g, '%26').replace(/=/g, '%3D');
}

/** `String(data: data.prefix(n), encoding: .utf8) ?? ""` — byte prefix, strict UTF-8 decode. */
export function prefixUTF8(text: string, byteCount: number): string {
  const g = globalThis as {
    TextEncoder?: new () => { encode(t: string): Uint8Array };
    TextDecoder?: new (label?: string, options?: { fatal?: boolean }) => { decode(b: Uint8Array): string };
  };
  if (!g.TextEncoder || !g.TextDecoder) return text.slice(0, byteCount);
  const bytes = new g.TextEncoder().encode(text);
  if (bytes.length <= byteCount) return text;
  try {
    return new g.TextDecoder('utf-8', { fatal: true }).decode(bytes.slice(0, byteCount));
  } catch {
    return '';
  }
}

/** `ISO8601DateFormatter().string(from:)` — no fractional seconds. */
function iso8601(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function jsonObjectFrom(text: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* JSONSerialization throws → nil */
  }
  return undefined;
}

/** `JSONSerialization.jsonObject(with:)` succeeds only for a top-level object/array. */
function isJSONValid(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

// MARK: - LogicSimulator

export class LogicSimulator {
  // MARK: Published state

  private _isRunning = false;
  private _log: SimLogEntry[] = [];
  private _variables: Record<string, string> = {};
  private _awaitingChoice: BranchChoice | undefined;
  private _speed = 0.14;
  private _hasUIChanges = false;
  // The screen shown in the interactive preview. Lives here (not in the
  // view) so MCP tools can navigate and observe the running app.
  private _previewScreenId: string | undefined;
  // Screens navigated FROM, so goBack can pop like the exported app does.
  private navigationHistory: string[] = [];
  private _previewPlatform: AppPlatform = 'iPhone';
  // Toast currently visible in the preview window; auto-dismisses.
  private _toastMessage: string | undefined;
  private toastTask: SimTask | undefined;

  logicViewModel: SimulatorLogicHost | undefined;
  designViewModel: SimulatorDesignHost | undefined;

  // Interactive preview: navigate blocks switch the displayed screen.
  onNavigate: ((screenId: string) => void) | undefined;

  private readonly fetchImpl: FetchLike | undefined;
  private readonly gameSink: GameCommandSink;
  private readonly platformActions: SimulatorPlatformActions;
  private readonly storage: Storage;
  private readonly clock: Clock;

  constructor(options: LogicSimulatorOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? defaultFetch();
    this.gameSink = options.gameSink ?? NullGameCommandSink;
    this.platformActions = options.platformActions ?? NullSimulatorPlatformActions;
    this.storage = options.storage ?? getPlatform().storage;
    this.clock = options.clock ?? getPlatform().clock;
  }

  // MARK: Observation (ObservableObject stand-in)

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

  get isRunning(): boolean {
    return this._isRunning;
  }
  private set isRunning(value: boolean) {
    this._isRunning = value;
    this.emit();
  }

  get log(): SimLogEntry[] {
    return this._log;
  }
  set log(value: SimLogEntry[]) {
    this._log = value;
    this.emit();
  }

  clearLog(): void {
    this.log = [];
  }

  /**
   * Any assignment here — from any block, in any flow — does two things:
   * (1) persists non-flow-local names into `persistentState` immediately
   * (not just at run end, so even an interrupted/stopped flow keeps what
   * it already set), and (2) re-pushes bound node properties (see
   * bindProperty/logicBindings), so a Text bound to "likeCount" updates
   * the instant incrementVariable changes it — no explicit setText needed.
   */
  get variables(): Record<string, string> {
    return this._variables;
  }
  set variables(value: Record<string, string>) {
    this._variables = value;
    // `didSet`
    for (const [name, currentValue] of Object.entries(this._variables)) {
      if (!this.currentFlowLocalNames.has(name)) this.persistentState[name] = currentValue;
    }
    this.refreshAllBindings();
    this.emit();
  }

  /** `variables[name] = value` — one subscript assignment, observers included. */
  setVariableValue(name: string, value: string): void {
    this.variables = { ...this._variables, [name]: value };
  }

  get awaitingChoice(): BranchChoice | undefined {
    return this._awaitingChoice;
  }
  private set awaitingChoice(value: BranchChoice | undefined) {
    this._awaitingChoice = value;
    this.emit();
  }

  get speed(): number {
    return this._speed;
  }
  set speed(value: number) {
    this._speed = value;
    this.emit();
  }

  get hasUIChanges(): boolean {
    return this._hasUIChanges;
  }
  set hasUIChanges(value: boolean) {
    this._hasUIChanges = value;
    this.emit();
  }

  get previewScreenId(): string | undefined {
    return this._previewScreenId;
  }
  set previewScreenId(value: string | undefined) {
    this._previewScreenId = value;
    this.emit();
  }

  get previewPlatform(): AppPlatform {
    return this._previewPlatform;
  }
  set previewPlatform(value: AppPlatform) {
    this._previewPlatform = value;
    this.emit();
  }

  get toastMessage(): string | undefined {
    return this._toastMessage;
  }
  private set toastMessage(value: string | undefined) {
    this._toastMessage = value;
    this.emit();
  }

  // MARK: Private run state

  private runTask: SimTask | undefined;
  /** Awaitable handle on the current `run()` (the Swift `Task` is fire-and-forget). */
  runPromise: Promise<void> | undefined;
  private choiceContinuation: ((index: number) => void) | undefined;
  private savedNodes: DesignNode[] | undefined;

  // Variables that outlive a single flow run, for the length of this
  // preview session — global variables everywhere, screen variables
  // wherever they're declared. Only .flow-scoped variables reset on every
  // run. Cleared by resetUI().
  private persistentState: Record<string, string> = {};
  // Names scoped .flow in the currently running flow — excluded from
  // persistentState so they reset to their default on every run.
  private currentFlowLocalNames = new Set<string>();
  // Item data from a tapped repeat-list clone, consumed by the next run().
  private pendingItemContext: Record<string, string> = {};
  // Named timers created by Start Timer blocks.
  private namedTimerTasks = new Map<string, SimTask>();
  // Self-scheduling On Timer event flows for the currently shown screen.
  private screenTimerTasks: SimTask[] = [];
  // In-memory Firestore stand-in: document path → document JSON.
  private firestoreMock: Record<string, string> = {};

  // MARK: - Triggers

  // Fires the flow whose tap event is bound to this node (interactive
  // preview). `itemContext` carries a repeat-list clone's item data
  // ("book" -> item JSON, "book.title" -> field values) into the run, so a
  // tapped row's flow sees WHICH row was tapped.
  runTap(nodeId: string, itemContext: Record<string, string> = {}): void {
    const flows = this.logicViewModel?.flows;
    if (!flows) return;
    for (const flow of flows) {
      const event = flow.blocks.find(
        (block) =>
          (block.type === 'onTap' || block.type === 'onDoubleTap' || block.type === 'onLongPress') &&
          (block.parameters.some((p) => (p.key === 'element' || p.key === 'targetNode') && p.nodeReference === nodeId) ||
            block.connectedDesignNodeId === nodeId),
      );
      if (event) {
        if (this._isRunning) {
          this.stop();
        }
        if (this.logicViewModel) {
          this.logicViewModel.currentFlowId = flow.id;
          this.logicViewModel.selectedBlockId = event.id;
        }
        this.pendingItemContext = itemContext;
        this.run();
        return;
      }
    }
    this.append('hand.tap', 'No flow bound to this element');
  }

  // Fires the On Swipe flow bound to this node whose direction filter
  // matches the actual swipe (a flow with no/empty direction matches any).
  runSwipe(nodeId: string, direction: string, itemContext: Record<string, string> = {}): void {
    const flows = this.logicViewModel?.flows;
    if (!flows) return;
    for (const flow of flows) {
      const event = flow.blocks.find((block) => {
        if (block.type !== 'onSwipe') return false;
        const matchesNode =
          block.parameters.some((p) => (p.key === 'element' || p.key === 'targetNode') && p.nodeReference === nodeId) ||
          block.connectedDesignNodeId === nodeId;
        if (!matchesNode) return false;
        const wanted = block.parameters.find((p) => p.key === 'direction')?.value ?? '';
        return wanted === '' || wanted === direction;
      });
      if (event) {
        if (this._isRunning) {
          this.stop();
        }
        if (this.logicViewModel) {
          this.logicViewModel.currentFlowId = flow.id;
          this.logicViewModel.selectedBlockId = event.id;
        }
        this.pendingItemContext = itemContext;
        this.append('hand.draw', `Swipe ${direction}`);
        this.run();
        return;
      }
    }
  }

  // Loads global (and screen-scoped) variable defaults into `variables` up
  // front, so data-bound repeat lists render on the very first paint and an
  // item tap resolves its context on the first tap. Safe to call repeatedly.
  primeVariables(): void {
    const seeded: Record<string, string> = { ...this._variables };
    for (const variable of this.designViewModel?.project.globalVariables ?? []) {
      if (seeded[variable.name] === undefined) {
        seeded[variable.name] = variable.defaultValue ?? this.defaultValue(variable.type);
      }
    }
    for (const flow of this.logicViewModel?.flows ?? []) {
      for (const variable of flow.variables) {
        if (variable.scope !== 'flow' && seeded[variable.name] === undefined) {
          seeded[variable.name] = variable.defaultValue ?? this.defaultValue(variable.type);
        }
      }
    }
    if (!shallowEqual(seeded, this._variables)) this.variables = seeded;
  }

  runEvent(types: readonly LogicBlockType[] | ReadonlySet<LogicBlockType>, nodeId?: string): void {
    const wanted: ReadonlySet<LogicBlockType> =
      types instanceof Set ? (types as ReadonlySet<LogicBlockType>) : new Set(types as readonly LogicBlockType[]);
    const flows = this.logicViewModel?.flows;
    if (!flows) return;
    for (const flow of flows) {
      if (nodeId !== undefined && flow.screenNodeId !== undefined && flow.screenNodeId !== nodeId) {
        continue;
      }
      const event = flow.blocks.find((block) => {
        if (!wanted.has(block.type)) return false;
        if (nodeId !== undefined) {
          return flow.screenNodeId === nodeId || block.parameters.some((p) => p.nodeReference === nodeId);
        }
        return true;
      });
      if (event) {
        if (this._isRunning) {
          this.stop();
        }
        if (this.logicViewModel) {
          this.logicViewModel.currentFlowId = flow.id;
          this.logicViewModel.selectedBlockId = event.id;
        }
        this.run();
        return;
      }
    }
  }

  // MARK: - Control

  run(): void {
    const flow = this.logicViewModel?.currentFlow;
    if (!flow) return;
    this.stop();

    if (this.savedNodes === undefined) {
      const snapshot = this.designViewModel?.snapshotNodesForSimulation();
      this.savedNodes = snapshot ? (JSON.parse(JSON.stringify(snapshot)) as DesignNode[]) : undefined;
    }

    this.log = [];

    // Start from whatever persisted, then seed defaults only for names
    // never seen before — an already-persisted value must win over a
    // fresh default, or persistence would be pointless.
    const seeded: Record<string, string> = { ...this.persistentState };
    for (const variable of this.designViewModel?.project.globalVariables ?? []) {
      if (seeded[variable.name] === undefined) {
        seeded[variable.name] = variable.defaultValue ?? this.defaultValue(variable.type);
      }
    }
    const flowLocalNames = new Set<string>();
    for (const variable of flow.variables) {
      if (variable.scope === 'flow') {
        // Explicit scratch semantics: always fresh, every run.
        flowLocalNames.add(variable.name);
        seeded[variable.name] = variable.defaultValue ?? this.defaultValue(variable.type);
      } else if (seeded[variable.name] === undefined) {
        seeded[variable.name] = variable.defaultValue ?? this.defaultValue(variable.type);
      }
    }
    // Tapped repeat-row item data lands last so it beats any defaults.
    for (const [name, itemValue] of Object.entries(this.pendingItemContext)) {
      seeded[name] = itemValue;
    }
    this.pendingItemContext = {};
    this.variables = seeded;
    this.currentFlowLocalNames = flowLocalNames;

    const events = flow.blocks.filter((b) => BlockCatalog.definition(b.type)?.inputPortCount === 0);
    const selected = this.logicViewModel?.selectedBlockId;
    const event = events.find((b) => b.id === selected) ?? events[0];
    if (!event) {
      this.append(
        'exclamationmark.triangle',
        'No event block to start from — add an On Tap / On Screen Load first.',
        true,
      );
      return;
    }

    this.isRunning = true;
    this.append('play.fill', `▶ Running '${flow.name}' from '${event.label}'`);

    const task: SimTask = { cancelled: false };
    this.runTask = task;
    this.runPromise = (async () => {
      await this.execute(event, flow, task);
      this.append('flag.checkered', 'Flow finished');
      this.isRunning = false;
      if (this.logicViewModel) this.logicViewModel.simActiveBlockId = undefined;
      if (this.runTask === task) {
        this.runTask = undefined;
        this.runPromise = undefined;
      }
    })();
  }

  stop(): void {
    if (this.runTask) this.runTask.cancelled = true;
    this.runTask = undefined;
    this.runPromise = undefined;
    this.choiceContinuation?.(0);
    this.choiceContinuation = undefined;
    this.awaitingChoice = undefined;
    this.isRunning = false;
    if (this.logicViewModel) this.logicViewModel.simActiveBlockId = undefined;
  }

  /** Awaits the flow currently running (and anything it starts while finishing). */
  async waitForIdle(): Promise<void> {
    let pending = this.runPromise;
    while (pending) {
      await pending;
      pending = this.runPromise === pending ? undefined : this.runPromise;
    }
  }

  // Restores the design screen to its pre-simulation state.
  resetUI(): void {
    this.stop();
    this.stopAllTimers();
    if (this.savedNodes) {
      this.designViewModel?.restoreNodesFromSimulation(this.savedNodes);
    }
    this.savedNodes = undefined;
    this.hasUIChanges = false;
    this.persistentState = {};
    this.firestoreMock = {};
    this.navigationHistory = [];
    this.append('arrow.uturn.backward', 'UI restored to pre-run state');
  }

  // MARK: - Timers

  // Cancels every running timer (named + screen-scheduled). Called when
  // the preview closes or resets — deliberately NOT from stop(), which
  // run() calls at the start of every flow (timers must survive that).
  stopAllTimers(): void {
    for (const task of this.namedTimerTasks.values()) task.cancelled = true;
    this.namedTimerTasks = new Map();
    for (const task of this.screenTimerTasks) task.cancelled = true;
    this.screenTimerTasks = [];
  }

  // (Re)arms every On Timer event flow scoped to this screen (or unscoped):
  // each fires after its `seconds`, repeating if `repeats` is true, until
  // the preview navigates away.
  scheduleScreenTimers(screenId: string): void {
    for (const task of this.screenTimerTasks) task.cancelled = true;
    this.screenTimerTasks = [];
    const flows = this.logicViewModel?.flows;
    if (!flows) return;

    for (const flow of flows) {
      if (!(flow.screenNodeId === undefined || flow.screenNodeId === screenId)) continue;
      for (const event of flow.blocks) {
        if (event.type !== 'onTimer') continue;
        const seconds = Math.max(
          swiftDouble(event.parameters.find((p) => p.key === 'seconds')?.value ?? '1') ?? 1,
          0.05,
        );
        const repeats = event.parameters.find((p) => p.key === 'repeats')?.value === 'true';
        const flowId = flow.id;
        const eventId = event.id;
        const task: SimTask = { cancelled: false };
        void (async () => {
          do {
            await this.clock.sleep(seconds * 1000);
            if (task.cancelled) return;
            this.fireFlow(flowId, eventId, '⏱ Timer');
          } while (repeats && !task.cancelled);
        })();
        this.screenTimerTasks.push(task);
      }
    }
  }

  private startNamedTimer(name: string, seconds: number): void {
    const existing = this.namedTimerTasks.get(name);
    if (existing) existing.cancelled = true;
    const task: SimTask = { cancelled: false };
    this.namedTimerTasks.set(name, task);
    void (async () => {
      while (!task.cancelled) {
        await this.clock.sleep(Math.max(seconds, 0.05) * 1000);
        if (task.cancelled) return;
        this.fireCustomEvent(name, `⏱ Timer '${name}'`);
      }
    })();
  }

  private stopNamedTimer(name: string): void {
    const existing = this.namedTimerTasks.get(name);
    if (existing) existing.cancelled = true;
    this.namedTimerTasks.delete(name);
  }

  // Runs the Custom Event flow whose Action Name matches — how a named
  // timer's ticks (or future generated hooks) enter the flow graph.
  private fireCustomEvent(name: string, sourceLabel: string): void {
    const flows = this.logicViewModel?.flows;
    if (!flows) return;
    for (const flow of flows) {
      const event = flow.blocks.find(
        (block) =>
          block.type === 'customEvent' && (block.parameters.find((p) => p.key === 'name')?.value ?? '') === name,
      );
      if (event) {
        this.fireFlow(flow.id, event.id, sourceLabel);
        return;
      }
    }
  }

  // Timer-safe flow trigger: skips the tick (instead of queueing) if a
  // flow is already mid-run, so ticks never interleave two flows.
  private fireFlow(flowId: string, eventId: string, sourceLabel: string): void {
    if (this._isRunning) return;
    if (this.logicViewModel) {
      this.logicViewModel.currentFlowId = flowId;
      this.logicViewModel.selectedBlockId = eventId;
    }
    this.append('timer', `${sourceLabel} fired`);
    this.run();
  }

  // MARK: - Game bridge

  // Live game scenes (AgentGameView) report into the logic layer here: the
  // score/lifecycle land in variables (so any bound Text/visibility reacts
  // instantly via refreshAllBindings), and onCollision runFlow behaviors can
  // fire real logic flows by name or id.
  handleGameEvent(event: GameEvent): void {
    switch (event.kind) {
      case 'started':
        this.setVariableValue('gameOver', 'false');
        this.setVariableValue('gameWon', 'false');
        this.runEvent(['onGameStart']);
        break;
      case 'scoreChanged':
        this.setVariableValue('gameScore', `${event.score}`);
        this.runEvent(['onGameScore']);
        break;
      case 'gameOver':
        this.setVariableValue('gameScore', `${event.score}`);
        this.setVariableValue('gameOver', 'true');
        this.runEvent(['onGameOver']);
        this.triggerGameFlow('onGameOver');
        break;
      case 'won':
        this.setVariableValue('gameScore', `${event.score}`);
        this.setVariableValue('gameWon', 'true');
        this.runEvent(['onGameWin']);
        this.triggerGameFlow('onGameWin');
        break;
      case 'runFlow':
        this.triggerGameFlow(event.flowId);
        break;
      case 'collision':
        this.fireGameCollisionFlow(event.categoryA, event.categoryB, event.entityA, event.entityB);
        break;
      case 'tap':
        this.setVariableValue('gameTapX', String(Math.trunc(event.x)));
        this.setVariableValue('gameTapY', String(Math.trunc(event.y)));
        this.runEvent(['onGameTap']);
        break;
      case 'drag':
        this.setVariableValue('gameDragPhase', event.phase);
        this.setVariableValue('gameDragX', String(Math.trunc(event.x)));
        this.setVariableValue('gameDragY', String(Math.trunc(event.y)));
        this.fireGameDragFlow(event.phase);
        break;
      case 'entityDestroyed':
        this.setVariableValue('gameDestroyed', event.category);
        this.fireGameDestroyedFlow(event.category);
        break;
      case 'lifeLost':
        this.setVariableValue('gameLives', `${event.remaining}`);
        this.runEvent(['onGameLifeLost']);
        break;
      case 'spawned':
        this.setVariableValue('gameSpawned', event.category);
        this.fireGameSpawnedFlow(event.category);
        break;
      case 'impact':
        this.setVariableValue('gameImpactForce', String(Math.trunc(event.force)));
        this.fireGameImpactFlow(event.categoryA, event.categoryB, event.force, event.entityA, event.entityB);
        break;
      case 'launched':
        this.setVariableValue('gameLaunched', event.entityId);
        this.runEvent(['onGameLaunched']);
        break;
    }
  }

  /** Runs the first On Impact flow whose category filters match the pair AND
   * whose minForce threshold the hit cleared (light grazes stay silent). */
  private fireGameImpactFlow(a: string, b: string, force: number, idA: string, idB: string): void {
    const flows = this.logicViewModel?.flows;
    if (this._isRunning || !flows) return;
    for (const flow of flows) {
      const event = flow.blocks.find((blk) => blk.type === 'onGameImpact');
      if (!event) continue;
      const fa = event.parameters.find((p) => p.key === 'categoryA')?.value ?? '';
      const fb = event.parameters.find((p) => p.key === 'categoryB')?.value ?? '';
      const minForce = swiftDouble(event.parameters.find((p) => p.key === 'minForce')?.value ?? '0') ?? 0;
      if (!(force >= minForce)) continue;
      // Normalize to the FILTER's order: if you filter A=pig, B=bird then
      // gameImpactEntityA is always the pig — otherwise every flow would
      // need to guess which side of the contact it got.
      const swap = (fa !== '' && fa === b) || (fb !== '' && fb === a);
      const ca = swap ? b : a;
      const cb = swap ? a : b;
      const ea = swap ? idB : idA;
      const eb = swap ? idA : idB;
      const match = (fa === '' || fa === ca) && (fb === '' || fb === cb);
      if (match) {
        this.setVariableValue('gameImpactA', ca);
        this.setVariableValue('gameImpactB', cb);
        this.setVariableValue('gameImpactEntityA', ea);
        this.setVariableValue('gameImpactEntityB', eb);
        this.fireFlow(flow.id, event.id, `impact ${ca}×${cb} @${Math.trunc(force)}`);
        return;
      }
    }
  }

  private fireGameSpawnedFlow(category: string): void {
    const flows = this.logicViewModel?.flows;
    if (this._isRunning || !flows) return;
    for (const flow of flows) {
      const event = flow.blocks.find((b) => b.type === 'onGameSpawned');
      if (!event) continue;
      const wanted = event.parameters.find((p) => p.key === 'category')?.value ?? '';
      if (wanted === '' || wanted === category) {
        this.fireFlow(flow.id, event.id, `spawned ${category}`);
        return;
      }
    }
  }

  private fireGameDragFlow(phase: string): void {
    const flows = this.logicViewModel?.flows;
    if (this._isRunning || !flows) return;
    for (const flow of flows) {
      const event = flow.blocks.find((b) => b.type === 'onGameDrag');
      if (!event) continue;
      const wanted = event.parameters.find((p) => p.key === 'phase')?.value ?? 'move';
      if (wanted === 'any' || wanted === phase) {
        this.fireFlow(flow.id, event.id, `game drag ${phase}`);
        return;
      }
    }
  }

  private fireGameDestroyedFlow(category: string): void {
    const flows = this.logicViewModel?.flows;
    if (this._isRunning || !flows) return;
    for (const flow of flows) {
      const event = flow.blocks.find((b) => b.type === 'onGameEntityDestroyed');
      if (!event) continue;
      const wanted = event.parameters.find((p) => p.key === 'category')?.value ?? '';
      if (wanted === '' || wanted === category) {
        this.fireFlow(flow.id, event.id, `destroyed ${category}`);
        return;
      }
    }
  }

  /** Runs the first On Game Collision flow whose category filters match the
   * touching pair (either order; an empty filter matches anything). */
  private fireGameCollisionFlow(a: string, b: string, idA: string, idB: string): void {
    const flows = this.logicViewModel?.flows;
    if (this._isRunning || !flows) return;
    for (const flow of flows) {
      const event = flow.blocks.find((blk) => blk.type === 'onGameCollision');
      if (!event) continue;
      const fa = event.parameters.find((p) => p.key === 'categoryA')?.value ?? '';
      const fb = event.parameters.find((p) => p.key === 'categoryB')?.value ?? '';
      const match = (fa === '' || fa === a || fa === b) && (fb === '' || fb === a || fb === b);
      if (match) {
        // Same normalization as impacts: entityA is always the categoryA
        // thing, so a flow can remove exactly what it hit.
        const swap = (fa !== '' && fa === b) || (fb !== '' && fb === a);
        this.setVariableValue('gameCollisionEntityA', swap ? idB : idA);
        this.setVariableValue('gameCollisionEntityB', swap ? idA : idB);
        this.fireFlow(flow.id, event.id, `game collision ${a}×${b}`);
        return;
      }
    }
  }

  /** Fires a flow by id or (fuzzy) name — used by game events. Silently a
   * no-op when no such flow exists, so games without wired flows just play. */
  private triggerGameFlow(reference: string): void {
    const flows = this.logicViewModel?.flows;
    if (!flows) return;
    const lower = reference.toLowerCase();
    const flow =
      flows.find((f) => f.id.toLowerCase() === lower) ??
      flows.find((f) => f.name.toLowerCase() === lower) ??
      flows.find((f) => f.name.toLowerCase().includes(lower));
    if (!flow) return;
    const event = flow.blocks.find((b) => b.category === LogicBlockCategory.event) ?? flow.blocks[0];
    if (!event) return;
    this.fireFlow(flow.id, event.id, `game → ${flow.name}`);
  }

  // MARK: - Reactive bindings

  // Re-pushes every logicBindings-bound node's property from the current
  // variables — called on every variables mutation (see the setter above) so
  // bound UI always reflects the latest value.
  private refreshAllBindings(): void {
    const design = this.designViewModel;
    const page = design?.project.pages[design.currentPageIndex];
    if (!design || !page) return;
    this.refreshBindings(page.nodes);
  }

  private refreshBindings(nodes: DesignNode[]): void {
    for (const node of nodes) {
      for (const binding of node.logicBindings ?? []) {
        const newValue = this._variables[binding.variableName];
        if (newValue === undefined) continue;

        switch (binding.kind) {
          case 'text':
          case 'value': {
            if (node.text === newValue) continue;
            this.designViewModel?.simulateUpdateNode(node.id, (n) => {
              n.text = newValue;
            });
            this.hasUIChanges = true;
            break;
          }
          case 'visibility': {
            const targetOpacity = newValue === 'false' ? 0.08 : 1;
            if (node.style.opacity === targetOpacity) continue;
            this.designViewModel?.simulateUpdateNode(node.id, (n) => {
              n.style.opacity = targetOpacity;
            });
            this.hasUIChanges = true;
            break;
          }
          case 'enabled': {
            const targetOpacity = newValue === 'false' ? 0.45 : 1;
            if (node.style.opacity === targetOpacity) continue;
            this.designViewModel?.simulateUpdateNode(node.id, (n) => {
              n.style.opacity = targetOpacity;
            });
            this.hasUIChanges = true;
            break;
          }
          case 'isOn':
          case 'selectedIndex':
            // No generic visual stand-in in the preview yet; the exporter
            // reads these directly at code-gen time.
            break;
        }
      }

      if (node.children.length > 0) {
        this.refreshBindings(node.children);
      }
    }
  }

  choose(index: number): void {
    this.awaitingChoice = undefined;
    this.choiceContinuation?.(index);
    this.choiceContinuation = undefined;
  }

  // MARK: - Execution

  private async execute(block: LogicBlock, flow: LogicFlow, task: SimTask): Promise<void> {
    if (task.cancelled) return;

    if (this.logicViewModel) this.logicViewModel.simActiveBlockId = block.id;
    const port = await this.perform(block);

    if (block.category !== LogicBlockCategory.event) {
      await this.clock.sleep(this._speed * 1000);
    }
    if (task.cancelled) return;

    const next = flow.connections.filter((c) => c.sourceBlockId === block.id && c.sourcePortIndex === port);
    for (const connection of next) {
      const target = flow.blocks.find((b) => b.id === connection.targetBlockId);
      if (target) {
        await this.execute(target, flow, task);
      }
    }
  }

  /** Device sensors. A Mac can't read an iPhone's gyroscope or a Watch's
   * heart rate, so the preview returns plausible sample readings and says
   * so — the flow is still exercised end to end, and the exported app reads
   * the real hardware. */
  private performSensor(block: LogicBlock): number {
    const store = (key: string, value: string): void => {
      const name = block.parameters.find((p) => p.key === key)?.variableReference;
      if (name === undefined) return;
      this.setVariableValue(name, value);
    };

    switch (block.type) {
      case 'getLocation':
        store('latitudeVariable', '32.0853');
        store('longitudeVariable', '34.7818');
        this.append('location.fill', 'Location → 32.0853, 34.7818 (sample — real GPS on device)');
        break;
      case 'readMotion':
        store('xVariable', '0.02');
        store('yVariable', '-0.98');
        store('zVariable', '0.11');
        this.append('gyroscope', 'Motion → x 0.02, y −0.98, z 0.11 (sample)');
        break;
      case 'readHeartRate':
        store('variable', '72');
        this.append('heart.fill', 'Heart rate → 72 bpm (sample — HealthKit on Apple Watch)');
        break;
      case 'readStepCount':
        store('variable', '8432');
        this.append('figure.walk', 'Steps today → 8,432 (sample — pedometer/HealthKit)');
        break;
      case 'readBatteryLevel':
        store('variable', '87');
        this.append('battery.75', 'Battery → 87% (sample)');
        break;
      case 'startTracking': {
        const distVar = block.parameters.find((p) => p.key === 'distanceVariable')?.variableReference;
        const spdVar = block.parameters.find((p) => p.key === 'speedVariable')?.variableReference;
        if (distVar && (!this._variables[distVar] || this._variables[distVar] === '0')) {
          this.setVariableValue(distVar, '0');
        }
        if (spdVar) {
          this.setVariableValue(spdVar, '10.8');
        }
        this.append('location.fill', 'GPS Tracking started (sample 10.8 km/h)');
        break;
      }
      case 'stopTracking':
        this.append('location.slash', 'GPS Tracking stopped');
        break;
      default:
        this.append('sensor', `${block.label} (sample)`);
        break;
    }
    return 0;
  }

  // Executes one block and returns which output port the flow continues on.
  private async perform(block: LogicBlock): Promise<number> {
    const def = BlockCatalog.definition(block.type);

    switch (block.category) {
      case LogicBlockCategory.event:
        this.append('bolt.fill', `Event: ${block.label}`);
        return 0;

      case LogicBlockCategory.action:
        return await this.performAction(block);

      case LogicBlockCategory.condition: {
        const result = this.evaluateCondition(block);
        this.append('arrow.triangle.branch', `${block.label} → ${result === 0 ? 'then/true' : 'else/false'}`);
        return result;
      }

      case LogicBlockCategory.device:
        return this.performSensor(block);

      case LogicBlockCategory.api:
        return await this.performAPI(block);

      case LogicBlockCategory.firebase: {
        // Firestore data blocks run for real against an in-memory mock
        // store (writes land, reads/queries return them), so data flows
        // are testable unattended. Auth blocks keep the manual
        // Success/Error choice — there's no meaningful way to fake them.
        switch (block.type) {
          case 'firestoreAddDocument':
          case 'firestoreSetDocument':
          case 'firestoreGetDocument':
          case 'firestoreUpdateDocument':
          case 'firestoreDeleteDocument':
          case 'firestoreQuery':
          case 'firestoreListenDocument':
          case 'firestoreListenQuery':
          case 'firestoreBatchWrite':
            return this.performFirestoreMock(block);
          default:
            break;
        }
        const labels = def?.outputPortLabels ?? ['Success', 'Error'];

        // "Is someone signed in?" needs no human: the preview session
        // itself knows. A fresh preview has no session → Signed Out, which
        // is exactly what a cold launch of the real app does.
        if (block.type === 'firebaseGetCurrentUser' || block.type === 'firebaseAuthStateChanged') {
          const uid = this._variables['currentUserId'] ?? '';
          const signedIn = uid !== '';
          const param = block.parameters.find((p) => p.key === 'variable');
          const storeIn = param?.variableReference ?? param?.value;
          if (storeIn !== undefined && storeIn !== '') {
            this.setVariableValue(storeIn, signedIn ? uid : '');
          }
          this.append(
            signedIn ? 'person.crop.circle.badge.checkmark' : 'person.crop.circle.badge.questionmark',
            `${block.label} → ${signedIn ? `Signed In (${uid})` : 'Signed Out — no preview session yet'}`,
          );
          return signedIn ? 0 : 1;
        }

        this.append('flame.fill', `${block.label} — waiting for your choice…`);
        const choice = await this.awaitBranchChoice(block, labels);
        if (block.type === 'firebaseLogin' && choice === 0) {
          this.setVariableValue('currentUserEmail', this.value(block, 'email') ?? 'user@example.com');
          this.setVariableValue('currentUserId', 'sim-user-001');
        }
        if (block.type === 'firebaseRegister' && choice === 0) {
          this.setVariableValue('currentUserEmail', this.value(block, 'email') ?? 'user@example.com');
          this.setVariableValue('currentUserId', 'sim-user-001');
        }
        if (block.type === 'firebaseLogout' && choice === 0) {
          // Otherwise the next auth gate still reports a signed-in user
          // and the preview can never get back to the login screen.
          this.setVariableValue('currentUserId', '');
          this.setVariableValue('currentUserEmail', '');
        }
        this.append(
          choice === 0 ? 'checkmark.circle.fill' : 'xmark.circle.fill',
          `${block.label} → ${choice >= 0 && choice < labels.length ? labels[choice]! : `port ${choice}`}`,
          choice !== 0,
        );
        return choice;
      }

      case LogicBlockCategory.variable:
        return this.performDataOperation(block);

      case LogicBlockCategory.storage:
        return await this.performStorage(block);

      case LogicBlockCategory.ui:
        this.performUIUpdate(block);
        return 0;
    }
  }

  // MARK: - Data & Backends

  // Supabase/Algolia are plain REST APIs, so the simulator hits them for
  // real (same as an HTTP Request block). SQLite needs a linked C library
  // the host app doesn't carry, so it falls back to a manual Success/Error
  // choice — same convention as the Firebase blocks above.
  private async performStorage(block: LogicBlock): Promise<number> {
    switch (block.type) {
      case 'supabaseSignUp':
      case 'supabaseSignIn':
      case 'supabaseSignOut':
      case 'supabaseCurrentUser': {
        const config = this.designViewModel?.project.supabaseConfig;
        if (!config || !supabaseConfigIsConfigured(config)) {
          this.append('person.crop.circle.badge.xmark', "Supabase isn't configured — skipping auth call", true);
          return 1;
        }
        const session = block.parameters.find((p) => p.key === 'sessionVariable')?.variableReference;

        if (block.type === 'supabaseSignOut') {
          if (session !== undefined) this.setVariableValue(session, '');
          this.append('rectangle.portrait.and.arrow.right', 'Signed out');
          return 0;
        }

        let path: string;
        let method = 'POST';
        let body: string | undefined;
        switch (block.type) {
          case 'supabaseSignUp':
            path = '/auth/v1/signup';
            break;
          case 'supabaseSignIn':
            path = '/auth/v1/token?grant_type=password';
            break;
          default:
            path = '/auth/v1/user';
            method = 'GET';
            break;
        }
        if (method === 'POST') {
          const email = this.substitute(this.value(block, 'email') ?? '');
          const password = this.substitute(this.value(block, 'password') ?? '');
          if (email === '' || password === '') {
            this.append('xmark.circle.fill', 'Email and password are required', true);
            return 1;
          }
          body = JSON.stringify({ email, password });
        }
        const url = swiftURL(config.projectURL + path);
        if (url === undefined) {
          this.append('network.slash', 'Invalid Supabase project URL', true);
          return 1;
        }
        // Reading the current user needs the signed-in user's token, not
        // the anon key.
        const token = session !== undefined ? this._variables[session] : undefined;
        const headers: Record<string, string> = {
          apikey: config.anonKey,
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token !== undefined && token !== '' ? token : config.anonKey}`,
        };
        this.append('person.crop.circle', `${block.label}…`);
        try {
          const response = await this.request(url, { method, headers, body });
          const status = response.status;
          const ok = status >= 200 && status < 300;
          const text = await response.text();
          const parsed = jsonObjectFrom(text);
          const accessToken = parsed?.['access_token'];
          if (ok && typeof accessToken === 'string' && session !== undefined) {
            this.setVariableValue(session, accessToken);
          }
          const userVariable = block.parameters.find((p) => p.key === 'userVariable')?.variableReference;
          if (userVariable !== undefined) {
            this.setVariableValue(userVariable, prefixUTF8(text, 4000));
          }
          this.append(
            ok ? 'checkmark.circle.fill' : 'xmark.circle.fill',
            `Supabase auth → HTTP ${status}`,
            !ok,
          );
          return ok ? 0 : 1;
        } catch (error) {
          this.append('xmark.circle.fill', `Supabase auth failed: ${errorDescription(error)}`, true);
          return 1;
        }
      }

      case 'supabaseInsert':
      case 'supabaseUpdate':
      case 'supabaseDelete':
      case 'supabaseQuery': {
        const config = this.designViewModel?.project.supabaseConfig;
        if (!config || !supabaseConfigIsConfigured(config)) {
          this.append('tray.and.arrow.down', "Supabase isn't configured — skipping real call", true);
          return 1;
        }
        const table = this.value(block, 'table') ?? '';
        let base = `${config.projectURL}/rest/v1/${table}`;
        let method = 'GET';
        let body: string | undefined;
        let queryItems: { name: string; value: string }[] = [];
        switch (block.type) {
          case 'supabaseInsert':
            method = 'POST';
            body = this.keyValueJSON(block, 'data');
            break;
          case 'supabaseUpdate':
            method = 'PATCH';
            body = this.keyValueJSON(block, 'data');
            queryItems = this.filterQueryItems(this.value(block, 'filter'));
            break;
          case 'supabaseDelete':
            method = 'DELETE';
            queryItems = this.filterQueryItems(this.value(block, 'filter'));
            break;
          default: {
            queryItems = this.filterQueryItems(this.value(block, 'filter'));
            const limit = this.value(block, 'limit');
            if (limit !== undefined) queryItems.push({ name: 'limit', value: limit });
            break;
          }
        }
        if (queryItems.length > 0) {
          base += `?${queryItems
            .map((i) => `${encodeQueryComponent(i.name)}=${encodeQueryComponent(i.value)}`)
            .join('&')}`;
        }
        const url = swiftURL(base);
        if (url === undefined) {
          this.append('network.slash', 'Invalid Supabase table/filter', true);
          return 1;
        }
        const headers: Record<string, string> = {
          apikey: config.anonKey,
          Authorization: `Bearer ${config.anonKey}`,
          'Content-Type': 'application/json',
        };
        if (method !== 'GET') headers['Prefer'] = 'return=representation';
        this.append('tray.and.arrow.down', `${method} ${url}…`);
        try {
          const response = await this.request(url, { method, headers, body });
          const status = response.status;
          const ok = status >= 200 && status < 300;
          const text = await response.text();
          const storeIn = block.parameters.find((p) => p.key === 'variable')?.variableReference;
          if (storeIn !== undefined) this.setVariableValue(storeIn, prefixUTF8(text, 6000));
          this.append(ok ? 'checkmark.circle.fill' : 'xmark.circle.fill', `Supabase → HTTP ${status}`, !ok);
          return ok ? 0 : 1;
        } catch (error) {
          this.append('xmark.circle.fill', `Supabase request failed: ${errorDescription(error)}`, true);
          return 1;
        }
      }

      case 'algoliaSearch': {
        const appId = this.value(block, 'appId') ?? '';
        const apiKey = this.value(block, 'apiKey') ?? '';
        const index = this.value(block, 'index') ?? '';
        const query = this.substitute(this.value(block, 'query') ?? '');
        const url = swiftURL(`https://${appId}-dsn.algolia.net/1/indexes/${index}/query`);
        if (appId === '' || apiKey === '' || index === '' || url === undefined) {
          this.append('magnifyingglass', 'Algolia needs Application ID, API Key and Index', true);
          return 1;
        }
        this.append('magnifyingglass', `Algolia search '${query}' in ${index}…`);
        try {
          const response = await this.request(url, {
            method: 'POST',
            headers: { 'X-Algolia-Application-Id': appId, 'X-Algolia-API-Key': apiKey },
            body: JSON.stringify({ params: `query=${query}` }),
          });
          const status = response.status;
          const ok = status >= 200 && status < 300;
          const text = await response.text();
          const storeIn = block.parameters.find((p) => p.key === 'variable')?.variableReference;
          if (storeIn !== undefined) this.setVariableValue(storeIn, prefixUTF8(text, 6000));
          this.append(ok ? 'checkmark.circle.fill' : 'xmark.circle.fill', `Algolia → HTTP ${status}`, !ok);
          return ok ? 0 : 1;
        } catch (error) {
          this.append('xmark.circle.fill', `Algolia request failed: ${errorDescription(error)}`, true);
          return 1;
        }
      }

      case 'logAnalyticsEvent':
        this.append('chart.bar.xaxis', `Analytics event: ${this.value(block, 'name') ?? '?'} (simulated)`);
        return 0;

      case 'sqliteQuery':
      case 'sqliteExecute': {
        this.append('cylinder.split.1x2', `${block.label} — waiting for your choice (no local DB in preview)…`);
        const choice = await this.awaitBranchChoice(
          block,
          BlockCatalog.definition(block.type)?.outputPortLabels ?? ['Success', 'Error'],
        );
        this.append(
          choice === 0 ? 'checkmark.circle.fill' : 'xmark.circle.fill',
          `${block.label} → ${choice === 0 ? 'Success' : 'Error'}`,
          choice !== 0,
        );
        return choice;
      }

      default:
        this.append('questionmark.square.dashed', block.label);
        return 0;
    }
  }

  // MARK: - Firestore mock

  // In-memory Firestore: writes store JSON under "collection/docId", reads
  // and queries fetch it back. Deterministic, offline, reset by resetUI().
  private performFirestoreMock(block: LogicBlock): number {
    const dataJSON = (): string => this.keyValueJSON(block, 'data') ?? '{}';

    switch (block.type) {
      case 'firestoreAddDocument': {
        const collection = this.substitute(this.value(block, 'collection') ?? 'items');
        const docId = newUUID().slice(0, 8).toLowerCase();
        this.firestoreMock[`${collection}/${docId}`] = dataJSON();
        this.append('plus.rectangle.on.folder', `Mock Firestore: added ${collection}/${docId}`);
        return 0;
      }

      case 'firestoreSetDocument': {
        const collection = this.substitute(this.value(block, 'collection') ?? 'items');
        const explicit = this.substitute(this.value(block, 'documentId') ?? '');
        const docId = explicit === '' ? newUUID().slice(0, 8).toLowerCase() : explicit;
        this.firestoreMock[`${collection}/${docId}`] = dataJSON();
        this.append('tray.and.arrow.down', `Mock Firestore: saved ${collection}/${docId}`);
        return 0;
      }

      case 'firestoreGetDocument': {
        const path = this.substitute(this.value(block, 'path') ?? '');
        const doc = this.firestoreMock[path];
        if (doc === undefined) {
          this.append('tray.and.arrow.up', `Mock Firestore: no document at '${path}'`, true);
          return 1;
        }
        const storeIn = block.parameters.find((p) => p.key === 'variable')?.variableReference;
        if (storeIn !== undefined) this.setVariableValue(storeIn, doc);
        this.append('tray.and.arrow.up', `Mock Firestore: read ${path}`);
        return 0;
      }

      case 'firestoreUpdateDocument': {
        const path = this.substitute(this.value(block, 'path') ?? '');
        const existing = this.firestoreMock[path];
        if (existing === undefined) {
          this.append('square.and.pencil', `Mock Firestore: no document at '${path}' to update`, true);
          return 1;
        }
        const merged: Record<string, unknown> = jsonObjectFrom(existing) ?? {};
        const data = this.keyValueJSON(block, 'data');
        const updates = data !== undefined ? jsonObjectFrom(data) : undefined;
        if (updates) {
          for (const [key, val] of Object.entries(updates)) merged[key] = val;
        }
        this.firestoreMock[path] = JSON.stringify(merged);
        this.append('square.and.pencil', `Mock Firestore: updated ${path}`);
        return 0;
      }

      case 'firestoreDeleteDocument': {
        const path = this.substitute(this.value(block, 'path') ?? '');
        delete this.firestoreMock[path];
        this.append('trash', `Mock Firestore: deleted ${path}`);
        return 0;
      }

      case 'firestoreQuery':
      case 'firestoreListenQuery': {
        const collection = this.substitute(this.value(block, 'collection') ?? '');
        const prefix = `${collection}/`;
        let docs: Record<string, unknown>[] = [];
        for (const path of Object.keys(this.firestoreMock).sort()) {
          if (!path.startsWith(prefix)) continue;
          const doc = jsonObjectFrom(this.firestoreMock[path]!);
          if (doc) {
            const documentId = path.slice(prefix.length);
            doc['id'] = documentId;
            // Same key the native exporter merges, so a delete/detail
            // flow built against {{item._id}} behaves identically in the
            // preview and in the shipped app.
            doc['_id'] = documentId;
            docs.push(doc);
          }
        }
        const limit = swiftInt(this.value(block, 'limit') ?? '');
        if (limit !== null && limit > 0) {
          docs = docs.slice(0, limit);
        }
        const storeIn = block.parameters.find((p) => p.key === 'variable')?.variableReference;
        if (storeIn !== undefined) {
          this.setVariableValue(storeIn, JSON.stringify(docs));
        }
        const suffix = block.type === 'firestoreListenQuery' ? ' (listener simulated as one-time read)' : '';
        this.append(
          'line.3.horizontal.decrease.circle',
          `Mock Firestore: ${collection} → ${docs.length} document(s)${suffix}`,
        );
        return 0;
      }

      case 'firestoreListenDocument': {
        const path = this.substitute(this.value(block, 'path') ?? '');
        const doc = this.firestoreMock[path];
        const storeIn = block.parameters.find((p) => p.key === 'variable')?.variableReference;
        if (doc !== undefined && storeIn !== undefined) {
          this.setVariableValue(storeIn, doc);
        }
        this.append(
          'dot.radiowaves.left.and.right',
          `Mock Firestore: listening to ${path} (simulated as one-time read)`,
        );
        return 0;
      }

      case 'firestoreBatchWrite':
        this.append('square.stack.3d.up', 'Mock Firestore: batch write applied');
        return 0;

      default:
        return 0;
    }
  }

  private keyValueJSON(block: LogicBlock, key: string): string | undefined {
    const param = block.parameters.find((p) => p.key === key);
    const raw = param?.value;
    if (!param || raw === undefined || raw === '') return undefined;
    const fields: Record<string, string> = {};
    for (const line of raw.split('\n')) {
      if (line === '') continue;
      const separator = line.indexOf('=');
      if (separator < 0) continue;
      const name = line.slice(0, separator);
      const value = line.slice(separator + 1);
      fields[name.trim()] = this.substitute(value.trim());
    }
    return JSON.stringify(fields);
  }

  private filterQueryItems(filter: string | undefined): { name: string; value: string }[] {
    if (filter === undefined || filter === '') return [];
    const out: { name: string; value: string }[] = [];
    for (const pair of filter.split('&')) {
      if (pair === '') continue;
      const separator = pair.indexOf('=');
      if (separator < 0) continue;
      out.push({ name: pair.slice(0, separator), value: pair.slice(separator + 1) });
    }
    return out;
  }

  // MARK: - Actions

  private async performAction(block: LogicBlock): Promise<number> {
    switch (block.type) {
      case 'confirmDialog': {
        const confirmLabel = this.value(block, 'confirmLabel') ?? 'Confirm';
        const cancelLabel = this.value(block, 'cancelLabel') ?? 'Cancel';
        this.append('questionmark.bubble', `${block.label} — waiting for your choice…`);
        const choice = await this.awaitBranchChoice(block, [confirmLabel, cancelLabel]);
        this.append(
          choice === 0 ? 'checkmark.circle.fill' : 'xmark.circle',
          `${block.label} → ${choice === 0 ? confirmLabel : cancelLabel}`,
          choice !== 0,
        );
        return choice;
      }
      case 'shareContent': {
        const text = this.value(block, 'text') ?? '';
        const url = this.value(block, 'url') ?? '';
        this.append('square.and.arrow.up', `Would share: ${[text, url].filter((s) => s !== '').join(' ')}`);
        break;
      }
      case 'sendEmail':
        this.openOnMac('mailto', this.value(block, 'to') ?? '', 'email to');
        break;
      case 'callNumber':
        this.openOnMac('tel', this.value(block, 'number') ?? '', 'call');
        break;
      case 'sendSMS':
        this.openOnMac('sms', this.value(block, 'number') ?? '', 'SMS to');
        break;
      case 'launchMaps': {
        const query = this.substitute(this.value(block, 'query') ?? '');
        const url = swiftURL(`https://maps.apple.com/?q=${addingPercentEncodingURLQueryAllowed(query)}`);
        if (url !== undefined) this.platformActions.openURL(url);
        this.append('map', `Opened Maps for '${query}'`);
        break;
      }
      case 'requestPermission': {
        const kind = this.value(block, 'kind') ?? 'camera';
        this.append('checkmark.shield', `${block.label} (${kind}) — waiting for your choice…`);
        const choice = await this.awaitBranchChoice(block, ['Granted', 'Denied']);
        this.append(
          choice === 0 ? 'checkmark.circle.fill' : 'xmark.circle',
          `${kind} → ${choice === 0 ? 'Granted' : 'Denied'}`,
          choice !== 0,
        );
        return choice;
      }
      case 'biometricAuth': {
        this.append('faceid', `${block.label} — waiting for your choice…`);
        const choice = await this.awaitBranchChoice(block, ['Success', 'Failed']);
        this.append(
          choice === 0 ? 'checkmark.circle.fill' : 'xmark.circle',
          `Biometric auth → ${choice === 0 ? 'Success' : 'Failed'}`,
          choice !== 0,
        );
        return choice;
      }
      case 'scheduleLocalNotification':
        this.append(
          'bell.badge',
          `Would schedule notification '${this.value(block, 'title') ?? ''}' in ${
            this.value(block, 'seconds') ?? '5'
          }s (simulated)`,
        );
        break;
      case 'setBadgeCount': {
        const count = swiftInt(this.value(block, 'count') ?? '0') ?? 0;
        this.platformActions.setBadgeCount(count);
        this.append('app.badge', `Dock badge → ${count}`);
        break;
      }
      case 'playSound': {
        const file = this.value(block, 'file') ?? '';
        if (this.platformActions.playSound(file)) {
          this.append('speaker.wave.2', `Playing '${file}'`);
        } else {
          this.append(
            'speaker.wave.2',
            `Sound '${file}' not found in preview — will look in the exported app's Resources`,
            true,
          );
        }
        break;
      }
      case 'stopSound':
        this.append('speaker.slash', 'Stopped sound');
        break;
      case 'validateForm': {
        const nodeId = this.nodeReference(block, 'element');
        if (nodeId === undefined) {
          this.append('checkmark.rectangle', `${block.label}: no field linked`, true);
          return 1;
        }
        const text = this.designViewModel?.nodeForSimulation(nodeId)?.text ?? '';
        const valid = this.validate(text, this.value(block, 'rule') ?? 'notEmpty', this.value(block, 'argument') ?? '');
        this.append(
          valid ? 'checkmark.circle.fill' : 'xmark.circle',
          `${block.label} → ${valid ? 'Valid' : 'Invalid'}`,
          !valid,
        );
        return valid ? 0 : 1;
      }
      case 'clearField': {
        const nodeId = this.nodeReference(block, 'element');
        if (nodeId !== undefined) {
          const name = this.logicViewModel?.designNodeName(nodeId) ?? 'field';
          this.designViewModel?.simulateUpdateNode(nodeId, (node) => {
            node.text = '';
            for (const binding of node.logicBindings ?? []) {
              if (binding.kind === 'value' || binding.kind === 'text') {
                this.setVariableValue(binding.variableName, '');
              }
            }
          });
          this.append('xmark.rectangle', `Cleared '${name}'`);
        }
        break;
      }
      case 'executeCustomCode':
        this.append(
          'chevron.left.forwardslash.chevron.right',
          `Custom code only runs in the exported app: ${(this.value(block, 'code') ?? '').slice(0, 80)}`,
        );
        break;
      case 'setDarkModeOverride':
        this.append(
          'circle.lefthalf.filled',
          `Would set color scheme → ${this.value(block, 'mode') ?? 'system'} (simulated)`,
        );
        break;
      case 'downloadFile': {
        const urlString = this.value(block, 'url');
        const url = urlString !== undefined ? swiftURL(this.substitute(urlString)) : undefined;
        if (urlString === undefined || url === undefined) {
          this.append('arrow.down.circle', 'Invalid download URL', true);
          return 1;
        }
        this.append('arrow.down.circle', `Downloading ${url}…`);
        try {
          const response = await this.request(url, { method: 'GET' });
          if (!(response.status >= 200 && response.status < 300)) {
            throw new Error(`HTTP ${response.status}`);
          }
          // No file system in the preview: the "downloaded" location is the
          // URL itself (URLSession.download's temp URL on the Mac).
          const lastComponent = url.split('/').pop() ?? url;
          const storeIn = block.parameters.find((p) => p.key === 'variable')?.variableReference;
          if (storeIn !== undefined) this.setVariableValue(storeIn, url);
          this.append('checkmark.circle.fill', `Downloaded to ${lastComponent}`);
          return 0;
        } catch (error) {
          this.append('xmark.circle.fill', `Download failed: ${errorDescription(error)}`, true);
          return 1;
        }
      }
      case 'navigate':
      case 'presentSheet': {
        const screen = this.resolvedNodeName(block, 'screen') ?? this.value(block, 'screen') ?? '?';
        this.append('arrow.right.circle.fill', `${block.label} → ${screen}`);
        const screenId = this.nodeReference(block, 'screen');
        if (screenId !== undefined) {
          // Remember where we came from, so Go Back can actually pop — the
          // exported app pops for real.
          const current = this._previewScreenId;
          if (current !== undefined && current !== screenId) {
            this.navigationHistory.push(current);
          }
          this.previewScreenId = screenId;
          if (this.onNavigate) {
            this.onNavigate(screenId);
          } else {
            this.designViewModel?.selectNode(screenId);
          }
        }
        break;
      }
      case 'goBack':
      case 'dismissSheet': {
        this.append('arrow.left.circle', block.label);
        const previous = this.navigationHistory.pop();
        if (previous !== undefined) {
          this.previewScreenId = previous;
          if (this.onNavigate) {
            this.onNavigate(previous);
          } else {
            this.designViewModel?.selectNode(previous);
          }
          this.append(
            'arrow.uturn.backward.circle',
            `→ ${this.logicViewModel?.designNodeName(previous) ?? 'previous screen'}`,
          );
        }
        break;
      }
      case 'showAlert': {
        const title = this.value(block, 'title') ?? 'Alert';
        const message = this.value(block, 'message') ?? '';
        this.append('exclamationmark.bubble.fill', `ALERT: ${title}${message === '' ? '' : ` — ${message}`}`);
        this.presentToast(`⚠️ ${title}${message === '' ? '' : ` — ${message}`}`);
        break;
      }
      case 'showToast': {
        const message = this.value(block, 'message') ?? '';
        this.append('text.bubble', `TOAST: ${message}`);
        this.presentToast(message);
        break;
      }
      case 'openURL':
        this.append('safari', `Would open: ${this.value(block, 'url') ?? '?'}`);
        break;
      case 'copyToClipboard': {
        const text = this.value(block, 'text') ?? '';
        void getPlatform().clipboard.writeText(text);
        this.append('doc.on.doc', `Copied to clipboard: ${text}`);
        break;
      }
      case 'hapticFeedback':
        this.append('iphone.radiowaves.left.and.right', `HAPTIC: ${this.value(block, 'style') ?? 'light'}`);
        this.platformActions.hapticFeedback();
        break;
      case 'log':
        this.append('terminal', `LOG: ${this.value(block, 'message') ?? ''}`);
        break;
      case 'delay': {
        const seconds = Math.max(swiftDouble(this.value(block, 'seconds') ?? '1') ?? 1, 0);
        this.append('hourglass', `Waiting ${this.formattedNumber(seconds)}s…`);
        await this.clock.sleep(seconds * 1000);
        break;
      }
      case 'startTimer': {
        const name = this.value(block, 'name') ?? 'mainTimer';
        const seconds = Math.max(swiftDouble(this.value(block, 'seconds') ?? '1') ?? 1, 0.05);
        this.startNamedTimer(name, seconds);
        this.append(
          'timer.circle',
          `Started timer '${name}' every ${this.formattedNumber(
            seconds,
          )}s — each tick fires the Custom Event named '${name}'`,
        );
        break;
      }
      case 'stopTimer': {
        const name = this.value(block, 'name') ?? 'mainTimer';
        this.stopNamedTimer(name);
        this.append('timer.circle.fill', `Stopped timer '${name}'`);
        break;
      }
      case 'saveValue': {
        const key = this.value(block, 'key') ?? '';
        const savedValue = this.substitute(this.value(block, 'value') ?? '');
        this.storage.set(`AgenticDesignerPreview.${key}`, savedValue);
        this.append('externaldrive.badge.checkmark', `Saved ${key}`);
        break;
      }
      case 'customAction':
        this.append('function', `CUSTOM: ${this.value(block, 'name') ?? 'customAction'}`);
        break;
      case 'gameSpawn':
      case 'gameRemove':
      case 'gameImpulse':
      case 'gameMove':
      case 'gameSetGravity':
      case 'gameAddScore':
      case 'gameEnd':
      case 'gamePause':
      case 'gameSetVelocity':
      case 'gameSetProperty':
      case 'gameAnimate':
      case 'gameAddBehavior':
      case 'gameRemoveBehavior':
      case 'gameSetHealth':
      case 'gameShake':
      case 'gameParticles':
      case 'gameSetTimeScale':
      case 'gameSetSpawnRate':
      case 'gameSetLives':
      case 'gameRestart':
      case 'gameLaunch':
      case 'gameSetPhysics':
      case 'gameLoadSlingshot':
      case 'gameDamage':
      case 'gameMotor':
      case 'gameTorque':
        // Game commands live with the data ops (they broadcast into the
        // running scene); route them there instead of the log-only default.
        return this.performDataOperation(block);
      default:
        this.append('circle', block.label);
        break;
    }
    return 0;
  }

  // MARK: - Conditions

  private evaluateCondition(block: LogicBlock): number {
    switch (block.type) {
      case 'ifCondition':
      case 'compare': {
        const left = this.value(block, 'leftValue') ?? this.value(block, 'left') ?? '';
        const op = this.value(block, 'operator') ?? '==';
        const right = this.value(block, 'rightValue') ?? this.value(block, 'right') ?? '';
        return this.compare(left, op, right) ? 0 : 1;
      }
      case 'isEmpty':
        return (this.value(block, 'value') ?? '') === '' ? 0 : 1;
      case 'contains': {
        const haystack = this.value(block, 'value') ?? '';
        const needle = this.value(block, 'substring') ?? '';
        return haystack.includes(needle) ? 0 : 1;
      }
      case 'logicalNot':
        return this.value(block, 'value') === 'true' ? 1 : 0;
      case 'logicalAnd':
        return this.value(block, 'a') === 'true' && this.value(block, 'b') === 'true' ? 0 : 1;
      case 'logicalOr':
        return this.value(block, 'a') === 'true' || this.value(block, 'b') === 'true' ? 0 : 1;
      case 'platformCondition':
        return this.value(block, 'platform') === this._previewPlatform ? 0 : 1;
      default:
        return 0;
    }
  }

  private compare(left: string, op: string, right: string): boolean {
    const l = swiftDouble(left);
    const r = swiftDouble(right);
    if (l !== null && r !== null) {
      switch (op) {
        case '==':
          return l === r;
        case '!=':
          return l !== r;
        case '<':
          return l < r;
        case '>':
          return l > r;
        case '<=':
          return l <= r;
        case '>=':
          return l >= r;
        default:
          break;
      }
    }
    switch (op) {
      case '==':
        return left === right;
      case '!=':
        return left !== right;
      case 'contains':
        return left.includes(right);
      case 'isEmpty':
        return left === '';
      default:
        return false;
    }
  }

  // MARK: - API

  private async performAPI(block: LogicBlock): Promise<number> {
    switch (block.type) {
      case 'httpRequest': {
        const urlString = this.value(block, 'url');
        const url = urlString !== undefined ? swiftURL(this.substitute(urlString)) : undefined;
        if (urlString === undefined || url === undefined) {
          this.append('network.slash', 'Invalid URL', true);
          return 1;
        }
        const method = this.value(block, 'method') ?? 'GET';
        const headers: Record<string, string> = {};
        let body: string | undefined;
        const rawBody = this.value(block, 'body');
        if (rawBody !== undefined && method !== 'GET') {
          body = this.substitute(rawBody);
          headers['Content-Type'] = 'application/json';
        }
        this.append('network', `${method} ${url}…`);
        try {
          const response = await this.request(url, { method, headers, body });
          const status = response.status;
          const text = await response.text();
          this.setVariableValue('statusCode', String(status));
          this.setVariableValue('responseBody', prefixUTF8(text, 6000));
          const ok = status >= 200 && status < 300;
          this.append(
            ok ? 'checkmark.circle.fill' : 'xmark.circle.fill',
            `HTTP ${status} (${utf8ByteCount(text)} bytes)`,
            !ok,
          );
          return ok ? 0 : 1;
        } catch (error) {
          this.append('xmark.circle.fill', `Request failed: ${errorDescription(error)}`, true);
          return 1;
        }
      }

      case 'parseJSONResponse': {
        const path = this.value(block, 'path') ?? '';
        const source = this._variables['responseBody'] ?? '';
        const extracted = this.extractJSONPath(path, source);
        if (extracted !== undefined) {
          const variableName = block.parameters.find((p) => p.key === 'variable')?.variableReference;
          if (variableName !== undefined) this.setVariableValue(variableName, extracted);
          this.append('curlybraces', `${path} = ${extracted.slice(0, 80)}`);
          return 0;
        }
        this.append('curlybraces', `Path '${path}' not found in response`, true);
        return 0;
      }

      default:
        this.append('network', block.label);
        return 0;
    }
  }

  private extractJSONPath(path: string, json: string): string | undefined {
    if (!isJSONValid(json)) return undefined;
    let current: unknown = JSON.parse(json);

    for (const component of path.split('.')) {
      if (component === '') continue;
      const key = component;
      if (
        current !== null &&
        typeof current === 'object' &&
        !Array.isArray(current) &&
        Object.prototype.hasOwnProperty.call(current, key)
      ) {
        current = (current as Record<string, unknown>)[key];
      } else if (Array.isArray(current)) {
        const index = swiftInt(key.replace(/^[[\]]+/, '').replace(/[[\]]+$/, ''));
        if (index !== null && index >= 0 && index < current.length) {
          current = current[index];
        } else {
          return undefined;
        }
      } else {
        return undefined;
      }
    }

    if (typeof current === 'string') return current;
    if (typeof current === 'number' || typeof current === 'boolean') return numberStringValue(current);
    try {
      return JSON.stringify(current);
    } catch {
      return undefined;
    }
  }

  // MARK: - Data operations

  private performDataOperation(block: LogicBlock): number {
    const storeIn = block.parameters.find((p) => p.key === 'variable')?.variableReference;

    switch (block.type) {
      case 'setVariable':
        if (storeIn !== undefined) this.setVariableValue(storeIn, this.substitute(this.value(block, 'value') ?? ''));
        this.append('arrow.down.doc', `${storeIn ?? '?'} = ${this._variables[storeIn ?? ''] ?? ''}`);
        break;
      case 'toggleVariable':
        if (storeIn !== undefined) {
          const next = this._variables[storeIn] !== 'true';
          this.setVariableValue(storeIn, next ? 'true' : 'false');
          this.append('switch.2', `${storeIn} = ${this._variables[storeIn] ?? ''}`);
        }
        break;
      case 'incrementVariable':
      case 'decrementVariable':
        if (storeIn !== undefined) {
          const current = swiftDouble(this._variables[storeIn] ?? '0') ?? 0;
          const amount = swiftDouble(this.value(block, 'amount') ?? '1') ?? 1;
          const next = block.type === 'incrementVariable' ? current + amount : current - amount;
          this.setVariableValue(storeIn, this.formattedNumber(next));
          this.append(
            block.type === 'incrementVariable' ? 'plus.circle' : 'minus.circle',
            `${storeIn} = ${this._variables[storeIn] ?? ''}`,
          );
        }
        break;
      case 'appendToArray': {
        const arrayName = block.parameters.find((p) => p.key === 'array')?.variableReference;
        if (arrayName !== undefined) {
          const item = this.substitute(this.value(block, 'value') ?? '');
          const parts = splitNonEmpty(this._variables[arrayName], '\n');
          parts.push(item);
          this.setVariableValue(arrayName, parts.join('\n'));
          this.append('text.badge.plus', `Appended to ${arrayName}`);
        }
        break;
      }
      case 'removeFromArray': {
        const arrayName = block.parameters.find((p) => p.key === 'array')?.variableReference;
        if (arrayName !== undefined) {
          const item = this.substitute(this.value(block, 'value') ?? '');
          const parts = splitNonEmpty(this._variables[arrayName], '\n').filter((p) => p !== item);
          this.setVariableValue(arrayName, parts.join('\n'));
          this.append('text.badge.minus', `Removed from ${arrayName}`);
        }
        break;
      }
      case 'getVariable':
        this.append('arrow.up.doc', `${storeIn ?? '?'} = ${this._variables[storeIn ?? ''] ?? '(unset)'}`);
        break;
      case 'appendJsonItem':
        if (storeIn !== undefined) {
          const item = this.substitute(this.value(block, 'item') ?? '{}').trim();
          let list = (this._variables[storeIn] ?? '[]').trim();
          if (!list.startsWith('[')) list = '[]';
          list = list === '[]' ? `[${item}]` : `${list.slice(0, -1)},${item}]`;
          this.setVariableValue(storeIn, list);
          this.append('text.badge.plus', `Appended item to ${storeIn}`);
        }
        break;
      case 'replaceInVariable':
        if (storeIn !== undefined) {
          const find = this.substitute(this.value(block, 'find') ?? '');
          const repl = this.substitute(this.value(block, 'replaceWith') ?? '');
          this.setVariableValue(storeIn, replacingOccurrences(this._variables[storeIn] ?? '', find, repl));
          this.append('arrow.2.squarepath', `Replaced in ${storeIn}`);
        }
        break;
      case 'loadValue': {
        const key = this.value(block, 'key') ?? '';
        const fallback = this.substitute(this.value(block, 'default') ?? '');
        const loaded = this.storage.get(`AgenticDesignerPreview.${key}`) ?? fallback;
        if (storeIn !== undefined) {
          this.setVariableValue(storeIn, loaded);
          this.append(
            'externaldrive.badge.plus',
            `${storeIn} = ${loaded === '' ? '(nothing saved)' : loaded} (loaded '${key}')`,
          );
        }
        break;
      }
      case 'getCurrentTime': {
        const now = new Date(this.clock.now());
        const formatted = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
        if (storeIn !== undefined) {
          this.setVariableValue(storeIn, formatted);
          this.append('clock', `${storeIn} = ${formatted}`);
        }
        break;
      }
      case 'gameSpawn': {
        const template = this.substitute(this.value(block, 'template') ?? '');
        const x = swiftDouble(this.substitute(this.value(block, 'x') ?? '100')) ?? 100;
        const y = swiftDouble(this.substitute(this.value(block, 'y') ?? '100')) ?? 100;
        this.gameSink.broadcast({ kind: 'spawn', template, x, y });
        this.append('plus.viewfinder', `Game spawn ${template}`);
        break;
      }
      case 'gameRemove':
        this.gameSink.broadcast({ kind: 'remove', target: this.substitute(this.value(block, 'target') ?? '') });
        break;
      case 'gameImpulse': {
        const dx = swiftDouble(this.substitute(this.value(block, 'dx') ?? '0')) ?? 0;
        const dy = swiftDouble(this.substitute(this.value(block, 'dy') ?? '0')) ?? 0;
        this.gameSink.broadcast({ kind: 'impulse', entity: this.substitute(this.value(block, 'entity') ?? ''), dx, dy });
        break;
      }
      case 'gameMove': {
        const x = swiftDouble(this.substitute(this.value(block, 'x') ?? '0')) ?? 0;
        const y = swiftDouble(this.substitute(this.value(block, 'y') ?? '0')) ?? 0;
        this.gameSink.broadcast({ kind: 'move', entity: this.substitute(this.value(block, 'entity') ?? ''), x, y });
        break;
      }
      case 'gameSetGravity':
        this.gameSink.broadcast({
          kind: 'setGravityVector',
          dx: swiftDouble(this.substitute(this.value(block, 'gravityX') ?? '0')) ?? 0,
          dy: swiftDouble(this.substitute(this.value(block, 'gravity') ?? '-18')) ?? -18,
        });
        break;
      case 'gameAddScore':
        this.gameSink.broadcast({
          kind: 'addScore',
          value: Math.trunc(swiftDouble(this.substitute(this.value(block, 'points') ?? '1')) ?? 1),
        });
        break;
      case 'gameEnd':
        this.gameSink.broadcast({ kind: 'end', win: (this.value(block, 'result') ?? 'gameOver') === 'win' });
        break;
      case 'gamePause':
        this.gameSink.broadcast({ kind: 'pause', value: (this.value(block, 'mode') ?? 'pause') === 'pause' });
        break;
      case 'gameSetVelocity': {
        const vx = swiftDouble(this.substitute(this.value(block, 'vx') ?? '0')) ?? 0;
        const vy = swiftDouble(this.substitute(this.value(block, 'vy') ?? '0')) ?? 0;
        this.gameSink.broadcast({
          kind: 'setVelocity',
          entity: this.substitute(this.value(block, 'entity') ?? ''),
          vx,
          vy,
        });
        break;
      }
      case 'gameSetProperty':
        this.gameSink.broadcast({
          kind: 'setProperty',
          entity: this.substitute(this.value(block, 'entity') ?? ''),
          property: this.value(block, 'property') ?? 'color',
          value: this.substitute(this.value(block, 'value') ?? ''),
        });
        break;
      case 'gameAnimate':
        this.gameSink.broadcast({
          kind: 'animate',
          entity: this.substitute(this.value(block, 'entity') ?? ''),
          x: swiftDouble(this.substitute(this.value(block, 'x') ?? '0')) ?? 0,
          y: swiftDouble(this.substitute(this.value(block, 'y') ?? '0')) ?? 0,
          duration: swiftDouble(this.substitute(this.value(block, 'duration') ?? '0.6')) ?? 0.6,
        });
        break;
      case 'gameAddBehavior':
        this.gameSink.broadcast({
          kind: 'addBehavior',
          entity: this.substitute(this.value(block, 'entity') ?? ''),
          behaviorJSON: this.substitute(this.value(block, 'behavior') ?? ''),
        });
        this.append('puzzlepiece.extension', 'Behavior added');
        break;
      case 'gameRemoveBehavior':
        this.gameSink.broadcast({
          kind: 'removeBehavior',
          entity: this.substitute(this.value(block, 'entity') ?? ''),
          type: this.substitute(this.value(block, 'behaviorType') ?? ''),
        });
        break;
      case 'gameSetHealth':
        this.gameSink.broadcast({
          kind: 'setHealth',
          entity: this.substitute(this.value(block, 'entity') ?? ''),
          health: Math.trunc(swiftDouble(this.substitute(this.value(block, 'health') ?? '3')) ?? 3),
        });
        break;
      case 'gameShake':
        this.gameSink.broadcast({
          kind: 'shake',
          value: swiftDouble(this.substitute(this.value(block, 'intensity') ?? '10')) ?? 10,
        });
        break;
      case 'gameParticles':
        this.gameSink.broadcast({
          kind: 'particles',
          particleKind: this.value(block, 'kind') ?? 'confetti',
          x: swiftDouble(this.substitute(this.value(block, 'x') ?? '195')) ?? 195,
          y: swiftDouble(this.substitute(this.value(block, 'y') ?? '300')) ?? 300,
          burst: Math.trunc(swiftDouble(this.substitute(this.value(block, 'burst') ?? '40')) ?? 40),
        });
        break;
      case 'gameSetTimeScale':
        this.gameSink.broadcast({
          kind: 'setTimeScale',
          value: swiftDouble(this.substitute(this.value(block, 'scale') ?? '1')) ?? 1,
        });
        break;
      case 'gameSetSpawnRate':
        this.gameSink.broadcast({
          kind: 'setSpawnInterval',
          value: swiftDouble(this.substitute(this.value(block, 'interval') ?? '1')) ?? 1,
        });
        break;
      case 'gameSetLives':
        this.gameSink.broadcast({
          kind: 'setLives',
          value: Math.trunc(swiftDouble(this.substitute(this.value(block, 'lives') ?? '3')) ?? 3),
        });
        break;
      case 'gameRestart':
        this.gameSink.broadcast({ kind: 'restart' });
        this.append('arrow.counterclockwise.circle', 'Game restarted');
        break;
      case 'gameMotor':
        this.gameSink.broadcast({
          kind: 'motor',
          entity: this.substitute(this.value(block, 'entity') ?? ''),
          throttle: swiftDouble(this.substitute(this.value(block, 'throttle') ?? '1')) ?? 1,
        });
        break;
      case 'gameTorque':
        this.gameSink.broadcast({
          kind: 'torque',
          entity: this.substitute(this.value(block, 'entity') ?? ''),
          amount: swiftDouble(this.substitute(this.value(block, 'amount') ?? '40')) ?? 40,
        });
        break;
      case 'gameLoadSlingshot':
        this.gameSink.broadcast({ kind: 'loadSlingshot', entity: this.substitute(this.value(block, 'entity') ?? '') });
        this.append('arrow.uturn.backward.circle', 'Slingshot reloaded');
        break;
      case 'gameDamage':
        this.gameSink.broadcast({
          kind: 'damageEntity',
          entity: this.substitute(this.value(block, 'entity') ?? ''),
          amount: Math.trunc(swiftDouble(this.substitute(this.value(block, 'amount') ?? '1')) ?? 1),
        });
        break;
      case 'gameLaunch':
        this.gameSink.broadcast({
          kind: 'launch',
          entity: this.substitute(this.value(block, 'entity') ?? ''),
          angle: swiftDouble(this.substitute(this.value(block, 'angle') ?? '60')) ?? 60,
          strength: swiftDouble(this.substitute(this.value(block, 'strength') ?? '40')) ?? 40,
        });
        break;
      case 'gameSetPhysics':
        this.gameSink.broadcast({
          kind: 'setPhysics',
          entity: this.substitute(this.value(block, 'entity') ?? ''),
          property: this.value(block, 'property') ?? 'bounciness',
          value: this.substitute(this.value(block, 'value') ?? ''),
        });
        break;
      case 'gameQuery': {
        const what = this.value(block, 'what') ?? 'score';
        const target = this.substitute(this.value(block, 'target') ?? '');
        const result = this.gameSink.query(what, target);
        if (storeIn !== undefined) {
          this.setVariableValue(storeIn, result);
          this.append('eye', `${storeIn} = ${result} (game ${what})`);
        }
        break;
      }
      case 'ringAlarm': {
        const style = this.substitute(this.value(block, 'style') ?? 'classic');
        this.platformActions.playSound('Sosumi');
        this.presentToast(`\u{1F514} Ringing — ${style}`);
        this.append('bell.and.waves.left.and.right', `Alarm ringing (${style})`);
        break;
      }
      case 'scheduleNotificationAt': {
        const h = this.substitute(this.value(block, 'hour') ?? '6');
        const m = this.substitute(this.value(block, 'minute') ?? '30');
        this.presentToast(`⏰ Alarm notification scheduled for ${h}:${m.length === 1 ? `0${m}` : m}`);
        this.append('alarm', `Daily notification scheduled at ${h}:${m}`);
        break;
      }
      case 'randomNumber': {
        const lo = Math.trunc(swiftDouble(this.value(block, 'min') ?? '') ?? 1);
        const hi = Math.trunc(swiftDouble(this.value(block, 'max') ?? '') ?? 10);
        const low = Math.min(lo, hi);
        const high = Math.max(lo, hi);
        const rolled = low + Math.floor(Math.random() * (high - low + 1));
        if (storeIn !== undefined) {
          this.setVariableValue(storeIn, String(rolled));
          this.append('die.face.5', `${storeIn} = ${rolled} (random ${lo}–${hi})`);
        }
        break;
      }
      case 'mathOperation': {
        const l = swiftDouble(this.value(block, 'left') ?? '') ?? 0;
        const r = swiftDouble(this.value(block, 'right') ?? '') ?? 0;
        const op = this.value(block, 'operator') ?? '+';
        let result: number;
        switch (op) {
          case '-':
            result = l - r;
            break;
          case '×':
            result = l * r;
            break;
          case '÷':
            result = r === 0 ? 0 : l / r;
            break;
          case '%':
            result = r === 0 ? 0 : l % r;
            break;
          default:
            result = l + r;
            break;
        }
        // Whole results store as "42", not "42.0" — string comparisons
        // against typed answers must not fail on a phantom decimal.
        if (storeIn !== undefined) {
          this.setVariableValue(storeIn, result % 1 === 0 ? String(Math.trunc(result)) : swiftDoubleString(result));
        }
        this.append(
          'plus.forwardslash.minus',
          `${swiftDoubleString(l)} ${op} ${swiftDoubleString(r)} = ${swiftDoubleString(result)}`,
        );
        break;
      }
      case 'stringOperation': {
        const input = this.substitute(this.value(block, 'input') ?? '');
        const argument = this.substitute(this.value(block, 'argument') ?? '');
        const op = this.value(block, 'operation') ?? 'concat';
        let result: string;
        switch (op) {
          case 'uppercase':
            result = input.toUpperCase();
            break;
          case 'lowercase':
            result = input.toLowerCase();
            break;
          case 'trim':
            result = input.trim();
            break;
          case 'replace':
            result = replacingOccurrences(input, argument, '');
            break;
          default:
            result = input + argument;
            break;
        }
        if (storeIn !== undefined) this.setVariableValue(storeIn, result);
        this.append('textformat.abc', `${op} → ${result.slice(0, 60)}`);
        break;
      }
      case 'generateId':
        if (storeIn !== undefined) this.setVariableValue(storeIn, newUUID());
        this.append('number.square', 'Generated ID');
        break;
      case 'jsonParse': {
        const input = this.substitute(this.value(block, 'input') ?? '');
        const valid = isJSONValid(input);
        if (storeIn !== undefined && valid) this.setVariableValue(storeIn, input);
        this.append('doc.badge.gearshape', valid ? 'JSON parsed' : 'Invalid JSON', !valid);
        return valid ? 0 : 1;
      }
      default:
        // arrayOperation / jsonBuild / formatDate and every other Variables
        // block the Swift switch does not name land here.
        this.append('number', block.label);
        break;
    }
    return 0;
  }

  // MARK: - UI updates (really mutate the designed screen)

  private performUIUpdate(block: LogicBlock): void {
    switch (block.type) {
      case 'presentBottomSheet': {
        const screen = this.resolvedNodeName(block, 'screen') ?? this.value(block, 'screen') ?? '?';
        this.append('rectangle.bottomthird.inset.filled', `Bottom sheet → ${screen}`);
        const screenId = this.nodeReference(block, 'screen');
        if (screenId !== undefined) {
          this.previewScreenId = screenId;
          if (this.onNavigate) {
            this.onNavigate(screenId);
          } else {
            this.designViewModel?.selectNode(screenId);
          }
        }
        return;
      }
      case 'dismissBottomSheet':
        this.append('rectangle.bottomthird.inset.filled', 'Dismissed bottom sheet');
        return;
      case 'presentDatePicker': {
        const storeIn = block.parameters.find((p) => p.key === 'variable')?.variableReference;
        if (storeIn !== undefined) {
          this.setVariableValue(storeIn, iso8601(this.clock.now()));
          this.append(
            'calendar.badge.clock',
            `${storeIn} = ${
              this._variables[storeIn] ?? ''
            } (simulated — real picker appears in the exported app)`,
          );
        }
        return;
      }
      case 'presentColorPicker': {
        const storeIn = block.parameters.find((p) => p.key === 'variable')?.variableReference;
        if (storeIn !== undefined) {
          this.setVariableValue(storeIn, '#3B82F6');
          this.append('eyedropper', `${storeIn} = #3B82F6 (simulated — real picker appears in the exported app)`);
        }
        return;
      }
      default:
        break;
    }

    const nodeId = this.nodeReference(block, 'element');
    if (nodeId === undefined) {
      this.append('eye.slash', `${block.label}: no element linked`, true);
      return;
    }
    const name = this.logicViewModel?.designNodeName(nodeId) ?? 'element';
    this.hasUIChanges = true;

    switch (block.type) {
      case 'setText': {
        const text = this.substitute(this.value(block, 'text') ?? '');
        this.designViewModel?.simulateUpdateNode(nodeId, (node) => {
          node.text = text;
        });
        this.append('textformat', `'${name}' text → ${text}`);
        break;
      }
      case 'setColor': {
        const color = this.value(block, 'color') ?? '#3B82F6';
        const property = this.value(block, 'property') ?? 'fill';
        this.designViewModel?.simulateUpdateNode(nodeId, (node) => {
          switch (property) {
            case 'textColor':
              node.style.textColor = color;
              break;
            case 'stroke':
              node.style.stroke = color;
              break;
            default:
              node.style.fill = color;
              break;
          }
        });
        this.append('paintbrush.fill', `'${name}' ${property} → ${color}`);
        break;
      }
      case 'setVisible': {
        const visible = this.value(block, 'visible') !== 'false';
        this.designViewModel?.simulateUpdateNode(nodeId, (node) => {
          node.style.opacity = visible ? 1 : 0.08;
        });
        this.append('eye', `'${name}' ${visible ? 'shown' : 'hidden'}`);
        break;
      }
      case 'setEnabled': {
        const enabled = this.value(block, 'enabled') !== 'false';
        this.designViewModel?.simulateUpdateNode(nodeId, (node) => {
          node.style.opacity = enabled ? 1 : 0.45;
        });
        this.append('hand.raised.slash', `'${name}' ${enabled ? 'enabled' : 'disabled'}`);
        break;
      }
      case 'setLoading': {
        const loading = this.value(block, 'loading') !== 'false';
        this.designViewModel?.simulateUpdateNode(nodeId, (node) => {
          node.style.opacity = loading ? 0.55 : 1;
        });
        this.append('arrow.triangle.2.circlepath', `'${name}' loading: ${loading}`);
        break;
      }
      case 'setImage': {
        const source = this.value(block, 'source');
        if (source !== undefined) {
          this.designViewModel?.simulateUpdateNode(nodeId, (node) => {
            node.imageSource = source;
          });
          this.append('photo', `'${name}' image updated`);
        }
        break;
      }
      case 'scrollTo': {
        const offset = swiftDouble(this.value(block, 'offset') ?? '') ?? 0;
        const axis = this.value(block, 'axis') ?? 'vertical';
        this.designViewModel?.simulateUpdateNode(nodeId, (node) => {
          const behavior = node.scrollBehavior ?? { axis };
          behavior.axis = axis;
          behavior.initialOffset = Math.max(0, offset);
          node.scrollBehavior = behavior;
          node.clipContent = true;
        });
        this.append('arrow.down.to.line', `'${name}' scroll ${axis} → ${Math.trunc(offset)}`);
        break;
      }
      case 'animate': {
        const property = this.value(block, 'property') ?? 'opacity';
        const target = this.value(block, 'to') ?? '';
        const num = swiftDouble(target) ?? 0;
        this.designViewModel?.simulateUpdateNode(nodeId, (node) => {
          switch (property) {
            case 'opacity':
              node.style.opacity = Math.min(Math.max(num, 0), 1);
              break;
            case 'scale': {
              const scale = Math.max(num, 0.05);
              const centerX = node.x + node.width / 2;
              const centerY = node.y + node.height / 2;
              node.width = Math.max(1, node.width * scale);
              node.height = Math.max(1, node.height * scale);
              node.x = centerX - node.width / 2;
              node.y = centerY - node.height / 2;
              break;
            }
            case 'x':
              node.x = num;
              break;
            case 'y':
              node.y = num;
              break;
            case 'width':
              node.width = Math.max(1, num);
              break;
            case 'height':
              node.height = Math.max(1, num);
              break;
            case 'cornerRadius':
              node.style.cornerRadius = Math.max(0, num);
              break;
            default:
              node.style.opacity = Math.min(Math.max(num, 0), 1);
              break;
          }
        });
        this.append('wand.and.rays', `'${name}' ${property} → ${target}`);
        break;
      }
      case 'bindProperty': {
        const variableName = block.parameters.find((p) => p.key === 'variable')?.variableReference;
        if (variableName === undefined) {
          this.append('link.circle', 'Binding needs a variable', true);
          return;
        }
        const property = this.value(block, 'property') ?? 'text';
        this.designViewModel?.simulateUpdateNode(nodeId, (node) => {
          const kind: NodeLogicBindingKind = (AllNodeLogicBindingKind as readonly string[]).includes(property)
            ? (property as NodeLogicBindingKind)
            : 'text';
          const bindings = (node.logicBindings ?? []).filter((b) => b.kind !== kind);
          bindings.push({ id: newUUID(), kind, variableName });
          node.logicBindings = bindings;
          if (kind === 'text' || kind === 'value') {
            node.text = this._variables[variableName] ?? node.text;
          }
          if (kind === 'visibility') {
            node.style.opacity = this._variables[variableName] === 'false' ? 0.08 : 1;
          }
        });
        this.append('link.circle', `'${name}' ${property} bound to ${variableName}`);
        break;
      }
      case 'setNavigationSelection': {
        const variableName = block.parameters.find((p) => p.key === 'variable')?.variableReference;
        if (variableName !== undefined) {
          this.setVariableValue(variableName, this.substitute(this.value(block, 'value') ?? ''));
          this.append('sidebar.left', `Navigation selection = ${this._variables[variableName] ?? ''}`);
        }
        break;
      }
      default:
        this.append('wand.and.rays', `${block.label} on '${name}'`);
        break;
    }
  }

  // MARK: - Parameter resolution

  // Resolution order: linked design node's text → variable → literal value,
  // with {{variable}} substitution applied to literals.
  private value(block: LogicBlock, key: string): string | undefined {
    const param = block.parameters.find((p) => p.key === key);
    if (!param) return undefined;

    if (param.nodeReference !== undefined && param.type === 'nodeReference') {
      const node = this.designViewModel?.nodeForSimulation(param.nodeReference);
      return node?.text ?? node?.name;
    }
    if (param.variableReference !== undefined && param.variableReference !== '') {
      return this._variables[param.variableReference] ?? '';
    }
    if (param.value !== undefined) return this.substitute(param.value);
    return undefined;
  }

  private nodeReference(block: LogicBlock, key: string): string | undefined {
    return block.parameters.find((p) => p.key === key)?.nodeReference;
  }

  private resolvedNodeName(block: LogicBlock, key: string): string | undefined {
    return this.logicViewModel?.designNodeName(this.nodeReference(block, key));
  }

  private substitute(text: string): string {
    let result = text;
    for (const [name, val] of Object.entries(this._variables)) {
      result = replacingOccurrences(result, `{{${name}}}`, val);
    }
    // The same reserved tokens the exporters resolve. Without them the
    // preview wrote documents to literal "users/{{uid}}" while the exported
    // app wrote "users/<real uid>" — the preview then "worked" in a way the
    // shipped app never would.
    if (!result.includes('{{')) return result;
    const uid = this._variables['currentUserId'] ?? 'sim-user-001';
    for (const token of ['uid', 'userId', 'userid', 'currentUserId']) {
      result = replacingOccurrences(result, `{{${token}}}`, uid);
    }
    const now = iso8601(this.clock.now());
    for (const token of ['now', 'timestamp', 'createdAt', 'createdat']) {
      result = replacingOccurrences(result, `{{${token}}}`, now);
    }
    return result;
  }

  // Opens the Mac equivalent of an iOS URL-scheme action (mailto:/tel:/sms:)
  // so Share/Email/Call/SMS blocks do something real in the live preview.
  private openOnMac(scheme: string, target: string, label: string): void {
    const encoded = addingPercentEncodingURLQueryAllowed(target);
    const url = swiftURL(`${scheme}:${encoded}`);
    if (target === '' || url === undefined) {
      this.append('questionmark.circle', `${label} needs a value`, true);
      return;
    }
    this.platformActions.openURL(url);
    this.append('paperplane', `Would ${label} ${target}`);
  }

  private validate(text: string, rule: string, argument: string): boolean {
    switch (rule) {
      case 'email':
        return /^\S+@\S+\.\S+$/.test(text);
      case 'minLength':
        return [...text].length >= (swiftInt(argument) ?? 0);
      case 'matchesRegex':
        try {
          return new RegExp(argument).test(text);
        } catch {
          return false;
        }
      default:
        return text.trim() !== '';
    }
  }

  setInputValue(nodeId: string, text: string): void {
    this.designViewModel?.simulateUpdateNode(nodeId, (node) => {
      node.text = text;
      for (const binding of node.logicBindings ?? []) {
        if (binding.kind === 'value' || binding.kind === 'text') {
          this.setVariableValue(binding.variableName, text);
        }
      }
    });
    this.runEvent(['onChange'], nodeId);
  }

  private awaitBranchChoice(block: LogicBlock, labels: string[]): Promise<number> {
    this.awaitingChoice = { blockLabel: block.label, labels };
    return new Promise<number>((resolve) => {
      this.choiceContinuation = resolve;
    });
  }

  private append(icon: string, message: string, isError = false): void {
    this.log = [...this._log, { id: newUUID(), icon, message, isError }];
  }

  private defaultValue(type: VariableType): string {
    switch (type) {
      case 'number':
        return '0';
      case 'boolean':
        return 'false';
      case 'array':
        return '';
      case 'json':
        return '{}';
      case 'optional':
        return '';
      case 'string':
        return '';
    }
  }

  private formattedNumber(value: number): string {
    return swiftRounded(value) === value ? String(Math.trunc(value)) : swiftDoubleString(value);
  }

  // Shows a toast bubble in the preview window, replacing any current one.
  private presentToast(message: string): void {
    if (this.toastTask) this.toastTask.cancelled = true;
    this.toastMessage = message;
    const task: SimTask = { cancelled: false };
    this.toastTask = task;
    void (async () => {
      await this.clock.sleep(2400);
      if (task.cancelled) return;
      this.toastMessage = undefined;
    })();
  }

  // MARK: - HTTP (URLSession.shared)

  private async request(
    url: string,
    init: { method: string; headers?: Record<string, string>; body?: string },
  ): Promise<{ status: number; text(): Promise<string> }> {
    const impl = this.fetchImpl;
    if (!impl) throw new Error('The Internet connection appears to be offline.');
    return await impl(url, init);
  }
}

// MARK: - Free functions mirroring Swift string/number behaviour

function shallowEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((k) => a[k] === b[k]);
}

/** `String.split(separator:)` — Swift drops empty subsequences. */
function splitNonEmpty(text: string | undefined, separator: string): string[] {
  if (text === undefined) return [];
  return text.split(separator).filter((s) => s !== '');
}

/** `replacingOccurrences(of:with:)` — literal (non-regex) replacement of every match. */
function replacingOccurrences(text: string, find: string, replacement: string): string {
  if (find === '') return text;
  return text.split(find).join(replacement);
}

/** Swift `.rounded()` — half away from zero. */
function swiftRounded(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value));
}

/** `String(someDouble)` — Swift always prints a decimal point for whole doubles. */
export function swiftDoubleString(value: number): string {
  if (Number.isNaN(value)) return 'nan';
  if (!Number.isFinite(value)) return value > 0 ? 'inf' : '-inf';
  return Number.isInteger(value) ? `${value}.0` : String(value);
}

/** `NSNumber.stringValue` for a JSON number/bool. */
function numberStringValue(value: number | boolean): string {
  if (typeof value === 'boolean') return value ? '1' : '0';
  return String(value);
}

function utf8ByteCount(text: string): number {
  const g = globalThis as { TextEncoder?: new () => { encode(t: string): Uint8Array } };
  if (!g.TextEncoder) return text.length;
  return new g.TextEncoder().encode(text).length;
}

/** `error.localizedDescription` */
function errorDescription(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
