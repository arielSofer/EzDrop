// Ported 1:1 from AgenticDesigner/ViewModels/ProjectViewModel.swift — the
// agent action pipeline: `applyDesignAction(_:temporaryIds:)` and every
// `applyCreate…` / `applyUpdate…` / `applySet…` helper it dispatches to.

import {
  DesignTokenLibrary,
} from '@agentic/core/designIntelligence/DesignTokenLibrary';
import { ComponentFactory } from '@agentic/core/designIntelligence/ComponentFactory';
import {
  makeDesignNode,
  makeDesignPage,
  makeNodeStyle,
  makeRepeatBinding,
  makeTimePickerBinding,
  newUUID,
  type ComponentType,
  type DesignAction,
  type DesignActionType,
  type DesignNode,
  type DesignPage,
  type DesignTokens,
  type NodeStyle,
  type Point,
  type ScrollBehavior,
  type VisualStylePreset,
} from '@agentic/core';
import { isVisualStylePreset } from '@agentic/core';
import type { AgentRequestIntent } from './agentIntent';
import { alignChildrenIn, distributeChildrenIn, isLikelyMobileRootFrame } from './layout';
import {
  addChildNode,
  allZIndexes,
  findGlobalRect,
  findNode,
  parentNode,
  removeNode,
  updateNode,
} from './nodeTree';
import { containsScreenRootKeyword, screensPerRow } from './normalization';
import { buildOnboardingScreen, buildPresentationShot } from './macros';

export const implicitAgentFrameReference = '__implicitAgentScreenFrame';
export const defaultAgentRootFrameReference = '__defaultAgentRootFrame';

/** The mutable slice of the view model an action needs while it is applied. */
export interface ActionContext {
  /** `project.pages[currentPageIndex].nodes` (live). */
  nodes: DesignNode[];
  /** `project.pages` (live) — `applyCreatePage` appends to it. */
  pages: DesignPage[];
  selectedNodeId: string | undefined;
  /** Assignment to `selectedNodeId`, `didSet` included. */
  setSelectedNodeId(id: string | undefined): void;
  currentAgentRequestIntent: AgentRequestIntent;
  currentAgentStylePreset: VisualStylePreset;
  shouldAutoParentUnreferencedAgentActions: boolean;
  allowsRootScreenDeletion: boolean;
}

type TemporaryIds = Record<string, string>;

// MARK: - Shared predicates

export function isVisualCreateAction(action: DesignAction): boolean {
  switch (action.type) {
    case 'createText':
    case 'createButton':
    case 'createInput':
    case 'createRectangle':
    case 'createImage':
    case 'createIcon':
    case 'createComponent':
      return true;
    default:
      return false;
  }
}

export function shouldTreatActionAsRootScreen(action: DesignAction): boolean {
  if (action.type !== 'createFrame') return false;

  const combinedText = [action.nodeReference, action.name, action.rawComponentName]
    .filter((value): value is string => value !== undefined)
    .join(' ');

  if (containsScreenRootKeyword(combinedText)) return true;

  if (
    action.width !== undefined &&
    action.height !== undefined &&
    action.width >= 320 &&
    action.width <= 500 &&
    action.height >= 560 &&
    action.height <= 980
  ) {
    return true;
  }

  return false;
}

export function shouldAutoNestUnparentedFrame(
  action: DesignAction,
  currentAgentRequestIntent: AgentRequestIntent,
): boolean {
  return (
    action.type === 'createFrame' &&
    currentAgentRequestIntent === 'createNewDesign' &&
    !shouldTreatActionAsRootScreen(action)
  );
}

export function rootScreenActionCount(actions: readonly DesignAction[]): number {
  return actions.filter(
    (action) =>
      action.type === 'createFrame' &&
      action.parentId === undefined &&
      action.parentReference === undefined &&
      shouldTreatActionAsRootScreen(action),
  ).length;
}

export function shouldCreateImplicitScreenFrame(
  actions: readonly DesignAction[],
  currentAgentRequestIntent: AgentRequestIntent,
): boolean {
  const hasRootContainer = actions.some((action) => {
    switch (action.type) {
      case 'createOnboardingScreen':
      case 'createPresentationShot':
        return true;
      case 'createFrame':
        return (
          action.parentId === undefined &&
          action.parentReference === undefined &&
          shouldTreatActionAsRootScreen(action)
        );
      default:
        return false;
    }
  });

  if (hasRootContainer) return false;

  const unparentedCreateActions = actions.filter(
    (action) =>
      action.parentId === undefined &&
      action.parentReference === undefined &&
      (isVisualCreateAction(action) || shouldAutoNestUnparentedFrame(action, currentAgentRequestIntent)),
  );

  return unparentedCreateActions.length >= 2;
}

/** `sanitizedActionsForCurrentIntent(_:)` */
export function sanitizedActionsForCurrentIntent(
  actions: readonly DesignAction[],
  currentAgentRequestIntent: AgentRequestIntent,
  selectedNodeId: string | undefined,
): DesignAction[] {
  switch (currentAgentRequestIntent) {
    case 'createNewDesign':
      return [...actions];

    case 'editSelection': {
      if (selectedNodeId === undefined) return [...actions];
      return actions.filter((action) => {
        switch (action.type) {
          case 'updateText':
          case 'updateStyle':
          case 'moveNode':
          case 'resizeNode':
          case 'scaleNode':
          case 'setAutoLayout':
          case 'pinNode':
          case 'bringToFront':
          case 'sendToBack':
          case 'setZIndex':
          case 'alignChildren':
          case 'distributeChildren':
          case 'positionRelativeTo':
          case 'deleteNode':
            return true;
          case 'createFrame':
          case 'createText':
          case 'createButton':
          case 'createInput':
          case 'createRectangle':
          case 'createImage':
          case 'createIcon':
          case 'createPage':
          case 'createOnboardingScreen':
          case 'createComponent':
          case 'createPresentationShot':
            return false;
        }
      });
    }

    case 'improveExistingCanvas':
      return actions.filter((action) => {
        switch (action.type) {
          case 'createPage':
          case 'createPresentationShot':
          case 'createOnboardingScreen':
            return false;
          case 'createFrame':
            return action.parentId !== undefined || action.parentReference !== undefined;
          case 'createText':
          case 'createButton':
          case 'createInput':
          case 'createRectangle':
          case 'createImage':
          case 'createIcon':
          case 'updateText':
          case 'updateStyle':
          case 'moveNode':
          case 'resizeNode':
          case 'scaleNode':
          case 'setAutoLayout':
          case 'pinNode':
          case 'bringToFront':
          case 'sendToBack':
          case 'setZIndex':
          case 'alignChildren':
          case 'distributeChildren':
          case 'positionRelativeTo':
          case 'deleteNode':
          case 'createComponent':
            return true;
        }
      });
  }
}

/** The create actions `applyDesignActionsExactly` auto-references. */
export const exactCreateTypes: ReadonlySet<DesignActionType> = new Set<DesignActionType>([
  'createFrame',
  'createText',
  'createButton',
  'createInput',
  'createRectangle',
  'createImage',
  'createIcon',
  'createOnboardingScreen',
  'createComponent',
  'createPresentationShot',
]);

// MARK: - Reference resolution

export function resolvedNodeId(
  context: ActionContext,
  action: DesignAction,
  temporaryIds: TemporaryIds,
): string | undefined {
  if (action.nodeId !== undefined) return action.nodeId;
  if (action.nodeReference !== undefined) return temporaryIds[action.nodeReference];
  if (context.currentAgentRequestIntent === 'editSelection') return context.selectedNodeId;
  return undefined;
}

export function resolvedParentId(
  context: ActionContext,
  action: DesignAction,
  temporaryIds: TemporaryIds,
): string | undefined {
  if (action.parentId !== undefined) return action.parentId;
  if (action.parentReference !== undefined) return temporaryIds[action.parentReference];

  if (
    context.shouldAutoParentUnreferencedAgentActions &&
    (isVisualCreateAction(action) || shouldAutoNestUnparentedFrame(action, context.currentAgentRequestIntent))
  ) {
    const defaultRootFrameId = temporaryIds[defaultAgentRootFrameReference];
    if (defaultRootFrameId !== undefined) return defaultRootFrameId;

    const implicitFrameId = temporaryIds[implicitAgentFrameReference];
    if (implicitFrameId !== undefined) return implicitFrameId;
  }

  return undefined;
}

export function resolvedRelativeNodeId(action: DesignAction, temporaryIds: TemporaryIds): string | undefined {
  if (action.relativeToNodeId !== undefined) return action.relativeToNodeId;
  if (action.relativeToReference !== undefined) return temporaryIds[action.relativeToReference];
  return undefined;
}

function rememberCreatedNode(createdId: string, action: DesignAction, temporaryIds: TemporaryIds): void {
  if (action.nodeReference === undefined) return;
  temporaryIds[action.nodeReference] = createdId;
}

// MARK: - Insertion

// מוסיף Node חדש או לרמת העמוד או לתוך Parent
export function insertNode(context: ActionContext, node: DesignNode, parentId: string | undefined): void {
  if (parentId !== undefined) {
    const didAdd = addChildNode(node, parentId, context.nodes);
    if (!didAdd) context.nodes.push(node);
  } else {
    context.nodes.push(node);
  }

  context.setSelectedNodeId(node.id);
}

// MARK: - Style helpers

export function applyBoxSpacing(action: DesignAction, style: NodeStyle): void {
  if (action.padding !== undefined) {
    style.paddingTop = action.padding;
    style.paddingRight = action.padding;
    style.paddingBottom = action.padding;
    style.paddingLeft = action.padding;
  }
  if (action.paddingH !== undefined) {
    style.paddingLeft = action.paddingH;
    style.paddingRight = action.paddingH;
  }
  if (action.paddingV !== undefined) {
    style.paddingTop = action.paddingV;
    style.paddingBottom = action.paddingV;
  }
  if (action.paddingTop !== undefined) style.paddingTop = action.paddingTop;
  if (action.paddingRight !== undefined) style.paddingRight = action.paddingRight;
  if (action.paddingBottom !== undefined) style.paddingBottom = action.paddingBottom;
  if (action.paddingLeft !== undefined) style.paddingLeft = action.paddingLeft;

  if (action.margin !== undefined) {
    style.marginTop = action.margin;
    style.marginRight = action.margin;
    style.marginBottom = action.margin;
    style.marginLeft = action.margin;
  }
  if (action.marginH !== undefined) {
    style.marginLeft = action.marginH;
    style.marginRight = action.marginH;
  }
  if (action.marginV !== undefined) {
    style.marginTop = action.marginV;
    style.marginBottom = action.marginV;
  }
  if (action.marginTop !== undefined) style.marginTop = action.marginTop;
  if (action.marginRight !== undefined) style.marginRight = action.marginRight;
  if (action.marginBottom !== undefined) style.marginBottom = action.marginBottom;
  if (action.marginLeft !== undefined) style.marginLeft = action.marginLeft;
}

export function applyScrollBehavior(action: DesignAction, node: DesignNode): void {
  if (
    action.scrollAxis === undefined &&
    action.scrollOffset === undefined &&
    action.recycleItemSpacing === undefined &&
    action.recycleItemCount === undefined
  ) {
    return;
  }

  const behavior: ScrollBehavior = node.scrollBehavior ? { ...node.scrollBehavior } : { axis: 'vertical' };
  if (action.scrollAxis !== undefined) behavior.axis = action.scrollAxis;
  if (action.scrollOffset !== undefined) behavior.initialOffset = Math.max(0, action.scrollOffset);
  if (action.recycleItemSpacing !== undefined) behavior.itemSpacing = Math.max(0, action.recycleItemSpacing);
  if (action.recycleItemCount !== undefined) behavior.itemCount = Math.max(0, action.recycleItemCount);

  node.scrollBehavior = behavior;
  node.clipContent = true;
}

export function applyTimePicker(action: DesignAction, node: DesignNode): void {
  if (action.timePickerHourVariable === undefined && action.timePickerMinuteVariable === undefined) return;
  node.timePicker = makeTimePickerBinding({
    hourVariable: action.timePickerHourVariable ?? 'alarmHour',
    minuteVariable: action.timePickerMinuteVariable ?? 'alarmMinute',
  });
}

export function applyRepeatBinding(action: DesignAction, node: DesignNode): void {
  const sourceVariable = action.repeatSourceVariable;
  if (sourceVariable === undefined || sourceVariable.length === 0) return;
  node.repeatBinding = makeRepeatBinding({
    sourceVariable,
    itemAlias:
      action.repeatItemAlias !== undefined && action.repeatItemAlias.length > 0 ? action.repeatItemAlias : 'item',
    maxItems: action.repeatMaxItems,
    axis: action.repeatAxis === 'horizontal' ? 'horizontal' : 'vertical',
    isScrollable: action.repeatScrollable ?? false,
    filterVariable:
      action.repeatFilterVariable !== undefined && action.repeatFilterVariable.length > 0
        ? action.repeatFilterVariable
        : undefined,
    categoryVariable:
      action.repeatCategoryVariable !== undefined && action.repeatCategoryVariable.length > 0
        ? action.repeatCategoryVariable
        : undefined,
  });
}

// MARK: - Create actions

/**
 * Next free slot for a ROOT frame in a wrapping grid, so screens added one at
 * a time also tile into rows instead of stacking at one point.
 */
export function nextRootFrameOrigin(context: ActionContext, width: number, height: number): Point {
  const roots = context.nodes.filter((node) => node.type === 'Frame');
  const perRow = Math.max(1, screensPerRow);
  const index = roots.length;
  const stepX = Math.max(width, 390) + 72;
  const stepY = Math.max(height, 844) + 150;
  const col = index % perRow;
  const row = Math.floor(index / perRow);
  return { x: 100 + col * stepX, y: 80 + row * stepY };
}

export function applyCreateFrame(
  context: ActionContext,
  action: DesignAction,
  parentId: string | undefined,
): string {
  const shouldForceMobileRoot =
    parentId === undefined &&
    context.currentAgentRequestIntent === 'createNewDesign' &&
    shouldTreatActionAsRootScreen(action);
  const frameWidth = shouldForceMobileRoot ? 390 : Math.max(1, action.width ?? 390);
  const frameHeight = shouldForceMobileRoot ? 844 : Math.max(1, action.height ?? 844);
  const autoOrigin =
    parentId === undefined ? nextRootFrameOrigin(context, frameWidth, frameHeight) : { x: 100, y: 100 };

  const forcedPadding = shouldForceMobileRoot ? 24 : undefined;
  const newNode = makeDesignNode({
    id: newUUID(),
    type: 'Frame',
    name: action.name ?? 'Frame',
    x: action.x ?? autoOrigin.x,
    y: action.y ?? autoOrigin.y,
    width: frameWidth,
    height: frameHeight,
    style: makeNodeStyle({
      fill: action.fill ?? '#111827',
      stroke: action.stroke,
      strokeWidth: action.strokeWidth,
      cornerRadius: action.cornerRadius ?? 24,
      opacity: action.opacity ?? 1.0,
      textAlign: action.textAlign,
      letterSpacing: action.letterSpacing,
      lineHeight: action.lineHeight,
      paddingTop: action.paddingTop ?? action.paddingV ?? action.padding ?? forcedPadding,
      paddingRight: action.paddingRight ?? action.paddingH ?? action.padding ?? forcedPadding,
      paddingBottom: action.paddingBottom ?? action.paddingV ?? action.padding ?? forcedPadding,
      paddingLeft: action.paddingLeft ?? action.paddingH ?? action.padding ?? forcedPadding,
      layout: action.layout,
      spacing: action.spacing,
      layoutAlign: action.layoutAlign ?? action.alignment,
      shadow: action.shadow,
      blur: action.blur,
      backgroundBlur: action.backgroundBlur,
      overlayColor: action.overlayColor,
      overlayOpacity: action.overlayOpacity,
      gradient: action.gradient,
    }),
    constraints: action.constraints,
    clipContent: action.clipContent ?? shouldForceMobileRoot,
    zIndex: action.zIndex ?? 0,
    textBehavior: action.textBehavior,
    children: [],
  });
  applyBoxSpacing(action, newNode.style);
  applyScrollBehavior(action, newNode);
  applyRepeatBinding(action, newNode);
  applyTimePicker(action, newNode);

  insertNode(context, newNode, parentId);
  return newNode.id;
}

export function applyCreateText(
  context: ActionContext,
  action: DesignAction,
  parentId: string | undefined,
): string {
  const newNode = makeDesignNode({
    id: newUUID(),
    type: 'Text',
    name: action.name ?? 'Text',
    x: action.x ?? 120,
    y: action.y ?? 120,
    width: Math.max(1, action.width ?? 240),
    height: Math.max(1, action.height ?? 44),
    text: action.text ?? 'New Text',
    style: makeNodeStyle({
      fill: action.fill ?? '#FFFFFF',
      stroke: action.stroke,
      strokeWidth: action.strokeWidth,
      cornerRadius: action.cornerRadius ?? 0,
      opacity: action.opacity ?? 1.0,
      fontSize: action.fontSize ?? 24,
      fontWeight: action.fontWeight,
      fontFamily: action.fontFamily,
      textColor: action.textColor,
      textAlign: action.textAlign,
      letterSpacing: action.letterSpacing,
      lineHeight: action.lineHeight,
      gradient: action.gradient,
    }),
    constraints: action.constraints,
    clipContent: action.clipContent ?? false,
    zIndex: action.zIndex ?? 0,
    textBehavior: action.textBehavior,
    children: [],
  });
  applyBoxSpacing(action, newNode.style);
  applyRepeatBinding(action, newNode);
  applyTimePicker(action, newNode);

  insertNode(context, newNode, parentId);
  return newNode.id;
}

export function applyCreateButton(
  context: ActionContext,
  action: DesignAction,
  parentId: string | undefined,
): string {
  const newNode = makeDesignNode({
    id: newUUID(),
    type: 'Button',
    name: action.name ?? 'Button',
    x: action.x ?? 120,
    y: action.y ?? 220,
    width: Math.max(1, action.width ?? 180),
    height: Math.max(1, action.height ?? 52),
    text: action.text ?? 'Button',
    style: makeNodeStyle({
      fill: action.fill ?? '#2563EB',
      stroke: action.stroke,
      strokeWidth: action.strokeWidth,
      cornerRadius: action.cornerRadius ?? 12,
      opacity: action.opacity ?? 1.0,
      fontSize: action.fontSize ?? 16,
      fontWeight: action.fontWeight,
      fontFamily: action.fontFamily,
      textColor: action.textColor,
      textAlign: action.textAlign,
      letterSpacing: action.letterSpacing,
      lineHeight: action.lineHeight,
      gradient: action.gradient,
    }),
    constraints: action.constraints,
    clipContent: action.clipContent ?? false,
    zIndex: action.zIndex ?? 0,
    textBehavior: action.textBehavior,
    children: [],
  });
  applyBoxSpacing(action, newNode.style);
  applyRepeatBinding(action, newNode);
  applyTimePicker(action, newNode);

  insertNode(context, newNode, parentId);
  return newNode.id;
}

export function applyCreateInput(
  context: ActionContext,
  action: DesignAction,
  parentId: string | undefined,
): string {
  const newNode = makeDesignNode({
    id: newUUID(),
    type: 'Input',
    name: action.name ?? 'Input',
    x: action.x ?? 120,
    y: action.y ?? 300,
    width: Math.max(1, action.width ?? 326),
    height: Math.max(1, action.height ?? 52),
    text: action.text ?? 'Input',
    style: makeNodeStyle({
      fill: action.fill ?? '#FFFFFF',
      stroke: action.stroke ?? '#CBD5E1',
      strokeWidth: action.strokeWidth,
      cornerRadius: action.cornerRadius ?? 14,
      opacity: action.opacity ?? 1.0,
      fontSize: action.fontSize ?? 15,
      fontWeight: action.fontWeight,
      fontFamily: action.fontFamily,
      textColor: action.textColor,
      textAlign: action.textAlign,
      letterSpacing: action.letterSpacing,
      lineHeight: action.lineHeight,
      gradient: action.gradient,
    }),
    constraints: action.constraints,
    clipContent: action.clipContent ?? false,
    zIndex: action.zIndex ?? 0,
    textBehavior: action.textBehavior,
    children: [],
  });
  applyBoxSpacing(action, newNode.style);
  applyRepeatBinding(action, newNode);
  applyTimePicker(action, newNode);

  insertNode(context, newNode, parentId);
  return newNode.id;
}

export function applyCreateRectangle(
  context: ActionContext,
  action: DesignAction,
  parentId: string | undefined,
): string {
  const newNode = makeDesignNode({
    id: newUUID(),
    type: 'Rectangle',
    name: action.name ?? 'Rectangle',
    x: action.x ?? 120,
    y: action.y ?? 120,
    width: Math.max(1, action.width ?? 120),
    height: Math.max(1, action.height ?? 120),
    style: makeNodeStyle({
      fill: action.fill ?? '#E5E7EB',
      stroke: action.stroke,
      strokeWidth: action.strokeWidth,
      cornerRadius: action.cornerRadius ?? 12,
      opacity: action.opacity ?? 1.0,
      textAlign: action.textAlign,
      letterSpacing: action.letterSpacing,
      lineHeight: action.lineHeight,
      gradient: action.gradient,
    }),
    constraints: action.constraints,
    clipContent: action.clipContent ?? false,
    zIndex: action.zIndex ?? 0,
    textBehavior: action.textBehavior,
    children: [],
  });
  applyBoxSpacing(action, newNode.style);
  applyRepeatBinding(action, newNode);
  applyTimePicker(action, newNode);

  insertNode(context, newNode, parentId);
  return newNode.id;
}

export function applyCreateImage(
  context: ActionContext,
  action: DesignAction,
  parentId: string | undefined,
): string {
  const newNode = makeDesignNode({
    id: newUUID(),
    type: 'Image',
    name: action.name ?? 'Image',
    x: action.x ?? 32,
    y: action.y ?? 120,
    width: Math.max(1, action.width ?? 326),
    height: Math.max(1, action.height ?? 200),
    imageName: action.imageName,
    imageSource: action.imageSource ?? action.imageName,
    contentMode: action.contentMode ?? 'fill',
    style: makeNodeStyle({
      fill: action.fill ?? '#1E293B',
      stroke: action.stroke,
      strokeWidth: action.strokeWidth,
      cornerRadius: action.cornerRadius ?? 12,
      opacity: action.opacity ?? 1.0,
      shadow: action.shadow,
      blur: action.blur,
      backgroundBlur: action.backgroundBlur,
      overlayColor: action.overlayColor,
      overlayOpacity: action.overlayOpacity,
      gradient: action.gradient,
    }),
    constraints: action.constraints,
    clipContent: action.clipContent ?? false,
    zIndex: action.zIndex ?? 0,
    textBehavior: action.textBehavior,
    children: [],
  });
  applyScrollBehavior(action, newNode);
  applyRepeatBinding(action, newNode);
  applyTimePicker(action, newNode);
  applyBoxSpacing(action, newNode.style);

  insertNode(context, newNode, parentId);
  return newNode.id;
}

export function applyCreateIcon(
  context: ActionContext,
  action: DesignAction,
  parentId: string | undefined,
): string {
  const newNode = makeDesignNode({
    id: newUUID(),
    type: 'Icon',
    name: action.name ?? 'Icon',
    x: action.x ?? 32,
    y: action.y ?? 120,
    width: Math.max(1, action.width ?? 48),
    height: Math.max(1, action.height ?? 48),
    iconName: action.iconName ?? 'star',
    style: makeNodeStyle({
      fill: action.fill ?? '#00000000',
      stroke: action.stroke,
      strokeWidth: action.strokeWidth,
      cornerRadius: action.cornerRadius ?? 0,
      opacity: action.opacity ?? 1.0,
      textColor: action.textColor ?? action.fill ?? '#FFFFFF',
      gradient: action.gradient,
    }),
    constraints: action.constraints,
    clipContent: action.clipContent ?? false,
    zIndex: action.zIndex ?? 0,
    textBehavior: action.textBehavior,
    children: [],
  });
  applyBoxSpacing(action, newNode.style);

  insertNode(context, newNode, parentId);
  return newNode.id;
}

// יוצר Page חדש — Agent יכול להוסיף עמודים חדשים לפרויקט
export function applyCreatePage(context: ActionContext, action: DesignAction): void {
  const newPage = makeDesignPage({
    id: newUUID(),
    name: action.pageName ?? action.name ?? 'New Page',
    nodes: [],
  });
  context.pages.push(newPage);
}

// MARK: - Update actions

export function applyUpdateText(context: ActionContext, action: DesignAction, nodeId: string | undefined): void {
  if (nodeId === undefined) return;
  updateNode(nodeId, context.nodes, (node) => {
    node.text = action.text ?? node.text;
  });
}

export function applyUpdateStyle(context: ActionContext, action: DesignAction, nodeId: string | undefined): void {
  if (nodeId === undefined) return;

  updateNode(nodeId, context.nodes, (node) => {
    if (action.fill !== undefined) node.style.fill = action.fill;
    if (action.stroke !== undefined) node.style.stroke = action.stroke;
    if (action.strokeWidth !== undefined) node.style.strokeWidth = action.strokeWidth;
    if (action.gradient !== undefined) node.style.gradient = action.gradient;
    if (action.cornerRadius !== undefined) node.style.cornerRadius = Math.max(0, action.cornerRadius);
    if (action.opacity !== undefined) node.style.opacity = Math.min(Math.max(action.opacity, 0), 1);
    if (action.fontSize !== undefined) node.style.fontSize = Math.max(1, action.fontSize);
    if (action.fontWeight !== undefined) node.style.fontWeight = action.fontWeight;
    if (action.fontFamily !== undefined) node.style.fontFamily = action.fontFamily;
    if (action.textColor !== undefined) node.style.textColor = action.textColor;
    if (action.textAlign !== undefined) node.style.textAlign = action.textAlign;
    if (action.letterSpacing !== undefined) node.style.letterSpacing = action.letterSpacing;
    if (action.lineHeight !== undefined) node.style.lineHeight = action.lineHeight;
    if (action.constraints !== undefined) node.constraints = action.constraints;
    if (action.clipContent !== undefined) node.clipContent = action.clipContent;
    if (action.zIndex !== undefined) node.zIndex = action.zIndex;
    if (action.textBehavior !== undefined) node.textBehavior = action.textBehavior;
    applyScrollBehavior(action, node);
    applyRepeatBinding(action, node);
    if (action.imageName !== undefined) node.imageName = action.imageName;
    if (action.imageSource !== undefined) node.imageSource = action.imageSource;
    if (action.contentMode !== undefined) node.contentMode = action.contentMode;
    if (action.iconName !== undefined) node.iconName = action.iconName;
    if (action.layout !== undefined) node.style.layout = action.layout;
    if (action.spacing !== undefined) node.style.spacing = Math.max(0, action.spacing);
    const layoutAlign = action.layoutAlign ?? action.alignment;
    if (layoutAlign !== undefined) node.style.layoutAlign = layoutAlign;
    if (action.shadow !== undefined) node.style.shadow = action.shadow;
    if (action.overlayColor !== undefined) node.style.overlayColor = action.overlayColor;
    if (action.overlayOpacity !== undefined) node.style.overlayOpacity = action.overlayOpacity;
    if (action.blur !== undefined) node.style.blur = action.blur;
    if (action.backgroundBlur !== undefined) node.style.backgroundBlur = action.backgroundBlur;
    applyBoxSpacing(action, node.style);
  });
}

export function applyMoveNode(context: ActionContext, action: DesignAction, nodeId: string | undefined): void {
  if (nodeId === undefined) return;
  updateNode(nodeId, context.nodes, (node) => {
    if (action.x !== undefined) node.x = action.x;
    if (action.y !== undefined) node.y = action.y;
  });
}

export function applyResizeNode(context: ActionContext, action: DesignAction, nodeId: string | undefined): void {
  if (nodeId === undefined) return;
  updateNode(nodeId, context.nodes, (node) => {
    if (action.x !== undefined) node.x = action.x;
    if (action.y !== undefined) node.y = action.y;
    if (action.width !== undefined) node.width = Math.max(1, action.width);
    if (action.height !== undefined) node.height = Math.max(1, action.height);
  });
}

export function applyScaleNode(context: ActionContext, action: DesignAction, nodeId: string | undefined): void {
  if (nodeId === undefined) return;
  updateNode(nodeId, context.nodes, (node) => {
    const scale = Math.max(0.1, action.scale ?? 1);
    const centerX = node.x + node.width / 2;
    const centerY = node.y + node.height / 2;
    const newWidth = Math.max(1, action.width ?? node.width * scale);
    const newHeight = Math.max(1, action.height ?? node.height * scale);

    node.width = newWidth;
    node.height = newHeight;
    node.x = action.x ?? centerX - newWidth / 2;
    node.y = action.y ?? centerY - newHeight / 2;
  });
}

export function applySetAutoLayout(
  context: ActionContext,
  action: DesignAction,
  nodeId: string | undefined,
): void {
  if (nodeId === undefined) return;
  updateNode(nodeId, context.nodes, (node) => {
    if (action.layout !== undefined) node.style.layout = action.layout;
    if (action.spacing !== undefined) node.style.spacing = Math.max(0, action.spacing);
    const layoutAlign = action.layoutAlign ?? action.alignment;
    if (layoutAlign !== undefined) node.style.layoutAlign = layoutAlign;
    applyBoxSpacing(action, node.style);
  });
}

export function applyPinNode(context: ActionContext, action: DesignAction, nodeId: string | undefined): void {
  if (nodeId === undefined) return;
  updateNode(nodeId, context.nodes, (node) => {
    if (action.constraints !== undefined) node.constraints = action.constraints;
  });
}

export type LayerOrderTarget = 'front' | 'back';

export function applySetLayerOrder(
  context: ActionContext,
  _action: DesignAction,
  nodeId: string | undefined,
  order: LayerOrderTarget,
): void {
  if (nodeId === undefined) return;

  const allZ = allZIndexes(context.nodes);
  const maxZ = allZ.length > 0 ? Math.max(...allZ) : 0;
  const minZ = allZ.length > 0 ? Math.min(...allZ) : 0;
  const nextZ = order === 'front' ? maxZ + 1 : minZ - 1;

  updateNode(nodeId, context.nodes, (node) => {
    node.zIndex = nextZ;
  });
}

export function applySetZIndex(context: ActionContext, action: DesignAction, nodeId: string | undefined): void {
  if (nodeId === undefined || action.zIndex === undefined) return;
  const zIndex = action.zIndex;
  updateNode(nodeId, context.nodes, (node) => {
    node.zIndex = zIndex;
  });
}

export function applyAlignChildren(
  context: ActionContext,
  action: DesignAction,
  nodeId: string | undefined,
): void {
  if (nodeId === undefined) return;
  updateNode(nodeId, context.nodes, (node) => {
    alignChildrenIn(node, action.alignment ?? 'center');
  });
}

export function applyDistributeChildren(
  context: ActionContext,
  action: DesignAction,
  nodeId: string | undefined,
): void {
  if (nodeId === undefined) return;
  updateNode(nodeId, context.nodes, (node) => {
    distributeChildrenIn(
      node,
      action.axis ?? 'horizontal',
      action.padding ?? action.paddingH ?? action.paddingLeft ?? 16,
      action.spacing,
    );
  });
}

export function applyPositionRelativeTo(
  context: ActionContext,
  action: DesignAction,
  nodeId: string | undefined,
  temporaryIds: TemporaryIds,
): void {
  if (nodeId === undefined) return;
  const relativeNodeId = resolvedRelativeNodeId(action, temporaryIds);
  if (relativeNodeId === undefined) return;
  const relativeRect = findGlobalRect(relativeNodeId, context.nodes, { x: 0, y: 0 });
  if (!relativeRect) return;

  const parent = parentNode(nodeId, context.nodes);
  const parentRect = (parent ? findGlobalRect(parent.id, context.nodes, { x: 0, y: 0 }) : undefined) ?? {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  };
  const anchor = (action.anchor ?? 'below').trim().toLowerCase();
  const offsetX = action.offsetX ?? action.x ?? 0;
  const offsetY = action.offsetY ?? action.y ?? 0;

  const relativeMinX = relativeRect.x;
  const relativeMinY = relativeRect.y;
  const relativeMaxX = relativeRect.x + relativeRect.width;
  const relativeMaxY = relativeRect.y + relativeRect.height;
  const relativeMidX = relativeRect.x + relativeRect.width / 2;
  const relativeMidY = relativeRect.y + relativeRect.height / 2;

  updateNode(nodeId, context.nodes, (node) => {
    let globalPoint: Point;

    switch (anchor) {
      case 'above':
      case 'top':
        globalPoint = { x: relativeMidX - node.width / 2 + offsetX, y: relativeMinY - node.height + offsetY };
        break;
      case 'below':
      case 'bottom':
        globalPoint = { x: relativeMidX - node.width / 2 + offsetX, y: relativeMaxY + offsetY };
        break;
      case 'left':
      case 'leading':
        globalPoint = { x: relativeMinX - node.width + offsetX, y: relativeMidY - node.height / 2 + offsetY };
        break;
      case 'right':
      case 'trailing':
        globalPoint = { x: relativeMaxX + offsetX, y: relativeMidY - node.height / 2 + offsetY };
        break;
      case 'alignleft':
        globalPoint = { x: relativeMinX + offsetX, y: node.y + parentRect.y + offsetY };
        break;
      case 'alignright':
        globalPoint = { x: relativeMaxX - node.width + offsetX, y: node.y + parentRect.y + offsetY };
        break;
      case 'aligntop':
        globalPoint = { x: node.x + parentRect.x + offsetX, y: relativeMinY + offsetY };
        break;
      case 'alignbottom':
        globalPoint = { x: node.x + parentRect.x + offsetX, y: relativeMaxY - node.height + offsetY };
        break;
      case 'center':
      case 'centered':
        globalPoint = {
          x: relativeMidX - node.width / 2 + offsetX,
          y: relativeMidY - node.height / 2 + offsetY,
        };
        break;
      default:
        globalPoint = { x: relativeMidX - node.width / 2 + offsetX, y: relativeMaxY + offsetY };
        break;
    }

    node.x = globalPoint.x - parentRect.x;
    node.y = globalPoint.y - parentRect.y;
  });
}

// מוחק Node קיים (פעולת deleteNode של הסוכן) — לעולם לא מסך שורש שלם.
export function applyDeleteNode(context: ActionContext, nodeId: string | undefined): void {
  if (nodeId === undefined) return;

  // The root-screen guard protects against destructive deletes the in-app AI
  // sometimes emits; exact mode (MCP) is explicit by contract.
  if (!context.allowsRootScreenDeletion) {
    const node = findNode(nodeId, context.nodes);
    if (node && node.type === 'Frame' && isLikelyMobileRootFrame(node)) {
      console.log(`⚠️ deleteNode ignored for root screen frame '${node.name}'`);
      return;
    }
  }

  if (removeNode(nodeId, context.nodes) !== undefined) {
    if (context.selectedNodeId === nodeId) {
      context.setSelectedNodeId(undefined);
    }
    console.log(`🗑️ deleteNode removed node ${nodeId}`);
  }
}

// MARK: - Macros

export function applyCreateOnboardingScreen(
  context: ActionContext,
  action: DesignAction,
  parentId: string | undefined,
): string {
  const frame = buildOnboardingScreen(action);
  insertNode(context, frame, parentId);
  return frame.id;
}

export function applyCreatePresentationShot(
  context: ActionContext,
  action: DesignAction,
  parentId: string | undefined,
): string {
  const frame = buildPresentationShot(action);
  insertNode(context, frame, parentId);
  return frame.id;
}

/** `tokens(for:component:)` — the component-aware token choice. */
export function tokensForComponent(
  context: ActionContext,
  action: DesignAction,
  component: ComponentType,
): DesignTokens {
  const rawPreset = action.stylePreset;
  if (rawPreset !== undefined && isVisualStylePreset(rawPreset)) {
    return DesignTokenLibrary.tokens(rawPreset);
  }

  switch (component) {
    case 'avatarGreetingHeader':
    case 'balanceHeroCard':
    case 'quickActionRow':
    case 'transactionRow':
    case 'transactionList':
    case 'currencyCard':
    case 'currencyCardGrid':
    case 'bottomNavBar':
    case 'chartCard':
    case 'metricCard':
    case 'searchBar':
    case 'categoryChips':
      return DesignTokenLibrary.tokens('softFintech');
    default:
      return DesignTokenLibrary.tokens(context.currentAgentStylePreset);
  }
}

export function applyCreateComponent(
  context: ActionContext,
  action: DesignAction,
  parentId: string | undefined,
): string {
  const compType = action.component;
  if (compType === undefined) return newUUID();

  const tokens = tokensForComponent(context, action, compType);

  const newNode = ComponentFactory.createComponent(compType, action.props, action, tokens);

  insertNode(context, newNode, parentId);
  return newNode.id;
}

/** `prepareImplicitScreenFrameIfNeeded(for:temporaryIds:)` */
export function prepareImplicitScreenFrameIfNeeded(
  context: ActionContext,
  actions: readonly DesignAction[],
  temporaryIds: TemporaryIds,
): void {
  if (!shouldCreateImplicitScreenFrame(actions, context.currentAgentRequestIntent)) return;

  const tokens = DesignTokenLibrary.tokens(context.currentAgentStylePreset);
  const frameAction: DesignAction = {
    id: newUUID(),
    type: 'createFrame',
    nodeReference: implicitAgentFrameReference,
    name: 'App Screen',
    x: 100,
    y: 80,
    width: 390,
    height: 844,
    fill: tokens.colors.backgroundPrimary,
    cornerRadius: 36,
    shadow: { color: '#0F172A', opacity: 0.1, radius: 28, x: 0, y: 18 },
  };

  const frameId = applyCreateFrame(context, frameAction, undefined);
  temporaryIds[implicitAgentFrameReference] = frameId;
}

// MARK: - Dispatch

// מבצע פעולה אחת של Agent
export function applyDesignAction(
  context: ActionContext,
  action: DesignAction,
  temporaryIds: TemporaryIds,
): void {
  const parentId = resolvedParentId(context, action, temporaryIds);

  switch (action.type) {
    case 'createFrame': {
      const createdId = applyCreateFrame(context, action, parentId);
      rememberCreatedNode(createdId, action, temporaryIds);
      if (
        parentId === undefined &&
        context.currentAgentRequestIntent === 'createNewDesign' &&
        shouldTreatActionAsRootScreen(action) &&
        temporaryIds[defaultAgentRootFrameReference] === undefined
      ) {
        temporaryIds[defaultAgentRootFrameReference] = createdId;
      }
      return;
    }

    case 'createText':
      rememberCreatedNode(applyCreateText(context, action, parentId), action, temporaryIds);
      return;

    case 'createButton':
      rememberCreatedNode(applyCreateButton(context, action, parentId), action, temporaryIds);
      return;

    case 'createInput':
      rememberCreatedNode(applyCreateInput(context, action, parentId), action, temporaryIds);
      return;

    case 'createRectangle':
      rememberCreatedNode(applyCreateRectangle(context, action, parentId), action, temporaryIds);
      return;

    case 'createImage':
      rememberCreatedNode(applyCreateImage(context, action, parentId), action, temporaryIds);
      return;

    case 'createIcon':
      rememberCreatedNode(applyCreateIcon(context, action, parentId), action, temporaryIds);
      return;

    case 'createPage':
      applyCreatePage(context, action);
      return;

    case 'updateText':
      applyUpdateText(context, action, resolvedNodeId(context, action, temporaryIds));
      return;

    case 'updateStyle':
      applyUpdateStyle(context, action, resolvedNodeId(context, action, temporaryIds));
      return;

    case 'moveNode':
      applyMoveNode(context, action, resolvedNodeId(context, action, temporaryIds));
      return;

    case 'resizeNode':
      applyResizeNode(context, action, resolvedNodeId(context, action, temporaryIds));
      return;

    case 'scaleNode':
      applyScaleNode(context, action, resolvedNodeId(context, action, temporaryIds));
      return;

    case 'setAutoLayout':
      applySetAutoLayout(context, action, resolvedNodeId(context, action, temporaryIds));
      return;

    case 'pinNode':
      applyPinNode(context, action, resolvedNodeId(context, action, temporaryIds));
      return;

    case 'bringToFront':
      applySetLayerOrder(context, action, resolvedNodeId(context, action, temporaryIds), 'front');
      return;

    case 'sendToBack':
      applySetLayerOrder(context, action, resolvedNodeId(context, action, temporaryIds), 'back');
      return;

    case 'setZIndex':
      applySetZIndex(context, action, resolvedNodeId(context, action, temporaryIds));
      return;

    case 'alignChildren':
      applyAlignChildren(context, action, resolvedNodeId(context, action, temporaryIds));
      return;

    case 'distributeChildren':
      applyDistributeChildren(context, action, resolvedNodeId(context, action, temporaryIds));
      return;

    case 'positionRelativeTo':
      applyPositionRelativeTo(context, action, resolvedNodeId(context, action, temporaryIds), temporaryIds);
      return;

    case 'deleteNode':
      applyDeleteNode(context, resolvedNodeId(context, action, temporaryIds));
      return;

    case 'createOnboardingScreen':
      rememberCreatedNode(applyCreateOnboardingScreen(context, action, parentId), action, temporaryIds);
      return;

    case 'createComponent':
      rememberCreatedNode(applyCreateComponent(context, action, parentId), action, temporaryIds);
      return;

    case 'createPresentationShot':
      rememberCreatedNode(applyCreatePresentationShot(context, action, parentId), action, temporaryIds);
      return;
  }
}
