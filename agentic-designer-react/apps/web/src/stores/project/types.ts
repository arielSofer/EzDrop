// Ported 1:1 from AgenticDesigner/ViewModels/ProjectViewModel.swift
// (CanvasFocusRequest, CanvasHitMode, CanvasStudioAlignment,
// CanvasStudioDistributionAxis) and Views/SelectionOverlay.swift (ResizeHandle).

import { newUUID } from '@agentic/core';

export interface CanvasFocusRequest {
  nodeId: string;
  /** `let requestId = UUID()` — fresh per request, so the same node can be revealed twice. */
  requestId: string;
}

export function makeCanvasFocusRequest(nodeId: string): CanvasFocusRequest {
  return { nodeId, requestId: newUUID() };
}

/**
 * `ProjectViewModel.CanvasHitMode`
 * - `smart`: Figma-style — select the outermost element, then drill in on repeat clicks.
 * - `deepest`: straight to the innermost leaf (⌘/⌥-click).
 */
export const AllCanvasHitMode = ['smart', 'deepest'] as const;
export type CanvasHitMode = (typeof AllCanvasHitMode)[number];
export const CanvasHitMode = { smart: 'smart', deepest: 'deepest' } as const;

export const AllCanvasStudioAlignment = ['left', 'center', 'right', 'top', 'middle', 'bottom'] as const;
export type CanvasStudioAlignment = (typeof AllCanvasStudioAlignment)[number];
export const CanvasStudioAlignment = {
  left: 'left',
  center: 'center',
  right: 'right',
  top: 'top',
  middle: 'middle',
  bottom: 'bottom',
} as const;

export const AllCanvasStudioDistributionAxis = ['horizontal', 'vertical'] as const;
export type CanvasStudioDistributionAxis = (typeof AllCanvasStudioDistributionAxis)[number];
export const CanvasStudioDistributionAxis = { horizontal: 'horizontal', vertical: 'vertical' } as const;

/** `Views/SelectionOverlay.swift` — the 8 resize handles and their geometry. */
export const AllResizeHandle = [
  'topLeft',
  'top',
  'topRight',
  'left',
  'right',
  'bottom',
  'bottomLeft',
  'bottomRight',
] as const;
export type ResizeHandle = (typeof AllResizeHandle)[number];
export const ResizeHandle = {
  topLeft: 'topLeft',
  top: 'top',
  topRight: 'topRight',
  left: 'left',
  right: 'right',
  bottom: 'bottom',
  bottomLeft: 'bottomLeft',
  bottomRight: 'bottomRight',
} as const;

export function resizeHandleAffectsHorizontally(handle: ResizeHandle): boolean {
  switch (handle) {
    case 'top':
    case 'bottom':
      return false;
    default:
      return true;
  }
}

export function resizeHandleAffectsVertically(handle: ResizeHandle): boolean {
  switch (handle) {
    case 'left':
    case 'right':
      return false;
    default:
      return true;
  }
}

/** +1 when dragging right grows the box, -1 when it shrinks it. */
export function resizeHandleHorizontalSign(handle: ResizeHandle): number {
  switch (handle) {
    case 'topLeft':
    case 'left':
    case 'bottomLeft':
      return -1;
    default:
      return 1;
  }
}

export function resizeHandleVerticalSign(handle: ResizeHandle): number {
  switch (handle) {
    case 'topLeft':
    case 'top':
    case 'topRight':
      return -1;
    default:
      return 1;
  }
}

/** Dragging a left handle keeps the right edge fixed (and vice versa). */
export function resizeHandleAnchorsRight(handle: ResizeHandle): boolean {
  switch (handle) {
    case 'topLeft':
    case 'left':
    case 'bottomLeft':
      return true;
    default:
      return false;
  }
}

export function resizeHandleAnchorsBottom(handle: ResizeHandle): boolean {
  switch (handle) {
    case 'topLeft':
    case 'top':
    case 'topRight':
      return true;
    default:
      return false;
  }
}
