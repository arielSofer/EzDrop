// Ported 1:1 from AgenticDesigner/ViewModels/ProjectViewModel.swift — the
// canvas hit-testing rules (`hitTestChain(at:)`, `interactionRect(for:origin:)`,
// `hitTestNodeId(at:mode:)`) and the marquee-selection collectors.

import { rectContainsPoint, rectIntersection, rectIntersects, type DesignNode, type Point, type Rect } from '@agentic/core';
import { boundedTextSize, integralSize, interactionAttributes } from './textMetrics';
import type { CanvasHitMode } from './types';

/**
 * Text nodes often have a layout box much wider or taller than their visible
 * glyphs. Other node types keep their full box; text uses its rendered content
 * bounds plus a small forgiving hit slop.
 */
export function interactionRect(node: DesignNode, origin: Point): Rect {
  const fullRect: Rect = {
    x: origin.x,
    y: origin.y,
    width: Math.max(0, node.width),
    height: Math.max(0, node.height),
  };
  const text = node.text;
  if (node.type !== 'Text' || text === undefined || text.trim().length === 0) {
    return fullRect;
  }

  const paddingLeft = node.style.paddingLeft ?? 0;
  const paddingRight = node.style.paddingRight ?? 0;
  const paddingTop = node.style.paddingTop ?? 0;
  const paddingBottom = node.style.paddingBottom ?? 0;
  const availableWidth = Math.max(1, node.width - paddingLeft - paddingRight);
  const availableHeight = Math.max(1, node.height - paddingTop - paddingBottom);

  const measured = integralSize(boundedTextSize(text, interactionAttributes(node.style), availableWidth));
  const contentWidth = Math.min(availableWidth, Math.max(1, measured.width));
  const contentHeight = Math.min(availableHeight, Math.max(1, measured.height));
  let contentX: number;

  switch (node.style.textAlign?.toLowerCase()) {
    case 'center':
      contentX = origin.x + paddingLeft + (availableWidth - contentWidth) / 2;
      break;
    case 'right':
      contentX = origin.x + node.width - paddingRight - contentWidth;
      break;
    default:
      contentX = origin.x + paddingLeft;
      break;
  }

  // `.insetBy(dx: -4, dy: -3)` — grow by 4pt horizontally, 3pt vertically.
  const contentRect: Rect = {
    x: contentX - 4,
    y: origin.y + paddingTop - 3,
    width: contentWidth + 8,
    height: contentHeight + 6,
  };
  return rectIntersection(contentRect, fullRect);
}

interface HitCandidate {
  node: DesignNode;
  origin: Point;
  area: number;
}

/**
 * The stack of nodes under a point, outermost first: [screen, card, label].
 * At each level the topmost sibling wins, matching the draw order.
 */
export function hitTestChain(
  nodes: readonly DesignNode[],
  point: Point,
  selectedNodeId: string | undefined,
): string[] {
  const chain: string[] = [];

  const walk = (levelNodes: readonly DesignNode[], offset: Point): void => {
    const ordered = levelNodes
      .map((element, index) => ({ element, index }))
      .sort((lhs, rhs) => {
        const lz = lhs.element.zIndex ?? 0;
        const rz = rhs.element.zIndex ?? 0;
        return lz === rz ? lhs.index - rhs.index : lz - rz;
      })
      .map((entry) => entry.element);

    const candidates: HitCandidate[] = [];
    for (const node of ordered) {
      const origin: Point = { x: offset.x + node.x, y: offset.y + node.y };
      const rect = interactionRect(node, origin);
      if (!rectContainsPoint(rect, point)) continue;
      candidates.push({ node, origin, area: Math.max(0, rect.width) * Math.max(0, rect.height) });
    }
    let winner = candidates[candidates.length - 1];
    if (winner === undefined) return;

    // Topmost-wins is the default. The exception is a small LEAF under a much
    // larger sibling — a 24pt icon must stay reachable.
    const leafCandidates = candidates.filter(
      (candidate) => candidate.node.children.length === 0 && candidate.area < winner.area * 0.5,
    );
    if (leafCandidates.length > 0) {
      let preciseLeaf = leafCandidates[0];
      for (const candidate of leafCandidates.slice(1)) {
        if (candidate.area < preciseLeaf.area) preciseLeaf = candidate;
      }
      winner = preciseLeaf;
    }

    // Anything already selected keeps the hit, so a drag never jumps.
    if (selectedNodeId !== undefined) {
      const stillUnderCursor = candidates.find((candidate) => candidate.node.id === selectedNodeId);
      if (stillUnderCursor) winner = stillUnderCursor;
    }

    chain.push(winner.node.id);
    walk(winner.node.children, winner.origin);
  };

  walk(nodes, { x: 0, y: 0 });
  return chain;
}

export function hitTestNodeIdInChain(
  chain: readonly string[],
  mode: CanvasHitMode,
  selectedNodeId: string | undefined,
): string | undefined {
  if (chain.length === 0) return undefined;

  switch (mode) {
    case 'deepest':
      return chain[chain.length - 1];

    case 'smart': {
      // Clicking inside what's already selected drills one level in — and stays
      // put once there's nothing deeper.
      if (selectedNodeId !== undefined) {
        const index = chain.indexOf(selectedNodeId);
        if (index >= 0) {
          return index + 1 < chain.length ? chain[index + 1] : chain[index];
        }
      }
      // Otherwise take the top-level element inside the screen frame.
      return chain.length > 1 ? chain[1] : chain[0];
    }
  }
}

export function isMarqueePassthroughNode(node: DesignNode): boolean {
  const lowercasedName = node.name.toLowerCase();
  return (node.zIndex ?? 0) < 0 || lowercasedName.includes('background');
}

/**
 * Marquee picks the ELEMENTS a user sees — the cards, buttons and images
 * sitting on a screen — not the leaves buried inside them.
 */
export function collectMarqueeSelectableNodes(
  nodes: readonly DesignNode[],
  parentOffset: Point,
  selectionRect: Rect,
  matches: string[],
  isScreenRoot: (node: DesignNode) => boolean,
): void {
  for (const node of nodes) {
    const origin: Point = { x: parentOffset.x + node.x, y: parentOffset.y + node.y };
    const nodeRect: Rect = { x: origin.x, y: origin.y, width: node.width, height: node.height };

    if (isScreenRoot(node)) {
      // Screens are the stage: never selected, but their direct children are
      // exactly what the marquee should catch.
      for (const child of node.children) {
        const childRect: Rect = {
          x: origin.x + child.x,
          y: origin.y + child.y,
          width: child.width,
          height: child.height,
        };
        if (rectIntersects(selectionRect, childRect) && !isMarqueePassthroughNode(child)) {
          matches.push(child.id);
        }
      }
      continue;
    }

    // Loose elements placed directly on the canvas.
    if (rectIntersects(selectionRect, nodeRect) && !isMarqueePassthroughNode(node)) {
      matches.push(node.id);
    }
  }
}
