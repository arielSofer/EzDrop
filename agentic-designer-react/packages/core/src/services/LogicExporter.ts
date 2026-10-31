// Ported 1:1 from AgenticDesigner/Services/LogicExporter.swift
//
// Exports the project's logic as a structured "Logic Blueprint" and, more
// importantly, as a complete SwiftUI app: screens, flows, services, an Xcode
// project, an icon, privacy manifest, StoreKit config and UI tests.
//
// Swift writes straight to disk with FileManager; this port returns a pure
// `GeneratedFileTree` (relative path → text | { base64 }) that `writeTree`
// materialises through the FileSystem adapter. The OUTPUT IS STILL SWIFT.

import { BlockCatalog } from '../models/BlockDefinitions';
import { encodeGameSceneSpec } from '../models/codec';
import type { DesignNode, NodeLogicBindingKind } from '../models/DesignNode';
import type { DesignProject } from '../models/DesignProject';
import type { FirebaseConfig } from '../models/FirebaseConfig';
import type { LogicBlock, LogicBlockType, LogicFlow, LogicVariable, VariableType } from '../models/LogicModels';
import { makeLogicVariable } from '../models/LogicModels';
import { nodeEffectiveGameSpec } from '../helpers/GameSceneComposer';
import { agentGameKitSource } from '../resources/agentGameKitSource';
import type { FileSystem } from '../platform/FileSystem';
import type { GeneratedFileTree } from './GeneratedFileTree';
import { writeTree } from './GeneratedFileTree';
import {
  accessibilityIdentifier,
  gameSceneResourceName,
  nodeReference,
  paramValue,
  swiftIdentifier,
} from './logicExporter/helpers';
import {
  exportAppName,
  firestoreCollections,
  firestoreRulesSource,
  forcedInterfaceStyle,
  googleServiceInfoPlist,
  infoPlistSource,
  needsBackgroundLocation,
  packageSwift,
  partialInfoPlist,
  purchaseProductIds,
  pushEntitlements,
  readme,
  requiredUsageDescriptions,
  sanitizedBundleId,
  storeKitConfigSource,
  writeAppIcon,
  xcodeProjectPBX,
  xcodeReadme,
  xcodeSchemeSource,
  firebaseRCSource,
} from './logicExporter/projectFiles';
import {
  actionsSource,
  appSource,
  appStateSource,
  rootViewSource,
  screenSource,
  supportSource,
  watchRootSource,
  xcodeAppEntry,
} from './logicExporter/sources';
import {
  authServiceSource,
  firebaseDeployConfigJSON,
  permissionsSource,
  persistenceSource,
  privacyManifestSource,
  pushServiceSource,
  sensorServicesSource,
  storeServiceSource,
  watchWorkoutSource,
} from './logicExporter/staticSources';
import {
  swiftStringCompare,
  trimWhitespaces,
  trimWhitespacesAndNewlines,
  uuidString,
} from './logicExporter/swiftRuntime';
import type {
  DynamicMap,
  DynamicNodeProperty,
  ElementBlueprint,
  ExportAssetProvider,
  ExportOptions,
  ExportResult,
  FlowBlueprint,
  LogicBlueprint,
  ScreenBlueprint,
  StepBlueprint,
  VariableTypeMap,
} from './logicExporter/types';
import { UITestGenerator } from './logicExporter/uiTestGenerator';

export type {
  ElementBlueprint,
  ExportAssetProvider,
  ExportOptions,
  ExportResult,
  FlowBlueprint,
  LogicBlueprint,
  ScreenBlueprint,
  StepBlueprint,
  TriggerBlueprint,
} from './logicExporter/types';
export { UITestGenerator } from './logicExporter/uiTestGenerator';
export type { GeneratedFileTree } from './GeneratedFileTree';
export { writeTree } from './GeneratedFileTree';

/// Flows dropped by the last export because nothing triggers them.
let lastDroppedFlowNames: string[] = [];

/**
 * THE HONEST LIST. Blocks the palette offers that this exporter cannot turn
 * into working native code.
 */
export const blocksWithoutNativeCodegen: ReadonlySet<LogicBlockType> = new Set<LogicBlockType>([
  // Events that are never bound to anything in the generated app.
  'onShake', 'onLocationChanged', 'onWatchAction', 'onChange',
  // Emit nothing / a bare comment.
  'scrollTo', 'customAction',
  // Claim success without doing the thing.
  'presentColorPicker', 'presentDatePicker',
  'firestoreListenDocument', 'firestoreListenQuery', 'firestoreBatchWrite',
]);

/// Node-level bindings the native export honours; the rest are canvas-only.
export const bindingKindsWithoutNativeSupport: ReadonlySet<NodeLogicBindingKind> = new Set<NodeLogicBindingKind>([
  'selectedIndex',
]);

// MARK: - Screen / flow selection

function allScreens(project: DesignProject): DesignNode[] {
  return project.pages.flatMap((page) => page.nodes.filter((n) => n.type === 'Frame'));
}

// Live flows are the (possibly unsaved) editor flows for the page the user is
// currently on; every other page contributes its persisted flows.
function mergedFlows(project: DesignProject, liveFlows: LogicFlow[], currentPageId: string | undefined): LogicFlow[] {
  const livePageId = currentPageId ?? project.pages[0]?.id;
  if (livePageId === undefined) return liveFlows;
  return project.pages.flatMap((page) => (page.id === livePageId ? liveFlows : page.logicFlows));
}

function scopedFlowsForExport(flows: LogicFlow[], screens: DesignNode[]): LogicFlow[] {
  const screenIds = new Set(screens.map((s) => s.id));
  const nodeIds = new Set(screens.flatMap(flattenedNodeIds));

  const kept = flows.filter((flow) => isBound(flow, screenIds, nodeIds));
  lastDroppedFlowNames = flows
    .filter((flow) => flow.blocks.length > 0 && !isBound(flow, screenIds, nodeIds))
    .map((flow) => flow.name);
  return kept;
}

/// A flow only reaches the binary if something can trigger it.
function isBound(flow: LogicFlow, screenIds: Set<string>, nodeIds: Set<string>): boolean {
  if (flow.screenNodeId !== undefined) {
    return screenIds.has(flow.screenNodeId);
  }
  return flow.blocks.some((block) => {
    if (block.connectedDesignNodeId !== undefined && nodeIds.has(block.connectedDesignNodeId)) return true;
    return block.parameters.some((parameter) => {
      const reference = parameter.nodeReference;
      if (reference === undefined) return false;
      return nodeIds.has(reference) || screenIds.has(reference);
    });
  });
}

function flattenedNodeIds(node: DesignNode): string[] {
  return [node.id, ...node.children.flatMap(flattenedNodeIds)];
}

// The iOS app shows everything EXCEPT watch-only screens; the watch app shows
// the dedicated watch screen(s) if any exist, otherwise every screen adapted.
function iosViewScreens(screens: DesignNode[]): DesignNode[] {
  const phone = screens.filter((screen) => {
    if (
      screen.supportedPlatforms === undefined &&
      trimWhitespacesAndNewlines(screen.name).toLowerCase().startsWith('watch')
    ) {
      return false;
    }
    const platforms = screen.supportedPlatforms;
    if (platforms === undefined) return true;
    return platforms.includes('iPhone') || platforms.includes('iPad');
  });
  return phone.length === 0 ? screens : phone;
}

function watchViewScreens(screens: DesignNode[]): DesignNode[] {
  const dedicated = screens.filter((s) => s.supportedPlatforms?.includes('appleWatch') === true);
  if (dedicated.length > 0) return dedicated;

  // Watch* named screens are the designer's DEDICATED watch UI.
  const namedWatchScreens = screens.filter((s) => trimWhitespacesAndNewlines(s.name).toLowerCase().startsWith('watch'));
  if (namedWatchScreens.length > 0) return namedWatchScreens;

  // No dedicated watch UI at all: mirror the phone flow when its screens
  // follow the alarm storyboard names, else adapt everything.
  const alarmStoryboardOrder = ['Home', 'Ringing', 'MathChallenge', 'Success', 'AlarmsList', 'Settings'];
  const alarmStoryboard = alarmStoryboardOrder
    .map((name) => screens.find((s) => s.name === name))
    .filter((s): s is DesignNode => s !== undefined);
  if (alarmStoryboard.length >= 3) return alarmStoryboard;

  return screens;
}

// MARK: - Variables

function templateVariableNames(raw: string): string[] {
  if (!raw.includes('{{')) return [];
  const names: string[] = [];
  let remainder = raw;
  for (;;) {
    const open = remainder.indexOf('{{');
    if (open === -1) break;
    remainder = remainder.slice(open + 2);
    const close = remainder.indexOf('}}');
    if (close === -1) break;
    names.push(trimWhitespaces(remainder.slice(0, close)));
    remainder = remainder.slice(close + 2);
  }
  return names;
}

function inferredVariableType(block: LogicBlock, parameterKey: string): VariableType {
  void parameterKey;
  switch (block.type) {
    case 'toggleVariable':
      return 'boolean';
    case 'incrementVariable':
    case 'decrementVariable':
    case 'mathOperation':
      return 'number';
    // Sensor readings are numeric.
    case 'getLocation':
    case 'onLocationChanged':
    case 'readHeartRate':
    case 'readStepCount':
    case 'readMotion':
    case 'readBatteryLevel':
      return 'number';
    case 'appendToArray':
    case 'removeFromArray':
    case 'arrayOperation':
      return 'array';
    default:
      return 'string';
  }
}

// Collects every variable referenced anywhere.
function mergedVariables(project: DesignProject, flows: LogicFlow[], screens: DesignNode[]): LogicVariable[] {
  const declared = new Map<string, LogicVariable>();
  for (const variable of [...project.globalVariables, ...flows.flatMap((f) => f.variables)]) {
    if (!declared.has(variable.name)) declared.set(variable.name, variable);
  }

  const inferredTypes = new Map<string, VariableType>();
  const hint = (name: string, type: VariableType): void => {
    if (name.length === 0) return;
    if (!inferredTypes.has(name) || inferredTypes.get(name) === 'string') {
      inferredTypes.set(name, type);
    }
  };

  for (const flow of flows) {
    for (const block of flow.blocks) {
      for (const param of block.parameters) {
        if (param.variableReference !== undefined) {
          hint(param.variableReference, inferredVariableType(block, param.key));
        }
        if (param.value !== undefined) {
          for (const name of templateVariableNames(param.value)) hint(name, 'string');
        }
      }
    }
  }

  const scanBindings = (node: DesignNode): void => {
    for (const binding of node.logicBindings ?? []) hint(binding.variableName, 'string');
    node.children.forEach(scanBindings);
  };
  screens.forEach(scanBindings);

  for (const [name, type] of inferredTypes) {
    if (declared.has(name)) continue;
    declared.set(name, makeLogicVariable({ name, type, scope: 'global' }));
  }

  return [...declared.values()].sort((a, b) => swiftStringCompare(a.name, b.name));
}

// MARK: - Dynamic node state

function dynamicProperties(flows: LogicFlow[]): DynamicMap {
  const result: DynamicMap = new Map();
  const add = (nodeId: string | undefined, property: DynamicNodeProperty): void => {
    if (nodeId === undefined) return;
    const set = result.get(nodeId) ?? new Set<DynamicNodeProperty>();
    set.add(property);
    result.set(nodeId, set);
  };
  for (const flow of flows) {
    for (const block of flow.blocks) {
      const element = nodeReference(block, 'element');
      switch (block.type) {
        case 'setText':
        case 'clearField':
          add(element, 'text');
          break;
        case 'setColor':
          add(element, (paramValue(block, 'property') ?? 'fill') === 'textColor' ? 'textColor' : 'fill');
          break;
        case 'setVisible':
        case 'setEnabled':
        case 'setLoading':
          add(element, 'opacityChannel');
          break;
        case 'setImage':
          add(element, 'image');
          break;
        case 'animate':
          switch (paramValue(block, 'property') ?? 'opacity') {
            case 'opacity': add(element, 'opacityChannel'); break;
            case 'scale':
            case 'x': add(element, 'x'); add(element, 'y'); add(element, 'width'); add(element, 'height'); break;
            case 'y': add(element, 'y'); break;
            case 'width': add(element, 'width'); break;
            case 'height': add(element, 'height'); break;
            default: break;
          }
          break;
        default:
          break;
      }
    }
  }
  return result;
}

// MARK: - Assets

function copyImageAssets(
  files: GeneratedFileTree,
  screens: DesignNode[],
  resources: string,
  assets: ExportAssetProvider | undefined,
): Map<string, string> {
  const paths: string[] = [];

  const walk = (node: DesignNode): void => {
    for (const candidate of [node.imageSource, node.imageName].filter((c): c is string => c !== undefined)) {
      if (assets?.fileExists(candidate) === true && !paths.includes(candidate)) {
        paths.push(candidate);
      }
    }
    node.children.forEach(walk);
  };

  screens.forEach(walk);
  const result = new Map<string, string>();
  if (paths.length === 0 || assets === undefined) return result;

  const usedNames = new Set<string>();
  for (const path of paths) {
    const lastComponent = path.split('/').pop() ?? path;
    const dot = lastComponent.lastIndexOf('.');
    const ext = dot > 0 ? lastComponent.slice(dot + 1) : '';
    const rawBase = dot > 0 ? lastComponent.slice(0, dot) : lastComponent;
    const extension = ext.length === 0 ? 'png' : ext;
    const base = swiftIdentifier(rawBase, 'ImageAsset');
    let resourceName = base;
    let index = 2;
    while (usedNames.has(resourceName)) {
      resourceName = `${base}${index}`;
      index += 1;
    }
    usedNames.add(resourceName);

    const fileName = `${resourceName}.${extension}`;
    files[`${resources}/${fileName}`] = { base64: assets.readFileBase64(path) };
    result.set(path, fileName);
  }

  return result;
}

// MARK: - 2D game export

function collectGameNodes(nodes: DesignNode[]): DesignNode[] {
  const found: DesignNode[] = [];
  const walk = (n: DesignNode): void => {
    if (n.gameScene !== undefined) found.push(n);
    n.children.forEach(walk);
  };
  nodes.forEach(walk);
  return found;
}

/// The SpriteKit runtime source (AgentGameKit.swift), shipped as a bundled
/// resource so it can be copied verbatim into exports.
function gameRuntimeSource(options: ExportOptions): string | undefined {
  if (options.gameRuntimeSource === null) return undefined;
  return options.gameRuntimeSource ?? agentGameKitSource;
}

/// Copies the runtime, writes each game scene's JSON, and copies its sprite
/// art into the export's Resources.
function exportGameScenes(
  files: GeneratedFileTree,
  screens: DesignNode[],
  sharedDir: string,
  resources: string,
  options: ExportOptions,
): void {
  const gameNodes = collectGameNodes(screens);
  if (gameNodes.length === 0) return;

  // 1. The engine.
  const runtime = gameRuntimeSource(options);
  if (runtime !== undefined) {
    files[`${sharedDir}/AgentGameKit.swift`] = runtime;
  }

  const assets = options.assets;
  const usedSpriteNames = new Set<string>();

  // Copies one asset into Resources and returns its bundled file name.
  const bundleAsset = (src: string | undefined): string | undefined => {
    if (src === undefined || assets === undefined || !assets.fileExists(src)) return undefined;
    const lastComponent = src.split('/').pop() ?? src;
    const dot = lastComponent.lastIndexOf('.');
    const ext = dot > 0 ? lastComponent.slice(dot + 1) : '';
    const rawBase = dot > 0 ? lastComponent.slice(0, dot) : lastComponent;
    const extension = ext.length === 0 ? 'png' : ext;
    let resourceName = swiftIdentifier(rawBase, 'Sprite');
    let index = 2;
    while (usedSpriteNames.has(resourceName)) {
      resourceName = `${swiftIdentifier(rawBase, 'Sprite')}${index}`;
      index += 1;
    }
    usedSpriteNames.add(resourceName);
    const fileName = `${resourceName}.${extension}`;
    files[`${resources}/${fileName}`] = { base64: assets.readFileBase64(src) };
    return fileName;
  };

  for (const node of gameNodes) {
    const original = nodeEffectiveGameSpec(node);
    if (original === undefined) continue;
    const spec = { ...original, entities: original.entities.map((e) => ({ ...e })), parallax: original.parallax.map((p) => ({ ...p })) };

    // 2. Copy every referenced asset, rewriting to bundle names.
    for (const entity of spec.entities) {
      const bundled = bundleAsset(entity.sprite);
      if (bundled !== undefined) entity.sprite = bundled;
      if (entity.frames !== undefined) {
        entity.frames = entity.frames.map((frame) => bundleAsset(frame) ?? frame);
      }
    }
    for (const layer of spec.parallax) {
      const bundled = bundleAsset(layer.sprite);
      if (bundled !== undefined) layer.sprite = bundled;
    }
    const bundledBackground = bundleAsset(spec.backgroundImage);
    if (bundledBackground !== undefined) spec.backgroundImage = bundledBackground;
    const bundledMusic = bundleAsset(spec.music);
    if (bundledMusic !== undefined) spec.music = bundledMusic;

    // 3. Bundle the scene JSON under the shared resource name.
    files[`${resources}/${gameSceneResourceName(node)}.json`] = JSON.stringify(encodeGameSceneSpec(spec));
  }
}

// MARK: - Localization

/// Writes `Base.lproj/Localizable.strings` plus a Hebrew stub.
function writeLocalization(files: GeneratedFileTree, screens: DesignNode[], appName: string): void {
  void appName;
  const strings = new Set<string>();
  const collect = (node: DesignNode): void => {
    if (node.text !== undefined) {
      const text = trimWhitespacesAndNewlines(node.text);
      if (text.length > 0) strings.add(text);
    }
    node.children.forEach(collect);
  };
  screens.forEach(collect);
  if (strings.size === 0) return;

  const body = [...strings]
    .sort(swiftStringCompare)
    .map((value) => `"${value.replaceAll('"', '\\"')}" = "${value.replaceAll('"', '\\"')}";`)
    .join('\n');

  for (const language of ['Base', 'he']) {
    const header =
      language === 'he'
        ? '// Hebrew translations. Values still hold the English source — replace them.\n// The app already lays out right-to-left when this language is active.\n'
        : '// Generated from the design\'s text layers.\n';
    files[`${language}.lproj/Localizable.strings`] = header + body + '\n';
  }
}

/// Code Mode hand-edits win over generation in EVERY export path.
export function applySourceOverrides(project: DesignProject, files: GeneratedFileTree): void {
  const overrides = project.sourceOverrides;
  if (overrides === undefined || Object.keys(overrides).length === 0) return;
  for (const path of Object.keys(files)) {
    if (!path.endsWith('.swift')) continue;
    const fileName = path.split('/').pop() ?? path;
    const content = overrides[fileName];
    if (content === undefined) continue;
    files[path] = content;
  }
}

// MARK: - Blueprint

function parameterMap(block: LogicBlock, nodeNames: Map<string, string>): Record<string, string> {
  const map: Record<string, string> = {};

  for (const param of block.parameters) {
    const nodeId = param.nodeReference;
    const name = nodeId === undefined ? undefined : nodeNames.get(nodeId);
    if (nodeId !== undefined && name !== undefined) {
      map[param.key] = `{{${name}.value}}`;
    } else if (param.variableReference !== undefined && param.variableReference.length > 0) {
      map[param.key] = `{{${param.variableReference}}}`;
    } else if (param.value !== undefined && param.value.length > 0) {
      map[param.key] = param.value;
    }
  }

  if (block.comment !== undefined) {
    map['_comment'] = block.comment;
  }

  return map;
}

function chain(
  blockId: string,
  port: number,
  flow: LogicFlow,
  nodeNames: Map<string, string>,
  visited: Set<string>,
): StepBlueprint[] {
  const steps: StepBlueprint[] = [];
  let currentId = blockId;
  let currentPort = port;

  for (;;) {
    const connection = flow.connections.find((c) => c.sourceBlockId === currentId && c.sourcePortIndex === currentPort);
    if (connection === undefined) break;
    if (visited.has(connection.targetBlockId)) break;
    visited.add(connection.targetBlockId);
    const block = flow.blocks.find((b) => b.id === connection.targetBlockId);
    if (block === undefined) break;

    const definition = BlockCatalog.definition(block.type);
    const isBranching = (definition?.outputPortCount ?? 1) > 1;

    if (isBranching) {
      const successVisited = new Set(visited);
      const errorVisited = new Set(visited);
      const onSuccess = chain(block.id, 0, flow, nodeNames, successVisited);
      const onError = chain(block.id, 1, flow, nodeNames, errorVisited);
      for (const id of successVisited) visited.add(id);
      for (const id of errorVisited) visited.add(id);

      const step: StepBlueprint = { type: block.type, parameters: parameterMap(block, nodeNames) };
      if (onSuccess.length > 0) step.onSuccess = onSuccess;
      if (onError.length > 0) step.onError = onError;
      steps.push(step);
      break; // branches consume the rest of the chain
    }

    steps.push({ type: block.type, parameters: parameterMap(block, nodeNames) });

    currentId = block.id;
    currentPort = 0;
  }

  return steps;
}

// Each event block becomes one exported flow: trigger + the chain of steps
// reachable from it.
function flowBlueprints(flow: LogicFlow, nodeNames: Map<string, string>): FlowBlueprint[] {
  const eventBlocks = flow.blocks.filter((b) => BlockCatalog.definition(b.type)?.inputPortCount === 0);

  return eventBlocks.map((event) => {
    const visited = new Set<string>([event.id]);
    const steps = chain(event.id, 0, flow, nodeNames, visited);

    const elementParam = event.parameters.find((p) => p.type === 'nodeReference');
    const elementName =
      elementParam?.nodeReference === undefined ? undefined : nodeNames.get(elementParam.nodeReference);

    const blueprint: FlowBlueprint = {
      name: eventBlocks.length > 1 ? `${flow.name} — ${event.label}` : flow.name,
      trigger: elementName === undefined ? { type: event.type } : { type: event.type, elementName },
      steps,
    };
    return blueprint;
  });
}

function screenBlueprint(
  name: string,
  size: { width: number; height: number },
  nodes: DesignNode[],
  flows: LogicFlow[],
): ScreenBlueprint {
  const elements: ElementBlueprint[] = [];
  const nodeNames = new Map<string, string>();

  const walk = (list: DesignNode[]): void => {
    for (const node of list) {
      const element: ElementBlueprint = { id: uuidString(node.id), name: node.name, type: node.type };
      if (node.text !== undefined) element.text = node.text;
      elements.push(element);
      nodeNames.set(node.id, node.name);
      walk(node.children);
    }
  };
  walk(nodes);

  const exportedFlows = flows.flatMap((flow) => flowBlueprints(flow, nodeNames));

  return { screenName: name, screenSize: size, elements, flows: exportedFlows };
}

export function buildBlueprint(
  project: DesignProject,
  flows: LogicFlow[],
  currentPageId?: string,
): LogicBlueprint {
  // The flows passed in are the live (possibly unsaved) flows for the current
  // page; other pages contribute their persisted flows.
  const screens: ScreenBlueprint[] = [];
  const livePageId = currentPageId ?? project.pages[0]?.id;

  for (const page of project.pages) {
    const pageFlows = page.id === livePageId ? flows : page.logicFlows;
    const rootScreens = page.nodes.filter((n) => n.type === 'Frame');

    if (rootScreens.length === 0) {
      screens.push(screenBlueprint(page.name, { width: 390, height: 844 }, page.nodes, pageFlows));
      continue;
    }

    for (const screen of rootScreens) {
      const flowsForScreen = pageFlows.filter((f) => f.screenNodeId === undefined || f.screenNodeId === screen.id);
      screens.push(
        screenBlueprint(screen.name, { width: screen.width, height: screen.height }, [screen], flowsForScreen),
      );
    }
  }

  const blueprint: LogicBlueprint = {
    projectName: project.name,
    exportDate: Date.now(),
    screens,
    apiEndpoints: project.apiEndpoints,
    globalVariables: project.globalVariables,
  };
  if (project.firebaseConfig !== undefined) blueprint.firebase = project.firebaseConfig;
  return blueprint;
}

// MARK: - Public entry points

/**
 * `exportSwiftUISource(project:flows:currentPageId:to:)` — the SwiftPM layout.
 * Returns the file tree instead of writing it; `rootName` is the folder Swift
 * creates inside the chosen directory.
 */
export function exportSwiftUISource(
  project: DesignProject,
  flows: LogicFlow[],
  options: ExportOptions = {},
): ExportResult {
  const appName = swiftIdentifier(project.name, 'ExportedApp');
  const files: GeneratedFileTree = {};
  const sources = `Sources/${appName}`;
  const shared = `${sources}/Shared`;
  const screensDir = `${sources}/Screens`;
  const resources = `${sources}/Resources`;

  const screenNodes = allScreens(project).filter(
    (screen) =>
      screen.supportedPlatforms === undefined ||
      screen.supportedPlatforms.some((p) => project.platformSettings.enabledPlatforms.includes(p)),
  );
  const allFlows = scopedFlowsForExport(mergedFlows(project, flows, options.currentPageId), screenNodes);
  const variables = mergedVariables(project, allFlows, screenNodes);
  const variableTypes: VariableTypeMap = new Map(variables.map((v) => [v.name, v.type]));
  const imageAssets = copyImageAssets(files, screenNodes, resources, options.assets);
  // 2D games: the SwiftPM/simulator-run path needs the SpriteKit runtime too.
  exportGameScenes(files, screenNodes, shared, resources, options);
  const hasGameScenes = collectGameNodes(screenNodes).length > 0;

  files['Package.swift'] = packageSwift(appName, project, imageAssets.size > 0 || hasGameScenes);
  files['README.md'] = readme(project, appName);
  // Continuous location needs the background mode; a one-shot read does not.
  const backgroundLocation = needsBackgroundLocation(allFlows);
  files['Info.plist'] = infoPlistSource(
    requiredUsageDescriptions(allFlows),
    backgroundLocation,
    project.platformSettings.orientation,
  );
  const dynamicProps = dynamicProperties(allFlows);
  files[`${shared}/AppState.swift`] = appStateSource(variables, screenNodes[0], screenNodes, dynamicProps);
  files[`${shared}/GeneratedActions.swift`] = actionsSource(
    appName, project, allFlows, screenNodes, variables, dynamicProps, imageAssets,
  );
  files[`${shared}/GeneratedSupport.swift`] = supportSource(appName, imageAssets.size > 0, imageAssets);
  files[`${shared}/SensorServices.swift`] = sensorServicesSource();
  files[`${shared}/StateStore.swift`] = persistenceSource();
  files[`${shared}/AuthService.swift`] = authServiceSource();
  files[`${shared}/Permissions.swift`] = permissionsSource();
  files[`${shared}/StoreService.swift`] = storeServiceSource();
  files[`${shared}/PushService.swift`] = pushServiceSource();

  // Rules ship with the app source, not as an afterthought.
  const collections = firestoreCollections(allFlows, project.firebaseConfig);
  if (collections.length > 0) {
    files['firestore.rules'] = firestoreRulesSource(collections, project.firebaseConfig?.publicReadCollections ?? []);
    files['firebase.json'] = firebaseDeployConfigJSON();
    const projectId = project.firebaseConfig?.projectId;
    if (projectId !== undefined && projectId.length > 0) {
      files['.firebaserc'] = firebaseRCSource(projectId);
    }
  }
  const hasWatch = project.platformSettings.enabledPlatforms.includes('appleWatch');
  const usesPush = allFlows.some((f) => f.blocks.some((b) => b.type === 'registerForPush'));
  files[`${sources}/RootView.swift`] = rootViewSource(appName, iosViewScreens(screenNodes), allFlows);
  files[`${sources}/${appName}App.swift`] = appSource(appName, hasWatch, usesPush);

  for (const screen of screenNodes) {
    const fileName = `${swiftIdentifier(screen.name, 'Screen')}View.swift`;
    files[`${screensDir}/${fileName}`] = screenSource(screen, allFlows, variableTypes, imageAssets, dynamicProps);
  }

  if (hasWatch) {
    const watch = `${sources}/Watch`;
    files[`${watch}/WatchRootView.swift`] = watchRootSource(
      watchViewScreens(screenNodes), allFlows, variableTypes, imageAssets, dynamicProps,
    );
    // The part that makes it an actual watch app.
    files[`${watch}/WatchWorkoutService.swift`] = watchWorkoutSource();
  }

  // Layer five of the truth check: a machine taps through the promised flows.
  files[`${appName}UITests/${appName}UITests.swift`] = UITestGenerator.source(appName, screenNodes, allFlows);

  // Every user-visible string, extracted for translation.
  writeLocalization(files, screenNodes, appName);

  applySourceOverrides(project, files);
  return { rootName: `${appName}SwiftUIExport`, files };
}

/**
 * `exportXcodeProject(project:flows:currentPageId:to:)` — a real .xcodeproj
 * (objectVersion 77 / Xcode 16+) that builds a signable app bundle, and embeds
 * a watchOS app when the watch is enabled.
 */
export function exportXcodeProject(
  project: DesignProject,
  flows: LogicFlow[],
  options: ExportOptions = {},
): ExportResult {
  const appName = swiftIdentifier(project.name, 'ExportedApp');
  const bundleId = sanitizedBundleId(project.bundleIdentifier) ?? `com.agentic.${appName.toLowerCase()}`;
  const files: GeneratedFileTree = {};
  const sharedDir = 'Shared';
  const iosDir = 'iOS';

  const screenNodes = allScreens(project).filter(
    (screen) =>
      screen.supportedPlatforms === undefined ||
      screen.supportedPlatforms.some((p) => project.platformSettings.enabledPlatforms.includes(p)),
  );
  const allFlows = scopedFlowsForExport(mergedFlows(project, flows, options.currentPageId), screenNodes);
  const variables = mergedVariables(project, allFlows, screenNodes);
  const variableTypes: VariableTypeMap = new Map(variables.map((v) => [v.name, v.type]));
  const resources = `${iosDir}/Resources`;
  const imageAssets = copyImageAssets(files, screenNodes, resources, options.assets);
  // 2D games: copy the SpriteKit runtime, bundle each scene's JSON, copy art.
  exportGameScenes(files, screenNodes, sharedDir, resources, options);
  const dynamicProps = dynamicProperties(allFlows);
  const hasWatch = project.platformSettings.enabledPlatforms.includes('appleWatch');
  const usesPush = allFlows.some((f) => f.blocks.some((b) => b.type === 'registerForPush'));

  // Shared services + state — compiled into BOTH the iOS and watch targets.
  files[`${sharedDir}/AppState.swift`] = appStateSource(variables, screenNodes[0], screenNodes, dynamicProps);
  files[`${sharedDir}/GeneratedActions.swift`] = actionsSource(
    appName, project, allFlows, screenNodes, variables, dynamicProps, imageAssets,
  );
  files[`${sharedDir}/GeneratedSupport.swift`] = supportSource(appName, imageAssets.size > 0, imageAssets);
  files[`${sharedDir}/SensorServices.swift`] = sensorServicesSource();
  files[`${sharedDir}/StateStore.swift`] = persistenceSource();
  files[`${sharedDir}/AuthService.swift`] = authServiceSource();
  files[`${sharedDir}/Permissions.swift`] = permissionsSource();
  files[`${sharedDir}/StoreService.swift`] = storeServiceSource();
  files[`${sharedDir}/PushService.swift`] = pushServiceSource();

  // iOS target: its own @main, the phone root view, and every screen.
  const firebaseEnabled = project.firebaseConfig?.isEnabled === true;
  files[`${iosDir}/App.swift`] = xcodeAppEntry(appName, 'RootView', `${appName}App`, usesPush, firebaseEnabled);
  files[`${iosDir}/RootView.swift`] = rootViewSource(appName, iosViewScreens(screenNodes), allFlows);
  for (const screen of screenNodes) {
    const fileName = `${swiftIdentifier(screen.name, 'Screen')}View.swift`;
    files[`${iosDir}/${fileName}`] = screenSource(screen, allFlows, variableTypes, imageAssets, dynamicProps);
  }
  // App icon (blank icon = rejection) and privacy manifest.
  const brandHex =
    project.brand !== undefined && project.brand.accent.startsWith('#') && project.brand.accent.length >= 7
      ? project.brand.accent
      : undefined;
  writeAppIcon(files, iosDir, appName, brandHex);
  files[`${iosDir}/PrivacyInfo.xcprivacy`] = privacyManifestSource();

  // GoogleService-Info.plist, generated from the project's credentials.
  const plist = googleServiceInfoPlist(project.firebaseConfig, bundleId);
  if (plist !== undefined) {
    files[`${iosDir}/GoogleService-Info.plist`] = plist;
  }

  if (hasWatch) {
    const watchDir = 'Watch';
    files[`${watchDir}/WatchApp.swift`] = xcodeAppEntry(appName, 'WatchRootView', `${appName}WatchApp`);
    files[`${watchDir}/WatchRootView.swift`] = watchRootSource(
      watchViewScreens(screenNodes), allFlows, variableTypes, imageAssets, dynamicProps,
    );
    files[`${watchDir}/WatchWorkoutService.swift`] = watchWorkoutSource();
    // The watch app needs its own icon and privacy manifest too.
    writeAppIcon(files, watchDir, appName, brandHex, 'watchos');
    files[`${watchDir}/PrivacyInfo.xcprivacy`] = privacyManifestSource();
  }

  // Firestore rules ship next to the project, same as the SPM export.
  const collections = firestoreCollections(allFlows, project.firebaseConfig);
  if (collections.length > 0) {
    files['firestore.rules'] = firestoreRulesSource(collections, project.firebaseConfig?.publicReadCollections ?? []);
    files['firebase.json'] = firebaseDeployConfigJSON();
    const projectId = project.firebaseConfig?.projectId;
    if (projectId !== undefined && projectId.length > 0) {
      files['.firebaserc'] = firebaseRCSource(projectId);
    }
  }

  // Array-valued plist keys (UIBackgroundModes) live in a partial Info.plist
  // at the root — deliberately OUTSIDE the synchronized folders.
  if (needsBackgroundLocation(allFlows)) {
    files['Info.plist'] = partialInfoPlist();
  }

  // Push needs the aps-environment entitlement.
  if (usesPush) {
    files[`${appName}.entitlements`] = pushEntitlements();
  }

  const projectDir = `${appName}.xcodeproj`;
  files[`${projectDir}/project.pbxproj`] = xcodeProjectPBX({
    appName,
    bundleId,
    hasWatch,
    usageDescriptions: requiredUsageDescriptions(allFlows),
    needsBackgroundLocation: needsBackgroundLocation(allFlows),
    firebaseEnabled: project.firebaseConfig?.isEnabled === true,
    usesPush,
    orientation: project.platformSettings.orientation,
    ...(project.developmentTeam !== undefined ? { developmentTeam: project.developmentTeam } : {}),
    ...(forcedInterfaceStyle(project) !== undefined ? { forcedInterfaceStyle: forcedInterfaceStyle(project) } : {}),
  });

  // StoreKit test config + a shared scheme.
  const productIds = purchaseProductIds(allFlows);
  if (productIds.length > 0) {
    files['Products.storekit'] = storeKitConfigSource(productIds);
  }
  files[`${projectDir}/xcshareddata/xcschemes/${appName}.xcscheme`] = xcodeSchemeSource(appName, productIds.length > 0);

  files['README.md'] = xcodeReadme(project, appName, bundleId, hasWatch);

  applySourceOverrides(project, files);
  return { rootName: `${appName}Xcode`, files };
}

/** Flows the last export dropped because nothing triggers them. */
export function getLastDroppedFlowNames(): string[] {
  return [...lastDroppedFlowNames];
}

/** Materialises an export onto disk through the FileSystem adapter. */
export async function writeExport(fs: FileSystem, directory: string, result: ExportResult): Promise<string> {
  const root = fs.join(directory, result.rootName);
  if (await fs.exists(root)) await fs.remove(root);
  await writeTree(fs, root, result.files);
  return root;
}

export const LogicExporter = {
  exportSwiftUISource,
  exportXcodeProject,
  exportAppName,
  buildBlueprint,
  applySourceOverrides,
  writeExport,
  gameSceneResourceName,
  accessibilityIdentifier,
  blocksWithoutNativeCodegen,
  bindingKindsWithoutNativeSupport,
  get lastDroppedFlowNames(): string[] {
    return [...lastDroppedFlowNames];
  },
};

export { exportAppName, gameSceneResourceName, accessibilityIdentifier };
export type { FirebaseConfig, DynamicNodeProperty };
