// apps/web/src/views/canvas/GuidesOverlay.tsx
//
// 1:1 port of Views/GuidesOverlay.swift.
// Renders dynamic snap lines (verticalX and horizontalY) during element dragging.

import React from 'react';
import type { SnapGuides } from '@agentic/core';

export interface GuidesOverlayProps {
  guides: SnapGuides;
  canvasWidth?: number;
  canvasHeight?: number;
}

export function GuidesOverlay({
  guides,
  canvasWidth = 4000,
  canvasHeight = 4000,
}: GuidesOverlayProps) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 900,
      }}
    >
      {guides.verticalX !== undefined && (
        <div
          style={{
            position: 'absolute',
            left: guides.verticalX,
            top: 0,
            width: 1,
            height: canvasHeight,
            backgroundColor: 'var(--accent-blue)',
            boxShadow: '0 0 4px var(--accent-blue)',
          }}
        />
      )}
      {guides.horizontalY !== undefined && (
        <div
          style={{
            position: 'absolute',
            top: guides.horizontalY,
            left: 0,
            width: canvasWidth,
            height: 1,
            backgroundColor: 'var(--accent-blue)',
            boxShadow: '0 0 4px var(--accent-blue)',
          }}
        />
      )}
    </div>
  );
}

export default GuidesOverlay;
