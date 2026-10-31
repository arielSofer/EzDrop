// apps/web/src/views/logic/BlockPaletteView.tsx
//
// 1:1 port of Views/Logic/BlockPaletteView.swift.
// Left sidebar in Logic Mode: searchable 182-block catalog organized by
// category (Events, Actions, Firebase, APIs, Navigation, Math, etc.).
// Double-click to add at canvas center, or drag-and-drop.

import React, { useState } from 'react';
import { useLogicViewModel } from '../../stores/logicStore';
import { SFSymbol } from '../../components/SFSymbol';
import {
  BlockCatalog,
  AllLogicBlockCategory,
  type LogicBlockCategory,
  type LogicBlockType,
} from '@agentic/core';

export function BlockPaletteView() {
  const logicViewModel = useLogicViewModel();
  const [searchText, setSearchText] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(['Events', 'Actions', 'Firebase', 'API / Network']),
  );

  const toggleCategory = (cat: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const handleAddBlock = (type: LogicBlockType) => {
    // Add block at center of the visible canvas
    const x = Math.round(-logicViewModel.canvasOffset.width / logicViewModel.canvasZoom + 300);
    const y = Math.round(-logicViewModel.canvasOffset.height / logicViewModel.canvasZoom + 200);
    logicViewModel.addBlock(type, { x: Math.max(50, x), y: Math.max(50, y) });
  };

  const handleDragStart = (e: React.DragEvent, type: LogicBlockType) => {
    e.dataTransfer.setData('text/plain', type);
    e.dataTransfer.effectAllowed = 'copy';
  };

  const query = searchText.trim().toLowerCase();

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
      {/* Header & Search */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          padding: '14px 12px 10px',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <SFSymbol name="square.grid.2x2" size={14} color="var(--text-secondary)" />
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Blocks ({BlockCatalog.all.length})
          </span>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 8px',
            borderRadius: 6,
            backgroundColor: 'rgba(0, 0, 0, 0.3)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <SFSymbol name="magnifyingglass" size={11} color="var(--text-muted)" />
          <input
            type="text"
            placeholder="Search blocks..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            style={{
              width: '100%',
              border: 'none',
              outline: 'none',
              backgroundColor: 'transparent',
              color: 'var(--text-primary)',
              fontSize: 11,
            }}
          />
          {searchText && (
            <button
              type="button"
              onClick={() => setSearchText('')}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}
            >
              <SFSymbol name="xmark.circle.fill" size={11} />
            </button>
          )}
        </div>
      </div>

      {/* Categories & Blocks List */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '8px 6px',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}
      >
        {AllLogicBlockCategory.map((category) => {
          const allInCategory = BlockCatalog.definitions(category);
          const filtered = query
            ? allInCategory.filter(
                (d) =>
                  d.label.toLowerCase().includes(query) ||
                  d.description.toLowerCase().includes(query) ||
                  d.category.toLowerCase().includes(query),
              )
            : allInCategory;

          if (filtered.length === 0) return null;

          const isExpanded = query ? true : expandedCategories.has(category);
          const color = BlockCatalog.color(category);

          return (
            <div key={category} style={{ display: 'flex', flexDirection: 'column' }}>
              {/* Category Header */}
              <button
                type="button"
                onClick={() => toggleCategory(category)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '6px 8px',
                  borderRadius: 6,
                  backgroundColor: 'transparent',
                  border: 'none',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                  transition: 'background-color 0.1s ease',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.03)')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      backgroundColor: color,
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ fontSize: 11, fontWeight: 600 }}>{category}</span>
                  <span
                    style={{
                      fontSize: 9,
                      padding: '1px 5px',
                      borderRadius: 10,
                      backgroundColor: 'rgba(255, 255, 255, 0.06)',
                      color: 'var(--text-muted)',
                    }}
                  >
                    {filtered.length}
                  </span>
                </div>

                <SFSymbol
                  name={isExpanded ? 'chevron.down' : 'chevron.right'}
                  size={10}
                  color="var(--text-muted)"
                />
              </button>

              {/* Block Items */}
              {isExpanded && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingLeft: 12, paddingRight: 4, marginTop: 2 }}>
                  {filtered.map((def) => (
                    <div
                      key={def.type}
                      draggable
                      onDragStart={(e) => handleDragStart(e, def.type)}
                      onDoubleClick={() => handleAddBlock(def.type)}
                      onClick={() => handleAddBlock(def.type)}
                      title={`${def.label}: ${def.description}\n(Click or double-click to add, or drag to canvas)`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '5px 8px',
                        borderRadius: 6,
                        backgroundColor: 'rgba(255, 255, 255, 0.02)',
                        border: '1px solid transparent',
                        cursor: 'grab',
                        transition: 'all 0.12s ease',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.07)';
                        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.15)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.02)';
                        e.currentTarget.style.borderColor = 'transparent';
                      }}
                    >
                      <SFSymbol name={def.icon} size={13} color={def.color} />
                      <span
                        style={{
                          fontSize: 11,
                          color: 'var(--text-secondary)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          flex: 1,
                        }}
                      >
                        {def.label}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default BlockPaletteView;
