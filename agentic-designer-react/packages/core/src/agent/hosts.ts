// Host interfaces for the framework-free agent layer.
//
// Swift's AgentToolLoop / DesignAgentService / DesignChatSession hold
// `weak var mcp: MCPServerController?` and reach straight into
// `mcp.designViewModel` (ProjectViewModel) and `mcp.logicViewModel`
// (LogicViewModel), and call the static CheckpointStore / DesignQualityAudit /
// CanvasSnapshotRenderer helpers. The port depends only on the members that
// are actually used, with the SAME names, so the web app's zustand stores
// implement these without inheriting anything.

import type { DesignNode } from '../models/DesignNode';
import type { DesignPage, DesignProject } from '../models/DesignProject';
import type { LogicFlow } from '../models/LogicModels';
import type { JSONObject } from '../models/JSON';
import type { MCPToolDefinition, MCPToolResult } from '../mcp/types';
import type { AgentContext } from './AgentContext';
import type { DesignAction } from './DesignAction';

// MARK: - MCP tool belt (MCPServerController)

/**
 * `MCPServerController.makeTools()` plus dispatch. The loop reads the
 * definitions for their name/description/inputSchema and runs one by name —
 * in the web app the call is relayed to the live editor state.
 */
export interface AgentToolHost {
  /** `mcp.makeTools()` */
  listTools(): MCPToolDefinition[];
  /** `tool.handler(args)` for the tool called `name`. */
  callTool(name: string, args: JSONObject): Promise<MCPToolResult>;
}

// MARK: - AgentToolLoop → ProjectViewModel

/**
 * Exactly the `ProjectViewModel` members `Agent/AgentToolLoop.swift` touches:
 * `design.project` (pages / agentMemo) and `design.currentPage`.
 *
 * Swift writes straight into the value-typed document
 * (`design.project.agentMemo = memo`); a store cannot observe a direct
 * property write, so that write goes through `mutateProject`.
 */
export interface AgentDesignHost {
  readonly project: DesignProject;
  /** `currentPage` — `project.pages[currentPageIndex]` */
  readonly currentPage: DesignPage;
  mutateProject(update: (project: DesignProject) => void): void;
}

// MARK: - AgentToolLoop → LogicViewModel

/** The single `LogicViewModel` member the loop reads (`logicViewModel?.flows`). */
export interface AgentLogicHost {
  readonly flows: LogicFlow[];
}

// MARK: - CheckpointStore (Services/CheckpointStore.swift)

/** `ProjectCheckpoint` — `id` is the checkpoint file path. */
export interface ProjectCheckpoint {
  id: string;
  label: string;
  /** ms since epoch (Swift: `Date`). */
  date: number;
  url: string;
}

/**
 * `CheckpointStore.save(_:label:)` / `.load(_:)`. Filesystem-backed, so the
 * server implements it and the web app forwards over the bridge.
 */
export interface AgentCheckpointStore {
  save(project: DesignProject, label: string): void;
  load(checkpoint: ProjectCheckpoint): Promise<DesignProject>;
}

/** No checkpoint store attached (tests, or a disconnected server). */
export const NullAgentCheckpointStore: AgentCheckpointStore = {
  save() {},
  async load() {
    throw new Error('No checkpoint store attached.');
  },
};

// MARK: - DesignQualityAudit (Services/DesignQualityAudit.swift)

/** `DesignQualityReport` — only the two fields the finish gate reads. */
export interface AgentQualityReport {
  score: number;
  passesReferenceBar: boolean;
}

/** `DesignQualityAudit.report(page:)` + `.summary(_:limit:)`. */
export interface AgentQualityAuditor {
  report(page: DesignPage): AgentQualityReport;
  summary(report: AgentQualityReport, limit: number): string;
}

// MARK: - CanvasSnapshotRenderer (Helpers/CanvasSnapshotRenderer.swift)

/** `CanvasSnapshotRenderer.jpegDataURL(for:maxDimension:)` */
export interface AgentCanvasSnapshotRenderer {
  jpegDataURL(nodes: DesignNode[], maxDimension?: number): Promise<string | undefined>;
}

// MARK: - DesignAgentService / DesignChatSession → ProjectViewModel

/**
 * The additional `ProjectViewModel` members `Services/DesignAgentService.swift`
 * and `Services/DesignChatSession.swift` use, names verbatim.
 */
export interface DesignAgentDesignHost extends AgentDesignHost {
  readonly currentPageIndex: number;
  readonly selectedNodeId: string | undefined;
  /** `makeAgentContext(userPrompt:)` */
  makeAgentContext(userPrompt: string): AgentContext;
  /** `applyDesignActions(_:)` → the nodeReference → node id map. */
  applyDesignActions(actions: DesignAction[]): Record<string, string>;
  /** `setGeneratedImage(nodeId:imagePath:)` */
  setGeneratedImage(nodeId: string, imagePath: string): void;
  /** `rootScreen(containing:)` */
  rootScreen(containing: string): DesignNode | undefined;
  /** `replaceProject(_:)` — used by DesignChatSession.revert. */
  replaceProject(newProject: DesignProject): void;
}
