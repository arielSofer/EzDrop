// apps/web/src/views/logic/ConnectionLineView.tsx
//
// 1:1 port of Views/Logic/ConnectionLineView.swift.
// Smooth cubic Bézier wire connecting block output ports to input ports,
// with selection highlight, glow shadow, and animated pulse when active.

import React from 'react';
import type { Point } from '@agentic/core';

export interface ConnectionLineViewProps {
  id?: string;
  startPoint: Point;
  endPoint: Point;
  color?: string;
  isSelected?: boolean;
  isAnimating?: boolean;
  onClick?: (e: React.MouseEvent) => void;
}

export function ConnectionLineView({
  id,
  startPoint,
  endPoint,
  color = '#4F46E5',
  isSelected = false,
  isAnimating = false,
  onClick,
}: ConnectionLineViewProps) {
  const controlOffset = Math.max(24, Math.abs(endPoint.y - startPoint.y) * 0.5);
  const cp1 = { x: startPoint.x, y: startPoint.y + controlOffset };
  const cp2 = { x: endPoint.x, y: endPoint.y - controlOffset };

  const d = `M ${startPoint.x} ${startPoint.y} C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${endPoint.x} ${endPoint.y}`;

  return (
    <g id={id ? `logic-wire-${id}` : undefined} onClick={onClick} style={{ cursor: 'pointer' }}>
      {/* Invisible wider stroke for easier clicking / hit-testing */}
      <path
        d={d}
        fill="none"
        stroke="transparent"
        strokeWidth={16}
        pointerEvents="stroke"
      />

      {/* Outer glow when selected or executing */}
      {isSelected && (
        <path
          d={d}
          fill="none"
          stroke={color}
          strokeWidth={6}
          strokeOpacity={0.4}
          pointerEvents="none"
        />
      )}

      {/* Main wire */}
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={isSelected ? 3 : 2}
        strokeLinecap="round"
        strokeDasharray={isAnimating ? '8,4' : undefined}
        pointerEvents="none"
      />
    </g>
  );
}

export default ConnectionLineView;
