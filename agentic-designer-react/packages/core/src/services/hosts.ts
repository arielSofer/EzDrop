// Host interfaces for the framework-free logic services.
//
// The Swift classes hold `weak var designViewModel: ProjectViewModel?` /
// `weak var logicViewModel: LogicViewModel?` and reach into them directly.
// The port depends only on the members actually used (names verbatim), so
// the web app's zustand stores implement these without inheriting anything.

import type { DesignNode, NodeLogicBindingKind } from '../models/DesignNode';
import type { DesignProject } from '../models/DesignProject';
import type { GameCommand } from '../models/GameCommand';
import type { LogicFlow } from '../models/LogicModels';

// MARK: - LogicSimulator → ProjectViewModel

/**
 * Exactly the `ProjectViewModel` members `Services/LogicSimulator.swift`
 * touches (`designViewModel?.…`).
 */
export interface SimulatorDesignHost {
  /** `project` — read: `globalVariables`, `supabaseConfig`, `pages[currentPageIndex].nodes`. */
  readonly project: DesignProject;
  /** `currentPageIndex` */
  readonly currentPageIndex: number;
  /** `nodeForSimulation(id:)` — `findNode(id:in: project.pages[currentPageIndex].nodes)` */
  nodeForSimulation(id: string): DesignNode | undefined;
  /** `simulateUpdateNode(id:_:)` — mutates the node in place (the `inout` closure) and publishes. */
  simulateUpdateNode(id: string, update: (node: DesignNode) => void): void;
  /** `snapshotNodesForSimulation()` — `project.pages[currentPageIndex].nodes` (the simulator deep-copies it). */
  snapshotNodesForSimulation(): DesignNode[];
  /** `restoreNodesFromSimulation(_:)` — `project.pages[currentPageIndex].nodes = nodes` */
  restoreNodesFromSimulation(nodes: DesignNode[]): void;
  /** `selectNode(_:)` — used when no `onNavigate` callback is installed. */
  selectNode(id: string): void;
  /**
   * `repeatTemplateForOrAncestorOf(_:)` — the repeat-list template that owns
   * `id` (itself if it carries a `repeatBinding`, else its nearest ancestor
   * that does). Not called by LogicSimulator itself: it is what builds the
   * `itemContext` passed to `runTap`/`runSwipe` (AppPreviewView and the
   * `tap_element` MCP tool, `MCPServerController.swift:2428`), so it belongs
   * to the same host.
   */
  repeatTemplateForOrAncestorOf(id: string): DesignNode | undefined;
}

// MARK: - LogicSimulator → LogicViewModel

/**
 * Exactly the `LogicViewModel` members `Services/LogicSimulator.swift`
 * touches (`logicViewModel?.…`). `viewModels/LogicViewModel.ts` satisfies it.
 */
export interface SimulatorLogicHost {
  flows: LogicFlow[];
  currentFlowId: string | undefined;
  selectedBlockId: string | undefined;
  readonly currentFlow: LogicFlow | undefined;
  simActiveBlockId: string | undefined;
  designNodeName(id: string | undefined): string | undefined;
}

// MARK: - LogicViewModel / ComposedLogicGenerator → ProjectViewModel

/**
 * Exactly the `ProjectViewModel` members `ViewModels/LogicViewModel.swift`
 * (and `Services/ComposedLogicGenerator.swift`) touch.
 *
 * Swift writes straight into the value-typed document
 * (`design.project.pages[i].logicFlows = flows`,
 * `design.project.globalVariables.append(…)`,
 * `design.project.platformSettings = settings`,
 * `walk(&design.project.pages[i].nodes)`). A store cannot observe direct
 * property writes, so every such write goes through `mutateProject`, which
 * must apply `update` to the live document and publish.
 */
export interface DesignHostForLogic {
  readonly project: DesignProject;
  readonly currentPageIndex: number;
  mutateProject(update: (project: DesignProject) => void): void;
  /** `setLogicBinding(nodeId:kind:variableName:)` */
  setLogicBinding(nodeId: string, kind: NodeLogicBindingKind, variableName: string | undefined): void;
}

// MARK: - Game bridge (GameSceneRegistry)

/**
 * `GameSceneRegistry.broadcast(_:)` / `GameSceneRegistry.query(_:_:)` —
 * implemented by the web game runtime. `query` answers
 * `positionX|positionY|health|count|score|lives|timeLeft` for the first live
 * scene and returns "" when no scene is registered.
 */
export interface GameCommandSink {
  broadcast(command: GameCommand): void;
  query(what: string, target: string): string;
}

/** No live scene registered (the Swift registry's empty state). */
export const NullGameCommandSink: GameCommandSink = {
  broadcast() {},
  query() {
    return '';
  },
};

// MARK: - Desktop side effects the simulator triggers (AppKit calls)

/**
 * The AppKit calls `LogicSimulator.swift` makes for real on the Mac
 * (`NSWorkspace.shared.open`, `NSSound`, `NSApp.dockTile.badgeLabel`,
 * `NSHapticFeedbackManager`). The web app maps them to `window.open`,
 * `<audio>`, the Badging API and the Vibration API; the default performs
 * nothing but every block still logs exactly what the Swift logs.
 */
export interface SimulatorPlatformActions {
  /** `NSWorkspace.shared.open(url)` — mailto:/tel:/sms:/maps URLs. */
  openURL(url: string): void;
  /** `NSSound(named:) ?? NSSound(contentsOfFile:)` → `play()`; return false when not found. */
  playSound(file: string): boolean;
  /** `NSApp.dockTile.badgeLabel = count > 0 ? "\(count)" : nil` */
  setBadgeCount(count: number): void;
  /** `NSHapticFeedbackManager.defaultPerformer.perform(.generic, performanceTime: .now)` */
  hapticFeedback(): void;
}

export const NullSimulatorPlatformActions: SimulatorPlatformActions = {
  openURL() {},
  playSound() {
    return false;
  },
  setBadgeCount() {},
  hapticFeedback() {},
};

// MARK: - HTTP (URLSession.shared)

/** The subset of WHATWG `fetch` the simulator needs (core has no DOM lib types). */
export interface FetchLikeResponse {
  status: number;
  text(): Promise<string>;
}
export interface FetchLikeInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}
export type FetchLike = (url: string, init?: FetchLikeInit) => Promise<FetchLikeResponse>;

/** `globalThis.fetch` when the host has one. */
export function defaultFetch(): FetchLike | undefined {
  const g = globalThis as { fetch?: FetchLike };
  return typeof g.fetch === 'function' ? g.fetch.bind(globalThis) : undefined;
}

// MARK: - Model provider (ComposedLogicGenerator)

/** `OpenRouterMessage(role:content:)` as `ComposedLogicGenerator` builds it. */
export interface RawChatMessage {
  role: string;
  content: string;
}

/**
 * The one `OpenRouterProvider` member `ComposedLogicGenerator.swift` calls:
 * `generateRawChat(messages:jsonMode:)`. The ported OpenRouterProvider
 * satisfies this structurally.
 */
export interface RawChatProvider {
  generateRawChat(messages: RawChatMessage[], jsonMode: boolean): Promise<string>;
}
