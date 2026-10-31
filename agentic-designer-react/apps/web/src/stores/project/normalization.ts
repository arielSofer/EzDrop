// Ported 1:1 from AgenticDesigner/ViewModels/ProjectViewModel.swift — the
// normalization passes `applyDesignActions` runs after the agent's actions
// land (and NOT `applyDesignActionsExactly`, which respects coordinates).

import type { DesignNode, NodeStyle, TextBehavior } from '@agentic/core';
import { compositedFill, contrastRatio, isTransparentHex, luminance } from './colors';
import {
  addConsistentCardDepth,
  clampChildrenInsideParent,
  distributeIconLabelPairs,
  expandTextNodesForTypography,
  isBottomNavigation,
  isIconLabelCluster,
  isLikelyMobileRootFrame,
  isLooseVisualRoot,
  isMobileScreenFrame,
  normalizeMobileScreen,
  relayoutBottomNavigation,
  resolveMobileSiblingOverlaps,
} from './layout';
import { boundedTextSize, interactionAttributes, measuredTextSize, unboundedTextSize } from './textMetrics';
import { repairSemanticCopy, semanticDomain, type AgentSemanticDomain } from './semantics';
import type { AgentRequestIntent, PresentationMode } from './agentIntent';

/**
 * How many screens sit in one row before wrapping to the next. Without a cap
 * the screens marched off to the right forever and vanished off-canvas.
 */
export const screensPerRow = 6;

/** The private agent-run state `applyDesignActions` reads while normalising. */
export interface NormalizationContext {
  currentAgentRequestIntent: AgentRequestIntent;
  currentAgentPresentationMode: PresentationMode;
  currentAgentUserPrompt: string;
}

// MARK: - removePromptArtifactText

export function isPromptArtifactText(text: string | undefined): boolean {
  const trimmed = text?.trim();
  if (!trimmed || trimmed.length === 0) return false;

  // Strip decorative bullets/dashes so "• #3B82F6" is still caught.
  const strippedSet = '•·●○◦▪‣*–— \t';
  let start = 0;
  let end = trimmed.length;
  while (start < end && strippedSet.includes(trimmed[start])) start += 1;
  while (end > start && strippedSet.includes(trimmed[end - 1])) end -= 1;
  const stripped = trimmed.slice(start, end);

  if (/^#[0-9A-Fa-f]{3,8}$/.test(stripped)) return true;

  const lowered = stripped.toLowerCase();
  if (lowered.startsWith('{') && (lowered.includes('"subject"') || lowered.includes('negativeprompt'))) {
    return true;
  }

  return lowered === 'negativeprompt' || lowered === 'imageprompt';
}

// מסיר טקסטים שהם שאריות פרומפט (קודי צבע, קטעי JSON) שדלפו לקנבס
export function removePromptArtifactText(nodes: DesignNode[]): void {
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    let hasArtifactLabel = false;
    switch (node.type) {
      case 'Text':
      case 'Button':
      case 'Input':
        hasArtifactLabel = isPromptArtifactText(node.text);
        break;
      default:
        hasArtifactLabel = false;
        break;
    }
    if (!hasArtifactLabel) continue;
    console.log(`🗑️ removed prompt-artifact ${node.type} node '${node.text ?? ''}'`);
    nodes.splice(index, 1);
  }

  for (const node of nodes) {
    removePromptArtifactText(node.children);
  }
}

// MARK: - repairTextSizing

export function nearestRightNeighborX(index: number, nodes: readonly DesignNode[]): number | undefined {
  const node = nodes[index];
  let limit: number | undefined;

  for (let otherIndex = 0; otherIndex < nodes.length; otherIndex += 1) {
    if (otherIndex === index) continue;
    const other = nodes[otherIndex];
    const overlapsVertically = other.y < node.y + node.height && other.y + other.height > node.y;
    if (!overlapsVertically || !(other.x > node.x + 20)) continue;
    limit = Math.min(limit ?? Number.MAX_VALUE, other.x);
  }

  return limit;
}

/**
 * Buttons render their label inside their own fill — a too-narrow button
 * truncates ("Albu…"). Grow the button when the row has room, otherwise shrink
 * the label font until the full word fits.
 */
export function repairButtonLabel(node: DesignNode, text: string, parentWidth: number | undefined): void {
  const labelInset = 28;
  let neededWidth = Math.ceil(measuredTextSize(text, node.style).width) + labelInset;

  if (!(node.width < neededWidth)) return;

  const availableWidth =
    parentWidth !== undefined && parentWidth > 0 ? Math.max(40, parentWidth - node.x - 8) : neededWidth;

  if (neededWidth <= availableWidth) {
    node.width = neededWidth;
    return;
  }

  node.width = Math.max(node.width, availableWidth);

  const style: NodeStyle = { ...node.style };
  let fontSize = style.fontSize ?? 14;
  while (fontSize > 10) {
    style.fontSize = fontSize;
    neededWidth = Math.ceil(measuredTextSize(text, style).width) + labelInset;
    if (neededWidth <= node.width) break;
    fontSize -= 1;
  }
  node.style.fontSize = fontSize;
}

export function repairSingleTextNode(node: DesignNode, text: string, parentWidth: number | undefined): void {
  const paddingH = (node.style.paddingLeft ?? 0) + (node.style.paddingRight ?? 0);
  const paddingV = (node.style.paddingTop ?? 0) + (node.style.paddingBottom ?? 0);
  const singleLineWidth = Math.ceil(measuredTextSize(text, node.style).width) + paddingH + 4;
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  const longestWordWidth =
    Math.ceil(words.reduce((widest, word) => Math.max(widest, measuredTextSize(word, node.style).width), 0)) +
    paddingH +
    4;

  const availableWidth =
    parentWidth !== undefined && parentWidth > 0 ? Math.max(40, parentWidth - node.x - 8) : singleLineWidth;

  // Short labels read premium on ONE line.
  const wordCount = words.length;
  if (wordCount <= 3 && node.width < singleLineWidth && singleLineWidth <= availableWidth) {
    node.width = singleLineWidth;
  }

  const breaksWords = node.width < longestWordWidth;
  const truncatesSingleLine = node.textBehavior?.maxLines === 1 && node.width < singleLineWidth;

  if (breaksWords || truncatesSingleLine) {
    if (singleLineWidth <= availableWidth) {
      node.width = Math.max(node.width, singleLineWidth);
    } else if (!/\s/.test(text)) {
      // A single word cannot wrap — shrink the font until it fits the slot.
      const style: NodeStyle = { ...node.style };
      let fontSize = style.fontSize ?? 16;
      while (fontSize > 10) {
        style.fontSize = fontSize;
        if (Math.ceil(measuredTextSize(text, style).width) + paddingH + 4 <= availableWidth) break;
        fontSize -= 1;
      }
      node.style.fontSize = fontSize;
      node.width = Math.max(
        node.width,
        Math.min(availableWidth, Math.ceil(measuredTextSize(text, style).width) + paddingH + 4),
      );
    } else {
      // Cannot fit one line inside the parent — take what is available and wrap.
      node.width = Math.max(node.width, availableWidth);

      if (longestWordWidth > availableWidth) {
        const style: NodeStyle = { ...node.style };
        let fontSize = style.fontSize ?? 16;
        while (fontSize > 10) {
          style.fontSize = fontSize;
          const longest =
            Math.ceil(words.reduce((widest, word) => Math.max(widest, measuredTextSize(word, style).width), 0)) +
            paddingH +
            4;
          if (longest <= availableWidth) break;
          fontSize -= 1;
        }
        node.style.fontSize = fontSize;
      }

      const behavior: TextBehavior = { ...(node.textBehavior ?? {}) };
      behavior.wrap = true;
      behavior.autoHeight = true;
      if (behavior.maxLines === 1) delete behavior.maxLines;
      node.textBehavior = behavior;
    }
  }

  // Height repair: wrapped text needs enough vertical room.
  if (node.textBehavior?.maxLines === undefined) {
    const contentWidth = Math.max(20, node.width - paddingH);
    const wrappedHeight = Math.ceil(measuredTextSize(text, node.style, contentWidth).height * 1.15) + paddingV;

    if (node.height < wrappedHeight) {
      node.height = wrappedHeight;
    }
  }
}

// מרחיב טקסטים צרים מדי כך שמילים לא יישברו לעמודות אותיות
export function repairTextSizing(nodes: DesignNode[], parentWidth: number | undefined): void {
  for (let index = 0; index < nodes.length; index += 1) {
    const neighborLimit = nearestRightNeighborX(index, nodes);
    let growthLimit: number | undefined;
    if (parentWidth !== undefined && neighborLimit !== undefined) growthLimit = Math.min(parentWidth, neighborLimit);
    else if (parentWidth !== undefined) growthLimit = parentWidth;
    else if (neighborLimit !== undefined) growthLimit = neighborLimit;

    const node = nodes[index];

    if (node.type === 'Text') {
      const text = node.text?.trim();
      if (text && text.length > 0) repairSingleTextNode(node, text, growthLimit);
    }

    if (node.type === 'Button') {
      const text = node.text?.trim();
      if (text && text.length > 0) repairButtonLabel(node, text, growthLimit);
    }

    repairTextSizing(node.children, node.width);
  }
}

// MARK: - Screen roots

export function containsScreenRootKeyword(text: string): boolean {
  const normalized = text.toLowerCase().replaceAll('_', ' ').replaceAll('-', ' ');
  const compact = normalized.replaceAll(' ', '');
  const words = new Set(normalized.split(' ').filter((word) => word.length > 0));

  if (
    compact.includes('screen') ||
    compact.includes('phone') ||
    compact.includes('iphone') ||
    compact.includes('mobile') ||
    compact.includes('mockup') ||
    words.has('page') ||
    words.has('view')
  ) {
    return true;
  }

  const screenPhrases = [
    'home screen', 'discover screen', 'search screen', 'detail screen',
    'player screen', 'library screen', 'profile screen', 'settings screen',
    'onboarding screen', 'checkout screen', 'cart screen', 'login screen',
    'signup screen', 'dashboard screen', 'feed screen', 'messages screen',
    'chat screen', 'map screen', 'booking screen',
  ];

  return screenPhrases.some((phrase) => normalized.includes(phrase));
}

export function isAgentScreenRoot(node: DesignNode): boolean {
  if (node.type !== 'Frame') return false;

  const name = node.name.toLowerCase();
  const hasScreenName = containsScreenRootKeyword(name);
  const hasMobileScreenSize =
    node.width >= 320 && node.width <= 500 && node.height >= 560 && node.height <= 980;

  return hasScreenName || hasMobileScreenSize;
}

export function agentScreenRootIndices(nodes: readonly DesignNode[]): number[] {
  return nodes.map((_node, index) => index).filter((index) => isAgentScreenRoot(nodes[index]));
}

export function shouldFlattenExtraRootContainer(node: DesignNode): boolean {
  if (node.type !== 'Frame' || node.children.length === 0) return false;

  const name = node.name.toLowerCase();
  const looksLikeScreen =
    isLikelyMobileRootFrame(node) || name.includes('screen') || name.includes('app') || name.includes('phone');
  const isOversizedRootContainer = node.width >= 320 && node.height >= 520;

  return looksLikeScreen || isOversizedRootContainer;
}

function squaredDistance(lhs: { x: number; y: number }, rhs: { x: number; y: number }): number {
  const dx = lhs.x - rhs.x;
  const dy = lhs.y - rhs.y;
  return dx * dx + dy * dy;
}

export function nearestScreenIndex(
  node: DesignNode,
  originalScreenRects: { x: number; y: number; width: number; height: number }[],
): number {
  if (originalScreenRects.length === 0) return 0;

  const nodeCenter = { x: node.x + node.width / 2, y: node.y + node.height / 2 };

  let best = 0;
  for (let index = 1; index < originalScreenRects.length; index += 1) {
    const candidate = originalScreenRects[index];
    const current = originalScreenRects[best];
    const candidateDistance = squaredDistance(nodeCenter, {
      x: candidate.x + candidate.width / 2,
      y: candidate.y + candidate.height / 2,
    });
    const currentDistance = squaredDistance(nodeCenter, {
      x: current.x + current.width / 2,
      y: current.y + current.height / 2,
    });
    if (candidateDistance < currentDistance) best = index;
  }
  return best;
}

export function normalizeAgentScreenRoot(frame: DesignNode, index = 0): void {
  const screenSpacing = 72;
  const rowGap = 150;
  const perRow = Math.max(1, screensPerRow);
  const col = index % perRow;
  const row = Math.floor(index / perRow);
  frame.x = 100 + col * (390 + screenSpacing);
  frame.y = 80 + row * (844 + rowGap);
  frame.width = 390;
  frame.height = 844;
  frame.clipContent = true;
  frame.style.cornerRadius = Math.min(Math.max(frame.style.cornerRadius, 28), 44);

  if (frame.style.paddingTop === undefined) frame.style.paddingTop = 24;
  if (frame.style.paddingRight === undefined) frame.style.paddingRight = 24;
  if (frame.style.paddingBottom === undefined) frame.style.paddingBottom = 24;
  if (frame.style.paddingLeft === undefined) frame.style.paddingLeft = 24;
}

function appendLooseRoot(
  node: DesignNode,
  screen: DesignNode,
  originalScreenRect: { x: number; y: number },
): void {
  if (shouldFlattenExtraRootContainer(node)) {
    for (const childNode of node.children) {
      const child = childNode;
      child.x = node.x + child.x - originalScreenRect.x;
      child.y = node.y + child.y - originalScreenRect.y;
      screen.children.push(child);
    }
  } else {
    const child = node;
    child.x = node.x - originalScreenRect.x;
    child.y = node.y - originalScreenRect.y;
    screen.children.push(child);
  }
}

/** Pass 1 — `normalizeAgentScreenRoots(in:createdIds:)`. Returns the new roots. */
export function normalizeAgentScreenRoots(
  nodes: DesignNode[],
  createdIds: ReadonlySet<string>,
  context: NormalizationContext,
): DesignNode[] {
  if (
    context.currentAgentRequestIntent !== 'createNewDesign' ||
    context.currentAgentPresentationMode === 'presentationShot' ||
    nodes.length <= 1
  ) {
    return nodes;
  }

  // Loose generated content must only be absorbed into screens created by THIS
  // generation — never into leftover frames from old runs.
  let screenIndices = agentScreenRootIndices(nodes);
  if (createdIds.size > 0) {
    const createdOnly = screenIndices.filter((index) => createdIds.has(nodes[index].id));
    if (createdOnly.length > 0) screenIndices = createdOnly;
  }
  if (screenIndices.length === 0) return nodes;

  const originalScreenRects = screenIndices.map((index) => ({
    x: nodes[index].x,
    y: nodes[index].y,
    width: nodes[index].width,
    height: nodes[index].height,
  }));
  const screenIds = new Set(screenIndices.map((index) => nodes[index].id));
  const screens = screenIndices.map((index) => nodes[index]);
  const leftovers: DesignNode[] = [];

  screens.forEach((screen, index) => normalizeAgentScreenRoot(screen, index));

  for (const node of nodes) {
    if (screenIds.has(node.id)) continue;
    if (!(isLooseVisualRoot(node) || shouldFlattenExtraRootContainer(node))) {
      leftovers.push(node);
      continue;
    }

    const screenIndex = nearestScreenIndex(node, originalScreenRects);
    appendLooseRoot(node, screens[screenIndex], originalScreenRects[screenIndex]);
  }

  return [...screens, ...leftovers];
}

/** Pass 2 — `nestLooseRootNodesIntoMobileFrame(in:)`. Returns the new roots. */
export function nestLooseRootNodesIntoMobileFrame(
  nodes: DesignNode[],
  context: NormalizationContext,
): DesignNode[] {
  if (context.currentAgentRequestIntent !== 'createNewDesign') return nodes;
  if (agentScreenRootIndices(nodes).length !== 1) return nodes;
  const frameIndex = nodes.findIndex((node) => isMobileScreenFrame(node) || isLikelyMobileRootFrame(node));
  if (frameIndex < 0) return nodes;

  const frameOrigin = { x: nodes[frameIndex].x, y: nodes[frameIndex].y };
  const looseChildren: DesignNode[] = [];
  const remainingNodes: DesignNode[] = [];

  for (let index = 0; index < nodes.length; index += 1) {
    if (index === frameIndex) {
      remainingNodes.push(nodes[index]);
      continue;
    }

    if (!isLooseVisualRoot(nodes[index])) {
      remainingNodes.push(nodes[index]);
      continue;
    }

    const child = nodes[index];
    child.x = Math.max(0, child.x - frameOrigin.x);
    child.y = Math.max(0, child.y - frameOrigin.y);
    looseChildren.push(child);
  }

  if (looseChildren.length === 0) return nodes;

  const newFrameIndex = remainingNodes.findIndex((node) => node.id === nodes[frameIndex].id);
  if (newFrameIndex >= 0) {
    remainingNodes[newFrameIndex].children.push(...looseChildren);
  }

  return remainingNodes;
}

/** Pass 3 — `expandContainersToFitChildren(in:)`. */
export function expandContainersToFitChildren(nodes: DesignNode[]): void {
  for (const node of nodes) {
    if (node.children.length > 0) {
      expandContainersToFitChildren(node.children);
    }

    if (
      !(node.type === 'Frame' || node.type === 'Rectangle') ||
      node.children.length === 0 ||
      isMobileScreenFrame(node)
    ) {
      continue;
    }

    const paddingBottom = isTransparentHex(node.style.fill) ? 0 : 16;
    const requiredHeight = node.children.reduce(
      (tallest, child) => Math.max(tallest, child.y + child.height + paddingBottom),
      Number.NEGATIVE_INFINITY,
    );
    const resolvedHeight = Number.isFinite(requiredHeight) ? requiredHeight : node.height;

    if (resolvedHeight > node.height) {
      node.height = resolvedHeight;
    }
  }
}

/** Pass 4 — `normalizeMobileScreenLayouts(in:)`. */
export function normalizeMobileScreenLayouts(nodes: DesignNode[]): void {
  for (const node of nodes) {
    if (isMobileScreenFrame(node)) {
      normalizeMobileScreen(node);
    }
    if (node.children.length > 0) {
      normalizeMobileScreenLayouts(node.children);
    }
  }
}

/** Pass 5 — `normalizeNavigationLayouts(in:)`. */
export function normalizeNavigationLayouts(nodes: DesignNode[]): void {
  for (const node of nodes) {
    if (isBottomNavigation(node)) {
      relayoutBottomNavigation(node);
    }
    if (node.children.length > 0) {
      normalizeNavigationLayouts(node.children);
    }
  }
}

/** Pass 6 — `normalizeIconLabelClusterLayouts(in:)`. */
export function normalizeIconLabelClusterLayouts(nodes: DesignNode[]): void {
  for (const node of nodes) {
    if (isIconLabelCluster(node)) {
      distributeIconLabelPairs(node, 4);
    }
    if (node.children.length > 0) {
      normalizeIconLabelClusterLayouts(node.children);
    }
  }
}

/** Pass 7 — `applyDesignQualityPass(in:)`. */
export function applyDesignQualityPass(nodes: DesignNode[]): void {
  for (const node of nodes) {
    if (node.children.length > 0) {
      applyDesignQualityPass(node.children);

      if (isMobileScreenFrame(node)) {
        resolveMobileSiblingOverlaps(node);
        addConsistentCardDepth(node);
      }

      expandTextNodesForTypography(node);
      clampChildrenInsideParent(node);
    }
  }
}

/** Pass 8 — `repairGeneratedDesignSemantics(in:)`. */
export function repairGeneratedDesignSemantics(nodes: DesignNode[], context: NormalizationContext): void {
  if (context.currentAgentRequestIntent !== 'createNewDesign') return;

  const domain: AgentSemanticDomain = semanticDomain(context.currentAgentUserPrompt);
  for (const node of nodes) {
    repairSemanticCopy(node, domain);
  }
}

/** Pass 11 — `clipRoundedContainers(in:)` (public: also runs on `replaceProject`). */
export function clipRoundedContainers(nodes: DesignNode[]): void {
  for (const node of nodes) {
    const radius = node.style.cornerRadius ?? 0;

    // A child placed at a NEGATIVE offset is protruding on purpose.
    const hasIntentionalProtrusion = node.children.some((child) => child.x < -0.5 || child.y < -0.5);

    // Oversized MEDIA anchored inside the box is the real defect.
    const hasOversizedMedia = node.children.some(
      (child) =>
        (child.type === 'Image' || child.type === 'Icon') &&
        child.x >= -0.5 &&
        child.y >= -0.5 &&
        (child.x + child.width > node.width + 0.5 || child.y + child.height > node.height + 0.5),
    );

    if (radius > 0 && hasOversizedMedia && !hasIntentionalProtrusion && node.clipContent !== true) {
      node.clipContent = true;
    }
    // Heal containers a previous run clipped into hiding their protruding children.
    if (hasIntentionalProtrusion && node.clipContent === true) {
      node.clipContent = false;
    }
    clipRoundedContainers(node.children);
  }
}

// MARK: - Text hugging

export interface FittedTextBox {
  width: number;
  height: number;
  dx: number;
}

/**
 * `fittedTextBox(for:)` — the box a text node actually needs, plus the x-shift
 * that keeps the rendered glyphs exactly where they already are. Returns
 * undefined when the node isn't text or already fits.
 */
export function fittedTextBox(node: DesignNode): FittedTextBox | undefined {
  if (node.type !== 'Text') return undefined;
  const text = node.text;
  if (!text || text.trim().length === 0) return undefined;

  // Explicitly wrapping text owns a layout slot, not a one-line hug.
  if (node.textBehavior?.wrap === true || (node.textBehavior?.maxLines ?? 1) > 1) {
    return undefined;
  }

  const paddingLeft = node.style.paddingLeft ?? 0;
  const paddingRight = node.style.paddingRight ?? 0;
  const paddingTop = node.style.paddingTop ?? 0;
  const paddingBottom = node.style.paddingBottom ?? 0;
  const availableWidth = Math.max(1, node.width - paddingLeft - paddingRight);

  const attributes = interactionAttributes(node.style);
  const unbounded = unboundedTextSize(text, attributes);
  // Multi-line text keeps its current width (that width is what decides the
  // wrap); only a single line collapses horizontally.
  const wraps = unbounded.width > availableWidth;
  const measured = wraps ? boundedTextSize(text, attributes, availableWidth) : unbounded;

  const newWidth = Math.max(1, Math.ceil(measured.width) + paddingLeft + paddingRight);
  const newHeight = Math.max(1, Math.ceil(measured.height) + paddingTop + paddingBottom);
  // Only ever shrink.
  if (
    !(newWidth <= node.width) ||
    !(newHeight <= node.height) ||
    !(node.width - newWidth > 0.5 || node.height - newHeight > 0.5)
  ) {
    return undefined;
  }

  // Collapse toward wherever the glyphs already sit.
  const widthDelta = node.width - newWidth;
  let dx: number;
  switch (node.style.textAlign?.toLowerCase()) {
    case 'center':
      dx = widthDelta / 2;
      break;
    case 'right':
      dx = widthDelta;
      break;
    default:
      dx = 0;
      break;
  }
  return { width: newWidth, height: newHeight, dx };
}

/**
 * Pass 12 — `hugTextBoxesToContent(in:)`. Deliberately does NOT mark the nodes
 * manually positioned: the layout engine stays in charge of where they sit.
 */
export function hugTextBoxesToContent(nodes: DesignNode[]): void {
  for (const node of nodes) {
    const fit = fittedTextBox(node);
    if (fit) {
      node.x += fit.dx;
      node.width = fit.width;
      node.height = fit.height;
    }
    hugTextBoxesToContent(node.children);
  }
}

// MARK: - repairTextContrast

/** Pass 13 — `repairTextContrast(in:inheritedFill:)`. */
export function repairTextContrast(nodes: DesignNode[], inheritedFill: string): void {
  for (const node of nodes) {
    // The surface visually behind this node's children.
    const surfaceForChildren = ((): string => {
      if (node.type === 'Image' && (node.imageSource ?? node.imageName) !== undefined) {
        const photoProxy = '#6B7280';
        const overlay = node.style.overlayColor;
        const opacity = node.style.overlayOpacity;
        if (overlay !== undefined && opacity !== undefined && opacity > 0) {
          const alphaByte = Math.trunc(Math.min(1, Math.max(0, opacity)) * 255)
            .toString(16)
            .toUpperCase()
            .padStart(2, '0');
          const overlayHex = overlay.startsWith('#') && overlay.length === 7 ? overlay + alphaByte : overlay;
          return compositedFill(overlayHex, photoProxy);
        }
        return photoProxy;
      }
      const gradient = node.style.gradient;
      if (gradient && gradient.colors.length > 0) {
        return compositedFill(gradient.colors[0], inheritedFill);
      }
      return compositedFill(node.style.fill, inheritedFill);
    })();

    switch (node.type) {
      case 'Text': {
        // A text node's own fill is its color fallback, not a surface.
        const renderedColor = node.style.textColor ?? node.style.fill;
        const visibleColor = compositedFill(renderedColor, inheritedFill);
        if (contrastRatio(visibleColor, inheritedFill) < 4.5) {
          node.style.textColor = luminance(inheritedFill) > 0.55 ? '#0F172A' : '#FFFFFF';
        }
        break;
      }
      case 'Button': {
        const renderedColor = node.style.textColor ?? '#FFFFFF';
        const visibleColor = compositedFill(renderedColor, surfaceForChildren);
        if (contrastRatio(visibleColor, surfaceForChildren) < 4.5) {
          node.style.textColor = luminance(surfaceForChildren) > 0.55 ? '#0F172A' : '#FFFFFF';
        }
        break;
      }
      case 'Input':
      case 'Icon': {
        const renderedColor = node.style.textColor ?? node.style.fill;
        const visibleColor = compositedFill(renderedColor, surfaceForChildren);
        if (contrastRatio(visibleColor, surfaceForChildren) < 4.5) {
          node.style.textColor = luminance(surfaceForChildren) > 0.55 ? '#0F172A' : '#FFFFFF';
        }
        break;
      }
      default:
        break;
    }

    if (node.children.length > 0) {
      repairTextContrast(node.children, surfaceForChildren);
    }
  }
}
