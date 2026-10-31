// JSON codec for every persisted model type — the port of each Swift
// `init(from:)` (custom or synthesized) and the synthesized encoders.
//
// Sources of the rules implemented here:
//   Models/DesignProject.swift      DesignProject / DesignPage / ProjectPlatformSettings decodeIfPresent defaults
//   Models/GradientStyle.swift      bare `[String]` array OR keyed object, `type` defaults to "linear"
//   Runtime/AgentGameKit.swift      GameSceneSpec / ParallaxLayer / GameBodyType / GameEntity tolerant decoders
//   everything else                 synthesized Codable (required keys, nil optionals omitted, enums as rawValue)
//
// Leniency note: Swift's synthesized decoder REQUIRES a key even when the
// property has a default (`var width: CGFloat = 200`). The port applies the
// declared default instead of failing — a strict superset: every file the
// Swift app opens decodes identically here, and the port also opens files the
// Swift app would reject only for a missing defaulted key. Type mismatches and
// unknown enum raw values still throw, exactly like Swift.

import { AllAPIAuthentication, AllHTTPMethod, type APIEndpointConfig, type HTTPHeaderField, type HTTPQueryParam, type ResponseFieldMapping } from './APIEndpointConfig';
import type { BrandIdentity } from './BrandIdentity';
import {
  AllImageContentMode,
  AllLogicConditionOperation,
  AllNodeLogicBindingKind,
  AllNodeType,
  AllRepeatAxis,
  type DesignNode,
  type EdgeConstraints,
  type LogicConditionExpression,
  type NodeLogicBinding,
  type NodeStyle,
  type RepeatBinding,
  type ScrollBehavior,
  type ShadowStyle,
  type TextBehavior,
  type TimePickerBinding,
} from './DesignNode';
import {
  AllAppOrientation,
  AllAppPlatform,
  type DesignPage,
  type DesignProject,
  type ProjectPlatformSettings,
} from './DesignProject';
import type { FirebaseConfig, FirestoreCollectionTemplate, FirestoreFieldTemplate } from './FirebaseConfig';
import { decodeGameBodyType, fallbackGameEntityId, type GameBehavior, type GameEntity, type GameSceneSpec, type ParallaxLayer } from './GameSpec';
import type { GradientStyle } from './GradientStyle';
import { stringifySorted } from './JSON';
import {
  AllLogicBlockCategory,
  AllLogicBlockType,
  AllParameterType,
  AllVariableScope,
  AllVariableType,
  type BlockConnection,
  type BlockParameter,
  type LogicBlock,
  type LogicFlow,
  type LogicVariable,
} from './LogicModels';
import type { SupabaseConfig } from './SupabaseConfig';
import { newUUID, parseUUID } from './uuid';

// MARK: - Errors & primitives

export type DecodingPath = readonly (string | number)[];

export class DecodingError extends Error {
  readonly path: DecodingPath;
  constructor(message: string, path: DecodingPath) {
    super(`${message} (at ${formatPath(path)})`);
    this.name = 'DecodingError';
    this.path = path;
  }
}

function formatPath(path: DecodingPath): string {
  if (path.length === 0) return '<root>';
  return path.map((p) => (typeof p === 'number' ? `[${p}]` : p)).join('.').replaceAll('.[', '[');
}

type Obj = Record<string, unknown>;

function fail(message: string, path: DecodingPath): never {
  throw new DecodingError(message, path);
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

export function isPlainObject(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireObject(json: unknown, path: DecodingPath): Obj {
  if (!isPlainObject(json)) fail(`Expected object, got ${describe(json)}`, path);
  return json;
}

/** Swift `decodeIfPresent` treats JSON null exactly like a missing key. */
function present(o: Obj, key: string): boolean {
  return o[key] !== undefined && o[key] !== null;
}

function reqString(o: Obj, key: string, path: DecodingPath): string {
  const v = o[key];
  if (typeof v !== 'string') fail(`Expected string for '${key}', got ${describe(v)}`, path);
  return v;
}

function optString(o: Obj, key: string, path: DecodingPath): string | undefined {
  if (!present(o, key)) return undefined;
  return reqString(o, key, path);
}

function reqNumber(o: Obj, key: string, path: DecodingPath): number {
  const v = o[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(`Expected number for '${key}', got ${describe(v)}`, path);
  return v;
}

function optNumber(o: Obj, key: string, path: DecodingPath): number | undefined {
  if (!present(o, key)) return undefined;
  return reqNumber(o, key, path);
}

function reqInt(o: Obj, key: string, path: DecodingPath): number {
  const v = reqNumber(o, key, path);
  if (!Number.isInteger(v)) fail(`Expected integer for '${key}', got ${v}`, path);
  return v;
}

function optInt(o: Obj, key: string, path: DecodingPath): number | undefined {
  if (!present(o, key)) return undefined;
  return reqInt(o, key, path);
}

function reqBool(o: Obj, key: string, path: DecodingPath): boolean {
  const v = o[key];
  if (typeof v !== 'boolean') fail(`Expected boolean for '${key}', got ${describe(v)}`, path);
  return v;
}

function optBool(o: Obj, key: string, path: DecodingPath): boolean | undefined {
  if (!present(o, key)) return undefined;
  return reqBool(o, key, path);
}

function reqUUID(o: Obj, key: string, path: DecodingPath): string {
  const v = o[key];
  const uuid = parseUUID(v);
  if (!uuid) fail(`Expected UUID string for '${key}', got ${typeof v === 'string' ? JSON.stringify(v) : describe(v)}`, path);
  return uuid;
}

function optUUID(o: Obj, key: string, path: DecodingPath): string | undefined {
  if (!present(o, key)) return undefined;
  return reqUUID(o, key, path);
}

function reqEnum<T extends string>(o: Obj, key: string, all: readonly T[], path: DecodingPath): T {
  const v = o[key];
  if (typeof v !== 'string') fail(`Expected string for '${key}', got ${describe(v)}`, path);
  if (!(all as readonly string[]).includes(v)) fail(`Cannot initialize '${key}' from invalid raw value ${JSON.stringify(v)}`, path);
  return v as T;
}

function optEnum<T extends string>(o: Obj, key: string, all: readonly T[], path: DecodingPath): T | undefined {
  if (!present(o, key)) return undefined;
  return reqEnum(o, key, all, path);
}

function reqArray<T>(o: Obj, key: string, path: DecodingPath, item: (v: unknown, p: DecodingPath) => T): T[] {
  const v = o[key];
  if (!Array.isArray(v)) fail(`Expected array for '${key}', got ${describe(v)}`, path);
  return v.map((el, i) => item(el, [...path, key, i]));
}

function optArray<T>(o: Obj, key: string, path: DecodingPath, item: (v: unknown, p: DecodingPath) => T): T[] | undefined {
  if (!present(o, key)) return undefined;
  return reqArray(o, key, path, item);
}

function stringItem(v: unknown, p: DecodingPath): string {
  if (typeof v !== 'string') fail(`Expected string, got ${describe(v)}`, p);
  return v;
}

function numberItem(v: unknown, p: DecodingPath): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(`Expected number, got ${describe(v)}`, p);
  return v;
}

function enumItem<T extends string>(all: readonly T[]): (v: unknown, p: DecodingPath) => T {
  return (v, p) => {
    if (typeof v !== 'string') fail(`Expected string, got ${describe(v)}`, p);
    if (!(all as readonly string[]).includes(v)) fail(`Cannot initialize from invalid raw value ${JSON.stringify(v)}`, p);
    return v as T;
  };
}

function optObject<T>(o: Obj, key: string, path: DecodingPath, decode: (v: unknown, p: DecodingPath) => T): T | undefined {
  if (!present(o, key)) return undefined;
  return decode(o[key], [...path, key]);
}

function optStringRecord(o: Obj, key: string, path: DecodingPath): Record<string, string> | undefined {
  if (!present(o, key)) return undefined;
  const v = requireObject(o[key], [...path, key]);
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v)) {
    if (typeof val !== 'string') fail(`Expected string for '${k}', got ${describe(val)}`, [...path, key]);
    out[k] = val;
  }
  return out;
}

/** Drop `undefined` members so encoded JSON never carries them and decoded objects compare cleanly. */
export function compact<T extends object>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

// MARK: - DesignNode family

export function decodeShadowStyle(json: unknown, path: DecodingPath = []): ShadowStyle {
  const o = requireObject(json, path);
  return {
    color: reqString(o, 'color', path),
    opacity: reqNumber(o, 'opacity', path),
    radius: reqNumber(o, 'radius', path),
    x: reqNumber(o, 'x', path),
    y: reqNumber(o, 'y', path),
  };
}

export function encodeShadowStyle(s: ShadowStyle): unknown {
  return { color: s.color, opacity: s.opacity, radius: s.radius, x: s.x, y: s.y };
}

export function decodeEdgeConstraints(json: unknown, path: DecodingPath = []): EdgeConstraints {
  const o = requireObject(json, path);
  return compact({
    top: optNumber(o, 'top', path),
    right: optNumber(o, 'right', path),
    bottom: optNumber(o, 'bottom', path),
    left: optNumber(o, 'left', path),
    centerX: optNumber(o, 'centerX', path),
    centerY: optNumber(o, 'centerY', path),
  });
}

export function encodeEdgeConstraints(c: EdgeConstraints): unknown {
  return compact({ top: c.top, right: c.right, bottom: c.bottom, left: c.left, centerX: c.centerX, centerY: c.centerY });
}

export function decodeTextBehavior(json: unknown, path: DecodingPath = []): TextBehavior {
  const o = requireObject(json, path);
  return compact({
    wrap: optBool(o, 'wrap', path),
    autoHeight: optBool(o, 'autoHeight', path),
    maxLines: optInt(o, 'maxLines', path),
    truncate: optBool(o, 'truncate', path),
    overflow: optString(o, 'overflow', path),
  });
}

export function encodeTextBehavior(t: TextBehavior): unknown {
  return compact({ wrap: t.wrap, autoHeight: t.autoHeight, maxLines: t.maxLines, truncate: t.truncate, overflow: t.overflow });
}

export function decodeScrollBehavior(json: unknown, path: DecodingPath = []): ScrollBehavior {
  const o = requireObject(json, path);
  return compact({
    axis: reqString(o, 'axis', path),
    showsIndicators: optBool(o, 'showsIndicators', path),
    initialOffset: optNumber(o, 'initialOffset', path),
    itemSpacing: optNumber(o, 'itemSpacing', path),
    itemCount: optInt(o, 'itemCount', path),
  });
}

export function encodeScrollBehavior(s: ScrollBehavior): unknown {
  return compact({
    axis: s.axis,
    showsIndicators: s.showsIndicators,
    initialOffset: s.initialOffset,
    itemSpacing: s.itemSpacing,
    itemCount: s.itemCount,
  });
}

/**
 * `GradientStyle.init(from:)` — a bare `[String]` array becomes a linear
 * gradient with those colors; otherwise a keyed object where `type` defaults
 * to "linear" and `colors` to []. Anything else (string, number, array with
 * non-strings) throws, as Swift's keyed-container request would.
 */
export function decodeGradientStyle(json: unknown, path: DecodingPath = []): GradientStyle {
  if (Array.isArray(json) && json.every((c) => typeof c === 'string')) {
    return { type: 'linear', colors: [...(json as string[])] };
  }
  const o = requireObject(json, path);
  return compact({
    type: optString(o, 'type', path) ?? 'linear',
    colors: optArray(o, 'colors', path, stringItem) ?? [],
    angle: optNumber(o, 'angle', path),
    stops: optArray(o, 'stops', path, numberItem),
  });
}

export function encodeGradientStyle(g: GradientStyle): unknown {
  return compact({ type: g.type, colors: g.colors, angle: g.angle, stops: g.stops });
}

export function decodeNodeStyle(json: unknown, path: DecodingPath = []): NodeStyle {
  const o = requireObject(json, path);
  return compact({
    fill: reqString(o, 'fill', path),
    stroke: optString(o, 'stroke', path),
    strokeWidth: optNumber(o, 'strokeWidth', path),
    cornerRadius: reqNumber(o, 'cornerRadius', path),
    opacity: reqNumber(o, 'opacity', path),
    fontSize: optNumber(o, 'fontSize', path),
    fontWeight: optString(o, 'fontWeight', path),
    fontFamily: optString(o, 'fontFamily', path),
    textColor: optString(o, 'textColor', path),
    textAlign: optString(o, 'textAlign', path),
    letterSpacing: optNumber(o, 'letterSpacing', path),
    lineHeight: optNumber(o, 'lineHeight', path),
    paddingTop: optNumber(o, 'paddingTop', path),
    paddingRight: optNumber(o, 'paddingRight', path),
    paddingBottom: optNumber(o, 'paddingBottom', path),
    paddingLeft: optNumber(o, 'paddingLeft', path),
    marginTop: optNumber(o, 'marginTop', path),
    marginRight: optNumber(o, 'marginRight', path),
    marginBottom: optNumber(o, 'marginBottom', path),
    marginLeft: optNumber(o, 'marginLeft', path),
    layout: optString(o, 'layout', path),
    spacing: optNumber(o, 'spacing', path),
    layoutAlign: optString(o, 'layoutAlign', path),
    shadow: optObject(o, 'shadow', path, decodeShadowStyle),
    blur: optNumber(o, 'blur', path),
    backgroundBlur: optNumber(o, 'backgroundBlur', path),
    overlayColor: optString(o, 'overlayColor', path),
    overlayOpacity: optNumber(o, 'overlayOpacity', path),
    gradient: optObject(o, 'gradient', path, decodeGradientStyle),
    archTopRadius: optNumber(o, 'archTopRadius', path),
  });
}

export function encodeNodeStyle(s: NodeStyle): unknown {
  return compact({
    fill: s.fill,
    stroke: s.stroke,
    strokeWidth: s.strokeWidth,
    cornerRadius: s.cornerRadius,
    opacity: s.opacity,
    fontSize: s.fontSize,
    fontWeight: s.fontWeight,
    fontFamily: s.fontFamily,
    textColor: s.textColor,
    textAlign: s.textAlign,
    letterSpacing: s.letterSpacing,
    lineHeight: s.lineHeight,
    paddingTop: s.paddingTop,
    paddingRight: s.paddingRight,
    paddingBottom: s.paddingBottom,
    paddingLeft: s.paddingLeft,
    marginTop: s.marginTop,
    marginRight: s.marginRight,
    marginBottom: s.marginBottom,
    marginLeft: s.marginLeft,
    layout: s.layout,
    spacing: s.spacing,
    layoutAlign: s.layoutAlign,
    shadow: s.shadow ? encodeShadowStyle(s.shadow) : undefined,
    blur: s.blur,
    backgroundBlur: s.backgroundBlur,
    overlayColor: s.overlayColor,
    overlayOpacity: s.overlayOpacity,
    gradient: s.gradient ? encodeGradientStyle(s.gradient) : undefined,
    archTopRadius: s.archTopRadius,
  });
}

export function decodeRepeatBinding(json: unknown, path: DecodingPath = []): RepeatBinding {
  const o = requireObject(json, path);
  return compact({
    sourceVariable: reqString(o, 'sourceVariable', path),
    itemAlias: optString(o, 'itemAlias', path) ?? 'item',
    maxItems: optInt(o, 'maxItems', path),
    axis: optEnum(o, 'axis', AllRepeatAxis, path) ?? 'vertical',
    isScrollable: optBool(o, 'isScrollable', path) ?? true,
    filterVariable: optString(o, 'filterVariable', path),
    categoryVariable: optString(o, 'categoryVariable', path),
  });
}

export function encodeRepeatBinding(r: RepeatBinding): unknown {
  return compact({
    sourceVariable: r.sourceVariable,
    itemAlias: r.itemAlias,
    maxItems: r.maxItems,
    axis: r.axis,
    isScrollable: r.isScrollable,
    filterVariable: r.filterVariable,
    categoryVariable: r.categoryVariable,
  });
}

export function decodeLogicConditionExpression(json: unknown, path: DecodingPath = []): LogicConditionExpression {
  const o = requireObject(json, path);
  return compact({
    left: reqString(o, 'left', path),
    operation: reqEnum(o, 'operation', AllLogicConditionOperation, path),
    right: optString(o, 'right', path),
  });
}

export function encodeLogicConditionExpression(c: LogicConditionExpression): unknown {
  return compact({ left: c.left, operation: c.operation, right: c.right });
}

export function decodeNodeLogicBinding(json: unknown, path: DecodingPath = []): NodeLogicBinding {
  const o = requireObject(json, path);
  return compact({
    id: optUUID(o, 'id', path) ?? newUUID(),
    kind: reqEnum(o, 'kind', AllNodeLogicBindingKind, path),
    variableName: reqString(o, 'variableName', path),
    condition: optObject(o, 'condition', path, decodeLogicConditionExpression),
  });
}

export function encodeNodeLogicBinding(b: NodeLogicBinding): unknown {
  return compact({
    id: b.id,
    kind: b.kind,
    variableName: b.variableName,
    condition: b.condition ? encodeLogicConditionExpression(b.condition) : undefined,
  });
}

export function decodeTimePickerBinding(json: unknown, path: DecodingPath = []): TimePickerBinding {
  const o = requireObject(json, path);
  return {
    hourVariable: optString(o, 'hourVariable', path) ?? 'alarmHour',
    minuteVariable: optString(o, 'minuteVariable', path) ?? 'alarmMinute',
  };
}

export function encodeTimePickerBinding(t: TimePickerBinding): unknown {
  return { hourVariable: t.hourVariable, minuteVariable: t.minuteVariable };
}

export function decodeDesignNode(json: unknown, path: DecodingPath = []): DesignNode {
  const o = requireObject(json, path);
  return compact({
    id: optUUID(o, 'id', path) ?? newUUID(),
    type: reqEnum(o, 'type', AllNodeType, path),
    name: reqString(o, 'name', path),
    x: reqNumber(o, 'x', path),
    y: reqNumber(o, 'y', path),
    width: reqNumber(o, 'width', path),
    height: reqNumber(o, 'height', path),
    text: optString(o, 'text', path),
    isSecure: optBool(o, 'isSecure', path),
    imageName: optString(o, 'imageName', path),
    imageSource: optString(o, 'imageSource', path),
    contentMode: optEnum(o, 'contentMode', AllImageContentMode, path),
    iconName: optString(o, 'iconName', path),
    style: decodeNodeStyle(o.style, [...path, 'style']),
    constraints: optObject(o, 'constraints', path, decodeEdgeConstraints),
    clipContent: optBool(o, 'clipContent', path),
    zIndex: optNumber(o, 'zIndex', path),
    manuallyPositioned: optBool(o, 'manuallyPositioned', path),
    textBehavior: optObject(o, 'textBehavior', path, decodeTextBehavior),
    scrollBehavior: optObject(o, 'scrollBehavior', path, decodeScrollBehavior),
    devicePresetId: optString(o, 'devicePresetId', path),
    supportedPlatforms: optArray(o, 'supportedPlatforms', path, enumItem(AllAppPlatform)),
    logicBindings: optArray(o, 'logicBindings', path, decodeNodeLogicBinding),
    repeatBinding: optObject(o, 'repeatBinding', path, decodeRepeatBinding),
    gameEntity: optObject(o, 'gameEntity', path, decodeGameEntity),
    timePicker: optObject(o, 'timePicker', path, decodeTimePickerBinding),
    gameScene: optObject(o, 'gameScene', path, decodeGameSceneSpec),
    children: optArray(o, 'children', path, decodeDesignNode) ?? [],
  });
}

export function encodeDesignNode(n: DesignNode): unknown {
  return compact({
    id: n.id,
    type: n.type,
    name: n.name,
    x: n.x,
    y: n.y,
    width: n.width,
    height: n.height,
    text: n.text,
    isSecure: n.isSecure,
    imageName: n.imageName,
    imageSource: n.imageSource,
    contentMode: n.contentMode,
    iconName: n.iconName,
    style: encodeNodeStyle(n.style),
    constraints: n.constraints ? encodeEdgeConstraints(n.constraints) : undefined,
    clipContent: n.clipContent,
    zIndex: n.zIndex,
    manuallyPositioned: n.manuallyPositioned,
    textBehavior: n.textBehavior ? encodeTextBehavior(n.textBehavior) : undefined,
    scrollBehavior: n.scrollBehavior ? encodeScrollBehavior(n.scrollBehavior) : undefined,
    devicePresetId: n.devicePresetId,
    supportedPlatforms: n.supportedPlatforms,
    logicBindings: n.logicBindings ? n.logicBindings.map(encodeNodeLogicBinding) : undefined,
    repeatBinding: n.repeatBinding ? encodeRepeatBinding(n.repeatBinding) : undefined,
    gameEntity: n.gameEntity ? encodeGameEntity(n.gameEntity) : undefined,
    timePicker: n.timePicker ? encodeTimePickerBinding(n.timePicker) : undefined,
    gameScene: n.gameScene ? encodeGameSceneSpec(n.gameScene) : undefined,
    children: n.children.map(encodeDesignNode),
  });
}

// MARK: - Game spec (Runtime/AgentGameKit.swift tolerant decoders)

export function decodeParallaxLayer(json: unknown, path: DecodingPath = []): ParallaxLayer {
  const o = requireObject(json, path);
  return compact({
    sprite: optString(o, 'sprite', path) ?? '',
    speed: optNumber(o, 'speed', path) ?? 0.4,
    height: optNumber(o, 'height', path),
    y: optNumber(o, 'y', path) ?? 0,
  });
}

export function encodeParallaxLayer(l: ParallaxLayer): unknown {
  return compact({ sprite: l.sprite, speed: l.speed, height: l.height, y: l.y });
}

export function decodeGameBehavior(json: unknown, path: DecodingPath = []): GameBehavior {
  const o = requireObject(json, path);
  return compact({
    type: reqString(o, 'type', path),
    strength: optNumber(o, 'strength', path),
    key: optString(o, 'key', path),
    velocityX: optNumber(o, 'velocityX', path),
    velocityY: optNumber(o, 'velocityY', path),
    interval: optNumber(o, 'interval', path),
    template: optString(o, 'template', path),
    spawnYMin: optNumber(o, 'spawnYMin', path),
    spawnYMax: optNumber(o, 'spawnYMax', path),
    gapSize: optNumber(o, 'gapSize', path),
    firstDelay: optNumber(o, 'firstDelay', path),
    scoreOnPass: optBool(o, 'scoreOnPass', path),
    direction: optString(o, 'direction', path),
    margin: optNumber(o, 'margin', path),
    target: optString(o, 'target', path),
    action: optString(o, 'action', path),
    points: optInt(o, 'points', path),
    flowId: optString(o, 'flowId', path),
    soundName: optString(o, 'soundName', path),
    shake: optBool(o, 'shake', path),
    maxPower: optNumber(o, 'maxPower', path),
    maxDrag: optNumber(o, 'maxDrag', path),
    autoReload: optBool(o, 'autoReload', path),
    wheelRadius: optNumber(o, 'wheelRadius', path),
    wheelBase: optNumber(o, 'wheelBase', path),
    wheelDrop: optNumber(o, 'wheelDrop', path),
    motorSpeed: optNumber(o, 'motorSpeed', path),
    motorForce: optNumber(o, 'motorForce', path),
    particles: optString(o, 'particles', path),
  });
}

export function encodeGameBehavior(b: GameBehavior): unknown {
  return compact({
    type: b.type,
    strength: b.strength,
    key: b.key,
    velocityX: b.velocityX,
    velocityY: b.velocityY,
    interval: b.interval,
    template: b.template,
    spawnYMin: b.spawnYMin,
    spawnYMax: b.spawnYMax,
    gapSize: b.gapSize,
    firstDelay: b.firstDelay,
    scoreOnPass: b.scoreOnPass,
    direction: b.direction,
    margin: b.margin,
    target: b.target,
    action: b.action,
    points: b.points,
    flowId: b.flowId,
    soundName: b.soundName,
    shake: b.shake,
    maxPower: b.maxPower,
    maxDrag: b.maxDrag,
    autoReload: b.autoReload,
    wheelRadius: b.wheelRadius,
    wheelBase: b.wheelBase,
    wheelDrop: b.wheelDrop,
    motorSpeed: b.motorSpeed,
    motorForce: b.motorForce,
    particles: b.particles,
  });
}

function nonEmpty(s: string | undefined): string | undefined {
  return s === undefined || s === '' ? undefined : s;
}

/**
 * `GameEntity.init(from:)` — hand-authored entity JSON only needs x/y/width/height
 * (and usually color or sprite); everything else defaults. A missing id is
 * derived from name/category, else `entity-XXXXXXXX`.
 */
export function decodeGameEntity(json: unknown, path: DecodingPath = []): GameEntity {
  const o = requireObject(json, path);
  const id =
    optString(o, 'id', path) ??
    nonEmpty(optString(o, 'name', path)) ??
    nonEmpty(optString(o, 'category', path)) ??
    fallbackGameEntityId();
  return compact({
    id,
    name: optString(o, 'name', path) ?? '',
    sprite: optString(o, 'sprite', path),
    frames: optArray(o, 'frames', path, stringItem),
    frameRate: optNumber(o, 'frameRate', path),
    color: optString(o, 'color', path),
    x: optNumber(o, 'x', path) ?? 0,
    y: optNumber(o, 'y', path) ?? 0,
    width: optNumber(o, 'width', path) ?? 40,
    height: optNumber(o, 'height', path) ?? 40,
    zIndex: optNumber(o, 'zIndex', path) ?? 0,
    rotation: optNumber(o, 'rotation', path) ?? 0,
    body: present(o, 'body') ? decodeGameBodyType(o.body) : 'none',
    circleBody: optBool(o, 'circleBody', path) ?? false,
    affectedByGravity: optBool(o, 'affectedByGravity', path) ?? true,
    restitution: optNumber(o, 'restitution', path) ?? 0.2,
    mass: optNumber(o, 'mass', path),
    friction: optNumber(o, 'friction', path) ?? 0.2,
    linearDamping: optNumber(o, 'linearDamping', path) ?? 0.1,
    allowsRotation: optBool(o, 'allowsRotation', path) ?? false,
    category: optString(o, 'category', path),
    collidesWith: optArray(o, 'collidesWith', path, stringItem) ?? [],
    contacts: optArray(o, 'contacts', path, stringItem) ?? [],
    isTemplate: optBool(o, 'isTemplate', path) ?? false,
    health: optInt(o, 'health', path),
    dropShadow: optBool(o, 'dropShadow', path) ?? false,
    glow: optBool(o, 'glow', path) ?? false,
    glowColor: optString(o, 'glowColor', path),
    points: optArray(o, 'points', path, (v, p) => {
      if (!Array.isArray(v)) fail(`Expected [number] point, got ${describe(v)}`, p);
      return v.map((n, i) => numberItem(n, [...p, i]));
    }),
    strokeWidth: optNumber(o, 'strokeWidth', path),
    behaviors: optArray(o, 'behaviors', path, decodeGameBehavior) ?? [],
  });
}

export function encodeGameEntity(e: GameEntity): unknown {
  return compact({
    id: e.id,
    name: e.name,
    sprite: e.sprite,
    frames: e.frames,
    frameRate: e.frameRate,
    color: e.color,
    x: e.x,
    y: e.y,
    width: e.width,
    height: e.height,
    zIndex: e.zIndex,
    rotation: e.rotation,
    body: e.body,
    circleBody: e.circleBody,
    affectedByGravity: e.affectedByGravity,
    restitution: e.restitution,
    mass: e.mass,
    friction: e.friction,
    linearDamping: e.linearDamping,
    allowsRotation: e.allowsRotation,
    category: e.category,
    collidesWith: e.collidesWith,
    contacts: e.contacts,
    isTemplate: e.isTemplate,
    health: e.health,
    dropShadow: e.dropShadow,
    glow: e.glow,
    glowColor: e.glowColor,
    points: e.points,
    strokeWidth: e.strokeWidth,
    behaviors: e.behaviors.map(encodeGameBehavior),
  });
}

/** `GameSceneSpec.init(from:)` — every missing key falls back to its default. */
export function decodeGameSceneSpec(json: unknown, path: DecodingPath = []): GameSceneSpec {
  const o = requireObject(json, path);
  return compact({
    version: optInt(o, 'version', path) ?? 1,
    width: optNumber(o, 'width', path) ?? 390,
    height: optNumber(o, 'height', path) ?? 844,
    backgroundColor: optString(o, 'backgroundColor', path) ?? '#8ED0F0',
    backgroundImage: optString(o, 'backgroundImage', path),
    gravity: optNumber(o, 'gravity', path) ?? -18,
    scrollSpeed: optNumber(o, 'scrollSpeed', path) ?? 0,
    entities: optArray(o, 'entities', path, decodeGameEntity) ?? [],
    startPaused: optBool(o, 'startPaused', path) ?? true,
    showScore: optBool(o, 'showScore', path) ?? true,
    winScore: optInt(o, 'winScore', path),
    tapToStartText: optString(o, 'tapToStartText', path) ?? 'Tap to start',
    worldWidth: optNumber(o, 'worldWidth', path) ?? 0,
    worldHeight: optNumber(o, 'worldHeight', path) ?? 0,
    cameraFollow: optString(o, 'cameraFollow', path),
    parallax: optArray(o, 'parallax', path, decodeParallaxLayer) ?? [],
    ambient: optString(o, 'ambient', path),
    music: optString(o, 'music', path),
    lives: optInt(o, 'lives', path),
    timeLimit: optNumber(o, 'timeLimit', path),
    timeUpAction: optString(o, 'timeUpAction', path) ?? 'gameOver',
    difficultyRamp: optNumber(o, 'difficultyRamp', path),
    backgroundGradient: optArray(o, 'backgroundGradient', path, stringItem) ?? [],
    lighting: optBool(o, 'lighting', path) ?? false,
    lightFollow: optString(o, 'lightFollow', path),
    lightColor: optString(o, 'lightColor', path) ?? '#FFF4D6',
    vignette: optBool(o, 'vignette', path) ?? false,
  });
}

export function encodeGameSceneSpec(s: GameSceneSpec): unknown {
  return compact({
    version: s.version,
    width: s.width,
    height: s.height,
    backgroundColor: s.backgroundColor,
    backgroundImage: s.backgroundImage,
    gravity: s.gravity,
    scrollSpeed: s.scrollSpeed,
    entities: s.entities.map(encodeGameEntity),
    startPaused: s.startPaused,
    showScore: s.showScore,
    winScore: s.winScore,
    tapToStartText: s.tapToStartText,
    worldWidth: s.worldWidth,
    worldHeight: s.worldHeight,
    cameraFollow: s.cameraFollow,
    parallax: s.parallax.map(encodeParallaxLayer),
    ambient: s.ambient,
    music: s.music,
    lives: s.lives,
    timeLimit: s.timeLimit,
    timeUpAction: s.timeUpAction,
    difficultyRamp: s.difficultyRamp,
    backgroundGradient: s.backgroundGradient,
    lighting: s.lighting,
    lightFollow: s.lightFollow,
    lightColor: s.lightColor,
    vignette: s.vignette,
  });
}

// MARK: - Logic models

export function decodeBlockParameter(json: unknown, path: DecodingPath = []): BlockParameter {
  const o = requireObject(json, path);
  return compact({
    id: optUUID(o, 'id', path) ?? newUUID(),
    key: reqString(o, 'key', path),
    label: reqString(o, 'label', path),
    type: reqEnum(o, 'type', AllParameterType, path),
    value: optString(o, 'value', path),
    nodeReference: optUUID(o, 'nodeReference', path),
    variableReference: optString(o, 'variableReference', path),
    isRequired: optBool(o, 'isRequired', path) ?? true,
    placeholder: optString(o, 'placeholder', path),
    options: optArray(o, 'options', path, stringItem),
  });
}

export function encodeBlockParameter(p: BlockParameter): unknown {
  return compact({
    id: p.id,
    key: p.key,
    label: p.label,
    type: p.type,
    value: p.value,
    nodeReference: p.nodeReference,
    variableReference: p.variableReference,
    isRequired: p.isRequired,
    placeholder: p.placeholder,
    options: p.options,
  });
}

export function decodeLogicBlock(json: unknown, path: DecodingPath = []): LogicBlock {
  const o = requireObject(json, path);
  return compact({
    id: optUUID(o, 'id', path) ?? newUUID(),
    type: reqEnum(o, 'type', AllLogicBlockType, path),
    category: reqEnum(o, 'category', AllLogicBlockCategory, path),
    label: reqString(o, 'label', path),
    x: reqNumber(o, 'x', path),
    y: reqNumber(o, 'y', path),
    width: optNumber(o, 'width', path) ?? 200,
    parameters: optArray(o, 'parameters', path, decodeBlockParameter) ?? [],
    connectedDesignNodeId: optUUID(o, 'connectedDesignNodeId', path),
    isCollapsed: optBool(o, 'isCollapsed', path) ?? false,
    comment: optString(o, 'comment', path),
  });
}

export function encodeLogicBlock(b: LogicBlock): unknown {
  return compact({
    id: b.id,
    type: b.type,
    category: b.category,
    label: b.label,
    x: b.x,
    y: b.y,
    width: b.width,
    parameters: b.parameters.map(encodeBlockParameter),
    connectedDesignNodeId: b.connectedDesignNodeId,
    isCollapsed: b.isCollapsed,
    comment: b.comment,
  });
}

export function decodeBlockConnection(json: unknown, path: DecodingPath = []): BlockConnection {
  const o = requireObject(json, path);
  return {
    id: optUUID(o, 'id', path) ?? newUUID(),
    sourceBlockId: reqUUID(o, 'sourceBlockId', path),
    sourcePortIndex: reqInt(o, 'sourcePortIndex', path),
    targetBlockId: reqUUID(o, 'targetBlockId', path),
    targetPortIndex: reqInt(o, 'targetPortIndex', path),
  };
}

export function encodeBlockConnection(c: BlockConnection): unknown {
  return {
    id: c.id,
    sourceBlockId: c.sourceBlockId,
    sourcePortIndex: c.sourcePortIndex,
    targetBlockId: c.targetBlockId,
    targetPortIndex: c.targetPortIndex,
  };
}

export function decodeLogicVariable(json: unknown, path: DecodingPath = []): LogicVariable {
  const o = requireObject(json, path);
  return compact({
    id: optUUID(o, 'id', path) ?? newUUID(),
    name: reqString(o, 'name', path),
    type: optEnum(o, 'type', AllVariableType, path) ?? 'string',
    defaultValue: optString(o, 'defaultValue', path),
    scope: optEnum(o, 'scope', AllVariableScope, path) ?? 'flow',
  });
}

export function encodeLogicVariable(v: LogicVariable): unknown {
  return compact({ id: v.id, name: v.name, type: v.type, defaultValue: v.defaultValue, scope: v.scope });
}

export function decodeLogicFlow(json: unknown, path: DecodingPath = []): LogicFlow {
  const o = requireObject(json, path);
  return compact({
    id: optUUID(o, 'id', path) ?? newUUID(),
    name: reqString(o, 'name', path),
    blocks: optArray(o, 'blocks', path, decodeLogicBlock) ?? [],
    connections: optArray(o, 'connections', path, decodeBlockConnection) ?? [],
    screenNodeId: optUUID(o, 'screenNodeId', path),
    variables: optArray(o, 'variables', path, decodeLogicVariable) ?? [],
    supportedPlatforms: optArray(o, 'supportedPlatforms', path, enumItem(AllAppPlatform)),
  });
}

export function encodeLogicFlow(f: LogicFlow): unknown {
  return compact({
    id: f.id,
    name: f.name,
    blocks: f.blocks.map(encodeLogicBlock),
    connections: f.connections.map(encodeBlockConnection),
    screenNodeId: f.screenNodeId,
    variables: f.variables.map(encodeLogicVariable),
    supportedPlatforms: f.supportedPlatforms,
  });
}

// MARK: - Backend configs

function decodeKeyValueRow<T extends { id: string; key: string; value: string }>(json: unknown, path: DecodingPath): T {
  const o = requireObject(json, path);
  return {
    id: optUUID(o, 'id', path) ?? newUUID(),
    key: optString(o, 'key', path) ?? '',
    value: optString(o, 'value', path) ?? '',
  } as T;
}

export function decodeHTTPHeaderField(json: unknown, path: DecodingPath = []): HTTPHeaderField {
  return decodeKeyValueRow<HTTPHeaderField>(json, path);
}

export function decodeHTTPQueryParam(json: unknown, path: DecodingPath = []): HTTPQueryParam {
  return decodeKeyValueRow<HTTPQueryParam>(json, path);
}

export function decodeResponseFieldMapping(json: unknown, path: DecodingPath = []): ResponseFieldMapping {
  const o = requireObject(json, path);
  return {
    id: optUUID(o, 'id', path) ?? newUUID(),
    jsonPath: optString(o, 'jsonPath', path) ?? '',
    variableName: optString(o, 'variableName', path) ?? '',
  };
}

export function decodeAPIEndpointConfig(json: unknown, path: DecodingPath = []): APIEndpointConfig {
  const o = requireObject(json, path);
  return compact({
    id: optUUID(o, 'id', path) ?? newUUID(),
    name: optString(o, 'name', path) ?? '',
    baseURL: optString(o, 'baseURL', path) ?? '',
    path: optString(o, 'path', path) ?? '',
    method: optEnum(o, 'method', AllHTTPMethod, path) ?? 'GET',
    headers: optArray(o, 'headers', path, decodeHTTPHeaderField) ?? [],
    bodyTemplate: optString(o, 'bodyTemplate', path),
    queryParameters: optArray(o, 'queryParameters', path, decodeHTTPQueryParam) ?? [],
    responseMapping: optArray(o, 'responseMapping', path, decodeResponseFieldMapping) ?? [],
    authentication: optEnum(o, 'authentication', AllAPIAuthentication, path) ?? 'none',
  });
}

export function encodeAPIEndpointConfig(c: APIEndpointConfig): unknown {
  return compact({
    id: c.id,
    name: c.name,
    baseURL: c.baseURL,
    path: c.path,
    method: c.method,
    headers: c.headers.map((h) => ({ id: h.id, key: h.key, value: h.value })),
    bodyTemplate: c.bodyTemplate,
    queryParameters: c.queryParameters.map((q) => ({ id: q.id, key: q.key, value: q.value })),
    responseMapping: c.responseMapping.map((m) => ({ id: m.id, jsonPath: m.jsonPath, variableName: m.variableName })),
    authentication: c.authentication,
  });
}

export function decodeFirestoreFieldTemplate(json: unknown, path: DecodingPath = []): FirestoreFieldTemplate {
  const o = requireObject(json, path);
  return {
    id: optUUID(o, 'id', path) ?? newUUID(),
    name: reqString(o, 'name', path),
    type: optString(o, 'type', path) ?? 'string',
    isRequired: optBool(o, 'isRequired', path) ?? true,
  };
}

export function decodeFirestoreCollectionTemplate(json: unknown, path: DecodingPath = []): FirestoreCollectionTemplate {
  const o = requireObject(json, path);
  return {
    id: optUUID(o, 'id', path) ?? newUUID(),
    name: reqString(o, 'name', path),
    fields: optArray(o, 'fields', path, decodeFirestoreFieldTemplate) ?? [],
  };
}

export function decodeFirebaseConfig(json: unknown, path: DecodingPath = []): FirebaseConfig {
  const o = requireObject(json, path);
  return {
    projectId: optString(o, 'projectId', path) ?? '',
    apiKey: optString(o, 'apiKey', path) ?? '',
    authDomain: optString(o, 'authDomain', path) ?? '',
    storageBucket: optString(o, 'storageBucket', path) ?? '',
    messagingSenderId: optString(o, 'messagingSenderId', path) ?? '',
    appId: optString(o, 'appId', path) ?? '',
    isEnabled: optBool(o, 'isEnabled', path) ?? false,
    enableEmailAuth: optBool(o, 'enableEmailAuth', path) ?? true,
    enableGoogleAuth: optBool(o, 'enableGoogleAuth', path) ?? false,
    enableAppleAuth: optBool(o, 'enableAppleAuth', path) ?? false,
    enableAnonymousAuth: optBool(o, 'enableAnonymousAuth', path) ?? false,
    firestoreRules: optString(o, 'firestoreRules', path) ?? '',
    defaultCollections: optArray(o, 'defaultCollections', path, decodeFirestoreCollectionTemplate) ?? [],
    publicReadCollections: optArray(o, 'publicReadCollections', path, stringItem) ?? [],
  };
}

export function encodeFirebaseConfig(c: FirebaseConfig): unknown {
  return {
    projectId: c.projectId,
    apiKey: c.apiKey,
    authDomain: c.authDomain,
    storageBucket: c.storageBucket,
    messagingSenderId: c.messagingSenderId,
    appId: c.appId,
    isEnabled: c.isEnabled,
    enableEmailAuth: c.enableEmailAuth,
    enableGoogleAuth: c.enableGoogleAuth,
    enableAppleAuth: c.enableAppleAuth,
    enableAnonymousAuth: c.enableAnonymousAuth,
    firestoreRules: c.firestoreRules,
    defaultCollections: c.defaultCollections.map((col) => ({
      id: col.id,
      name: col.name,
      fields: col.fields.map((f) => ({ id: f.id, name: f.name, type: f.type, isRequired: f.isRequired })),
    })),
    publicReadCollections: c.publicReadCollections,
  };
}

export function decodeSupabaseConfig(json: unknown, path: DecodingPath = []): SupabaseConfig {
  const o = requireObject(json, path);
  return {
    projectURL: optString(o, 'projectURL', path) ?? '',
    anonKey: optString(o, 'anonKey', path) ?? '',
    isEnabled: optBool(o, 'isEnabled', path) ?? false,
  };
}

export function encodeSupabaseConfig(c: SupabaseConfig): unknown {
  return { projectURL: c.projectURL, anonKey: c.anonKey, isEnabled: c.isEnabled };
}

export function decodeBrandIdentity(json: unknown, path: DecodingPath = []): BrandIdentity {
  const o = requireObject(json, path);
  return compact({
    accent: reqString(o, 'accent', path),
    accentSecondary: optString(o, 'accentSecondary', path),
    name: optString(o, 'name', path),
  });
}

export function encodeBrandIdentity(b: BrandIdentity): unknown {
  return compact({ accent: b.accent, accentSecondary: b.accentSecondary, name: b.name });
}

// MARK: - Project / page

/** `ProjectPlatformSettings.init(from:)` — hand-written so older files still load. */
export function decodeProjectPlatformSettings(json: unknown, path: DecodingPath = []): ProjectPlatformSettings {
  const o = requireObject(json, path);
  return {
    enabledPlatforms: optArray(o, 'enabledPlatforms', path, enumItem(AllAppPlatform)) ?? ['iPhone', 'iPad'],
    defaultPreviewPlatform: optEnum(o, 'defaultPreviewPlatform', AllAppPlatform, path) ?? 'iPhone',
    orientation: optEnum(o, 'orientation', AllAppOrientation, path) ?? 'portrait',
  };
}

export function encodeProjectPlatformSettings(s: ProjectPlatformSettings): unknown {
  return {
    enabledPlatforms: s.enabledPlatforms,
    defaultPreviewPlatform: s.defaultPreviewPlatform,
    orientation: s.orientation,
  };
}

/** `DesignPage.init(from:)` — logicFlows default to [] for pre-Logic-Mode files. */
export function decodeDesignPage(json: unknown, path: DecodingPath = []): DesignPage {
  const o = requireObject(json, path);
  return compact({
    id: reqUUID(o, 'id', path),
    name: reqString(o, 'name', path),
    nodes: reqArray(o, 'nodes', path, decodeDesignNode),
    logicFlows: optArray(o, 'logicFlows', path, decodeLogicFlow) ?? [],
    supportedPlatforms: optArray(o, 'supportedPlatforms', path, enumItem(AllAppPlatform)),
  });
}

export function encodeDesignPage(p: DesignPage): unknown {
  return compact({
    id: p.id,
    name: p.name,
    nodes: p.nodes.map(encodeDesignNode),
    logicFlows: p.logicFlows.map(encodeLogicFlow),
    supportedPlatforms: p.supportedPlatforms,
  });
}

/** `DesignProject.init(from:)` — decodeIfPresent keeps projects saved before Logic Mode loadable. */
export function decodeDesignProject(json: unknown): DesignProject {
  const path: DecodingPath = [];
  const o = requireObject(json, path);
  return compact({
    name: reqString(o, 'name', path),
    pages: reqArray(o, 'pages', path, decodeDesignPage),
    firebaseConfig: optObject(o, 'firebaseConfig', path, decodeFirebaseConfig),
    supabaseConfig: optObject(o, 'supabaseConfig', path, decodeSupabaseConfig),
    apiEndpoints: optArray(o, 'apiEndpoints', path, decodeAPIEndpointConfig) ?? [],
    globalVariables: optArray(o, 'globalVariables', path, decodeLogicVariable) ?? [],
    platformSettings: present(o, 'platformSettings')
      ? decodeProjectPlatformSettings(o.platformSettings, ['platformSettings'])
      : { enabledPlatforms: ['iPhone', 'iPad'], defaultPreviewPlatform: 'iPhone', orientation: 'portrait' },
    brand: optObject(o, 'brand', path, decodeBrandIdentity),
    bundleIdentifier: optString(o, 'bundleIdentifier', path),
    developmentTeam: optString(o, 'developmentTeam', path),
    agentMemo: optString(o, 'agentMemo', path),
    sourceOverrides: optStringRecord(o, 'sourceOverrides', path),
  });
}

/** Mirrors the synthesized encoder (CodingKeys order; nil optionals omitted). */
export function encodeDesignProject(p: DesignProject): unknown {
  return compact({
    name: p.name,
    pages: p.pages.map(encodeDesignPage),
    firebaseConfig: p.firebaseConfig ? encodeFirebaseConfig(p.firebaseConfig) : undefined,
    supabaseConfig: p.supabaseConfig ? encodeSupabaseConfig(p.supabaseConfig) : undefined,
    apiEndpoints: p.apiEndpoints.map(encodeAPIEndpointConfig),
    globalVariables: p.globalVariables.map(encodeLogicVariable),
    platformSettings: encodeProjectPlatformSettings(p.platformSettings),
    brand: p.brand ? encodeBrandIdentity(p.brand) : undefined,
    bundleIdentifier: p.bundleIdentifier,
    developmentTeam: p.developmentTeam,
    agentMemo: p.agentMemo,
    sourceOverrides: p.sourceOverrides,
  });
}

/**
 * `.agenticdesign` text exactly as ProjectDocumentService writes it:
 * `JSONEncoder` with `[.prettyPrinted, .sortedKeys]` (2-space indent).
 */
export function serializeDesignProject(p: DesignProject): string {
  return stringifySorted(encodeDesignProject(p), 2);
}

/** Parse `.agenticdesign` text. */
export function parseDesignProject(text: string): DesignProject {
  return decodeDesignProject(JSON.parse(text));
}
