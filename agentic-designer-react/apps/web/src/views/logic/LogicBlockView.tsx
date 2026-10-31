// apps/web/src/views/logic/LogicBlockView.tsx
//
// 1:1 port of Views/Logic/LogicBlockView.swift.
// Visual card representation of a single logic block on the canvas:
// colored category header, parameter rows, input port at top, output ports at bottom,
// drag-to-move, and drag-from-port to connect wires.

import React, { useRef, useState } from 'react';
import { useLogicViewModel } from '../../stores/logicStore';
import { SFSymbol } from '../../components/SFSymbol';
import { BlockCatalog, BlockGeometry } from '@agentic/core';
import type { LogicBlock, Point } from '@agentic/core';

export interface LogicBlockViewProps {
  block: LogicBlock;
}

export function LogicBlockView({ block }: LogicBlockViewProps) {
  const logicViewModel = useLogicViewModel();
  const definition = BlockCatalog.definition(block.type);
  const categoryColor = definition?.color ?? '#6B7280';

  const isSelected = logicViewModel.selectedBlockId === block.id;
  const isExecuting = logicViewModel.simActiveBlockId === block.id;
  const hasError = logicViewModel.hasIssue(block.id);

  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ clientX: number; clientY: number; blockX: number; blockY: number } | null>(null);

  const height = BlockGeometry.height(block);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();

    logicViewModel.selectedBlockId = block.id;
    logicViewModel.selectedConnectionId = undefined;

    dragStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      blockX: block.x,
      blockY: block.y,
    };
    setIsDragging(true);

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!dragStartRef.current) return;
      const dx = (moveEvent.clientX - dragStartRef.current.clientX) / logicViewModel.canvasZoom;
      const dy = (moveEvent.clientY - dragStartRef.current.clientY) / logicViewModel.canvasZoom;
      logicViewModel.moveBlock(block.id, {
        x: Math.round(dragStartRef.current.blockX + dx),
        y: Math.round(dragStartRef.current.blockY + dy),
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      dragStartRef.current = null;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const handlePortMouseDown = (e: React.MouseEvent, portIndex: number) => {
    e.stopPropagation();
    const portPos = BlockGeometry.outputPortPosition(block, portIndex);
    logicViewModel.beginConnectionDrag(block.id, portIndex, portPos);

    const handlePortMouseMove = (moveEvent: MouseEvent) => {
      const canvasEl = document.getElementById('logic-canvas-viewport');
      if (!canvasEl) return;
      const rect = canvasEl.getBoundingClientRect();
      const pt: Point = {
        x: (moveEvent.clientX - rect.left - logicViewModel.canvasOffset.width) / logicViewModel.canvasZoom,
        y: (moveEvent.clientY - rect.top - logicViewModel.canvasOffset.height) / logicViewModel.canvasZoom,
      };
      logicViewModel.updateConnectionDrag(pt);
    };

    const handlePortMouseUp = (upEvent: MouseEvent) => {
      const canvasEl = document.getElementById('logic-canvas-viewport');
      if (canvasEl) {
        const rect = canvasEl.getBoundingClientRect();
        const pt: Point = {
          x: (upEvent.clientX - rect.left - logicViewModel.canvasOffset.width) / logicViewModel.canvasZoom,
          y: (upEvent.clientY - rect.top - logicViewModel.canvasOffset.height) / logicViewModel.canvasZoom,
        };
        logicViewModel.endConnectionDrag(pt);
      } else {
        logicViewModel.isConnecting = false;
        logicViewModel.connectionDragStart = undefined;
        logicViewModel.connectionDragEnd = undefined;
      }
      window.removeEventListener('mousemove', handlePortMouseMove);
      window.removeEventListener('mouseup', handlePortMouseUp);
    };

    window.addEventListener('mousemove', handlePortMouseMove);
    window.addEventListener('mouseup', handlePortMouseUp);
  };

  const handleInputPortMouseUp = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (logicViewModel.isConnecting && logicViewModel.connectionSourceBlockId) {
      logicViewModel.endConnectionDrag(BlockGeometry.inputPortPosition(block));
    }
  };

  const borderColor = isExecuting
    ? '#10B981'
    : hasError
    ? '#EF4444'
    : isSelected
    ? categoryColor
    : 'rgba(255, 255, 255, 0.12)';

  const outputLabels = definition?.outputPortLabels ?? [];
  const outputCount = definition?.outputPortCount ?? 1;

  return (
    <div
      id={`logic-block-${block.id}`}
      onMouseDown={handleMouseDown}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      style={{
        position: 'absolute',
        left: block.x,
        top: block.y,
        width: block.width,
        height,
        backgroundColor: '#25272D',
        borderRadius: 10,
        border: `2px solid ${borderColor}`,
        boxShadow: isExecuting
          ? '0 0 20px rgba(16, 185, 129, 0.6)'
          : isSelected
          ? '0 8px 24px rgba(0, 0, 0, 0.5)'
          : '0 4px 12px rgba(0, 0, 0, 0.25)',
        cursor: isDragging ? 'grabbing' : 'grab',
        userSelect: 'none',
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
        zIndex: isSelected ? 100 : 10,
      }}
    >
      {/* Input Port Circle at Top */}
      {(definition?.inputPortCount ?? 0) > 0 && (
        <div
          onMouseUp={handleInputPortMouseUp}
          title="Input connection port"
          style={{
            position: 'absolute',
            top: -7,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 14,
            height: 14,
            borderRadius: '50%',
            backgroundColor: '#1E1F23',
            border: '2px solid #94A3B8',
            cursor: 'pointer',
            zIndex: 10,
          }}
        />
      )}

      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '0 10px',
          height: BlockGeometry.headerHeight,
          backgroundColor: categoryColor,
          borderTopLeftRadius: 8,
          borderTopRightRadius: 8,
          color: '#FFFFFF',
        }}
      >
        <SFSymbol name={definition?.icon ?? 'square'} size={13} color="#FFFFFF" />
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
          }}
        >
          {block.label}
        </span>

        {/* Collapse toggle */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            logicViewModel.toggleCollapsed(block.id);
          }}
          style={{
            background: 'none',
            border: 'none',
            color: 'rgba(255, 255, 255, 0.8)',
            cursor: 'pointer',
            padding: 2,
            display: 'flex',
          }}
        >
          <SFSymbol name={block.isCollapsed ? 'chevron.right' : 'chevron.down'} size={10} color="#FFFFFF" />
        </button>
      </div>

      {/* Parameters & Content (when expanded) */}
      {!block.isCollapsed && (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: '4px 8px', gap: 4 }}>
          {block.parameters.map((param) => (
            <div
              key={param.key}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                height: BlockGeometry.paramRowHeight - 4,
                fontSize: 11,
              }}
            >
              <span style={{ color: 'var(--text-muted)' }}>{param.label}</span>
              <span
                style={{
                  color: 'var(--text-secondary)',
                  fontWeight: 500,
                  maxWidth: 120,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {param.variableReference ? `{{${param.variableReference}}}` : String(param.value ?? '—')}
              </span>
            </div>
          ))}

          {outputLabels.length > 0 && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-around',
                marginTop: 'auto',
                paddingBottom: 4,
                fontSize: 9,
                color: 'var(--text-muted)',
              }}
            >
              {outputLabels.map((lbl, idx) => (
                <span key={idx}>{lbl}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Output Port Circles at Bottom */}
      <div
        style={{
          position: 'absolute',
          bottom: -7,
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: outputCount === 1 ? 'center' : 'space-around',
          pointerEvents: 'none',
        }}
      >
        {Array.from({ length: outputCount }).map((_, idx) => (
          <div
            key={idx}
            onMouseDown={(e) => handlePortMouseDown(e, idx)}
            title="Drag from this port to connect to another block"
            style={{
              width: 14,
              height: 14,
              borderRadius: '50%',
              backgroundColor: '#1E1F23',
              border: `2px solid ${categoryColor}`,
              cursor: 'crosshair',
              pointerEvents: 'auto',
              transition: 'transform 0.1s ease',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.2)')}
            onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
          />
        ))}
      </div>
    </div>
  );
}

export default LogicBlockView;
