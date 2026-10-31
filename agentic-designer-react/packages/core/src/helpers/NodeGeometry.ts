// Ported 1:1 from AgenticDesigner/Helpers/NodeGeometry.swift

import type { DesignNode } from '../models/DesignNode';
import type { Point, Rect } from '../models/Geometry';

// כלי עזר לחישובי מיקום וגודל של DesignNode
export interface NodeGeometry {
  readonly node: DesignNode;
  // הקצה השמאלי של האובייקט
  readonly left: number;
  // הקצה העליון של האובייקט
  readonly top: number;
  // הקצה הימני של האובייקט
  readonly right: number;
  // הקצה התחתון של האובייקט
  readonly bottom: number;
  // מרכז האובייקט בציר X
  readonly centerX: number;
  // מרכז האובייקט בציר Y
  readonly centerY: number;
  // נקודת המרכז של האובייקט
  readonly center: Point;
  // המסגרת המלאה של האובייקט כ־CGRect
  readonly rect: Rect;
}

/** `NodeGeometry(node:)` — computed lazily like the Swift struct's properties. */
export function makeNodeGeometry(node: DesignNode): NodeGeometry {
  return {
    node,
    get left() { return node.x; },
    get top() { return node.y; },
    get right() { return node.x + node.width; },
    get bottom() { return node.y + node.height; },
    get centerX() { return node.x + node.width / 2; },
    get centerY() { return node.y + node.height / 2; },
    get center(): Point { return { x: node.x + node.width / 2, y: node.y + node.height / 2 }; },
    get rect(): Rect { return { x: node.x, y: node.y, width: node.width, height: node.height }; },
  };
}

// extension DesignNode { var geometry: NodeGeometry }
// מחזיר כלי עזר גיאומטרי עבור ה־Node
export function nodeGeometry(node: DesignNode): NodeGeometry {
  return makeNodeGeometry(node);
}

export function nodeLeft(node: DesignNode): number { return node.x; }
export function nodeTop(node: DesignNode): number { return node.y; }
export function nodeRight(node: DesignNode): number { return node.x + node.width; }
export function nodeBottom(node: DesignNode): number { return node.y + node.height; }
export function nodeCenterX(node: DesignNode): number { return node.x + node.width / 2; }
export function nodeCenterY(node: DesignNode): number { return node.y + node.height / 2; }
export function nodeCenter(node: DesignNode): Point { return { x: nodeCenterX(node), y: nodeCenterY(node) }; }
export function nodeRect(node: DesignNode): Rect { return { x: node.x, y: node.y, width: node.width, height: node.height }; }
