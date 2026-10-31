// Ported 1:1 from AgenticDesigner/Services/LogicExporter.swift — blueprint
// types (MARK: - Blueprint types) plus the pure output shape that replaces
// Swift's FileManager writes.

import type { APIEndpointConfig } from '../../models/APIEndpointConfig';
import type { FirebaseConfig } from '../../models/FirebaseConfig';
import type { Size } from '../../models/Geometry';
import type { LogicVariable } from '../../models/LogicModels';

export interface LogicBlueprint {
  projectName: string;
  /** ms since epoch (Swift `Date`). */
  exportDate: number;
  screens: ScreenBlueprint[];
  firebase?: FirebaseConfig;
  apiEndpoints: APIEndpointConfig[];
  globalVariables: LogicVariable[];
}

export interface ScreenBlueprint {
  screenName: string;
  screenSize: Size;
  elements: ElementBlueprint[];
  flows: FlowBlueprint[];
}

export interface ElementBlueprint {
  id: string;
  name: string;
  type: string;
  text?: string;
}

export interface FlowBlueprint {
  name: string;
  trigger: TriggerBlueprint;
  steps: StepBlueprint[];
}

export interface TriggerBlueprint {
  type: string;
  elementName?: string;
}

export interface StepBlueprint {
  type: string;
  parameters: Record<string, string>;
  onSuccess?: StepBlueprint[];
  onError?: StepBlueprint[];
}

/**
 * The exporter's output: every file the Swift exporter would have written,
 * keyed by path relative to the export root (e.g. "Shared/AppState.swift").
 * Text files are strings; binary files carry base64 (services/GeneratedFileTree.ts).
 */
export type { GeneratedFileTree } from '../GeneratedFileTree';

export interface ExportResult {
  /** The root folder name Swift creates inside the chosen directory ("<App>SwiftUIExport" / "<App>Xcode"). */
  rootName: string;
  files: import('../GeneratedFileTree').GeneratedFileTree;
}

/**
 * Design-time asset access. Swift reads image/sprite files straight off the
 * Mac with FileManager; in the port the host supplies them (node:fs on the
 * server, a pre-fetched map in the browser). Missing → the asset is treated
 * as non-existent, exactly like `FileManager.fileExists == false`.
 */
export interface ExportAssetProvider {
  fileExists(path: string): boolean;
  readFileBase64(path: string): string;
}

export interface ExportOptions {
  /** `currentPageId` — the page whose flows are the live editor flows. */
  currentPageId?: string;
  assets?: ExportAssetProvider;
  /**
   * Source of Shared/AgentGameKit.swift for 2D-game exports. Defaults to the
   * embedded copy of Resources/AgentGameKit.swifttext (Swift reads it from
   * the app bundle). `null` reproduces a bundle without the resource.
   */
  gameRuntimeSource?: string | null;
}

/** `private enum DynamicNodeProperty` — the per-node properties a UI block can drive. */
export type DynamicNodeProperty =
  | 'text'
  | 'fill'
  | 'textColor'
  | 'opacityChannel'
  | 'image'
  | 'x'
  | 'y'
  | 'width'
  | 'height';

/** `[UUID: Set<DynamicNodeProperty>]` */
export type DynamicMap = Map<string, Set<DynamicNodeProperty>>;

/** `[String: VariableType]` */
export type VariableTypeMap = Map<string, import('../../models/LogicModels').VariableType>;

/** `(alias: String, itemExpr: String)?` */
export interface RepeatItemContext {
  alias: string;
  itemExpr: string;
}
