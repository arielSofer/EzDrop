// apps/web/src/views/sidebar/LayersPanel.tsx
//
// 1:1 port of Views/LayersPanel.swift.
// Displays pages selector tabs and hierarchical layer tree with drag-to-reparent,
// contextual alignment, and auto-sizing tools.

import React, { useState } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { SFSymbol } from '../../components/SFSymbol';
import type { DesignNode, NodeType } from '@agentic/core';
import type { CanvasStudioAlignment } from '../../stores/project/types';

export function LayersPanel() {
  const project = useProjectStore((s) => s.project);
  const currentPageIndex = useProjectStore((s) => s.currentPageIndex);
  const selectPage = useProjectStore((s) => s.selectPage);
  const addPage = useProjectStore((s) => s.addPage);
  const deletePage = useProjectStore((s) => s.deletePage);
  const selectedNodeId = useProjectStore((s) => s.selectedNodeId);
  const selectNode = useProjectStore((s) => s.selectNode);
  const selectAndRevealNode = useProjectStore((s) => s.selectAndRevealNode);
  const reparentNode = useProjectStore((s) => s.reparentNode);
  const canReparentNode = useProjectStore((s) => s.canReparentNode);
  const alignChildren = useProjectStore((s) => s.alignChildren);
  const distributeChildren = useProjectStore((s) => s.distributeChildren);
  const fitTextNodeToContent = useProjectStore((s) => s.fitTextNodeToContent);
  const fitTextNodesToContent = useProjectStore((s) => s.fitTextNodesToContent);

  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
  const [activeDropTargetId, setActiveDropTargetId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; node: DesignNode } | null>(null);

  const currentPage = project.pages[currentPageIndex] ?? project.pages[0];

  const handleDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
    setDraggedNodeId(id);
    selectNode(id);
  };

  const handleDragOver = (e: React.DragEvent, targetId: string) => {
    if (!draggedNodeId) return;
    if (canReparentNode(draggedNodeId, targetId)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (activeDropTargetId !== targetId) {
        setActiveDropTargetId(targetId);
      }
    }
  };

  const handleDragLeave = (e: React.DragEvent, targetId: string) => {
    if (activeDropTargetId === targetId) {
      setActiveDropTargetId(null);
    }
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const draggedId = e.dataTransfer.getData('text/plain') || draggedNodeId;
    if (draggedId && canReparentNode(draggedId, targetId)) {
      reparentNode(draggedId, targetId);
    }
    setDraggedNodeId(null);
    setActiveDropTargetId(null);
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: 240,
        height: '100%',
        backgroundColor: 'var(--bg-panel)',
        borderRight: '1px solid var(--border-subtle)',
        userSelect: 'none',
        overflow: 'hidden',
      }}
    >
      {/* Page Tabs */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          height: 44,
          padding: '0 8px',
          backgroundColor: 'var(--bg-app)',
          borderBottom: '1px solid var(--border-subtle)',
          overflowX: 'auto',
          gap: 6,
        }}
      >
        {project.pages.map((page, idx) => {
          const isCurrent = currentPageIndex === idx;
          return (
            <button
              key={page.id ?? idx}
              type="button"
              onClick={() => selectPage(idx)}
              onContextMenu={(e) => {
                e.preventDefault();
                if (project.pages.length > 1) {
                  if (confirm(`Delete page "${page.name}"?`)) {
                    deletePage(idx);
                  }
                }
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '4px 10px',
                borderRadius: 6,
                fontSize: 11,
                fontWeight: isCurrent ? 600 : 400,
                color: isCurrent ? 'var(--accent-primary)' : 'var(--text-secondary)',
                backgroundColor: isCurrent ? 'rgba(79, 70, 229, 0.15)' : 'transparent',
                border: isCurrent ? '1px solid rgba(79, 70, 229, 0.4)' : '1px solid rgba(255, 255, 255, 0.08)',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all 0.15s ease',
              }}
            >
              {page.name}
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => addPage()}
          title="Add Page"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 24,
            height: 24,
            borderRadius: 6,
            backgroundColor: 'rgba(255, 255, 255, 0.05)',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <SFSymbol name="plus" size={12} />
        </button>
      </div>

      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 14px 8px',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Layers
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {currentPage?.nodes?.length ?? 0} roots
        </span>
      </div>

      {/* Layer Tree */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '6px 4px',
        }}
        onClick={() => setContextMenu(null)}
      >
        {currentPage?.nodes?.map((node) => (
          <LayerTreeRow
            key={node.id}
            node={node}
            depth={0}
            selectedNodeId={selectedNodeId}
            activeDropTargetId={activeDropTargetId}
            onSelect={(id) => selectAndRevealNode(id)}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onContextMenu={(e, n) => {
              e.preventDefault();
              setContextMenu({ x: e.clientX, y: e.clientY, node: n });
            }}
          />
        ))}
      </div>

      {/* Custom Context Menu */}
      {contextMenu && (
        <div
          style={{
            position: 'fixed',
            top: contextMenu.y,
            left: contextMenu.x,
            backgroundColor: '#25272D',
            border: '1px solid var(--border-subtle)',
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            padding: 4,
            zIndex: 9999,
            minWidth: 160,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.node.type === 'Text' && (
            <button
              type="button"
              onClick={() => {
                fitTextNodeToContent(contextMenu.node.id);
                setContextMenu(null);
              }}
              style={contextMenuItemStyle}
            >
              Fit Box to Text
            </button>
          )}

          {contextMenu.node.children.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => {
                  fitTextNodesToContent(contextMenu.node.id);
                  setContextMenu(null);
                }}
                style={contextMenuItemStyle}
              >
                Fit All Text Inside
              </button>
              <div style={{ height: 1, backgroundColor: 'var(--border-subtle)', margin: '4px 0' }} />
              <div style={{ padding: '3px 8px', fontSize: 10, color: 'var(--text-muted)' }}>
                Align {contextMenu.node.children.length} Children
              </div>
              {(['left', 'center', 'right', 'top', 'middle', 'bottom'] as CanvasStudioAlignment[]).map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => {
                    alignChildren(contextMenu.node.id, a);
                    setContextMenu(null);
                  }}
                  style={contextMenuItemStyle}
                >
                  Align {a.charAt(0).toUpperCase() + a.slice(1)}
                </button>
              ))}

              {contextMenu.node.children.length > 1 && (
                <>
                  <div style={{ height: 1, backgroundColor: 'var(--border-subtle)', margin: '4px 0' }} />
                  <button
                    type="button"
                    onClick={() => {
                      distributeChildren(contextMenu.node.id, 'horizontal');
                      setContextMenu(null);
                    }}
                    style={contextMenuItemStyle}
                  >
                    Distribute Horizontally
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      distributeChildren(contextMenu.node.id, 'vertical');
                      setContextMenu(null);
                    }}
                    style={contextMenuItemStyle}
                  >
                    Distribute Vertically
                  </button>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

interface LayerTreeRowProps {
  node: DesignNode;
  depth: number;
  selectedNodeId: string | undefined;
  activeDropTargetId: string | null;
  onSelect: (id: string) => void;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onDragOver: (e: React.DragEvent, targetId: string) => void;
  onDragLeave: (e: React.DragEvent, targetId: string) => void;
  onDrop: (e: React.DragEvent, targetId: string) => void;
  onContextMenu: (e: React.MouseEvent, node: DesignNode) => void;
}

function LayerTreeRow({
  node,
  depth,
  selectedNodeId,
  activeDropTargetId,
  onSelect,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onContextMenu,
}: LayerTreeRowProps) {
  const isSelected = selectedNodeId === node.id;
  const isDropTarget = activeDropTargetId === node.id;

  const iconForType = (type: NodeType): string => {
    switch (type) {
      case 'Frame':
        return 'rectangle';
      case 'Text':
        return 'textformat';
      case 'Rectangle':
        return 'square';
      case 'Button':
        return 'capsule';
      case 'Input':
        return 'text.rectangle';
      case 'Image':
        return 'photo.fill';
      case 'Icon':
        return 'star.fill';
      default:
        return 'square';
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div
        draggable
        onDragStart={(e) => onDragStart(e, node.id)}
        onDragOver={(e) => onDragOver(e, node.id)}
        onDragLeave={(e) => onDragLeave(e, node.id)}
        onDrop={(e) => onDrop(e, node.id)}
        onClick={() => onSelect(node.id)}
        onContextMenu={(e) => onContextMenu(e, node)}
        style={{
          display: 'flex',
          alignItems: 'center',
          paddingLeft: depth * 14 + 8,
          paddingRight: 8,
          paddingTop: 5,
          paddingBottom: 5,
          borderRadius: 6,
          backgroundColor: isDropTarget
            ? 'rgba(79, 70, 229, 0.25)'
            : isSelected
            ? 'rgba(79, 70, 229, 0.18)'
            : 'transparent',
          border: isDropTarget
            ? '1px solid var(--accent-primary)'
            : isSelected
            ? '1px solid rgba(79, 70, 229, 0.4)'
            : '1px solid transparent',
          cursor: 'pointer',
          gap: 6,
          transition: 'background-color 0.1s ease',
        }}
      >
        <SFSymbol
          name={iconForType(node.type)}
          size={14}
          color={isSelected ? 'var(--accent-primary)' : 'var(--text-muted)'}
        />
        <span
          style={{
            fontSize: 12,
            color: isSelected ? '#FFFFFF' : 'var(--text-secondary)',
            fontWeight: isSelected ? 500 : 400,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
          }}
        >
          {node.name}
        </span>
      </div>

      {node.children && node.children.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {node.children.map((child) => (
            <LayerTreeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedNodeId={selectedNodeId}
              activeDropTargetId={activeDropTargetId}
              onSelect={onSelect}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const contextMenuItemStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: '6px 10px',
  fontSize: 11,
  color: 'var(--text-primary)',
  backgroundColor: 'transparent',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
};

export default LayersPanel;
