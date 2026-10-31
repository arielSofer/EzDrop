// Ported 1:1 from AgenticDesigner/ViewModels/ProjectViewModel.swift — the
// private node-tree helpers (findNode, findGlobalRect, updateNode, removeNode,
// addChildNode, deleteNode, parentNode, containsNode, firstFrameNodeId,
// allZIndexes, markManuallyPositioned, duplicateNode, assignFreshIds).
//
// Swift's arrays are value types; here every function takes the live array and
// mutates it in place (inside an immer draft), matching `inout [DesignNode]`.

import { newUUID, type DesignNode, type Point, type Rect } from '@agentic/core';

// מחפש Node לפי id בתוך עץ של Nodes
export function findNode(id: string, nodes: readonly DesignNode[]): DesignNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findNode(id, node.children);
    if (found) return found;
  }
  return undefined;
}

// מחפש את המסגרת הגלובלית של Node לפי id
export function findGlobalRect(id: string, nodes: readonly DesignNode[], parentOffset: Point): Rect | undefined {
  for (const node of nodes) {
    const globalX = parentOffset.x + node.x;
    const globalY = parentOffset.y + node.y;

    if (node.id === id) {
      return { x: globalX, y: globalY, width: node.width, height: node.height };
    }

    const found = findGlobalRect(id, node.children, { x: globalX, y: globalY });
    if (found) return found;
  }
  return undefined;
}

// מעדכן Node לפי id בתוך עץ של Nodes
export function updateNode(id: string, nodes: DesignNode[], update: (node: DesignNode) => void): boolean {
  for (const node of nodes) {
    if (node.id === id) {
      update(node);
      return true;
    }
    if (updateNode(id, node.children, update)) return true;
  }
  return false;
}

export function removeNode(id: string, nodes: DesignNode[]): DesignNode | undefined {
  const index = nodes.findIndex((node) => node.id === id);
  if (index >= 0) return nodes.splice(index, 1)[0];

  for (const node of nodes) {
    const removed = removeNode(id, node.children);
    if (removed) return removed;
  }
  return undefined;
}

// מוסיף Node חדש לתוך children של Parent לפי id
export function addChildNode(child: DesignNode, parentId: string, nodes: DesignNode[]): boolean {
  for (const node of nodes) {
    if (node.id === parentId) {
      node.children.push(child);
      return true;
    }
    if (addChildNode(child, parentId, node.children)) return true;
  }
  return false;
}

// מוחק Node לפי id מתוך עץ של Nodes
export function deleteNode(id: string, nodes: DesignNode[]): boolean {
  const index = nodes.findIndex((node) => node.id === id);
  if (index >= 0) {
    nodes.splice(index, 1);
    return true;
  }
  for (const node of nodes) {
    if (deleteNode(id, node.children)) return true;
  }
  return false;
}

export function parentNode(id: string, nodes: readonly DesignNode[]): DesignNode | undefined {
  for (const node of nodes) {
    if (node.children.some((child) => child.id === id)) return node;
    const found = parentNode(id, node.children);
    if (found) return found;
  }
  return undefined;
}

export function containsNode(id: string, nodes: readonly DesignNode[]): boolean {
  return findNode(id, nodes) !== undefined;
}

export function firstFrameNodeId(nodes: readonly DesignNode[]): string | undefined {
  for (const node of nodes) {
    if (node.type === 'Frame') return node.id;
    const frameId = firstFrameNodeId(node.children);
    if (frameId) return frameId;
  }
  return undefined;
}

export function allZIndexes(nodes: readonly DesignNode[]): number[] {
  return nodes.flatMap((node) => [node.zIndex ?? 0, ...allZIndexes(node.children)]);
}

export function markManuallyPositioned(ids: ReadonlySet<string>, nodes: DesignNode[]): void {
  for (const node of nodes) {
    if (ids.has(node.id)) node.manuallyPositioned = true;
    if (node.children.length > 0) markManuallyPositioned(ids, node.children);
  }
}

export function assignFreshIds(node: DesignNode): void {
  node.id = newUUID();
  for (const child of node.children) assignFreshIds(child);
}

/** Deep copy of a node subtree — Swift gets this for free from value semantics. */
export function cloneNode(node: DesignNode): DesignNode {
  return JSON.parse(JSON.stringify(node)) as DesignNode;
}

export function duplicateNode(id: string, nodes: DesignNode[]): string | undefined {
  const index = nodes.findIndex((node) => node.id === id);
  if (index >= 0) {
    const duplicate = cloneNode(nodes[index]);
    assignFreshIds(duplicate);
    duplicate.name += ' Copy';
    duplicate.x += 24;
    duplicate.y += 24;
    duplicate.manuallyPositioned = true;
    nodes.splice(index + 1, 0, duplicate);
    return duplicate.id;
  }

  for (const node of nodes) {
    const newId = duplicateNode(id, node.children);
    if (newId) return newId;
  }
  return undefined;
}
