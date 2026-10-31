// Ported 1:1 from AgenticDesigner/Models/DesignNode.swift

import type { GradientStyle } from './GradientStyle';
import type { AppPlatform } from './DesignProject';
import type { GameEntity, GameSceneSpec } from './GameSpec';
import { newUUID } from './uuid';

export const AllNodeType = ['Text', 'Frame', 'Rectangle', 'Button', 'Input', 'Image', 'Icon'] as const;
export type NodeType = (typeof AllNodeType)[number];

export const AllImageContentMode = ['fill', 'fit'] as const;
export type ImageContentMode = (typeof AllImageContentMode)[number];

export interface ShadowStyle {
  color: string;
  opacity: number;
  radius: number;
  x: number;
  y: number;
}

export interface EdgeConstraints {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
  centerX?: number;
  centerY?: number;
}

export interface TextBehavior {
  wrap?: boolean;
  autoHeight?: boolean;
  maxLines?: number;
  truncate?: boolean;
  overflow?: string;
}

export interface ScrollBehavior {
  /** "vertical", "horizontal", or "both". */
  axis: string;
  showsIndicators?: boolean;
  /** Initial content offset used by previews/snapshots. */
  initialOffset?: number;
  /** Optional spacing hint for generated repeated item layouts. */
  itemSpacing?: number;
  /** Optional item count hint for recycler/list semantics. */
  itemCount?: number;
}

export interface NodeStyle {
  fill: string;
  stroke?: string;
  strokeWidth?: number;
  cornerRadius: number;
  opacity: number;
  fontSize?: number;
  fontWeight?: string;
  fontFamily?: string;
  /** Text colour — for Text, Button, Input, Icon */
  textColor?: string;
  /** Text alignment: "left", "center", "right" */
  textAlign?: string;
  /** Letter spacing in points */
  letterSpacing?: number;
  /** Line height in points */
  lineHeight?: number;
  /** Inner padding — gap between the node's border and its content */
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  /** Outer margin — applied inside Auto Layout containers */
  marginTop?: number;
  marginRight?: number;
  marginBottom?: number;
  marginLeft?: number;

  // Auto Layout properties
  layout?: string;
  spacing?: number;
  layoutAlign?: string;

  // Visual Art Direction properties
  shadow?: ShadowStyle;
  blur?: number;
  backgroundBlur?: number;
  overlayColor?: string;
  overlayOpacity?: number;

  // Gradient fill (overrides solid fill when present)
  gradient?: GradientStyle;

  // Arch/tombstone silhouette: rounds only the top-left and top-right
  // corners by this radius (typically width/2 for a full semicircle),
  // leaving the bottom corners flat per `cornerRadius`. undefined keeps the
  // existing uniform-corner RoundedRectangle behavior everywhere.
  archTopRadius?: number;
}

/** Every key of NodeStyle, in Swift declaration order (used by encoders/inspectors). */
export const NodeStyleKeys = [
  'fill', 'stroke', 'strokeWidth', 'cornerRadius', 'opacity', 'fontSize', 'fontWeight', 'fontFamily',
  'textColor', 'textAlign', 'letterSpacing', 'lineHeight',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'layout', 'spacing', 'layoutAlign',
  'shadow', 'blur', 'backgroundBlur', 'overlayColor', 'overlayOpacity',
  'gradient', 'archTopRadius',
] as const satisfies readonly (keyof NodeStyle)[];

export function makeNodeStyle(init: Partial<NodeStyle> & { fill: string; cornerRadius: number; opacity: number }): NodeStyle {
  const style: NodeStyle = { fill: init.fill, cornerRadius: init.cornerRadius, opacity: init.opacity };
  for (const key of NodeStyleKeys) {
    if (key === 'fill' || key === 'cornerRadius' || key === 'opacity') continue;
    const v = init[key];
    if (v !== undefined) (style as unknown as Record<string, unknown>)[key] = v;
  }
  return style;
}

export interface DesignNode {
  id: string;
  type: NodeType;
  name: string;

  x: number;
  y: number;
  width: number;
  height: number;

  text?: string;
  // Marks an .Input as a password field → exported as SwiftUI SecureField,
  // not a plain TextField. Optional so older documents decode unchanged.
  isSecure?: boolean;
  /** URL or file name for Image nodes */
  imageName?: string;
  imageSource?: string;
  contentMode?: ImageContentMode;
  /** SF Symbol name for Icon nodes */
  iconName?: string;
  style: NodeStyle;
  constraints?: EdgeConstraints;
  clipContent?: boolean;
  zIndex?: number;
  // Set when the user drags a node by hand — the auto-layout engine then
  // leaves its position alone instead of restacking it.
  manuallyPositioned?: boolean;
  textBehavior?: TextBehavior;
  scrollBehavior?: ScrollBehavior;

  devicePresetId?: string;
  supportedPlatforms?: AppPlatform[];
  logicBindings?: NodeLogicBinding[];
  // Turns this node into a template: in the interactive preview it's
  // cloned once per item in `sourceVariable` (a JSON array, e.g. from
  // firestoreQuery/httpRequest+parseJSONResponse), stacked along `axis`,
  // with {{alias.field}} tokens in its text/imageSource (and its
  // children's) substituted per item. undefined elsewhere — a single static
  // node, unchanged from today. The design canvas always shows just the
  // one template so it stays editable; only the live preview expands it.
  // When isScrollable, this template's direct PARENT automatically
  // becomes a scroll container along the same axis (a recycler view: one
  // cell template + a data source + a direction), unless the parent
  // already has its own explicit scrollBehavior set.
  repeatBinding?: RepeatBinding;
  // Makes this node a GAME ENTITY inside its parent game frame: the node's
  // x/y/size/fill/image drive the entity's placement and look (editable on
  // the canvas like any node), while this config carries the physics and
  // behaviors. The runtime spec is composed from these children.
  gameEntity?: GameEntity;
  // Turns this node into a native TIME PICKER (hour/minute wheels) bound
  // to two logic variables — live in the preview, native wheels in exports
  // (crown-scrollable on watchOS). The node stays a Frame.
  timePicker?: TimePickerBinding;
  // Turns this node into a live 2D game surface. When set, the node renders a
  // playable SpriteKit scene (AgentGameView) instead of its normal type view,
  // both on the design canvas and in exported apps. The node's type stays a
  // plain Frame so every existing NodeType switch keeps working unchanged.
  gameScene?: GameSceneSpec;
  children: DesignNode[];
}

/** Optional DesignNode keys, in Swift declaration order. */
export const DesignNodeOptionalKeys = [
  'text', 'isSecure', 'imageName', 'imageSource', 'contentMode', 'iconName',
  'constraints', 'clipContent', 'zIndex', 'manuallyPositioned', 'textBehavior', 'scrollBehavior',
  'devicePresetId', 'supportedPlatforms', 'logicBindings', 'repeatBinding', 'gameEntity', 'timePicker', 'gameScene',
] as const satisfies readonly (keyof DesignNode)[];

export type DesignNodeInit = Partial<DesignNode> & {
  type: NodeType;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  style: NodeStyle;
};

export function makeDesignNode(init: DesignNodeInit): DesignNode {
  const node: DesignNode = {
    id: init.id ?? newUUID(),
    type: init.type,
    name: init.name,
    x: init.x,
    y: init.y,
    width: init.width,
    height: init.height,
    style: init.style,
    children: init.children ?? [],
  };
  for (const key of DesignNodeOptionalKeys) {
    const v = init[key];
    if (v !== undefined) (node as unknown as Record<string, unknown>)[key] = v;
  }
  return node;
}

export interface RepeatBinding {
  sourceVariable: string;
  itemAlias: string;
  // Safety cap on how many clones the preview will ever render.
  maxItems?: number;
  axis: RepeatAxis;
  isScrollable: boolean;
  // When set, only items whose values contain this variable's text
  // (case-insensitive) are shown — a live, reactive search filter. Empty
  // filter shows everything.
  filterVariable?: string;
  // A second, independent filter (e.g. a category chip) AND-combined with
  // filterVariable: an item shows only if it matches BOTH. Empty = match all.
  categoryVariable?: string;
}

export function makeRepeatBinding(init: Partial<RepeatBinding> & { sourceVariable: string }): RepeatBinding {
  const b: RepeatBinding = {
    sourceVariable: init.sourceVariable,
    itemAlias: init.itemAlias ?? 'item',
    axis: init.axis ?? 'vertical',
    isScrollable: init.isScrollable ?? true,
  };
  if (init.maxItems !== undefined) b.maxItems = init.maxItems;
  if (init.filterVariable !== undefined) b.filterVariable = init.filterVariable;
  if (init.categoryVariable !== undefined) b.categoryVariable = init.categoryVariable;
  return b;
}

export const AllRepeatAxis = ['vertical', 'horizontal'] as const;
export type RepeatAxis = (typeof AllRepeatAxis)[number];

export interface NodeLogicBinding {
  id: string;
  kind: NodeLogicBindingKind;
  variableName: string;
  condition?: LogicConditionExpression;
}

export function makeNodeLogicBinding(
  init: Partial<NodeLogicBinding> & { kind: NodeLogicBindingKind; variableName: string },
): NodeLogicBinding {
  const b: NodeLogicBinding = { id: init.id ?? newUUID(), kind: init.kind, variableName: init.variableName };
  if (init.condition !== undefined) b.condition = init.condition;
  return b;
}

export const AllNodeLogicBindingKind = ['text', 'value', 'isOn', 'visibility', 'enabled', 'selectedIndex'] as const;
export type NodeLogicBindingKind = (typeof AllNodeLogicBindingKind)[number];

export interface LogicConditionExpression {
  left: string;
  operation: LogicConditionOperation;
  right?: string;
}

export const AllLogicConditionOperation = [
  'equals',
  'notEquals',
  'greaterThan',
  'lessThan',
  'contains',
  'isEmpty',
  'isNotEmpty',
  'isTrue',
  'isFalse',
] as const;
export type LogicConditionOperation = (typeof AllLogicConditionOperation)[number];

export interface TimePickerBinding {
  hourVariable: string;
  minuteVariable: string;
}

export function makeTimePickerBinding(init: Partial<TimePickerBinding> = {}): TimePickerBinding {
  return {
    hourVariable: init.hourVariable ?? 'alarmHour',
    minuteVariable: init.minuteVariable ?? 'alarmMinute',
  };
}
