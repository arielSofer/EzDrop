// Ported 1:1 from AgenticDesigner/Agent/DesignAction.swift
//
// The agent's response format (Milestone 4: Design Plan) and its deliberately
// lenient decoder: LLM output is normalised rather than rejected — key aliases,
// numbers-as-strings ("12px"), objects-as-strings, loose enum spellings — and
// one malformed action never discards the whole response (LossyDesignAction).

import { decodeComponentType, type ComponentType } from '../models/ComponentType';
import type { EdgeConstraints, ImageContentMode, ShadowStyle, TextBehavior } from '../models/DesignNode';
import { decodeGradientStyle, decodeScrollBehavior, decodeShadowStyle, isPlainObject } from '../models/codec';
import type { GradientStyle } from '../models/GradientStyle';
import { newUUID, parseUUID } from '../models/uuid';
import { getPlatform } from '../platform/platform';

// MARK: - Response

export interface DesignAgentResponse {
  plan: string[];
  actions: DesignAction[];
}

/** `LossyDesignAction` — wrapper that swallows individual decode failures inside action arrays. */
export interface LossyDesignAction {
  action: DesignAction | null;
}

export class DesignActionDecodingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DesignActionDecodingError';
  }
}

// MARK: - Action type

export const AllDesignActionType = [
  'createFrame',
  'createText',
  'createButton',
  'createInput',
  'createRectangle',
  'createImage',
  'createIcon',
  'createPage',
  'updateText',
  'updateStyle',
  'moveNode',
  'resizeNode',
  'scaleNode',
  'setAutoLayout',
  'pinNode',
  'bringToFront',
  'sendToBack',
  'setZIndex',
  'alignChildren',
  'distributeChildren',
  'positionRelativeTo',
  'deleteNode',
  'createOnboardingScreen',
  'createComponent',
  'createPresentationShot',
] as const;
export type DesignActionType = (typeof AllDesignActionType)[number];

/** `DesignActionType.init(from:)` — normalises case/underscores/dashes and accepts synonyms. */
export function decodeDesignActionType(rawValue: unknown): DesignActionType {
  if (typeof rawValue !== 'string') {
    throw new DesignActionDecodingError(`Expected String for DesignAction type, got ${describeJSON(rawValue)}`);
  }
  const normalizedValue = rawValue.trim().toLowerCase().replaceAll('_', '').replaceAll('-', '');

  switch (normalizedValue) {
    case 'createframe': case 'frame':
      return 'createFrame';
    case 'createtext': case 'text':
      return 'createText';
    case 'createbutton': case 'button':
      return 'createButton';
    case 'createinput': case 'input': case 'createinputfield': case 'inputfield':
      return 'createInput';
    case 'createrectangle': case 'rectangle': case 'createshape':
      return 'createRectangle';
    case 'createimage': case 'image':
      return 'createImage';
    case 'createicon': case 'icon':
      return 'createIcon';
    case 'createpage': case 'page': case 'addpage': case 'newpage':
      return 'createPage';
    case 'updatetext':
      return 'updateText';
    case 'updatestyle':
      return 'updateStyle';
    case 'movenode':
      return 'moveNode';
    case 'resizenode':
      return 'resizeNode';
    case 'scalenode': case 'scale': case 'enlarge': case 'shrink':
      return 'scaleNode';
    case 'setautolayout': case 'autolayout': case 'layoutnode': case 'setlayout':
      return 'setAutoLayout';
    case 'pinnode': case 'pin': case 'setconstraints': case 'constraints':
      return 'pinNode';
    case 'bringtofront': case 'front': case 'movefront':
      return 'bringToFront';
    case 'sendtoback': case 'back': case 'moveback':
      return 'sendToBack';
    case 'setzindex': case 'zindex': case 'setlayerorder': case 'layerorder':
      return 'setZIndex';
    case 'alignchildren': case 'alignitems': case 'align':
      return 'alignChildren';
    case 'distributechildren': case 'distributeitems': case 'distribute': case 'spaceevenly': case 'splitevenly':
      return 'distributeChildren';
    case 'positionrelativeto': case 'positionrelative': case 'place relative': case 'placerelative':
      return 'positionRelativeTo';
    case 'deletenode': case 'removenode': case 'delete': case 'remove':
      return 'deleteNode';
    case 'createonboardingscreen': case 'onboardingscreen':
      return 'createOnboardingScreen';
    case 'createcomponent': case 'component':
      return 'createComponent';
    case 'createpresentationshot': case 'presentationshot': case 'createshowcase': case 'showcase':
      return 'createPresentationShot';
    default:
      throw new DesignActionDecodingError(`Unsupported DesignAction type: ${rawValue}`);
  }
}

// MARK: - Action

/** One action the agent returns to the app. */
export interface DesignAction {
  id: string;

  type: DesignActionType;
  component?: ComponentType;
  rawComponentName?: string;
  props?: Record<string, string>;

  /** Existing node id — relevant for update/move/resize */
  nodeId?: string;
  // var so the app can tag generated-image actions with a reference before
  // applying, which lets it patch the real asset in after async generation.
  nodeReference?: string;

  /** Parent id a new node should be added under */
  parentId?: string;
  parentReference?: string;

  // General data
  name?: string;
  text?: string;
  /** for createPage */
  pageName?: string;

  // Position & size
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  scale?: number;
  axis?: string;
  alignment?: string;
  relativeToNodeId?: string;
  relativeToReference?: string;
  anchor?: string;
  offsetX?: number;
  offsetY?: number;

  // Style
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  gradient?: GradientStyle;
  cornerRadius?: number;
  opacity?: number;
  fontSize?: number;
  /** text colour */
  textColor?: string;
  textAlign?: string;
  letterSpacing?: number;
  lineHeight?: number;
  constraints?: EdgeConstraints;
  clipContent?: boolean;
  zIndex?: number;
  textBehavior?: TextBehavior;
  scrollAxis?: string;
  scrollOffset?: number;
  recycleItemSpacing?: number;
  recycleItemCount?: number;
  // Data-bound repeat (recycler) template: clone this node once per item
  // of a JSON-array variable, {{alias.field}} tokens resolving per item.
  repeatSourceVariable?: string;
  timePickerHourVariable?: string;
  timePickerMinuteVariable?: string;
  repeatItemAlias?: string;
  /** "vertical" | "horizontal" */
  repeatAxis?: string;
  repeatMaxItems?: number;
  repeatScrollable?: boolean;
  /** live search filter variable */
  repeatFilterVariable?: string;
  /** second (category) filter variable */
  repeatCategoryVariable?: string;
  shadow?: ShadowStyle;
  overlayColor?: string;
  overlayOpacity?: number;
  blur?: number;
  backgroundBlur?: number;
  /** uniform padding on every side */
  padding?: number;
  /** horizontal padding (left+right) */
  paddingH?: number;
  /** vertical padding (top+bottom) */
  paddingV?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  margin?: number;
  marginH?: number;
  marginV?: number;
  marginTop?: number;
  marginRight?: number;
  marginBottom?: number;
  marginLeft?: number;

  // Auto Layout
  /** e.g. "verticalStack", "horizontalStack" */
  layout?: string;
  /** gap between children */
  spacing?: number;
  layoutAlign?: string;

  // Image / Icon specific
  /** URL or path for Image nodes */
  imageName?: string;
  imageSource?: string;
  // var so the app can synthesize a brief for placeholder-only images
  // instead of rendering a gray placeholder box.
  imagePrompt?: string;
  assetKind?: string;
  aspectRatio?: string;
  resolution?: string;
  size?: string;
  contentMode?: ImageContentMode;
  /** SF Symbol name for Icon nodes */
  iconName?: string;

  // Onboarding Macro fields
  title?: string;
  /** Mapped from "description" in JSON */
  descriptionText?: string;
  primaryCTA?: string;
  secondaryCTA?: string;
  stylePreset?: string;
  fontWeight?: string;
  fontFamily?: string;
}

/** All DesignAction keys in Swift declaration order (id/type first). */
export const DesignActionKeys = [
  'id', 'type', 'component', 'rawComponentName', 'props', 'nodeId', 'nodeReference', 'parentId', 'parentReference',
  'name', 'text', 'pageName', 'x', 'y', 'width', 'height', 'scale', 'axis', 'alignment', 'relativeToNodeId',
  'relativeToReference', 'anchor', 'offsetX', 'offsetY', 'fill', 'stroke', 'strokeWidth', 'gradient', 'cornerRadius',
  'opacity', 'fontSize', 'textColor', 'textAlign', 'letterSpacing', 'lineHeight', 'constraints', 'clipContent', 'zIndex',
  'textBehavior', 'scrollAxis', 'scrollOffset', 'recycleItemSpacing', 'recycleItemCount', 'repeatSourceVariable',
  'timePickerHourVariable', 'timePickerMinuteVariable', 'repeatItemAlias', 'repeatAxis', 'repeatMaxItems',
  'repeatScrollable', 'repeatFilterVariable', 'repeatCategoryVariable', 'shadow', 'overlayColor', 'overlayOpacity',
  'blur', 'backgroundBlur', 'padding', 'paddingH', 'paddingV', 'paddingTop', 'paddingRight', 'paddingBottom',
  'paddingLeft', 'margin', 'marginH', 'marginV', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'layout',
  'spacing', 'layoutAlign', 'imageName', 'imageSource', 'imagePrompt', 'assetKind', 'aspectRatio', 'resolution',
  'size', 'contentMode', 'iconName', 'title', 'descriptionText', 'primaryCTA', 'secondaryCTA', 'stylePreset',
  'fontWeight', 'fontFamily',
] as const satisfies readonly (keyof DesignAction)[];

/** Memberwise `DesignAction.init(...)`: fresh id unless given, undefined members dropped. */
export function makeDesignAction(init: Partial<DesignAction> & { type: DesignActionType }): DesignAction {
  const action = { id: init.id ?? newUUID(), type: init.type } as DesignAction;
  for (const key of DesignActionKeys) {
    if (key === 'id' || key === 'type') continue;
    const v = init[key];
    if (v !== undefined) (action as unknown as Record<string, unknown>)[key] = v;
  }
  return action;
}

/**
 * `DesignAction.replacingGeneratedImageSource(_:)` — same id, imageName AND
 * imageSource replaced. NOTE (faithful to Swift): the memberwise call there
 * omits the repeat… / timePicker… fields, so they are dropped on the copy.
 */
export function replacingGeneratedImageSource(action: DesignAction, imageSource: string): DesignAction {
  return makeDesignAction({
    id: action.id,
    type: action.type,
    nodeId: action.nodeId,
    nodeReference: action.nodeReference,
    parentId: action.parentId,
    parentReference: action.parentReference,
    name: action.name,
    text: action.text,
    pageName: action.pageName,
    x: action.x,
    y: action.y,
    width: action.width,
    height: action.height,
    scale: action.scale,
    axis: action.axis,
    alignment: action.alignment,
    relativeToNodeId: action.relativeToNodeId,
    relativeToReference: action.relativeToReference,
    anchor: action.anchor,
    offsetX: action.offsetX,
    offsetY: action.offsetY,
    fill: action.fill,
    stroke: action.stroke,
    strokeWidth: action.strokeWidth,
    gradient: action.gradient,
    cornerRadius: action.cornerRadius,
    opacity: action.opacity,
    fontSize: action.fontSize,
    textColor: action.textColor,
    textAlign: action.textAlign,
    letterSpacing: action.letterSpacing,
    lineHeight: action.lineHeight,
    constraints: action.constraints,
    clipContent: action.clipContent,
    zIndex: action.zIndex,
    textBehavior: action.textBehavior,
    scrollAxis: action.scrollAxis,
    scrollOffset: action.scrollOffset,
    recycleItemSpacing: action.recycleItemSpacing,
    recycleItemCount: action.recycleItemCount,
    shadow: action.shadow,
    overlayColor: action.overlayColor,
    overlayOpacity: action.overlayOpacity,
    blur: action.blur,
    backgroundBlur: action.backgroundBlur,
    padding: action.padding,
    paddingH: action.paddingH,
    paddingV: action.paddingV,
    paddingTop: action.paddingTop,
    paddingRight: action.paddingRight,
    paddingBottom: action.paddingBottom,
    paddingLeft: action.paddingLeft,
    margin: action.margin,
    marginH: action.marginH,
    marginV: action.marginV,
    marginTop: action.marginTop,
    marginRight: action.marginRight,
    marginBottom: action.marginBottom,
    marginLeft: action.marginLeft,
    imageName: imageSource,
    imageSource,
    imagePrompt: action.imagePrompt,
    assetKind: action.assetKind,
    aspectRatio: action.aspectRatio,
    resolution: action.resolution,
    size: action.size,
    contentMode: action.contentMode,
    iconName: action.iconName,
    title: action.title,
    descriptionText: action.descriptionText,
    primaryCTA: action.primaryCTA,
    secondaryCTA: action.secondaryCTA,
    stylePreset: action.stylePreset,
    fontWeight: action.fontWeight,
    fontFamily: action.fontFamily,
    rawComponentName: action.rawComponentName,
    component: action.component,
    props: action.props,
    layout: action.layout,
    spacing: action.spacing,
    layoutAlign: action.layoutAlign,
  });
}

// MARK: - Flexible value helpers (FlexibleStringValue & friends)

function describeJSON(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

const TWO_POW_63 = 2 ** 63;

/** Swift `String(Int)` / `String(Double)` for a JSON number. */
function swiftNumberDescription(value: number): string {
  if (Number.isInteger(value) && Math.abs(value) < TWO_POW_63) {
    return String(value); // Int path
  }
  if (Number.isNaN(value)) return 'nan';
  if (!Number.isFinite(value)) return value > 0 ? 'inf' : '-inf';
  // Double path: Swift switches to exponent form below 1e-4 and at/above 2^53.
  const abs = Math.abs(value);
  if (abs !== 0 && (abs < 1e-4 || abs >= 2 ** 53)) {
    return value.toExponential().replace(/e([+-])(\d)$/, 'e$10$2');
  }
  return String(value);
}

/** Foundation `JSONSerialization` with `.sortedKeys`: compact, keys sorted, forward slashes escaped. */
function serializedJSONString(object: unknown): string {
  const sorted = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sorted);
    if (isPlainObject(v)) {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v).sort()) out[k] = sorted(v[k]);
      return out;
    }
    return v;
  };
  return JSON.stringify(sorted(object)).replaceAll('/', '\\/');
}

/**
 * `FlexibleStringValue.stringValue` — a string, bool, number, object or array
 * rendered as a string (objects/arrays become compact JSON whose nested values
 * are themselves flexible strings). `null` for JSON null / undecodable.
 */
export function flexibleStringValue(json: unknown): string | null {
  if (json === null || json === undefined) return null;
  if (typeof json === 'string') return json;
  if (typeof json === 'boolean') return json ? 'true' : 'false';
  if (typeof json === 'number') return swiftNumberDescription(json);
  if (Array.isArray(json)) {
    return serializedJSONString(json.map((item) => flexibleStringValue(item)));
  }
  if (isPlainObject(json)) {
    const out: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(json)) out[k] = flexibleStringValue(v);
    return serializedJSONString(out);
  }
  return null;
}

const DECIMAL_DOUBLE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const HEX_DOUBLE = /^[+-]?0[xX]([0-9a-fA-F]+)(?:\.([0-9a-fA-F]*))?(?:[pP]([+-]?\d+))?$/;

/** Swift `Double(String)` — whole-string parse; no whitespace; accepts inf/nan and hex floats. */
export function swiftDouble(text: string): number | null {
  if (DECIMAL_DOUBLE.test(text)) return Number(text);
  const lower = text.toLowerCase();
  const sign = lower.startsWith('-') ? -1 : 1;
  const unsigned = lower.replace(/^[+-]/, '');
  if (unsigned === 'inf' || unsigned === 'infinity') return sign * Infinity;
  if (unsigned === 'nan') return NaN;
  const hex = HEX_DOUBLE.exec(text);
  if (hex) {
    let value = parseInt(hex[1], 16);
    if (hex[2]) {
      let scale = 1 / 16;
      for (const ch of hex[2]) {
        value += parseInt(ch, 16) * scale;
        scale /= 16;
      }
    }
    if (hex[3]) value *= 2 ** parseInt(hex[3], 10);
    return sign * value;
  }
  return null;
}

/** Swift `Int(String)` — optional sign and decimal digits only. */
export function swiftInt(text: string): number | null {
  if (!/^[+-]?\d+$/.test(text)) return null;
  return parseInt(text, 10);
}

/** Swift `.rounded()` — schoolbook rounding (half away from zero). */
function swiftRounded(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value));
}

/** `CGFloat.parseFlexibleNumber` — strips px/pt, accepts a decimal comma, rejects auto/fit/hug/fill/null. */
export function parseFlexibleNumber(rawValue: string): number | null {
  const cleaned = rawValue.trim().replaceAll('px', '').replaceAll('pt', '').replaceAll(',', '.');
  if (cleaned.length === 0) return null;
  if (['auto', 'fit', 'hug', 'fill', 'null'].includes(cleaned.toLowerCase())) return null;
  return swiftDouble(cleaned);
}

type Container = Record<string, unknown>;

/** `decodeIfPresent` semantics: JSON null behaves like a missing key. */
function valueIfPresent(c: Container, key: string): unknown {
  const v = c[key];
  return v === null ? undefined : v;
}

function decodeFlexibleStringIfPresent(c: Container, key: string): string | undefined {
  const v = valueIfPresent(c, key);
  if (v === undefined) return undefined;
  return flexibleStringValue(v) ?? undefined;
}

function decodeFlexibleStringDictionaryIfPresent(c: Container, key: string): Record<string, string> | undefined {
  const v = valueIfPresent(c, key);
  if (isPlainObject(v)) {
    const result: Record<string, string> = {};
    for (const [k, item] of Object.entries(v)) {
      const s = flexibleStringValue(item);
      if (s !== null) result[k] = s;
    }
    return result;
  }
  if (Array.isArray(v)) {
    const result: Record<string, string> = {};
    v.forEach((item, offset) => {
      const s = flexibleStringValue(item);
      if (s !== null) result[`item${offset + 1}`] = s;
    });
    return result;
  }
  return undefined;
}

function decodeFlexibleContentModeIfPresent(c: Container, key: string): ImageContentMode | undefined {
  const raw = decodeFlexibleStringIfPresent(c, key);
  if (raw === undefined) return undefined;
  const rawValue = raw.trim().toLowerCase().replaceAll('_', '').replaceAll('-', '');
  switch (rawValue) {
    case 'fill': case 'cover': case 'aspectfill': case 'scaleaspectfill': case 'crop':
      return 'fill';
    case 'fit': case 'contain': case 'aspectfit': case 'scaleaspectfit':
      return 'fit';
    default:
      return undefined;
  }
}

function flexibleStringMap(v: unknown): Record<string, string | null> | undefined {
  if (!isPlainObject(v)) return undefined;
  const out: Record<string, string | null> = {};
  for (const [k, item] of Object.entries(v)) out[k] = flexibleStringValue(item);
  return out;
}

interface FlexiblePaddingValue {
  all?: number;
  horizontal?: number;
  vertical?: number;
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

interface FlexibleLayoutValue {
  type?: string;
  gap?: number;
  align?: string;
}

function numberFrom(values: Record<string, string | null>, ...names: string[]): number | undefined {
  for (const name of names) {
    const raw = values[name];
    if (raw === undefined || raw === null) continue;
    const value = parseFlexibleNumber(raw);
    if (value !== null) return value;
  }
  return undefined;
}

function stringFrom(values: Record<string, string | null>, ...names: string[]): string | undefined {
  for (const name of names) {
    const raw = values[name];
    if (raw !== undefined && raw !== null && raw.trim().length > 0) return raw;
  }
  return undefined;
}

function decodeFlexiblePaddingIfPresent(c: Container, key: string): FlexiblePaddingValue {
  const uniform = decodeFlexibleCGFloatIfPresent(c, key);
  if (uniform !== undefined) {
    return { all: uniform };
  }
  const values = flexibleStringMap(valueIfPresent(c, key));
  if (!values) return {};

  const all = numberFrom(values, 'all', 'value');
  const horizontal = numberFrom(values, 'horizontal', 'h', 'x');
  const vertical = numberFrom(values, 'vertical', 'v', 'y');

  return {
    all,
    horizontal,
    vertical,
    top: numberFrom(values, 'top') ?? vertical ?? all,
    right: numberFrom(values, 'right', 'trailing') ?? horizontal ?? all,
    bottom: numberFrom(values, 'bottom') ?? vertical ?? all,
    left: numberFrom(values, 'left', 'leading') ?? horizontal ?? all,
  };
}

function decodeFlexibleLayoutIfPresent(c: Container, key: string): FlexibleLayoutValue {
  const values = flexibleStringMap(valueIfPresent(c, key));
  if (!values) return {};
  return {
    type: stringFrom(values, 'type', 'direction', 'layout'),
    gap: numberFrom(values, 'gap', 'spacing'),
    align: stringFrom(values, 'align', 'alignment', 'items'),
  };
}

function decodeFlexibleConstraintsIfPresent(c: Container, key: string): EdgeConstraints | undefined {
  const values = flexibleStringMap(valueIfPresent(c, key));
  if (!values) return undefined;

  const number = (...names: string[]): number | undefined => {
    for (const name of names) {
      const raw = values[name];
      if (raw === undefined || raw === null) continue;
      const normalized = raw.trim().toLowerCase();
      if (normalized === 'true') return 0;
      const value = parseFlexibleNumber(raw);
      if (value !== null) return value;
    }
    return undefined;
  };

  const constraints: EdgeConstraints = {};
  const top = number('top');
  const right = number('right', 'trailing');
  const bottom = number('bottom');
  const left = number('left', 'leading');
  const centerX = number('centerX', 'centerx', 'horizontalCenter');
  const centerY = number('centerY', 'centery', 'verticalCenter');
  if (top !== undefined) constraints.top = top;
  if (right !== undefined) constraints.right = right;
  if (bottom !== undefined) constraints.bottom = bottom;
  if (left !== undefined) constraints.left = left;
  if (centerX !== undefined) constraints.centerX = centerX;
  if (centerY !== undefined) constraints.centerY = centerY;

  if (
    top === undefined && right === undefined && bottom === undefined &&
    left === undefined && centerX === undefined && centerY === undefined
  ) {
    return undefined;
  }
  return constraints;
}

function decodeFlexibleTextBehaviorIfPresent(c: Container, key: string): TextBehavior | undefined {
  const values = flexibleStringMap(valueIfPresent(c, key));
  if (!values) return undefined;

  const bool = (...names: string[]): boolean | undefined => {
    for (const name of names) {
      const raw = values[name];
      if (raw === undefined || raw === null) continue;
      const normalized = raw.trim().toLowerCase();
      if (['true', 'yes', '1', 'wrap', 'auto'].includes(normalized)) return true;
      if (['false', 'no', '0', 'none'].includes(normalized)) return false;
    }
    return undefined;
  };

  const int = (...names: string[]): number | undefined => {
    for (const name of names) {
      const raw = values[name];
      if (raw === undefined || raw === null) continue;
      const value = swiftInt(raw.trim());
      if (value !== null) return value;
    }
    return undefined;
  };

  const behavior: TextBehavior = {};
  const wrap = bool('wrap');
  const autoHeight = bool('autoHeight', 'autoheight');
  const maxLines = int('maxLines', 'maxlines');
  const truncate = bool('truncate', 'truncation');
  const overflow = stringFrom(values, 'overflow');
  if (wrap !== undefined) behavior.wrap = wrap;
  if (autoHeight !== undefined) behavior.autoHeight = autoHeight;
  if (maxLines !== undefined) behavior.maxLines = maxLines;
  if (truncate !== undefined) behavior.truncate = truncate;
  if (overflow !== undefined) behavior.overflow = overflow;
  return behavior;
}

function decodeFlexibleShadowIfPresent(c: Container, key: string): ShadowStyle | undefined {
  const v = valueIfPresent(c, key);
  if (v === undefined) return undefined;
  try {
    return decodeShadowStyle(v, [key]);
  } catch {
    // fall through to the named presets
  }
  const string = flexibleStringValue(v);
  if (string === null) return undefined;
  switch (string.trim().toLowerCase()) {
    case 'soft': case 'sm':
      return { color: '#000000', opacity: 0.14, radius: 14, x: 0, y: 8 };
    case 'medium': case 'md':
      return { color: '#000000', opacity: 0.18, radius: 22, x: 0, y: 14 };
    case 'large': case 'lg': case 'floating':
      return { color: '#000000', opacity: 0.22, radius: 32, x: 0, y: 22 };
    default:
      return undefined;
  }
}

/** Throws when the value is a non-empty, non-"null" string that is not a UUID (as Swift does). */
function decodeFlexibleUUIDIfPresent(c: Container, key: string): string | undefined {
  const v = valueIfPresent(c, key);
  if (v === undefined || typeof v !== 'string') return undefined;
  const direct = parseUUID(v);
  if (direct) return direct;
  const trimmed = v.trim();
  if (trimmed.length === 0 || trimmed.toLowerCase() === 'null') return undefined;
  const uuid = parseUUID(trimmed);
  if (!uuid) {
    throw new DesignActionDecodingError(`Expected UUID string for ${key}, got ${v}`);
  }
  return uuid;
}

function decodeFlexibleUUIDReferenceIfPresent(c: Container, key: string): { uuid?: string; reference?: string } {
  const v = valueIfPresent(c, key);
  if (v === undefined || typeof v !== 'string') return {};
  const direct = parseUUID(v);
  if (direct) return { uuid: direct };
  const trimmed = v.trim();
  if (trimmed.length === 0 || trimmed.toLowerCase() === 'null') return {};
  const uuid = parseUUID(trimmed);
  if (uuid) return { uuid };
  return { reference: trimmed };
}

function decodeFlexibleCGFloatIfPresent(c: Container, key: string): number | undefined {
  const v = valueIfPresent(c, key);
  if (v === undefined) return undefined;
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return undefined;
  const trimmed = v.trim();
  if (trimmed.length === 0 || trimmed.toLowerCase() === 'null') return undefined;
  if (['auto', 'fit', 'hug', 'fill'].includes(trimmed.toLowerCase())) return undefined;
  return parseFlexibleNumber(trimmed) ?? undefined;
}

function decodeFlexibleDoubleIfPresent(c: Container, key: string): number | undefined {
  const v = valueIfPresent(c, key);
  if (v === undefined) return undefined;
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return undefined;
  const trimmed = v.trim();
  if (trimmed.length === 0 || trimmed.toLowerCase() === 'null') return undefined;
  if (['auto', 'fit', 'hug', 'fill'].includes(trimmed.toLowerCase())) return undefined;
  return swiftDouble(trimmed) ?? undefined;
}

function decodeFlexibleBoolIfPresent(c: Container, key: string): boolean | undefined {
  const v = valueIfPresent(c, key);
  if (v === undefined) return undefined;
  if (typeof v === 'boolean') return v;
  if (typeof v !== 'string') return undefined;
  const trimmed = v.trim().toLowerCase();
  if (['true', 'yes', '1', 'on'].includes(trimmed)) return true;
  if (['false', 'no', '0', 'off'].includes(trimmed)) return false;
  return undefined;
}

// MARK: - Decoding

/**
 * `DesignAction.init(from:)` — throws `DesignActionDecodingError` (or a codec
 * `DecodingError` for a malformed `gradient` / `scrollBehavior`) when the
 * action cannot be decoded. Use `decodeDesignAction` for the lossy form.
 */
export function decodeDesignActionStrict(json: unknown): DesignAction {
  if (!isPlainObject(json)) {
    throw new DesignActionDecodingError(`Expected keyed container for DesignAction, got ${describeJSON(json)}`);
  }
  const container: Container = json;
  const decodedNodeId = decodeFlexibleUUIDReferenceIfPresent(container, 'nodeId');
  const decodedParentId = decodeFlexibleUUIDReferenceIfPresent(container, 'parentId');

  const id = decodeFlexibleUUIDIfPresent(container, 'id') ?? newUUID();
  const typeRaw = container.type;
  if (typeRaw === undefined) throw new DesignActionDecodingError('No value associated with key type');
  if (typeRaw === null) throw new DesignActionDecodingError('Expected DesignActionType but found null value for key type');
  const type = decodeDesignActionType(typeRaw);

  const rawComponentName =
    decodeFlexibleStringIfPresent(container, 'component') ??
    decodeFlexibleStringIfPresent(container, 'rawComponentName');
  const componentValue = valueIfPresent(container, 'component');
  const component = typeof componentValue === 'string' ? decodeComponentType(componentValue) : undefined;
  const props = decodeFlexibleStringDictionaryIfPresent(container, 'props');
  const nodeReference = decodeFlexibleStringIfPresent(container, 'nodeReference') ?? decodedNodeId.reference;
  const parentReference =
    decodeFlexibleStringIfPresent(container, 'parentReference') ??
    decodeFlexibleStringIfPresent(container, 'parent') ??
    decodeFlexibleStringIfPresent(container, 'parentRef') ??
    decodeFlexibleStringIfPresent(container, 'parentNodeReference') ??
    decodedParentId.reference;

  const decodedRelativeToNodeId = decodeFlexibleUUIDReferenceIfPresent(container, 'relativeToNodeId');

  const gradientValue = valueIfPresent(container, 'gradient');
  const gradient = gradientValue === undefined ? undefined : decodeGradientStyle(gradientValue, ['gradient']);

  const scrollValue = valueIfPresent(container, 'scrollBehavior');
  const decodedScroll = scrollValue === undefined ? undefined : decodeScrollBehavior(scrollValue, ['scrollBehavior']);

  const decodedRecycleCount = decodeFlexibleCGFloatIfPresent(container, 'recycleItemCount');
  const decodedRepeatMax = decodeFlexibleCGFloatIfPresent(container, 'repeatMaxItems');

  const decodedPadding = decodeFlexiblePaddingIfPresent(container, 'padding');
  const decodedMargin = decodeFlexiblePaddingIfPresent(container, 'margin');

  const decodedLayout = decodeFlexibleLayoutIfPresent(container, 'layout');
  const layoutString = decodeFlexibleStringIfPresent(container, 'layout');

  return makeDesignAction({
    id,
    type,
    rawComponentName,
    component,
    props,
    nodeId: decodedNodeId.uuid,
    nodeReference,
    parentId: decodedParentId.uuid,
    parentReference,
    name: decodeFlexibleStringIfPresent(container, 'name'),
    text: decodeFlexibleStringIfPresent(container, 'text'),
    pageName: decodeFlexibleStringIfPresent(container, 'pageName'),
    x: decodeFlexibleCGFloatIfPresent(container, 'x'),
    y: decodeFlexibleCGFloatIfPresent(container, 'y'),
    width: decodeFlexibleCGFloatIfPresent(container, 'width'),
    height: decodeFlexibleCGFloatIfPresent(container, 'height'),
    scale: decodeFlexibleCGFloatIfPresent(container, 'scale'),
    axis: decodeFlexibleStringIfPresent(container, 'axis'),
    alignment: decodeFlexibleStringIfPresent(container, 'alignment'),
    relativeToNodeId: decodedRelativeToNodeId.uuid,
    relativeToReference: decodeFlexibleStringIfPresent(container, 'relativeToReference') ?? decodedRelativeToNodeId.reference,
    anchor: decodeFlexibleStringIfPresent(container, 'anchor'),
    offsetX: decodeFlexibleCGFloatIfPresent(container, 'offsetX'),
    offsetY: decodeFlexibleCGFloatIfPresent(container, 'offsetY'),
    fill:
      decodeFlexibleStringIfPresent(container, 'fill') ??
      decodeFlexibleStringIfPresent(container, 'backgroundColor') ??
      decodeFlexibleStringIfPresent(container, 'fillColor'),
    stroke:
      decodeFlexibleStringIfPresent(container, 'stroke') ??
      decodeFlexibleStringIfPresent(container, 'borderColor'),
    strokeWidth:
      decodeFlexibleCGFloatIfPresent(container, 'strokeWidth') ??
      decodeFlexibleCGFloatIfPresent(container, 'borderWidth'),
    gradient,
    cornerRadius: decodeFlexibleCGFloatIfPresent(container, 'cornerRadius'),
    opacity: decodeFlexibleDoubleIfPresent(container, 'opacity'),
    fontSize:
      decodeFlexibleCGFloatIfPresent(container, 'fontSize') ??
      decodeFlexibleCGFloatIfPresent(container, 'size'),
    textColor:
      decodeFlexibleStringIfPresent(container, 'textColor') ??
      decodeFlexibleStringIfPresent(container, 'color') ??
      decodeFlexibleStringIfPresent(container, 'foregroundColor'),
    textAlign: decodeFlexibleStringIfPresent(container, 'textAlign'),
    letterSpacing: decodeFlexibleCGFloatIfPresent(container, 'letterSpacing'),
    lineHeight: decodeFlexibleCGFloatIfPresent(container, 'lineHeight'),
    constraints:
      decodeFlexibleConstraintsIfPresent(container, 'constraints') ??
      decodeFlexibleConstraintsIfPresent(container, 'pin'),
    clipContent: decodeFlexibleBoolIfPresent(container, 'clipContent'),
    zIndex: decodeFlexibleDoubleIfPresent(container, 'zIndex'),
    textBehavior: decodeFlexibleTextBehaviorIfPresent(container, 'textBehavior'),
    scrollAxis: decodeFlexibleStringIfPresent(container, 'scrollAxis') ?? decodedScroll?.axis,
    scrollOffset: decodeFlexibleCGFloatIfPresent(container, 'scrollOffset') ?? decodedScroll?.initialOffset,
    recycleItemSpacing: decodeFlexibleCGFloatIfPresent(container, 'recycleItemSpacing') ?? decodedScroll?.itemSpacing,
    recycleItemCount:
      decodedRecycleCount !== undefined ? Math.max(0, swiftRounded(decodedRecycleCount)) : decodedScroll?.itemCount,
    repeatSourceVariable: decodeFlexibleStringIfPresent(container, 'repeatSourceVariable'),
    timePickerHourVariable: decodeFlexibleStringIfPresent(container, 'timePickerHourVariable'),
    timePickerMinuteVariable: decodeFlexibleStringIfPresent(container, 'timePickerMinuteVariable'),
    repeatItemAlias: decodeFlexibleStringIfPresent(container, 'repeatItemAlias'),
    repeatAxis: decodeFlexibleStringIfPresent(container, 'repeatAxis'),
    repeatMaxItems: decodedRepeatMax !== undefined ? Math.max(1, swiftRounded(decodedRepeatMax)) : undefined,
    repeatScrollable: decodeFlexibleBoolIfPresent(container, 'repeatScrollable'),
    repeatFilterVariable: decodeFlexibleStringIfPresent(container, 'repeatFilterVariable'),
    repeatCategoryVariable: decodeFlexibleStringIfPresent(container, 'repeatCategoryVariable'),
    shadow: decodeFlexibleShadowIfPresent(container, 'shadow'),
    overlayColor: decodeFlexibleStringIfPresent(container, 'overlayColor'),
    overlayOpacity: decodeFlexibleDoubleIfPresent(container, 'overlayOpacity'),
    blur: decodeFlexibleCGFloatIfPresent(container, 'blur'),
    backgroundBlur: decodeFlexibleCGFloatIfPresent(container, 'backgroundBlur'),

    padding: decodedPadding.all,
    paddingH: decodeFlexibleCGFloatIfPresent(container, 'paddingH') ?? decodedPadding.horizontal,
    paddingV: decodeFlexibleCGFloatIfPresent(container, 'paddingV') ?? decodedPadding.vertical,
    paddingTop: decodeFlexibleCGFloatIfPresent(container, 'paddingTop') ?? decodedPadding.top,
    paddingRight: decodeFlexibleCGFloatIfPresent(container, 'paddingRight') ?? decodedPadding.right,
    paddingBottom: decodeFlexibleCGFloatIfPresent(container, 'paddingBottom') ?? decodedPadding.bottom,
    paddingLeft: decodeFlexibleCGFloatIfPresent(container, 'paddingLeft') ?? decodedPadding.left,
    margin: decodedMargin.all,
    marginH: decodeFlexibleCGFloatIfPresent(container, 'marginH') ?? decodedMargin.horizontal,
    marginV: decodeFlexibleCGFloatIfPresent(container, 'marginV') ?? decodedMargin.vertical,
    marginTop: decodeFlexibleCGFloatIfPresent(container, 'marginTop') ?? decodedMargin.top,
    marginRight: decodeFlexibleCGFloatIfPresent(container, 'marginRight') ?? decodedMargin.right,
    marginBottom: decodeFlexibleCGFloatIfPresent(container, 'marginBottom') ?? decodedMargin.bottom,
    marginLeft: decodeFlexibleCGFloatIfPresent(container, 'marginLeft') ?? decodedMargin.left,
    imageName: decodeFlexibleStringIfPresent(container, 'imageName'),
    imageSource: decodeFlexibleStringIfPresent(container, 'imageSource'),
    imagePrompt:
      decodeFlexibleStringIfPresent(container, 'imagePrompt') ??
      decodeFlexibleStringIfPresent(container, 'assetPrompt'),
    assetKind: decodeFlexibleStringIfPresent(container, 'assetKind'),
    aspectRatio: decodeFlexibleStringIfPresent(container, 'aspectRatio'),
    resolution: decodeFlexibleStringIfPresent(container, 'resolution'),
    size: decodeFlexibleStringIfPresent(container, 'size'),
    contentMode: decodeFlexibleContentModeIfPresent(container, 'contentMode'),
    iconName:
      decodeFlexibleStringIfPresent(container, 'iconName') ??
      decodeFlexibleStringIfPresent(container, 'symbol') ??
      decodeFlexibleStringIfPresent(container, 'systemName') ??
      decodeFlexibleStringIfPresent(container, 'sfSymbol') ??
      decodeFlexibleStringIfPresent(container, 'icon'),
    title: decodeFlexibleStringIfPresent(container, 'title'),
    descriptionText: decodeFlexibleStringIfPresent(container, 'description'),
    primaryCTA: decodeFlexibleStringIfPresent(container, 'primaryCTA'),
    secondaryCTA: decodeFlexibleStringIfPresent(container, 'secondaryCTA'),
    stylePreset: decodeFlexibleStringIfPresent(container, 'stylePreset'),
    fontWeight: decodeFlexibleStringIfPresent(container, 'fontWeight'),
    fontFamily: decodeFlexibleStringIfPresent(container, 'fontFamily'),
    layout: decodedLayout.type ?? layoutString,
    spacing:
      decodeFlexibleCGFloatIfPresent(container, 'spacing') ??
      decodeFlexibleCGFloatIfPresent(container, 'gap') ??
      decodedLayout.gap,
    layoutAlign: decodeFlexibleStringIfPresent(container, 'layoutAlign') ?? decodedLayout.align,
  });
}

/** `LossyDesignAction` — null instead of throwing. */
export function decodeDesignAction(json: unknown): DesignAction | null {
  try {
    return decodeDesignActionStrict(json);
  } catch {
    return null;
  }
}

/** `[LossyDesignAction]` */
export function decodeLossyDesignActions(json: unknown[]): LossyDesignAction[] {
  return json.map((item) => ({ action: decodeDesignAction(item) }));
}

/**
 * `DesignAgentResponse.init(from:)` — `plan` may be an array of anything or a
 * single value; `actions` is decoded lossily but must yield at least one
 * action when the array is non-empty.
 */
export function decodeDesignAgentResponse(json: unknown): DesignAgentResponse {
  if (!isPlainObject(json)) {
    throw new DesignActionDecodingError(`Expected keyed container for DesignAgentResponse, got ${describeJSON(json)}`);
  }
  const container: Container = json;

  const planRaw = valueIfPresent(container, 'plan');
  const planValues: (string | null)[] = Array.isArray(planRaw) ? planRaw.map((item) => flexibleStringValue(item)) : [];
  const singlePlan = planRaw === undefined ? null : flexibleStringValue(planRaw);

  const plan =
    planValues.length === 0
      ? singlePlan === null ? [] : [singlePlan]
      : planValues.filter((value): value is string => value !== null);

  // Lossy decode: one invented action type or malformed entry must not
  // discard the whole response — skip bad actions, keep the rest.
  const actionsRaw = container.actions;
  if (actionsRaw === undefined) {
    throw new DesignActionDecodingError('No value associated with key actions');
  }
  if (actionsRaw === null) {
    throw new DesignActionDecodingError('Expected [LossyDesignAction] but found null value for key actions');
  }
  if (!Array.isArray(actionsRaw)) {
    throw new DesignActionDecodingError(`Expected to decode Array for key actions but found ${describeJSON(actionsRaw)}`);
  }
  const lossy = decodeLossyDesignActions(actionsRaw);
  const decoded = lossy.map((l) => l.action).filter((a): a is DesignAction => a !== null);
  if (decoded.length === 0 && lossy.length > 0) {
    throw new DesignActionDecodingError('No action in the array could be decoded.');
  }
  if (decoded.length < lossy.length) {
    getPlatform().logger.warn(`⚠️ Skipped ${lossy.length - decoded.length} undecodable action(s), kept ${decoded.length}`);
  }
  return { plan, actions: decoded };
}
