// apps/web/src/views/logic/BlockInspectorPanel.tsx
//
// 1:1 port of Views/Logic/BlockInspectorPanel.swift.
// Right sidebar in Logic Mode: parameter editors for the selected block,
// element/screen target pickers, variable binding, comment notes,
// and full variables manager (flow & global scopes).

import React, { useState } from 'react';
import { useLogicViewModel } from '../../stores/logicStore';
import { useProjectStore } from '../../stores/projectStore';
import { SFSymbol } from '../../components/SFSymbol';
import { BlockCatalog, AllAppPlatform, type AppPlatform, type VariableType, type VariableScope } from '@agentic/core';

export function BlockInspectorPanel() {
  const logicViewModel = useLogicViewModel();
  const project = useProjectStore((s) => s.project);
  const currentPageIndex = useProjectStore((s) => s.currentPageIndex);

  const [newVarName, setNewVarName] = useState('');
  const [newVarType, setNewVarType] = useState<VariableType>('string');
  const [newVarScope, setNewVarScope] = useState<VariableScope>('flow');
  const [newVarDefault, setNewVarDefault] = useState('');

  const selectedBlock = logicViewModel.selectedBlock;
  const definition = selectedBlock ? BlockCatalog.definition(selectedBlock.type) : undefined;
  const currentPage = project.pages[currentPageIndex] ?? project.pages[0];

  const handleAddVariable = () => {
    const name = newVarName.trim();
    if (!name) return;
    logicViewModel.addVariable(
      name,
      newVarType,
      newVarScope,
      newVarDefault || undefined,
    );
    setNewVarName('');
    setNewVarDefault('');
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        backgroundColor: 'var(--bg-panel)',
        borderLeft: '1px solid var(--border-color)',
        overflowY: 'auto',
        userSelect: 'none',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', padding: 12, gap: 16 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <SFSymbol name="slider.horizontal.3" size={14} color="var(--text-secondary)" />
          <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Block Inspector
          </span>
        </div>

        {selectedBlock && definition ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Block Type Badge & Name */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  backgroundColor: BlockCatalog.color(definition.category),
                }}
              />
              <span style={{ fontSize: 13, fontWeight: 600 }}>{selectedBlock.label}</span>
              <span
                style={{
                  marginLeft: 'auto',
                  fontSize: 10,
                  color: 'var(--text-muted)',
                  backgroundColor: 'var(--bg-tertiary)',
                  padding: '2px 6px',
                  borderRadius: 4,
                }}
              >
                {definition.category}
              </span>
            </div>

            {/* Description */}
            <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0, lineHeight: 1.4 }}>
              {definition.description}
            </p>

            <div style={{ height: 1, backgroundColor: 'var(--border-subtle)' }} />

            {/* Editable Parameters */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: 0.5 }}>
                Parameters
              </span>

              {selectedBlock.parameters.map((param) => {
                const defParam = definition.defaultParameters.find((p) => p.key === param.key);
                return (
                  <div key={param.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{param.label}</span>
                      {defParam?.type === 'screenReference' && (
                        <select
                          value={param.nodeReference ?? ''}
                          onChange={(e) => logicViewModel.linkParameterToNode(selectedBlock.id, param.key, e.target.value || undefined)}
                          style={selectStyle}
                        >
                          <option value="">Choose screen...</option>
                          {logicViewModel.designScreens.map((screen) => (
                            <option key={screen.id} value={screen.id}>
                              {screen.name}
                            </option>
                          ))}
                        </select>
                      )}

                      {defParam?.type === 'nodeReference' && (
                        <select
                          value={param.nodeReference ?? ''}
                          onChange={(e) => logicViewModel.linkParameterToNode(selectedBlock.id, param.key, e.target.value || undefined)}
                          style={selectStyle}
                        >
                          <option value="">Choose element...</option>
                          {logicViewModel.designNodesFlat.map((n) => (
                            <option key={n.id} value={n.id}>
                              {n.name} ({n.type})
                            </option>
                          ))}
                        </select>
                      )}

                      {defParam?.type === 'boolean' && (
                        <input
                          type="checkbox"
                          checked={param.value === 'true'}
                          onChange={(e) => logicViewModel.updateParameter(selectedBlock.id, param.key, e.target.checked ? 'true' : 'false')}
                        />
                      )}

                      {defParam?.type === 'number' && (
                        <input
                          type="number"
                          value={param.value ?? '0'}
                          onChange={(e) => logicViewModel.updateParameter(selectedBlock.id, param.key, e.target.value)}
                          style={{ ...inputStyle, width: 80 }}
                        />
                      )}

                      {defParam?.type === 'dropdown' && defParam.options && (
                        <select
                          value={String(param.value ?? '')}
                          onChange={(e) => logicViewModel.updateParameter(selectedBlock.id, param.key, e.target.value)}
                          style={selectStyle}
                        >
                          {defParam.options.map((opt: string) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      )}

                      {(defParam?.type === 'string' || !defParam) && (
                        <input
                          type="text"
                          value={String(param.value ?? '')}
                          onChange={(e) => logicViewModel.updateParameter(selectedBlock.id, param.key, e.target.value)}
                          style={{ ...inputStyle, flex: 1, maxWidth: 160 }}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ height: 1, backgroundColor: 'var(--border-subtle)' }} />

            {/* Comment Note */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: 0.5 }}>
                Comment / Note
              </span>
              <input
                type="text"
                placeholder="Optional explanation for this step..."
                value={selectedBlock.comment ?? ''}
                onChange={(e) => logicViewModel.updateComment(selectedBlock.id, e.target.value || undefined)}
                style={inputStyle}
              />
            </div>

            {/* Quick Actions */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
              <button
                type="button"
                onClick={() => logicViewModel.duplicateBlock(selectedBlock.id)}
                style={actionButtonStyle}
              >
                <SFSymbol name="plus.square.on.square" size={13} />
                <span>Duplicate</span>
              </button>
              <button
                type="button"
                onClick={() => logicViewModel.deleteBlock(selectedBlock.id)}
                style={{ ...actionButtonStyle, color: 'var(--accent-danger)' }}
              >
                <SFSymbol name="trash" size={13} color="var(--accent-danger)" />
                <span>Delete</span>
              </button>
            </div>
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '24px 8px',
              color: 'var(--text-muted)',
              gap: 8,
              textAlign: 'center',
            }}
          >
            <SFSymbol name="cube.transparent" size={28} />
            <span style={{ fontSize: 12 }}>Select a block to inspect its parameters</span>
          </div>
        )}

        <div style={{ height: 1, backgroundColor: 'var(--border-subtle)' }} />

        {/* Variables Section */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: 0.5 }}>
            Variables ({logicViewModel.currentFlow?.variables.length ?? 0})
          </span>

          {logicViewModel.currentFlow?.variables.map((v) => (
            <div
              key={v.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '4px 8px',
                borderRadius: 6,
                backgroundColor: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid var(--border-subtle)',
                fontSize: 11,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{v.name}</span>
                <span style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                  ({v.type})
                </span>
              </div>
              <button
                type="button"
                onClick={() => logicViewModel.deleteVariable(v.id)}
                style={{ background: 'none', border: 'none', color: 'var(--accent-danger)', cursor: 'pointer', padding: 0 }}
              >
                <SFSymbol name="trash" size={11} color="var(--accent-danger)" />
              </button>
            </div>
          ))}

          {/* Add Variable Form */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
            <input
              type="text"
              placeholder="Variable name"
              value={newVarName}
              onChange={(e) => setNewVarName(e.target.value)}
              style={inputStyle}
            />
            <div style={{ display: 'flex', gap: 6 }}>
              <select
                value={newVarType}
                onChange={(e) => setNewVarType(e.target.value as VariableType)}
                style={{ ...selectStyle, flex: 1 }}
              >
                <option value="string">String</option>
                <option value="number">Number</option>
                <option value="boolean">Boolean</option>
                <option value="array">Array</option>
                <option value="object">Object</option>
              </select>
              <select
                value={newVarScope}
                onChange={(e) => setNewVarScope(e.target.value as VariableScope)}
                style={{ ...selectStyle, flex: 1 }}
              >
                <option value="flow">Flow</option>
                <option value="global">Global</option>
              </select>
            </div>
            <button
              type="button"
              onClick={handleAddVariable}
              disabled={!newVarName.trim()}
              style={{
                ...actionButtonStyle,
                backgroundColor: 'rgba(79, 70, 229, 0.2)',
                color: 'var(--accent-primary)',
                border: '1px solid rgba(79, 70, 229, 0.4)',
              }}
            >
              <SFSymbol name="plus" size={12} />
              <span>Add Variable</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  padding: '4px 6px',
  borderRadius: 6,
  backgroundColor: 'rgba(0, 0, 0, 0.3)',
  border: '1px solid var(--border-subtle)',
  color: 'var(--text-primary)',
  fontSize: 11,
  outline: 'none',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '5px 8px',
  borderRadius: 6,
  backgroundColor: 'rgba(0, 0, 0, 0.3)',
  border: '1px solid var(--border-subtle)',
  color: 'var(--text-primary)',
  fontSize: 11,
  outline: 'none',
};

const actionButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: '6px 10px',
  borderRadius: 6,
  backgroundColor: 'rgba(255, 255, 255, 0.04)',
  border: '1px solid var(--border-subtle)',
  color: 'var(--text-secondary)',
  fontSize: 11,
  cursor: 'pointer',
};

export default BlockInspectorPanel;
