// apps/web/src/views/canvas/CanvasView.tsx
//
// 1:1 port of Views/CanvasView.swift.
// The main interactive graphics canvas: pan, zoom, recursive node rendering,
// selection, multi-selection, marquee drag, move with snap engine, and resize handles.

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useProjectStore, type GroupResizeStart } from '../../stores/projectStore';
import {
  SnapEngine,
  makeNodeStyle,
  type Point,
  type Rect,
  type SnapGuides,
  type DesignNode,
} from '@agentic/core';
import { SFSymbol } from '../../components/SFSymbol';
import CanvasNodeView from './CanvasNodeView';
import SelectionOverlay, { type ResizeHandle } from './SelectionOverlay';
import GuidesOverlay from './GuidesOverlay';
import SelectionEditBubble from './SelectionEditBubble';

export interface CanvasViewProps {
  zoomScale: number;
  onZoomChange: (scale: number) => void;
}

const CANVAS_WIDTH = 4000;
const CANVAS_HEIGHT = 4000;

interface DragState {
  mode: 'none' | 'move' | 'resize' | 'groupResize' | 'marquee' | 'pan';
  startX: number;
  startY: number;
  startPoint: Point;
  draggedNodeId?: string;
  initialPositions: Map<string, Point>;
  resizeHandle?: ResizeHandle;
  initialRect?: Rect;
  groupResize?: GroupResizeStart;
  didSnapshot: boolean;
}

export function CanvasView({ zoomScale, onZoomChange }: CanvasViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const project = useProjectStore((s) => s.project);
  const currentPageIndex = useProjectStore((s) => s.currentPageIndex);
  const selectedNodeId = useProjectStore((s) => s.selectedNodeId);
  const selectedNodeIds = useProjectStore((s) => s.selectedNodeIds);
  const selectedNode = useProjectStore((s) => s.selectedNode());
  const selectNode = useProjectStore((s) => s.selectNode);
  const toggleNodeInSelection = useProjectStore((s) => s.toggleNodeInSelection);
  const selectNodes = useProjectStore((s) => s.selectNodes);
  const clearSelection = useProjectStore((s) => s.clearSelection);
  const moveNode = useProjectStore((s) => s.moveNode);
  const resizeSelectedNode = useProjectStore((s) => s.resizeSelectedNode);
  const groupResizeStart = useProjectStore((s) => s.groupResizeStart);
  const applyGroupResize = useProjectStore((s) => s.applyGroupResize);
  const hitTestNodeId = useProjectStore((s) => s.hitTestNodeId);
  const globalRect = useProjectStore((s) => s.globalRect);
  const selectionGlobalRect = useProjectStore((s) => s.selectionGlobalRect);
  const canvasFocusRequest = useProjectStore((s) => s.canvasFocusRequest);
  const snapshot = useProjectStore((s) => s.snapshot);
  const node = useProjectStore((s) => s.node);
  const parentOfNode = useProjectStore((s) => s.parentOfNode);
  const isRootNode = useProjectStore((s) => s.isRootNode);
  const nodesExcluding = useProjectStore((s) => s.nodesExcluding);
  const clampedPositionForMove = useProjectStore((s) => s.clampedPositionForMove);
  const duplicateSelection = useProjectStore((s) => s.duplicateSelection);
  const copySelection = useProjectStore((s) => s.copySelection);
  const cutSelection = useProjectStore((s) => s.cutSelection);
  const pasteSelection = useProjectStore((s) => s.pasteSelection);
  const bringSelectionToFront = useProjectStore((s) => s.bringSelectionToFront);
  const sendSelectionToBack = useProjectStore((s) => s.sendSelectionToBack);
  const safeDeleteSelectedNode = useProjectStore((s) => s.safeDeleteSelectedNode);
  const fitTextNodeToContent = useProjectStore((s) => s.fitTextNodeToContent);

  const currentPage = project.pages[currentPageIndex] ?? project.pages[0];
  const rootNodes = currentPage
    ? [...currentPage.nodes].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
    : [];

  // Gesture state
  const [activeSnapGuides, setActiveSnapGuides] = useState<SnapGuides | null>(null);
  const [marqueeRect, setMarqueeRect] = useState<Rect | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  // Auto-scroll / pan to selected node when requested (e.g. from Layers panel)
  useEffect(() => {
    if (!canvasFocusRequest) return;
    const targetId = canvasFocusRequest.nodeId;
    const rect = globalRect(targetId);
    if (!rect || !scrollRef.current) return;

    const containerWidth = scrollRef.current.clientWidth;
    const containerHeight = scrollRef.current.clientHeight;

    const targetCenterX = (rect.x + rect.width / 2) * zoomScale;
    const targetCenterY = (rect.y + rect.height / 2) * zoomScale;

    const scrollLeft = Math.max(0, targetCenterX - containerWidth / 2);
    const scrollTop = Math.max(0, targetCenterY - containerHeight / 2);

    scrollRef.current.scrollTo({
      left: scrollLeft,
      top: scrollTop,
      behavior: 'smooth',
    });
  }, [canvasFocusRequest, globalRect, zoomScale]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.code === 'Space' && !e.repeat && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        setIsSpacePressed(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsSpacePressed(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  // Interaction tracking refs
  const dragRef = useRef<DragState>({
    mode: 'none',
    startX: 0,
    startY: 0,
    startPoint: { x: 0, y: 0 },
    initialPositions: new Map(),
    didSnapshot: false,
  });

  // Center initial canvas on mount
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = 200;
      scrollRef.current.scrollTop = 150;
    }
  }, []);

  // Convert mouse event client coordinates to canvas coordinate space
  const screenToCanvas = useCallback(
    (clientX: number, clientY: number): Point => {
      if (!containerRef.current) return { x: 0, y: 0 };
      const rect = containerRef.current.getBoundingClientRect();
      return {
        x: (clientX - rect.left) / zoomScale,
        y: (clientY - rect.top) / zoomScale,
      };
    },
    [zoomScale],
  );

  // Helper for parent center snapping (Shift-drag)
  const parentCenterSnapped = useCallback(
    (
      nodeId: string,
      proposedX: number,
      proposedY: number,
      movingHorizontally: boolean,
    ): { x: number; y: number; guides?: SnapGuides } => {
      const threshold = 8;
      const n = node(nodeId);
      const parent = parentOfNode(nodeId);
      if (!n || !parent) return { x: proposedX, y: proposedY };
      const parentRect = globalRect(parent.id);
      if (!parentRect) return { x: proposedX, y: proposedY };

      if (movingHorizontally) {
        const parentCenterX = parent.width / 2;
        if (Math.abs(proposedX + n.width / 2 - parentCenterX) < threshold) {
          return {
            x: parentCenterX - n.width / 2,
            y: proposedY,
            guides: { verticalX: parentRect.x + parentRect.width / 2 },
          };
        }
      } else {
        const parentCenterY = parent.height / 2;
        if (Math.abs(proposedY + n.height / 2 - parentCenterY) < threshold) {
          return {
            x: proposedX,
            y: parentCenterY - n.height / 2,
            guides: { horizontalY: parentRect.y + parentRect.height / 2 },
          };
        }
      }
      return { x: proposedX, y: proposedY };
    },
    [node, parentOfNode, globalRect],
  );

  const handleMouseDown = (e: React.MouseEvent) => {
    // Space + drag or middle click = Pan
    if (e.button === 1 || (e.button === 0 && isSpacePressed)) {
      e.preventDefault();
      dragRef.current = {
        mode: 'pan',
        startX: e.clientX,
        startY: e.clientY,
        startPoint: {
          x: scrollRef.current?.scrollLeft ?? 0,
          y: scrollRef.current?.scrollTop ?? 0,
        },
        initialPositions: new Map(),
        didSnapshot: false,
      };
      setIsPanning(true);
      return;
    }

    if (e.button !== 0) return;

    // Check if clicked a resize handle
    const target = e.target as HTMLElement;
    const handleEl = target.closest('[data-resize-handle]') as HTMLElement | null;
    if (handleEl) {
      const handle = handleEl.getAttribute('data-resize-handle') as ResizeHandle;
      if (selectedNodeIds.size > 1) {
        const grp = groupResizeStart();
        if (grp) {
          snapshot();
          dragRef.current = {
            mode: 'groupResize',
            startX: e.clientX,
            startY: e.clientY,
            startPoint: screenToCanvas(e.clientX, e.clientY),
            resizeHandle: handle,
            groupResize: grp,
            initialPositions: new Map(),
            didSnapshot: true,
          };
          return;
        }
      } else if (selectedNodeId) {
        const selected = node(selectedNodeId);
        if (selected) {
          snapshot();
          dragRef.current = {
            mode: 'resize',
            startX: e.clientX,
            startY: e.clientY,
            startPoint: screenToCanvas(e.clientX, e.clientY),
            resizeHandle: handle,
            initialRect: {
              x: selected.x,
              y: selected.y,
              width: selected.width,
              height: selected.height,
            },
            initialPositions: new Map(),
            didSnapshot: true,
          };
          return;
        }
      }
    }

    const canvasPt = screenToCanvas(e.clientX, e.clientY);
    const hitId = hitTestNodeId(canvasPt);

    if (hitId) {
      if (e.shiftKey) {
        toggleNodeInSelection(hitId);
      } else if (!selectedNodeIds.has(hitId)) {
        selectNode(hitId);
      }

      // Collect initial positions for selected nodes
      const targetIds =
        selectedNodeIds.has(hitId) && selectedNodeIds.size > 1
          ? Array.from(selectedNodeIds)
          : [hitId];

      const initialPositions = new Map<string, Point>();
      for (const id of targetIds) {
        const n = node(id);
        if (n) {
          initialPositions.set(id, { x: n.x, y: n.y });
        }
      }

      dragRef.current = {
        mode: 'move',
        draggedNodeId: hitId,
        startX: e.clientX,
        startY: e.clientY,
        startPoint: canvasPt,
        initialPositions,
        didSnapshot: false,
      };
    } else {
      // Clicked on empty space
      if (!e.shiftKey) clearSelection();

      dragRef.current = {
        mode: 'marquee',
        startX: e.clientX,
        startY: e.clientY,
        startPoint: canvasPt,
        initialPositions: new Map(),
        didSnapshot: false,
      };
      setMarqueeRect(null);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const canvasPt = screenToCanvas(e.clientX, e.clientY);
    const hitId = hitTestNodeId(canvasPt);
    if (hitId) {
      if (!selectedNodeIds.has(hitId)) {
        selectNode(hitId);
      }
      setContextMenu({ x: e.clientX, y: e.clientY });
    } else {
      setContextMenu(null);
    }
  };

  const handleMouseMove = useCallback(
    (e: MouseEvent | React.MouseEvent) => {
      const drag = dragRef.current;
      if (drag.mode === 'none') return;

      if (drag.mode === 'pan' && scrollRef.current) {
        const dx = e.clientX - drag.startX;
        const dy = e.clientY - drag.startY;
        scrollRef.current.scrollLeft = drag.startPoint.x - dx;
        scrollRef.current.scrollTop = drag.startPoint.y - dy;
        return;
      }

      const currentPt = screenToCanvas(e.clientX, e.clientY);
      const totalDeltaX = currentPt.x - drag.startPoint.x;
      const totalDeltaY = currentPt.y - drag.startPoint.y;

      if (drag.mode === 'move') {
        if (!drag.didSnapshot && (Math.abs(totalDeltaX) > 2 || Math.abs(totalDeltaY) > 2)) {
          snapshot();
          drag.didSnapshot = true;
        }

        if (drag.didSnapshot) {
          let deltaX = totalDeltaX;
          let deltaY = totalDeltaY;

          // Shift while dragging: constrain to dominant axis
          if (e.shiftKey) {
            if (Math.abs(deltaX) >= Math.abs(deltaY)) {
              deltaY = 0;
            } else {
              deltaX = 0;
            }
          }

          // Group drag
          if (drag.initialPositions.size > 1) {
            for (const [id, startPos] of drag.initialPositions) {
              moveNode(id, startPos.x + deltaX, startPos.y + deltaY);
            }
            setActiveSnapGuides(null);
            return;
          }

          // Single node drag
          const nodeId = drag.draggedNodeId ?? selectedNodeId;
          if (!nodeId) return;
          const startPos = drag.initialPositions.get(nodeId);
          if (!startPos) return;

          let proposedX = startPos.x + deltaX;
          let proposedY = startPos.y + deltaY;

          if (isRootNode(nodeId)) {
            const moving = node(nodeId);
            if (moving) {
              if (e.shiftKey) {
                setActiveSnapGuides(null);
                moveNode(nodeId, proposedX, proposedY);
              } else {
                const others = nodesExcluding(nodeId);
                const snap = SnapEngine.snap(moving, proposedX, proposedY, others);
                if (snap.guides.verticalX !== undefined || snap.guides.horizontalY !== undefined) {
                  setActiveSnapGuides(snap.guides);
                } else {
                  setActiveSnapGuides(null);
                }
                moveNode(nodeId, snap.x, snap.y);
              }
            }
          } else {
            // Child element inside a screen/frame
            const moving = node(nodeId);
            const parent = parentOfNode(nodeId);

            if (moving && parent) {
              const parentGlobalRect = globalRect(parent.id);

              if (e.shiftKey) {
                const snapped = parentCenterSnapped(nodeId, proposedX, proposedY, deltaY === 0);
                proposedX = snapped.x;
                proposedY = snapped.y;
                setActiveSnapGuides(snapped.guides ?? null);
              } else {
                // Snap against sibling nodes inside the frame and the frame's edges & center
                const siblings = parent.children.filter((c) => c.id !== nodeId);
                const parentBoundsNode: DesignNode = {
                  id: '__parent_bounds__',
                  type: 'Frame',
                  name: parent.name,
                  x: 0,
                  y: 0,
                  width: parent.width,
                  height: parent.height,
                  style: makeNodeStyle({ fill: '#00000000', cornerRadius: 0, opacity: 1 }),
                  children: [],
                };
                const snap = SnapEngine.snap(moving, proposedX, proposedY, [...siblings, parentBoundsNode]);
                proposedX = snap.x;
                proposedY = snap.y;

                if (parentGlobalRect) {
                  const globalGuides: SnapGuides = {};
                  if (snap.guides.verticalX !== undefined) {
                    globalGuides.verticalX = parentGlobalRect.x + snap.guides.verticalX;
                  }
                  if (snap.guides.horizontalY !== undefined) {
                    globalGuides.horizontalY = parentGlobalRect.y + snap.guides.horizontalY;
                  }
                  if (globalGuides.verticalX !== undefined || globalGuides.horizontalY !== undefined) {
                    setActiveSnapGuides(globalGuides);
                  } else {
                    setActiveSnapGuides(null);
                  }
                } else {
                  setActiveSnapGuides(null);
                }
              }
            } else {
              setActiveSnapGuides(null);
            }

            const clamped = clampedPositionForMove(nodeId, proposedX, proposedY);
            moveNode(nodeId, clamped.x, clamped.y);
          }
        }
      } else if (drag.mode === 'groupResize' && drag.resizeHandle && drag.groupResize) {
        applyGroupResize(
          drag.resizeHandle,
          { width: totalDeltaX, height: totalDeltaY },
          drag.groupResize.frames,
          drag.groupResize.bounds,
          e.shiftKey,
        );
      } else if (drag.mode === 'resize' && drag.resizeHandle && drag.initialRect) {
        const handle = drag.resizeHandle;
        const start = drag.initialRect;
        const minSize = 24;

        let newX = start.x;
        let newY = start.y;
        let newW = start.width;
        let newH = start.height;

        switch (handle) {
          case 'topLeft':
            newW = start.width - totalDeltaX;
            newH = start.height - totalDeltaY;
            if (newW >= minSize) {
              newX = start.x + totalDeltaX;
            } else {
              newW = minSize;
              newX = start.x + start.width - minSize;
            }
            if (newH >= minSize) {
              newY = start.y + totalDeltaY;
            } else {
              newH = minSize;
              newY = start.y + start.height - minSize;
            }
            break;
          case 'top':
            newH = start.height - totalDeltaY;
            if (newH >= minSize) {
              newY = start.y + totalDeltaY;
            } else {
              newH = minSize;
              newY = start.y + start.height - minSize;
            }
            break;
          case 'topRight':
            newW = Math.max(minSize, start.width + totalDeltaX);
            newH = start.height - totalDeltaY;
            if (newH >= minSize) {
              newY = start.y + totalDeltaY;
            } else {
              newH = minSize;
              newY = start.y + start.height - minSize;
            }
            break;
          case 'right':
            newW = Math.max(minSize, start.width + totalDeltaX);
            break;
          case 'bottomRight':
            newW = Math.max(minSize, start.width + totalDeltaX);
            newH = Math.max(minSize, start.height + totalDeltaY);
            break;
          case 'bottom':
            newH = Math.max(minSize, start.height + totalDeltaY);
            break;
          case 'bottomLeft':
            newW = start.width - totalDeltaX;
            newH = Math.max(minSize, start.height + totalDeltaY);
            if (newW >= minSize) {
              newX = start.x + totalDeltaX;
            } else {
              newW = minSize;
              newX = start.x + start.width - minSize;
            }
            break;
          case 'left':
            newW = start.width - totalDeltaX;
            if (newW >= minSize) {
              newX = start.x + totalDeltaX;
            } else {
              newW = minSize;
              newX = start.x + start.width - minSize;
            }
            break;
        }

        resizeSelectedNode(newX, newY, newW, newH);
      } else if (drag.mode === 'marquee') {
        const minX = Math.min(drag.startPoint.x, currentPt.x);
        const minY = Math.min(drag.startPoint.y, currentPt.y);
        const width = Math.abs(currentPt.x - drag.startPoint.x);
        const height = Math.abs(currentPt.y - drag.startPoint.y);
        const r: Rect = { x: minX, y: minY, width, height };
        setMarqueeRect(r);

        selectNodes(r, e.shiftKey);
      }
    },
    [
      screenToCanvas,
      snapshot,
      moveNode,
      selectedNodeId,
      isRootNode,
      node,
      nodesExcluding,
      parentCenterSnapped,
      clampedPositionForMove,
      applyGroupResize,
      resizeSelectedNode,
      selectNodes,
    ],
  );

  const handleMouseUp = useCallback(() => {
    dragRef.current = {
      mode: 'none',
      startX: 0,
      startY: 0,
      startPoint: { x: 0, y: 0 },
      initialPositions: new Map(),
      didSnapshot: false,
    };
    setActiveSnapGuides(null);
    setMarqueeRect(null);
    setIsPanning(false);
  }, []);

  // Global mouse listeners during active drag to prevent stutter/lost pointer events
  useEffect(() => {
    const onWindowMouseMove = (e: MouseEvent) => {
      if (dragRef.current.mode !== 'none') {
        handleMouseMove(e);
      }
    };
    const onWindowMouseUp = () => {
      if (dragRef.current.mode !== 'none') {
        handleMouseUp();
      }
    };

    window.addEventListener('mousemove', onWindowMouseMove);
    window.addEventListener('mouseup', onWindowMouseUp);
    return () => {
      window.removeEventListener('mousemove', onWindowMouseMove);
      window.removeEventListener('mouseup', onWindowMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  // Wheel zoom / trackpad pinch
  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.08 : 0.92;
      const nextZoom = Math.max(0.25, Math.min(3.0, zoomScale * factor));
      onZoomChange(nextZoom);
    }
  };

  const selectedRect = selectionGlobalRect();

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      <div
        ref={scrollRef}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onContextMenu={handleContextMenu}
        onClick={() => setContextMenu(null)}
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          overflow: 'auto',
          backgroundColor: 'rgba(255, 255, 255, 0.04)',
          cursor: isPanning ? 'grabbing' : isSpacePressed ? 'grab' : 'default',
          userSelect: 'none',
        }}
      >
        {/* Outer scroll space matching virtual canvas at zoomScale */}
        <div
          style={{
            position: 'relative',
            width: CANVAS_WIDTH * zoomScale,
            height: CANVAS_HEIGHT * zoomScale,
          }}
        >
          {/* 4000x4000 Virtual Canvas transformed 1:1 */}
          <div
            id="agentic-design-canvas"
            ref={containerRef}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: CANVAS_WIDTH,
              height: CANVAS_HEIGHT,
              transformOrigin: '0 0',
              transform: `scale(${zoomScale})`,
            }}
          >
            {/* Subtle background grid pattern */}
            <svg
              width="100%"
              height="100%"
              style={{ position: 'absolute', inset: 0, pointerEvents: 'none', opacity: 0.35 }}
            >
              <defs>
                <pattern id="canvas-grid" width="32" height="32" patternUnits="userSpaceOnUse">
                  <circle cx="16" cy="16" r="1" fill="#4B5563" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#canvas-grid)" />
            </svg>

            {/* Screen frame title headers for easy dragging & selection */}
            {rootNodes.map((node) => {
              const isSelected = selectedNodeId === node.id;
              return (
                <div
                  key={`title-${node.id}`}
                  style={{
                    position: 'absolute',
                    left: node.x,
                    top: Math.max(8, node.y - 28),
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    cursor: 'grab',
                    userSelect: 'none',
                    pointerEvents: 'auto',
                    zIndex: 900,
                  }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    if (e.button !== 0) return;
                    selectNode(node.id);
                    const canvasPt = screenToCanvas(e.clientX, e.clientY);
                    const initialPositions = new Map<string, Point>();
                    initialPositions.set(node.id, { x: node.x, y: node.y });
                    dragRef.current = {
                      mode: 'move',
                      draggedNodeId: node.id,
                      startX: e.clientX,
                      startY: e.clientY,
                      startPoint: canvasPt,
                      initialPositions,
                      didSnapshot: false,
                    };
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    selectNode(node.id);
                    setContextMenu({ x: e.clientX, y: e.clientY });
                  }}
                >
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      fontFamily: 'var(--font-sans)',
                      color: isSelected ? 'var(--accent-blue)' : 'var(--text-secondary)',
                      padding: '2px 8px',
                      borderRadius: 4,
                      backgroundColor: isSelected
                        ? 'rgba(56, 189, 248, 0.15)'
                        : 'rgba(255, 255, 255, 0.05)',
                      border: isSelected
                        ? '1px solid rgba(56, 189, 248, 0.4)'
                        : '1px solid transparent',
                      backdropFilter: 'blur(4px)',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {node.name}
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                    {Math.round(node.width)} × {Math.round(node.height)}
                  </span>
                </div>
              );
            })}

            {/* Nodes layer */}
            {rootNodes.map((node) => (
              <CanvasNodeView
                key={node.id}
                node={node}
                selectedNodeId={selectedNodeId}
              />
            ))}

            {/* Multi-selection outlines */}
            {Array.from(selectedNodeIds)
              .filter((id) => id !== selectedNodeId)
              .map((id) => {
                const rect = globalRect(id);
                if (!rect) return null;
                return (
                  <div
                    key={id}
                    style={{
                      position: 'absolute',
                      left: rect.x,
                      top: rect.y,
                      width: rect.width,
                      height: rect.height,
                      border: '1.5px solid var(--accent-blue)',
                      boxSizing: 'border-box',
                      pointerEvents: 'none',
                      zIndex: 999,
                    }}
                  />
                );
              })}

            {/* Primary Selection Overlay & Handles */}
            {selectedRect && (
              <SelectionOverlay rect={selectedRect} zoomScale={zoomScale} />
            )}

            {/* Live Snapping Guides */}
            {activeSnapGuides && <GuidesOverlay guides={activeSnapGuides} />}

            {/* Marquee Selection Rectangle */}
            {marqueeRect && (
              <div
                style={{
                  position: 'absolute',
                  left: marqueeRect.x,
                  top: marqueeRect.y,
                  width: marqueeRect.width,
                  height: marqueeRect.height,
                  backgroundColor: 'rgba(56, 189, 248, 0.12)',
                  border: '1px dashed var(--accent-blue)',
                  pointerEvents: 'none',
                  zIndex: 950,
                }}
              />
            )}
          </div>
        </div>
      </div>

      {/* Floating Quick Edit Bubble pinned to viewport bottom */}
      <SelectionEditBubble />

      {/* Floating Right-Click Context Menu */}
      {contextMenu && (
        <div
          style={{
            position: 'fixed',
            left: contextMenu.x,
            top: contextMenu.y,
            backgroundColor: 'var(--bg-secondary, #1F232B)',
            border: '1px solid var(--border-color, #374151)',
            borderRadius: 8,
            padding: '4px 0',
            boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
            zIndex: 10000,
            minWidth: 180,
            display: 'flex',
            flexDirection: 'column',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            style={contextMenuItemStyle}
            onClick={() => {
              duplicateSelection();
              setContextMenu(null);
            }}
          >
            <SFSymbol name="plus.square.on.square" size={12} />
            <span>Duplicate</span>
            <span style={contextMenuKeyStyle}>⌘D</span>
          </button>

          <button
            type="button"
            style={contextMenuItemStyle}
            onClick={() => {
              copySelection();
              setContextMenu(null);
            }}
          >
            <SFSymbol name="doc.on.doc" size={12} />
            <span>Copy</span>
            <span style={contextMenuKeyStyle}>⌘C</span>
          </button>

          <button
            type="button"
            style={contextMenuItemStyle}
            onClick={() => {
              cutSelection();
              setContextMenu(null);
            }}
          >
            <SFSymbol name="scissors" size={12} />
            <span>Cut</span>
            <span style={contextMenuKeyStyle}>⌘X</span>
          </button>

          <button
            type="button"
            style={contextMenuItemStyle}
            onClick={() => {
              pasteSelection();
              setContextMenu(null);
            }}
          >
            <SFSymbol name="clipboard" size={12} />
            <span>Paste</span>
            <span style={contextMenuKeyStyle}>⌘V</span>
          </button>

          <div style={{ height: 1, backgroundColor: 'var(--border-subtle, #374151)', margin: '4px 0' }} />

          <button
            type="button"
            style={contextMenuItemStyle}
            onClick={() => {
              bringSelectionToFront();
              setContextMenu(null);
            }}
          >
            <SFSymbol name="square.2.layers.3d.top.filled" size={12} />
            <span>Bring to Front</span>
            <span style={contextMenuKeyStyle}>⌘]</span>
          </button>

          <button
            type="button"
            style={contextMenuItemStyle}
            onClick={() => {
              sendSelectionToBack();
              setContextMenu(null);
            }}
          >
            <SFSymbol name="square.2.layers.3d.bottom.filled" size={12} />
            <span>Send to Back</span>
            <span style={contextMenuKeyStyle}>⌘[</span>
          </button>

          {selectedNode?.type === 'Text' && (
            <button
              type="button"
              style={contextMenuItemStyle}
              onClick={() => {
                fitTextNodeToContent(selectedNode.id);
                setContextMenu(null);
              }}
            >
              <SFSymbol name="arrow.down.right.and.arrow.up.left" size={12} />
              <span>Fit Box to Text</span>
            </button>
          )}

          <div style={{ height: 1, backgroundColor: 'var(--border-subtle, #374151)', margin: '4px 0' }} />

          <button
            type="button"
            style={{ ...contextMenuItemStyle, color: '#EF4444' }}
            onClick={() => {
              safeDeleteSelectedNode();
              setContextMenu(null);
            }}
          >
            <SFSymbol name="trash" size={12} color="#EF4444" />
            <span>Delete</span>
            <span style={contextMenuKeyStyle}>⌫</span>
          </button>
        </div>
      )}
    </div>
  );
}

const contextMenuItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 12px',
  backgroundColor: 'transparent',
  border: 'none',
  color: 'var(--text-primary, #F3F4F6)',
  fontSize: 12,
  cursor: 'pointer',
  textAlign: 'left',
  width: '100%',
  boxSizing: 'border-box',
};

const contextMenuKeyStyle: React.CSSProperties = {
  marginLeft: 'auto',
  fontSize: 10,
  color: 'var(--text-muted, #9CA3AF)',
  fontFamily: 'var(--font-mono, monospace)',
};

export default CanvasView;
