// apps/web/src/views/canvas/CanvasNodeView.tsx
//
// 1:1 port of Views/CanvasNodeView.swift.
// Recursively renders a node and its children in absolute canvas/parent coordinates.

import React from 'react';
import type { DesignNode, Point } from '@agentic/core';
import NodeView from './NodeView';

export interface CanvasNodeViewProps {
  node: DesignNode;
  parentOffset?: Point;
  selectedNodeId?: string;
}

export function CanvasNodeView({
  node,
  parentOffset = { x: 0, y: 0 },
  selectedNodeId,
}: CanvasNodeViewProps) {
  const globalX = parentOffset.x + node.x;
  const globalY = parentOffset.y + node.y;

  const sortedChildren = [...node.children].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
  const isSelected = selectedNodeId === node.id;

  return (
    <div
      style={{
        position: 'absolute',
        left: globalX,
        top: globalY,
        width: node.width,
        height: node.height,
        zIndex: node.zIndex ?? 0,
        pointerEvents: 'none',
      }}
    >
      {/* Node representation itself */}
      <NodeView node={node} isSelected={isSelected} />

      {/* Children container */}
      {sortedChildren.length > 0 && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            overflow: node.clipContent || node.scrollBehavior ? 'hidden' : 'visible',
            borderRadius: node.style.cornerRadius ?? 0,
            pointerEvents: 'none',
          }}
        >
          {sortedChildren.map((child) => (
            <CanvasNodeView
              key={child.id}
              node={child}
              parentOffset={{ x: 0, y: 0 }}
              selectedNodeId={selectedNodeId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default CanvasNodeView;
