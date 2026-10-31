// Ported 1:1 from AgenticDesigner/Models/LogicModels.swift
//
// Core data structures for the visual block-programming system (Logic Mode).

import type { AppPlatform } from './DesignProject';
import { newUUID } from './uuid';

// MARK: - Flow

export interface LogicFlow {
  id: string;
  /** e.g., "Login Flow", "Search Flow" */
  name: string;
  blocks: LogicBlock[];
  connections: BlockConnection[];
  /** Which screen (root Frame) this flow belongs to */
  screenNodeId?: string;
  variables: LogicVariable[];
  supportedPlatforms?: AppPlatform[];
}

export function makeLogicFlow(init: Partial<LogicFlow> & { name: string }): LogicFlow {
  const f: LogicFlow = {
    id: init.id ?? newUUID(),
    name: init.name,
    blocks: init.blocks ?? [],
    connections: init.connections ?? [],
    variables: init.variables ?? [],
  };
  if (init.screenNodeId !== undefined) f.screenNodeId = init.screenNodeId;
  if (init.supportedPlatforms !== undefined) f.supportedPlatforms = init.supportedPlatforms;
  return f;
}

// MARK: - Block

export interface LogicBlock {
  id: string;
  type: LogicBlockType;
  category: LogicBlockCategory;
  label: string;
  x: number;
  y: number;
  width: number;
  parameters: BlockParameter[];
  connectedDesignNodeId?: string;
  isCollapsed: boolean;
  comment?: string;
}

export function makeLogicBlock(
  init: Partial<LogicBlock> & { type: LogicBlockType; category: LogicBlockCategory; label: string; x: number; y: number },
): LogicBlock {
  const b: LogicBlock = {
    id: init.id ?? newUUID(),
    type: init.type,
    category: init.category,
    label: init.label,
    x: init.x,
    y: init.y,
    width: init.width ?? 200,
    parameters: init.parameters ?? [],
    isCollapsed: init.isCollapsed ?? false,
  };
  if (init.connectedDesignNodeId !== undefined) b.connectedDesignNodeId = init.connectedDesignNodeId;
  if (init.comment !== undefined) b.comment = init.comment;
  return b;
}

// MARK: - Connection

export interface BlockConnection {
  id: string;
  sourceBlockId: string;
  sourcePortIndex: number;
  targetBlockId: string;
  targetPortIndex: number;
}

export function makeBlockConnection(
  init: Partial<BlockConnection> & {
    sourceBlockId: string;
    sourcePortIndex: number;
    targetBlockId: string;
    targetPortIndex: number;
  },
): BlockConnection {
  return {
    id: init.id ?? newUUID(),
    sourceBlockId: init.sourceBlockId,
    sourcePortIndex: init.sourcePortIndex,
    targetBlockId: init.targetBlockId,
    targetPortIndex: init.targetPortIndex,
  };
}

export function blockConnectionsEqual(a: BlockConnection, b: BlockConnection): boolean {
  return (
    a.id === b.id &&
    a.sourceBlockId === b.sourceBlockId &&
    a.sourcePortIndex === b.sourcePortIndex &&
    a.targetBlockId === b.targetBlockId &&
    a.targetPortIndex === b.targetPortIndex
  );
}

// MARK: - Parameters

export interface BlockParameter {
  id: string;
  key: string;
  label: string;
  type: ParameterType;
  value?: string;
  nodeReference?: string;
  variableReference?: string;
  isRequired: boolean;
  placeholder?: string;
  options?: string[];
}

export function makeBlockParameter(
  init: Partial<BlockParameter> & { key: string; label: string; type: ParameterType },
): BlockParameter {
  const p: BlockParameter = {
    id: init.id ?? newUUID(),
    key: init.key,
    label: init.label,
    type: init.type,
    isRequired: init.isRequired ?? true,
  };
  if (init.value !== undefined) p.value = init.value;
  if (init.nodeReference !== undefined) p.nodeReference = init.nodeReference;
  if (init.variableReference !== undefined) p.variableReference = init.variableReference;
  if (init.placeholder !== undefined) p.placeholder = init.placeholder;
  if (init.options !== undefined) p.options = init.options;
  return p;
}

export const AllParameterType = [
  'string',
  'number',
  'boolean',
  'url',
  'nodeReference',
  'variable',
  'jsonPath',
  'dropdown',
  'firebasePath',
  'httpMethod',
  'keyValue',
  'color',
  'screenReference',
] as const;
export type ParameterType = (typeof AllParameterType)[number];

// MARK: - Variables

export interface LogicVariable {
  id: string;
  name: string;
  type: VariableType;
  defaultValue?: string;
  scope: VariableScope;
}

export function makeLogicVariable(init: Partial<LogicVariable> & { name: string }): LogicVariable {
  const v: LogicVariable = {
    id: init.id ?? newUUID(),
    name: init.name,
    type: init.type ?? 'string',
    scope: init.scope ?? 'flow',
  };
  if (init.defaultValue !== undefined) v.defaultValue = init.defaultValue;
  return v;
}

export const AllVariableType = ['string', 'number', 'boolean', 'json', 'array', 'optional'] as const;
export type VariableType = (typeof AllVariableType)[number];

export const AllVariableScope = ['flow', 'screen', 'global'] as const;
/** flow = local to this flow; screen = shared across flows on the same screen; global = everywhere. */
export type VariableScope = (typeof AllVariableScope)[number];

// MARK: - Validation

export interface LogicIssue {
  id: string;
  blockId?: string;
  message: string;
  severity: LogicIssueSeverity;
}

export function makeLogicIssue(init: { blockId?: string; message: string; severity: LogicIssueSeverity; id?: string }): LogicIssue {
  const issue: LogicIssue = { id: init.id ?? newUUID(), message: init.message, severity: init.severity };
  if (init.blockId !== undefined) issue.blockId = init.blockId;
  return issue;
}

export const AllLogicIssueSeverity = ['error', 'warning'] as const;
export type LogicIssueSeverity = (typeof AllLogicIssueSeverity)[number];

// MARK: - Categories

/**
 * `LogicBlockCategory` raw values (what is persisted in JSON). Swift case
 * names are available through the `LogicBlockCategory` const (`.event` →
 * "Events") so call sites keep dot-access.
 */
export const LogicBlockCategory = {
  event: 'Events',
  action: 'Actions',
  condition: 'Conditions',
  api: 'API',
  firebase: 'Firebase',
  storage: 'Data & Backends',
  variable: 'Variables',
  ui: 'UI Updates',
  device: 'Device & Sensors',
} as const;
export type LogicBlockCategoryCase = keyof typeof LogicBlockCategory;
export type LogicBlockCategory = (typeof LogicBlockCategory)[LogicBlockCategoryCase];
/** `CaseIterable.allCases` order. */
export const AllLogicBlockCategory = [
  'Events',
  'Actions',
  'Conditions',
  'API',
  'Firebase',
  'Data & Backends',
  'Variables',
  'UI Updates',
  'Device & Sensors',
] as const satisfies readonly LogicBlockCategory[];

export function isLogicBlockCategory(value: unknown): value is LogicBlockCategory {
  return typeof value === 'string' && (AllLogicBlockCategory as readonly string[]).includes(value);
}

/** Reverse lookup: raw value → Swift case name. */
export function logicBlockCategoryCaseName(category: LogicBlockCategory): LogicBlockCategoryCase {
  for (const key of Object.keys(LogicBlockCategory) as LogicBlockCategoryCase[]) {
    if (LogicBlockCategory[key] === category) return key;
  }
  throw new Error(`Unknown LogicBlockCategory: ${category}`);
}

// MARK: - Block Types

export const AllLogicBlockType = [
  // ── Events ────────────────────────────
  'onTap',
  'onDoubleTap',
  'onLongPress',
  'onSwipe',
  'onScreenLoad',
  'onScreenDisappear',
  'onAppLaunch',
  'onScreenOpened',
  'onChange',
  'onSubmit',
  'onTimer',
  'onWatchAction',
  'customEvent',

  // ── Actions ───────────────────────────
  'navigate',
  'goBack',
  'presentSheet',
  'dismissSheet',
  'showAlert',
  'showToast',
  'openURL',
  'copyToClipboard',
  'hapticFeedback',
  'delay',
  'log',
  'startTimer',
  'stopTimer',
  'saveValue',
  'loadValue',
  'customAction',
  'confirmDialog',
  'shareContent',
  'sendEmail',
  'callNumber',
  'sendSMS',
  'launchMaps',
  'requestPermission',
  'biometricAuth',
  'scheduleLocalNotification',
  'setBadgeCount',
  'playSound',
  'stopSound',
  'validateForm',
  'clearField',
  'executeCustomCode',
  'setDarkModeOverride',
  'downloadFile',

  // ── Conditions ────────────────────────
  'ifCondition',
  'switchCase',
  'compare',
  'logicalAnd',
  'logicalOr',
  'logicalNot',
  'isEmpty',
  'contains',
  'platformCondition',

  // ── API ───────────────────────────────
  'httpRequest',
  'setRequestHeader',
  'setRequestBody',
  'parseJSONResponse',
  'handleAPIError',
  'buildURL',

  // ── Commerce & Push ───────────────────
  // The revenue and re-engagement layer a shippable app needs: real
  // StoreKit 2 purchases and real APNs registration.
  'purchaseProduct',
  'restorePurchases',
  'registerForPush',

  // ── Firebase Auth ─────────────────────
  'firebaseLogin',
  'firebaseRegister',
  'firebaseLogout',
  'firebaseGetCurrentUser',
  'firebaseResetPassword',
  'firebaseDeleteAccount',
  'firebaseUpdateProfile',
  'firebaseAuthStateChanged',

  // ── Firebase Firestore ────────────────
  'firestoreAddDocument',
  'firestoreSetDocument',
  'firestoreGetDocument',
  'firestoreUpdateDocument',
  'firestoreDeleteDocument',
  'firestoreQuery',
  'firestoreListenDocument',
  'firestoreListenQuery',
  'firestoreBatchWrite',

  // ── Data & Backends (Supabase / SQLite / Algolia / Analytics) ──
  // Device & sensors — iPhone / iPad / Apple Watch hardware.
  // Continuous run tracking — the engine that reads live distance/pace and
  // survives a locked screen. `getLocation` is only a one-shot read; without
  // these, the tracking engine was never started and measured nothing.
  'startTracking',
  'stopTracking',
  'getLocation',
  'readMotion',
  'readHeartRate',
  'readStepCount',
  'readBatteryLevel',
  'onShake',
  'onLocationChanged',

  // Apple Watch — the interaction model that makes a watch app a watch app:
  // the Digital Crown, watch-native buttons/gestures, and watch haptics.
  'onDigitalCrown',
  'onWatchTap',
  'onWatchLongPress',
  'watchHaptic',
  'startWatchWorkout',
  'pauseWatchWorkout',
  'endWatchWorkout',

  // Supabase auth — the missing half of "a real backend": data blocks
  // existed, but nothing could create or authenticate a user.
  'supabaseSignUp',
  'supabaseSignIn',
  'supabaseSignOut',
  'supabaseCurrentUser',
  'supabaseInsert',
  'supabaseQuery',
  'supabaseUpdate',
  'supabaseDelete',
  'sqliteQuery',
  'sqliteExecute',
  'algoliaSearch',
  'logAnalyticsEvent',

  // ── Variables & Data ──────────────────
  'setVariable',
  'toggleVariable',
  'incrementVariable',
  'decrementVariable',
  'appendToArray',
  'removeFromArray',
  'getVariable',
  'mathOperation',
  'randomNumber',
  'getCurrentTime',
  'scheduleNotificationAt',
  'ringAlarm',
  'appendJsonItem',
  'replaceInVariable',
  'onGameOver',
  'onGameWin',
  'onGameScore',
  'onGameCollision',
  'onGameTap',
  'onGameDrag',
  'onGameEntityDestroyed',
  'gameSpawn',
  'gameRemove',
  'gameImpulse',
  'gameMove',
  'gameSetGravity',
  'gameAddScore',
  'gameEnd',
  'gamePause',
  'onGameStart',
  'onGameLifeLost',
  'onGameSpawned',
  'gameSetVelocity',
  'gameSetProperty',
  'gameAnimate',
  'gameAddBehavior',
  'gameRemoveBehavior',
  'gameSetHealth',
  'gameShake',
  'gameParticles',
  'gameSetTimeScale',
  'gameSetSpawnRate',
  'gameSetLives',
  'gameRestart',
  'gameQuery',
  'gameLaunch',
  'gameSetPhysics',
  'onGameImpact',
  'onGameLaunched',
  'gameLoadSlingshot',
  'gameDamage',
  'gameMotor',
  'gameTorque',
  'stringOperation',
  'arrayOperation',
  'jsonBuild',
  'jsonParse',
  'formatDate',
  'generateId',

  // ── UI Updates ────────────────────────
  'setText',
  'setColor',
  'setVisible',
  'setEnabled',
  'setImage',
  'scrollTo',
  'setLoading',
  'animate',
  'bindProperty',
  'setNavigationSelection',
  'presentBottomSheet',
  'dismissBottomSheet',
  'presentDatePicker',
  'presentColorPicker',
] as const;
export type LogicBlockType = (typeof AllLogicBlockType)[number];

const logicBlockTypeSet: ReadonlySet<string> = new Set(AllLogicBlockType);

export function isLogicBlockType(value: unknown): value is LogicBlockType {
  return typeof value === 'string' && logicBlockTypeSet.has(value);
}
