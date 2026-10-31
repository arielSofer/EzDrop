// Ported 1:1 from AgenticDesigner/ViewModels/ProjectViewModel.swift — the
// layout engine and the shape predicates the normalization passes share
// (auto layout, padding bounds, constraints, mobile-screen normalisation,
// bottom-nav / chat-input relayout, align & distribute children).

import type { DesignNode, EdgeConstraints, NodeStyle, ShadowStyle, TextBehavior } from '@agentic/core';
import { isLightOpaqueFill, isTransparentHex } from './colors';
import { measuredTextSize } from './textMetrics';

// MARK: - Shape predicates

export function isMobileScreenFrame(node: DesignNode): boolean {
  return (
    node.type === 'Frame' &&
    node.width >= 320 &&
    node.width <= 460 &&
    node.height >= 600 &&
    node.height <= 980 &&
    node.children.length >= 2
  );
}

export function isLikelyMobileRootFrame(node: DesignNode): boolean {
  return (
    node.type === 'Frame' && node.width >= 320 && node.width <= 460 && node.height >= 600 && node.height <= 980
  );
}

export function isLooseVisualRoot(node: DesignNode): boolean {
  switch (node.type) {
    case 'Text':
    case 'Button':
    case 'Input':
    case 'Rectangle':
    case 'Image':
    case 'Icon':
      return true;
    case 'Frame':
      return !isLikelyMobileRootFrame(node);
  }
}

export function isBottomNavigation(node: DesignNode): boolean {
  const name = node.name.toLowerCase();

  if (name.includes('bottom') && (name.includes('nav') || name.includes('navigation'))) {
    return true;
  }

  // Models name nav bars many ways ("Navigation Bar", "Tab Bar", "Tabs").
  const navishName =
    name.includes('nav') || name.includes('tab bar') || name.includes('tabbar') || name.includes('tabs');

  if (!navishName || node.type !== 'Frame' || node.height > 110) return false;

  const directIcons = node.children.filter((child) => child.type === 'Icon').length;
  const nestedIcons = node.children.reduce(
    (count, child) => count + child.children.filter((grandChild) => grandChild.type === 'Icon').length,
    0,
  );

  return directIcons + nestedIcons >= 3;
}

export function isChatInput(node: DesignNode): boolean {
  return node.name.toLowerCase().includes('chat input');
}

export function isIconLabelCluster(node: DesignNode): boolean {
  const name = node.name.toLowerCase();
  const iconCount = node.children.filter((child) => child.type === 'Icon').length;
  const textCount = node.children.filter((child) => child.type === 'Text').length;

  return (
    iconCount >= 2 &&
    textCount >= 2 &&
    (name.includes('quick action') ||
      name.includes('action row') ||
      name.includes('tab bar') ||
      name.includes('icon row'))
  );
}

export function verticalGap(_node: DesignNode): number {
  // Reference apps overwhelmingly align section rhythm to a 4pt grid; every
  // branch of the Swift switch returns 12.
  return 12;
}

export function baseSemanticName(name: string): string {
  return name
    .toLowerCase()
    .replaceAll(' icon background', '')
    .replaceAll(' icon', '')
    .replaceAll(' label', '')
    .trim();
}

export function iconLabelMatchScore(iconName: string, labelNode: DesignNode, iconNode: DesignNode): number {
  const labelName = baseSemanticName(labelNode.name);
  const semanticScore = labelName.includes(iconName) || iconName.includes(labelName) ? 0 : 1000;
  const centerDistance = Math.abs(labelNode.x + labelNode.width / 2 - (iconNode.x + iconNode.width / 2));
  return semanticScore + centerDistance;
}

/** `Sequence.min(by:)` — the FIRST minimum, matching Swift's stable choice. */
function minIndexBy(indices: number[], less: (lhs: number, rhs: number) => boolean): number | undefined {
  if (indices.length === 0) return undefined;
  let best = indices[0];
  for (const candidate of indices.slice(1)) {
    if (less(candidate, best)) best = candidate;
  }
  return best;
}

// MARK: - Containment helpers

export function fitChildrenInsideParent(parent: DesignNode): void {
  if (parent.children.length === 0) return;

  for (const child of parent.children) {
    if (child.width > parent.width) child.width = Math.max(1, parent.width);
    if (child.height > parent.height) child.height = Math.max(1, parent.height);

    child.x = Math.min(Math.max(0, child.x), Math.max(0, parent.width - child.width));
    child.y = Math.min(Math.max(0, child.y), Math.max(0, parent.height - child.height));

    if (child.children.length > 0) fitChildrenInsideParent(child);
  }
}

export function clampChildrenInsideParent(parent: DesignNode): void {
  const padding = isTransparentHex(parent.style.fill) ? 0 : 2;

  for (const child of parent.children) {
    if (child.width > parent.width - padding * 2) {
      child.width = Math.max(1, parent.width - padding * 2);
    }
    if (child.height > parent.height - padding * 2) {
      child.height = Math.max(1, parent.height - padding * 2);
    }

    child.x = Math.min(Math.max(child.x, padding), Math.max(padding, parent.width - padding - child.width));
    child.y = Math.min(Math.max(child.y, padding), Math.max(padding, parent.height - padding - child.height));
  }
}

export function expandTextNodesForTypography(parent: DesignNode): void {
  for (const child of parent.children) {
    if (child.type !== 'Text') continue;
    const fontSize = child.style.fontSize ?? 16;
    const lineHeight = child.style.lineHeight ?? fontSize * 1.25;
    const maxLines = child.textBehavior?.maxLines ?? 1;
    const requestedLines =
      child.textBehavior?.autoHeight === true || child.textBehavior?.wrap === true ? Math.max(1, maxLines) : 1;
    const minimumHeight = Math.ceil(lineHeight * requestedLines);

    if (child.height < minimumHeight) {
      child.height = Math.min(minimumHeight, Math.max(1, parent.height - child.y));
    }
  }
}

export function normalizeHorizontalPlacement(
  child: DesignNode,
  frameWidth: number,
  padding: number,
  contentWidth: number,
): void {
  const shouldConstrain = child.type !== 'Icon';

  if (shouldConstrain && child.width > contentWidth) {
    child.width = contentWidth;
  }

  if (shouldConstrain) {
    child.x = (frameWidth - child.width) / 2;
  } else {
    child.x = Math.min(Math.max(child.x, padding), frameWidth - padding - child.width);
  }
}

export function compactMobileSection(node: DesignNode): void {
  const name = node.name.toLowerCase();

  if (name.includes('avatar') || name.includes('header')) {
    node.height = Math.min(node.height, 72);
  } else if (
    name.includes('hero') ||
    name.includes('map') ||
    name.includes('artwork') ||
    node.type === 'Image'
  ) {
    node.height = Math.min(Math.max(node.height, 160), 260);
    fitChildrenInsideParent(node);
  } else if (name.includes('balance')) {
    node.height = Math.min(Math.max(node.height, 132), 180);
    fitChildrenInsideParent(node);
  } else if (name.includes('quick action')) {
    node.height = Math.min(Math.max(node.height, 92), 104);
    fitChildrenInsideParent(node);
  } else if (name.includes('transaction') || name.includes('activity') || name.includes('list')) {
    node.height = Math.min(node.height, 232);
    fitChildrenInsideParent(node);
  } else if (name.includes('market') || name.includes('grid') || name.includes('currency')) {
    node.height = Math.min(node.height, 132);
    fitChildrenInsideParent(node);
  } else if (name.includes('message') || name.includes('response')) {
    node.height = Math.min(Math.max(node.height, 64), 84);
    fitChildrenInsideParent(node);
  } else if (name.includes('chat input')) {
    node.height = Math.min(Math.max(node.height, 60), 70);
    fitChildrenInsideParent(node);
  } else if (name.includes('sheet') || name.includes('card') || name.includes('panel')) {
    node.height = Math.min(Math.max(node.height, 80), 240);
    fitChildrenInsideParent(node);
  } else if (node.type === 'Frame' || node.type === 'Rectangle') {
    node.height = Math.min(Math.max(node.height, 48), 240);
    fitChildrenInsideParent(node);
  }
}

// MARK: - Navigation & chat input

export function relayoutBottomNavigation(node: DesignNode): void {
  if (node.children.length === 0) return;

  // Manual distribution must survive the final auto-layout resolve.
  delete node.style.layout;
  delete node.style.spacing;

  // Group children into tab items: an icon starts an item and one text
  // directly after it joins that item.
  const items: number[][] = [];
  for (let index = 0; index < node.children.length; index += 1) {
    const lastItem = items[items.length - 1];
    if (
      node.children[index].type === 'Text' &&
      lastItem !== undefined &&
      lastItem.length === 1 &&
      node.children[lastItem[0]].type === 'Icon'
    ) {
      lastItem.push(index);
    } else {
      items.push([index]);
    }
  }

  if (items.length === 0) return;
  const itemWidth = node.width / items.length;
  const hasLabels = node.children.some((child) => child.type === 'Text');

  items.forEach((group, slot) => {
    const baseX = slot * itemWidth;

    for (const index of group) {
      const child = node.children[index];
      switch (child.type) {
        case 'Icon': {
          child.width = Math.min(child.width, 22);
          child.height = Math.min(child.height, 22);
          child.x = baseX + (itemWidth - child.width) / 2;
          child.y = hasLabels ? 10 : (node.height - child.height) / 2;
          break;
        }
        case 'Text': {
          const text = child.text ?? '';
          const maxLabelWidth = Math.max(28, itemWidth - 6);
          const labelStyle: NodeStyle = { ...child.style };

          // Shrink the font until the label fits its slot on one line.
          let fontSize = labelStyle.fontSize ?? 11;
          while (fontSize > 9 && Math.ceil(measuredTextSize(text, labelStyle).width) > maxLabelWidth) {
            fontSize -= 1;
            labelStyle.fontSize = fontSize;
          }
          child.style.fontSize = fontSize;

          const labelWidth = Math.min(maxLabelWidth, Math.ceil(measuredTextSize(text, labelStyle).width) + 2);
          child.width = labelWidth;
          child.height = 16;
          const behavior: TextBehavior = { wrap: false, autoHeight: false, maxLines: 1 };
          child.textBehavior = behavior;
          child.style.textAlign = 'center';
          child.x = baseX + (itemWidth - labelWidth) / 2;
          child.y = 36;
          break;
        }
        default: {
          child.width = Math.max(1, itemWidth - 8);
          child.x = baseX + 4;
          child.y = Math.max(0, (node.height - child.height) / 2);
          break;
        }
      }
    }
  });
}

export function relayoutChatInput(node: DesignNode): void {
  if (node.children.length === 0) return;

  for (const child of node.children) {
    const name = child.name.toLowerCase();

    if (name.includes('attach')) {
      child.x = 18;
      child.y = (node.height - child.height) / 2;
    } else if (name.includes('placeholder')) {
      child.x = 50;
      child.y = (node.height - child.height) / 2;
      child.width = Math.max(1, node.width - 118);
    } else if (name.includes('send button')) {
      child.width = 44;
      child.height = 44;
      child.x = node.width - 54;
      child.y = (node.height - 44) / 2;
      fitChildrenInsideParent(child);
    }
  }
}

// MARK: - Mobile screen normalisation

/**
 * Gives every light surface CARD the same soft shadow, so the screen reads as
 * one design system instead of a mix of flat and floating cards.
 */
export function addConsistentCardDepth(screen: DesignNode): void {
  for (const card of screen.children) {
    if (card.type !== 'Frame') continue;
    if (
      card.children.length === 0 ||
      card.style.shadow !== undefined ||
      isBottomNavigation(card) ||
      card.width > screen.width ||
      card.height < 44 ||
      card.height > 360 ||
      !isLightOpaqueFill(card.style.fill)
    ) {
      continue;
    }
    const shadow: ShadowStyle = { color: '#0F172A', opacity: 0.06, radius: 16, x: 0, y: 8 };
    card.style.shadow = shadow;
  }
}

export function resolveMobileSiblingOverlaps(frame: DesignNode): void {
  const bottomIndex = frame.children.findIndex(
    (child) => isBottomNavigation(child) || isChatInput(child),
  );
  const bottomLimit = bottomIndex >= 0 ? frame.children[bottomIndex].y - 16 : frame.height - 24;
  const orderedIndices = frame.children
    .map((_child, index) => index)
    .filter((index) => index !== bottomIndex)
    .sort((lhs, rhs) => frame.children[lhs].y - frame.children[rhs].y);

  let currentBottom = 24;

  for (const childIndex of orderedIndices) {
    const child = frame.children[childIndex];
    if (child.y < currentBottom) child.y = currentBottom;

    if (child.y + child.height > bottomLimit) {
      const availableHeight = bottomLimit - child.y;
      if (availableHeight >= 48) {
        child.height = availableHeight;
        fitChildrenInsideParent(child);
      }
    }

    currentBottom = child.y + child.height + verticalGap(child);
  }
}

export function normalizeMobileScreen(frame: DesignNode): void {
  const defaultPadding = frame.width <= 420 ? 24 : 32;
  frame.clipContent = true;

  if (frame.style.paddingTop === undefined) frame.style.paddingTop = defaultPadding;
  if (frame.style.paddingRight === undefined) frame.style.paddingRight = defaultPadding;
  if (frame.style.paddingBottom === undefined) frame.style.paddingBottom = defaultPadding;
  if (frame.style.paddingLeft === undefined) frame.style.paddingLeft = defaultPadding;

  const paddingTop = frame.style.paddingTop ?? defaultPadding;
  const paddingRight = frame.style.paddingRight ?? defaultPadding;
  const paddingBottom = frame.style.paddingBottom ?? defaultPadding;
  const paddingLeft = frame.style.paddingLeft ?? defaultPadding;
  const sidePadding = Math.min(paddingLeft, paddingRight);
  const contentWidth = Math.max(1, frame.width - paddingLeft - paddingRight);
  const bottomIndexRaw = frame.children.findIndex(
    (child) => isBottomNavigation(child) || isChatInput(child),
  );
  const bottomIndex = bottomIndexRaw >= 0 ? bottomIndexRaw : undefined;
  // The nav sits a SMALL fixed margin from the true screen bottom — NOT the
  // content paddingBottom, which is large (≈100pt).
  const navBottomMargin = 16;
  let bottomTop = frame.height - paddingBottom;

  if (bottomIndex !== undefined) {
    const bar = frame.children[bottomIndex];
    bar.width = contentWidth;
    bar.x = paddingLeft;
    bar.height = Math.max(60, Math.min(bar.height, 70));
    bar.y = frame.height - bar.height - navBottomMargin;

    // Constraints keep the bar pinned when the screen's auto-layout resolves again.
    const constraints: EdgeConstraints = {
      right: paddingRight,
      bottom: navBottomMargin,
      left: paddingLeft,
    };
    bar.constraints = constraints;

    if (isBottomNavigation(bar)) {
      relayoutBottomNavigation(bar);
    } else if (isChatInput(bar)) {
      relayoutChatInput(bar);
    }

    bottomTop = bar.y;
  }

  const orderedIndices = frame.children
    .map((_child, index) => index)
    .filter((index) => index !== bottomIndex)
    .sort((lhs, rhs) => frame.children[lhs].y - frame.children[rhs].y);

  let currentY = paddingTop;
  const bottomLimit = bottomTop - 20;
  const droppedIDs = new Set<string>();

  for (const childIndex of orderedIndices) {
    const child = frame.children[childIndex];
    compactMobileSection(child);
    normalizeHorizontalPlacement(child, frame.width, sidePadding, contentWidth);

    child.y = currentY;

    const naturalHeight = child.height;
    if (currentY + naturalHeight > bottomLimit) {
      const available = bottomLimit - currentY;
      // A stacked card squeezed below ~72% of its height overlaps its own text.
      if (available >= naturalHeight * 0.72 && available >= 48) {
        child.height = available;
        fitChildrenInsideParent(child);
      } else {
        droppedIDs.add(child.id);
        continue;
      }
    }

    currentY = child.y + child.height + verticalGap(child);
  }
  if (droppedIDs.size > 0) {
    for (let index = frame.children.length - 1; index >= 0; index -= 1) {
      if (droppedIDs.has(frame.children[index].id)) frame.children.splice(index, 1);
    }
  }

  // A final CTA is a deliberate bottom anchor, not just the next item in a
  // loose stack.
  const visibleContent = frame.children
    .map((_child, index) => index)
    .filter((index) => !isBottomNavigation(frame.children[index]) && !isChatInput(frame.children[index]))
    .sort((lhs, rhs) => frame.children[lhs].y - frame.children[rhs].y);
  const lastIndex = visibleContent[visibleContent.length - 1];
  if (lastIndex !== undefined && frame.children[lastIndex].type === 'Button') {
    const last = frame.children[lastIndex];
    const targetY = bottomLimit - last.height;
    const previousIndex = visibleContent[visibleContent.length - 2];
    const previousBottom =
      previousIndex !== undefined
        ? frame.children[previousIndex].y + frame.children[previousIndex].height
        : paddingTop;
    if (targetY > last.y && targetY - previousBottom >= 24) {
      last.y = targetY;
    }
  }
}

// MARK: - Auto-Layout Engine

export function applyAutoLayoutToNodes(nodes: DesignNode[]): void {
  for (const node of nodes) {
    if (node.children.length > 0) {
      applyAutoLayoutToNodes(node.children);
    }

    if ((node.type === 'Frame' || node.type === 'Rectangle') && node.style.layout !== undefined) {
      applyAutoLayout(node, node.style.layout);
    }
  }
}

export function applyAutoLayout(node: DesignNode, layout: string): void {
  if (node.children.length === 0) return;

  const normalizedLayout = layout.trim().toLowerCase().replaceAll('-', '').replaceAll('_', '');
  const spacing = node.style.spacing ?? 16;
  const paddingTop = node.style.paddingTop ?? 16;
  const paddingRight = node.style.paddingRight ?? 16;
  const paddingBottom = node.style.paddingBottom ?? 16;
  const paddingLeft = node.style.paddingLeft ?? 16;
  const align = (node.style.layoutAlign ?? 'stretch').trim().toLowerCase();
  const contentWidth = Math.max(1, node.width - paddingLeft - paddingRight);
  const contentHeight = Math.max(1, node.height - paddingTop - paddingBottom);

  if (['vertical', 'verticalstack', 'vstack', 'column'].includes(normalizedLayout)) {
    let currentY = paddingTop;

    for (const child of node.children) {
      if (child.manuallyPositioned === true) continue;
      const marginTop = child.style.marginTop ?? 0;
      const marginRight = child.style.marginRight ?? 0;
      const marginBottom = child.style.marginBottom ?? 0;
      const marginLeft = child.style.marginLeft ?? 0;
      const childContentWidth = Math.max(1, contentWidth - marginLeft - marginRight);

      switch (align) {
        case 'left':
        case 'leading':
        case 'start':
          child.x = paddingLeft + marginLeft;
          break;
        case 'right':
        case 'trailing':
        case 'end':
          child.x = node.width - paddingRight - marginRight - child.width;
          break;
        case 'center':
        case 'middle':
          child.x = paddingLeft + marginLeft + (childContentWidth - child.width) / 2;
          break;
        default:
          child.x = paddingLeft + marginLeft;
          child.width = childContentWidth;
          break;
      }

      child.y = currentY + marginTop;
      currentY += marginTop + child.height + marginBottom + spacing;
    }

    const calculatedHeight = currentY - spacing + paddingBottom;
    if (calculatedHeight > node.height && !isMobileScreenFrame(node)) {
      node.height = calculatedHeight;
    }
  } else if (['horizontal', 'horizontalstack', 'hstack', 'row'].includes(normalizedLayout)) {
    let currentX = paddingLeft;

    for (const child of node.children) {
      if (child.manuallyPositioned === true) continue;
      const marginTop = child.style.marginTop ?? 0;
      const marginRight = child.style.marginRight ?? 0;
      const marginBottom = child.style.marginBottom ?? 0;
      const marginLeft = child.style.marginLeft ?? 0;
      const childContentHeight = Math.max(1, contentHeight - marginTop - marginBottom);

      child.x = currentX + marginLeft;

      switch (align) {
        case 'top':
        case 'start':
          child.y = paddingTop + marginTop;
          break;
        case 'bottom':
        case 'end':
          child.y = node.height - paddingBottom - marginBottom - child.height;
          break;
        case 'stretch':
          child.y = paddingTop + marginTop;
          child.height = childContentHeight;
          break;
        default:
          child.y = paddingTop + marginTop + (childContentHeight - child.height) / 2;
          break;
      }

      currentX += marginLeft + child.width + marginRight + spacing;
    }

    const calculatedWidth = currentX - spacing + paddingRight;
    if (calculatedWidth > node.width) {
      fitHorizontalChildrenInsideParent(node, spacing);
    }
  }
}

export function fitHorizontalChildrenInsideParent(parent: DesignNode, spacing: number): void {
  if (parent.children.length === 0) return;

  const paddingLeft = parent.style.paddingLeft ?? 16;
  const paddingRight = parent.style.paddingRight ?? 16;
  const contentWidth = Math.max(1, parent.width - paddingLeft - paddingRight);
  const count = parent.children.length;
  const totalSpacing = spacing * Math.max(0, count - 1);
  const availableChildWidth = Math.max(1, (contentWidth - totalSpacing) / Math.max(1, count));
  let currentX = paddingLeft;

  for (const child of parent.children) {
    child.width = Math.min(child.width, availableChildWidth);
    child.x = currentX;
    currentX += child.width + spacing;
    fitChildrenInsideParent(child);
  }
}

export function applyPaddingBoundsInNodes(nodes: DesignNode[]): void {
  for (const node of nodes) {
    applyPaddingBoundsToChildrenOf(node);
    if (node.children.length > 0) applyPaddingBoundsInNodes(node.children);
  }
}

export function applyPaddingBoundsToChildrenOf(parent: DesignNode): void {
  if (
    parent.children.length === 0 ||
    parent.style.layout !== undefined ||
    !(parent.type === 'Frame' || parent.type === 'Rectangle')
  ) {
    return;
  }

  const paddingTop = parent.style.paddingTop ?? 0;
  const paddingRight = parent.style.paddingRight ?? 0;
  const paddingBottom = parent.style.paddingBottom ?? 0;
  const paddingLeft = parent.style.paddingLeft ?? 0;
  const parentHasPadding = paddingTop > 0 || paddingRight > 0 || paddingBottom > 0 || paddingLeft > 0;

  for (const child of parent.children) {
    const marginTop = child.style.marginTop ?? 0;
    const marginRight = child.style.marginRight ?? 0;
    const marginBottom = child.style.marginBottom ?? 0;
    const marginLeft = child.style.marginLeft ?? 0;
    const childHasMargin = marginTop > 0 || marginRight > 0 || marginBottom > 0 || marginLeft > 0;

    if (!parentHasPadding && !childHasMargin) continue;

    const minX = paddingLeft + marginLeft;
    const maxWidth = Math.max(1, parent.width - paddingLeft - paddingRight - marginLeft - marginRight);
    if (child.width > maxWidth) child.width = maxWidth;
    const maxX = Math.max(minX, parent.width - paddingRight - marginRight - child.width);
    child.x = Math.min(Math.max(child.x, minX), maxX);

    const minY = paddingTop + marginTop;
    const maxHeight = Math.max(1, parent.height - paddingTop - paddingBottom - marginTop - marginBottom);
    if (child.height > maxHeight) child.height = maxHeight;
    const maxY = Math.max(minY, parent.height - paddingBottom - marginBottom - child.height);
    child.y = Math.min(Math.max(child.y, minY), maxY);
  }
}

export function applyConstraintsInNodes(nodes: DesignNode[]): void {
  for (const node of nodes) {
    applyConstraintsToChildrenOf(node);
    if (node.children.length > 0) applyConstraintsInNodes(node.children);
  }
}

export function applyConstraintsToChildrenOf(parent: DesignNode): void {
  if (parent.children.length === 0) return;

  for (const child of parent.children) {
    const constraints = child.constraints;
    if (!constraints) continue;

    if (constraints.left !== undefined && constraints.right !== undefined) {
      child.x = constraints.left;
      child.width = Math.max(1, parent.width - constraints.left - constraints.right);
    } else if (constraints.left !== undefined) {
      child.x = constraints.left;
    } else if (constraints.right !== undefined) {
      child.x = parent.width - constraints.right - child.width;
    } else if (constraints.centerX !== undefined) {
      child.x = (parent.width - child.width) / 2 + constraints.centerX;
    }

    if (constraints.top !== undefined && constraints.bottom !== undefined) {
      child.y = constraints.top;
      child.height = Math.max(1, parent.height - constraints.top - constraints.bottom);
    } else if (constraints.top !== undefined) {
      child.y = constraints.top;
    } else if (constraints.bottom !== undefined) {
      child.y = parent.height - constraints.bottom - child.height;
    } else if (constraints.centerY !== undefined) {
      child.y = (parent.height - child.height) / 2 + constraints.centerY;
    }
  }
}

// MARK: - Align / distribute children

export function alignChildrenIn(node: DesignNode, alignment: string): void {
  const normalized = alignment.trim().toLowerCase();
  const paddingLeft = node.style.paddingLeft ?? 0;
  const paddingRight = node.style.paddingRight ?? 0;
  const paddingTop = node.style.paddingTop ?? 0;
  const paddingBottom = node.style.paddingBottom ?? 0;
  const innerWidth = Math.max(0, node.width - paddingLeft - paddingRight);
  const innerHeight = Math.max(0, node.height - paddingTop - paddingBottom);

  for (const child of node.children) {
    switch (normalized) {
      case 'left':
      case 'leading':
        child.x = paddingLeft;
        break;
      case 'right':
      case 'trailing':
        child.x = paddingLeft + innerWidth - child.width;
        break;
      case 'top':
        child.y = paddingTop;
        break;
      case 'bottom':
        child.y = paddingTop + innerHeight - child.height;
        break;
      case 'middle':
      case 'verticalcenter':
      case 'centery':
        child.y = paddingTop + (innerHeight - child.height) / 2;
        break;
      default:
        child.x = paddingLeft + (innerWidth - child.width) / 2;
        break;
    }
    delete child.constraints;
    child.manuallyPositioned = true;
  }
}

export function distributeChildrenIn(
  node: DesignNode,
  axis: string,
  padding: number,
  spacing: number | undefined,
): void {
  if (node.children.length === 0) return;

  if (distributeIconLabelPairs(node, padding)) return;

  const normalizedAxis = axis.trim().toLowerCase();
  const childCount = node.children.length;

  if (normalizedAxis === 'vertical') {
    const totalChildHeight = node.children.reduce((sum, child) => sum + child.height, 0);
    const gap =
      spacing ?? Math.max(0, (node.height - padding * 2 - totalChildHeight) / Math.max(1, childCount - 1));
    let currentY = padding;

    for (const child of node.children) {
      child.y = currentY;
      child.x = (node.width - child.width) / 2;
      currentY += child.height + gap;
    }
  } else {
    const totalChildWidth = node.children.reduce((sum, child) => sum + child.width, 0);
    const gap =
      spacing ?? Math.max(0, (node.width - padding * 2 - totalChildWidth) / Math.max(1, childCount - 1));
    let currentX = padding;

    for (const child of node.children) {
      child.x = currentX;
      child.y = (node.height - child.height) / 2;
      currentX += child.width + gap;
    }
  }
}

export function distributeIconLabelPairs(node: DesignNode, padding: number): boolean {
  const pairs: { icon: number; label?: number; background?: number }[] = [];
  const usedLabelIndices = new Set<number>();
  const usedBackgroundIndices = new Set<number>();

  for (let iconIndex = 0; iconIndex < node.children.length; iconIndex += 1) {
    if (node.children[iconIndex].type !== 'Icon') continue;
    const iconName = baseSemanticName(node.children[iconIndex].name);

    const labelCandidates = node.children
      .map((_child, index) => index)
      .filter((index) => node.children[index].type === 'Text' && !usedLabelIndices.has(index));
    const labelIndex = minIndexBy(
      labelCandidates,
      (lhs, rhs) =>
        iconLabelMatchScore(iconName, node.children[lhs], node.children[iconIndex]) <
        iconLabelMatchScore(iconName, node.children[rhs], node.children[iconIndex]),
    );
    if (labelIndex !== undefined) usedLabelIndices.add(labelIndex);

    const backgroundCandidates = node.children
      .map((_child, index) => index)
      .filter((index) => node.children[index].type === 'Rectangle' && !usedBackgroundIndices.has(index));
    const backgroundIndex = minIndexBy(
      backgroundCandidates,
      (lhs, rhs) =>
        iconLabelMatchScore(iconName, node.children[lhs], node.children[iconIndex]) <
        iconLabelMatchScore(iconName, node.children[rhs], node.children[iconIndex]),
    );
    if (backgroundIndex !== undefined) usedBackgroundIndices.add(backgroundIndex);

    const pair: { icon: number; label?: number; background?: number } = { icon: iconIndex };
    if (labelIndex !== undefined) pair.label = labelIndex;
    if (backgroundIndex !== undefined) pair.background = backgroundIndex;
    pairs.push(pair);
  }

  if (pairs.length < 2) return false;

  const columnWidth = (node.width - padding * 2) / pairs.length;
  const iconSize = Math.max(22, Math.min(34, node.height * 0.32));
  const backgroundSize = Math.min(Math.max(iconSize + 18, 44), Math.min(64, node.height - 28));
  const iconTop = Math.max(8, Math.min(18, node.height * 0.16));
  const backgroundTop = Math.max(0, iconTop - (backgroundSize - iconSize) / 2);
  const labelTop = Math.min(node.height - 22, iconTop + iconSize + 8);

  pairs.forEach((pair, pairIndex) => {
    const columnX = padding + pairIndex * columnWidth;
    const centerX = columnX + columnWidth / 2;

    if (pair.background !== undefined) {
      const background = node.children[pair.background];
      background.width = backgroundSize;
      background.height = backgroundSize;
      background.style.cornerRadius = backgroundSize / 2;
      background.x = centerX - backgroundSize / 2;
      background.y = backgroundTop;
    }

    const icon = node.children[pair.icon];
    icon.width = iconSize;
    icon.height = iconSize;
    icon.x = centerX - iconSize / 2;
    icon.y = iconTop;

    if (pair.label !== undefined) {
      const label = node.children[pair.label];
      const labelWidth = Math.min(Math.max(56, columnWidth - 8), 96);
      label.width = labelWidth;
      label.height = Math.max(18, label.height);
      label.x = centerX - labelWidth / 2;
      label.y = labelTop;
    }
  });

  return true;
}
