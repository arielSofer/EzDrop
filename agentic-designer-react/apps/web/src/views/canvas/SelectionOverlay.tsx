// apps/web/src/views/canvas/SelectionOverlay.tsx
//
// 1:1 port of Views/SelectionOverlay.swift.
// Active selection bounding box with 8 resize handles.

import React from 'react';
import type { Rect } from '@agentic/core';

export type ResizeHandle =
  | 'topLeft'
  | 'top'
  | 'topRight'
  | 'left'
  | 'right'
  | 'bottomLeft'
  | 'bottom'
  | 'bottomRight';

export interface SelectionOverlayProps {
  rect: Rect;
  zoomScale?: number;
  onResizeStart?: (handle: ResizeHandle, e: React.MouseEvent) => void;
}

export function SelectionOverlay({ rect, zoomScale = 1 }: SelectionOverlayProps) {
  const handles: { handle: ResizeHandle; x: number; y: number; cursor: string }[] = [
    { handle: 'topLeft', x: rect.x, y: rect.y, cursor: 'nwse-resize' },
    { handle: 'top', x: rect.x + rect.width / 2, y: rect.y, cursor: 'ns-resize' },
    { handle: 'topRight', x: rect.x + rect.width, y: rect.y, cursor: 'nesw-resize' },
    { handle: 'right', x: rect.x + rect.width, y: rect.y + rect.height / 2, cursor: 'ew-resize' },
    { handle: 'bottomRight', x: rect.x + rect.width, y: rect.y + rect.height, cursor: 'nwse-resize' },
    { handle: 'bottom', x: rect.x + rect.width / 2, y: rect.y + rect.height, cursor: 'ns-resize' },
    { handle: 'bottomLeft', x: rect.x, y: rect.y + rect.height, cursor: 'nesw-resize' },
    { handle: 'left', x: rect.x, y: rect.y + rect.height / 2, cursor: 'ew-resize' },
  ];

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: 0,
        height: 0,
        zIndex: 1000,
        pointerEvents: 'none',
      }}
    >
      {/* Primary selection border */}
      <div
        style={{
          position: 'absolute',
          left: rect.x,
          top: rect.y,
          width: rect.width,
          height: rect.height,
          border: '1.5px solid var(--border-focus)',
          boxSizing: 'border-box',
          pointerEvents: 'none',
        }}
      />

      {/* 8 resize handles */}
      {handles.map(({ handle, x, y, cursor }) => (
        <div
          key={handle}
          data-resize-handle={handle}
          style={{
            position: 'absolute',
            left: x - 10 / zoomScale,
            top: y - 10 / zoomScale,
            width: 20 / zoomScale,
            height: 20 / zoomScale,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor,
            pointerEvents: 'auto',
          }}
        >
          <div
            style={{
              width: 8 / zoomScale,
              height: 8 / zoomScale,
              backgroundColor: '#FFFFFF',
              border: '1.5px solid var(--border-focus)',
              borderRadius: 1,
              boxShadow: '0 1px 3px rgba(0,0,0,0.35)',
            }}
          />
        </div>
      ))}
    </div>
  );
}

export default SelectionOverlay;
