// apps/web/src/views/logic/LogicCanvasView.tsx
//
// 1:1 port of Views/Logic/LogicCanvasView.swift.
// Interactive visual programming canvas with dot grid, translucent design UI overlay,
// smooth Bézier wires, blocks, rubber-band wire creation, pan, zoom, and palette drop.

import React, { useRef, useState, useEffect } from 'react';
import { useLogicViewModel } from '../../stores/logicStore';
import { useProjectStore } from '../../stores/projectStore';
import { CanvasNodeView } from '../canvas/CanvasNodeView';
import { ConnectionLineView } from './ConnectionLineView';
import { LogicBlockView } from './LogicBlockView';
import { BlockCatalog, BlockGeometry, type LogicBlockType, type Point } from '@agentic/core';

export function LogicCanvasView() {
  const logicViewModel = useLogicViewModel();
  const project = useProjectStore((s) => s.project);
  const currentPageIndex = useProjectStore((s) => s.currentPageIndex);

  const containerRef = useRef<HTMLDivElement>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const panStartRef = useRef<{ clientX: number; clientY: number; originW: number; originH: number } | null>(null);

  const currentPage = project.pages[currentPageIndex] ?? project.pages[0];
  const currentFlow = logicViewModel.currentFlow;

  // Track space key for panning
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.code === 'Space' && !e.repeat && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        setIsSpacePressed(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setIsSpacePressed(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && isSpacePressed)) {
      e.preventDefault();
      panStartRef.current = {
        clientX: e.clientX,
        clientY: e.clientY,
        originW: logicViewModel.canvasOffset.width,
        originH: logicViewModel.canvasOffset.height,
      };
      setIsPanning(true);

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!panStartRef.current) return;
        const dx = moveEvent.clientX - panStartRef.current.clientX;
        const dy = moveEvent.clientY - panStartRef.current.clientY;
        logicViewModel.canvasOffset = {
          width: panStartRef.current.originW + dx,
          height: panStartRef.current.originH + dy,
        };
      };

      const handleMouseUp = () => {
        setIsPanning(false);
        panStartRef.current = null;
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return;
    }

    // Click canvas background: clear selection
    if (e.target === containerRef.current || (e.target as HTMLElement).id === 'logic-canvas-viewport') {
      logicViewModel.selectedBlockId = undefined;
      logicViewModel.selectedConnectionId = undefined;
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.08 : 0.92;
      logicViewModel.canvasZoom = Math.max(0.2, Math.min(2.5, logicViewModel.canvasZoom * factor));
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const type = e.dataTransfer.getData('text/plain') as LogicBlockType;
    if (!type) return;

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const dropX = (e.clientX - rect.left - logicViewModel.canvasOffset.width) / logicViewModel.canvasZoom;
    const dropY = (e.clientY - rect.top - logicViewModel.canvasOffset.height) / logicViewModel.canvasZoom;

    logicViewModel.addBlock(type, { x: Math.round(dropX), y: Math.round(dropY) });
  };

  return (
    <div
      id="logic-canvas-viewport"
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onWheel={handleWheel}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        backgroundColor: '#18191D',
        backgroundImage: 'radial-gradient(circle, rgba(255, 255, 255, 0.08) 1px, transparent 1px)',
        backgroundSize: '24px 24px',
        cursor: isPanning ? 'grabbing' : isSpacePressed ? 'grab' : 'default',
        userSelect: 'none',
      }}
    >
      {/* 4000x4000 Virtual Logic Plane */}
      <div
        style={{
          position: 'absolute',
          left: logicViewModel.canvasOffset.width,
          top: logicViewModel.canvasOffset.height,
          width: 4000,
          height: 4000,
          transform: `scale(${logicViewModel.canvasZoom})`,
          transformOrigin: '0 0',
        }}
      >
        {/* Translucent UI Screens Reference Overlay */}
        {currentPage?.nodes && (
          <div style={{ position: 'absolute', top: 0, left: 0, opacity: 0.14, pointerEvents: 'none' }}>
            {currentPage.nodes.map((root) => (
              <CanvasNodeView
                key={root.id}
                node={root}
                parentOffset={{ x: 0, y: 0 }}
                selectedNodeId={undefined}
              />
            ))}
          </div>
        )}

        {/* SVG Connection Wires Layer */}
        <svg
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            overflow: 'visible',
            pointerEvents: 'none',
          }}
        >
          {currentFlow?.connections.map((conn) => {
            const fromBlock = currentFlow.blocks.find((b) => b.id === conn.sourceBlockId);
            const toBlock = currentFlow.blocks.find((b) => b.id === conn.targetBlockId);
            if (!fromBlock || !toBlock) return null;

            const start = BlockGeometry.outputPortPosition(fromBlock, conn.sourcePortIndex);
            const end = BlockGeometry.inputPortPosition(toBlock);
            const isSelected = logicViewModel.selectedConnectionId === conn.id;

            return (
              <ConnectionLineView
                key={conn.id}
                id={conn.id}
                startPoint={start}
                endPoint={end}
                isSelected={isSelected}
                onClick={(e) => {
                  e.stopPropagation();
                  logicViewModel.selectedConnectionId = conn.id;
                  logicViewModel.selectedBlockId = undefined;
                }}
              />
            );
          })}

          {/* Rubber-band Connection in Progress */}
          {logicViewModel.isConnecting &&
            logicViewModel.connectionDragStart &&
            logicViewModel.connectionDragEnd && (
              <ConnectionLineView
                startPoint={logicViewModel.connectionDragStart}
                endPoint={logicViewModel.connectionDragEnd}
                color="var(--accent-primary)"
                isAnimating
              />
            )}
        </svg>

        {/* Blocks Layer */}
        {currentFlow?.blocks.map((block) => (
          <LogicBlockView key={block.id} block={block} />
        ))}
      </div>
    </div>
  );
}

export default LogicCanvasView;
