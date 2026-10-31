// apps/web/src/views/inspector/InspectorPanel.tsx
//
// 1:1 port of Views/InspectorPanel.swift.
// Comprehensive properties inspector: coordinates, size, child alignment,
// styles, typography, image sources, icons, repeat list bindings,
// padding, margin, and embedded GameInspectorSection.

import React, { useRef } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { useLogicViewModel } from '../../stores/logicStore';
import { SFSymbol } from '../../components/SFSymbol';
import { DevicePresetLibrary, type DesignNode, type RepeatAxis } from '@agentic/core';
import type { CanvasStudioAlignment } from '../../stores/project/types';
import { GameInspectorSection } from './GameInspectorSection';

export function InspectorPanel() {
  const selectedNode = useProjectStore((s) => s.selectedNode());
  const updateSelectedNode = useProjectStore((s) => s.updateSelectedNode);
  const updateSelectedNodes = useProjectStore((s) => s.updateSelectedNodes);
  const fitTextNodeToContent = useProjectStore((s) => s.fitTextNodeToContent);
  const hugTextBoxIfEnabled = useProjectStore((s) => s.hugTextBoxIfEnabled);
  const alignChildren = useProjectStore((s) => s.alignChildren);
  const distributeChildren = useProjectStore((s) => s.distributeChildren);
  const alignSelection = useProjectStore((s) => s.alignSelection);
  const distributeSelection = useProjectStore((s) => s.distributeSelection);
  const project = useProjectStore((s) => s.project);
  const currentPageIndex = useProjectStore((s) => s.currentPageIndex);
  const selectedNodeIds = useProjectStore((s) => s.selectedNodeIds);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      if (dataUrl) {
        updateSelectedNode((n) => {
          n.imageSource = dataUrl;
          n.imageName = file.name;
        });
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const preset = selectedNode?.devicePresetId
    ? DevicePresetLibrary.preset(selectedNode.devicePresetId)
    : undefined;

  const logicViewModel = useLogicViewModel();
  const currentPage = project.pages[currentPageIndex] ?? project.pages[0];
  const allScreens = (currentPage?.nodes ?? []).filter((n) => n.type === 'Frame');

  const activeNavFlow = selectedNode
    ? logicViewModel.flows.find((f) =>
        f.blocks.some(
          (b) =>
            b.type === 'onTap' &&
            b.parameters.some((p) => p.key === 'targetNode' && p.nodeReference === selectedNode.id),
        ),
      )
    : undefined;

  const navBlock = activeNavFlow?.blocks.find((b) => b.type === 'navigate');
  const targetScreenId = navBlock?.parameters.find((p) => p.key === 'screen')?.nodeReference;

  const handleTargetScreenChange = (targetId: string) => {
    if (!selectedNode) return;
    if (!targetId) {
      if (activeNavFlow) {
        logicViewModel.deleteFlow(activeNavFlow.id);
      }
      return;
    }
    if (activeNavFlow && navBlock) {
      logicViewModel.linkParameterToNode(navBlock.id, 'screen', targetId);
      logicViewModel.persist();
    } else {
      const targetScreen = allScreens.find((s) => s.id === targetId);
      const flowName = `${selectedNode.name} -> ${targetScreen?.name ?? 'Screen'}`;
      logicViewModel.createFlow(flowName);
      const tapBlock = logicViewModel.addBlock('onTap', { x: 80, y: 120 });
      const newNavBlock = logicViewModel.addBlock('navigate', { x: 360, y: 120 });
      if (tapBlock && newNavBlock) {
        logicViewModel.linkParameterToNode(tapBlock.id, 'targetNode', selectedNode.id);
        logicViewModel.linkParameterToNode(newNavBlock.id, 'screen', targetId);
        logicViewModel.connectBlocks(tapBlock.id, 0, newNavBlock.id, 0);
        logicViewModel.persist();
      }
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: 300,
        height: '100%',
        backgroundColor: 'var(--bg-panel)',
        borderLeft: '1px solid var(--border-subtle)',
        userSelect: 'none',
        overflowY: 'auto',
      }}
    >
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleImageFile}
        accept="image/*"
        style={{ display: 'none' }}
      />

      {/* Header */}
      <div
        style={{
          padding: '16px 16px 10px',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Inspector
        </span>
      </div>

      {/* Selection Alignment Bar */}
      {selectedNode && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 12px',
            backgroundColor: 'rgba(255, 255, 255, 0.02)',
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <button
              type="button"
              onClick={() => alignSelection('left')}
              title="Align Left"
              style={iconMiniBtnStyle}
            >
              <SFSymbol name="align.horizontal.left" size={13} />
            </button>
            <button
              type="button"
              onClick={() => alignSelection('center')}
              title="Align Horizontal Center"
              style={iconMiniBtnStyle}
            >
              <SFSymbol name="align.horizontal.center" size={13} />
            </button>
            <button
              type="button"
              onClick={() => alignSelection('right')}
              title="Align Right"
              style={iconMiniBtnStyle}
            >
              <SFSymbol name="align.horizontal.right" size={13} />
            </button>
          </div>

          <div style={{ width: 1, height: 16, backgroundColor: 'var(--border-subtle)' }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <button
              type="button"
              onClick={() => alignSelection('top')}
              title="Align Top"
              style={iconMiniBtnStyle}
            >
              <SFSymbol name="align.vertical.top" size={13} />
            </button>
            <button
              type="button"
              onClick={() => alignSelection('middle')}
              title="Align Vertical Middle"
              style={iconMiniBtnStyle}
            >
              <SFSymbol name="align.vertical.center" size={13} />
            </button>
            <button
              type="button"
              onClick={() => alignSelection('bottom')}
              title="Align Bottom"
              style={iconMiniBtnStyle}
            >
              <SFSymbol name="align.vertical.bottom" size={13} />
            </button>
          </div>

          <div style={{ width: 1, height: 16, backgroundColor: 'var(--border-subtle)' }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <button
              type="button"
              onClick={() => distributeSelection('horizontal')}
              title="Distribute Horizontally"
              style={iconMiniBtnStyle}
            >
              <SFSymbol name="distribute.horizontal" size={13} />
            </button>
            <button
              type="button"
              onClick={() => distributeSelection('vertical')}
              title="Distribute Vertically"
              style={iconMiniBtnStyle}
            >
              <SFSymbol name="distribute.vertical" size={13} />
            </button>
          </div>
        </div>
      )}

      {selectedNode ? (
        <div key={selectedNode.id} style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '16px 14px' }}>
          {/* Name & Type */}
          <section style={sectionStyle}>
            <input
              type="text"
              data-tour-target="inspector-node-name"
              value={selectedNode.name}
              onChange={(e) => updateSelectedNode((n) => { n.name = e.target.value; })}
              style={titleInputStyle}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
              <span style={labelStyle}>Type</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)' }}>
                {selectedNode.gameScene ? 'Game' : selectedNode.type}
              </span>
            </div>
            {preset && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                <span style={labelStyle}>Device</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{preset.name}</span>
              </div>
            )}
          </section>

          {/* Game Spec Controls */}
          {selectedNode.gameScene && (
            <>
              <div style={dividerStyle} />
              <GameInspectorSection node={selectedNode} />
            </>
          )}

          <div style={dividerStyle} />

          {/* Position */}
          <section style={sectionStyle}>
            <div style={sectionTitleStyle}>Position</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
              <NumberRow label="X" value={Math.round(selectedNode.x)} onChange={(v) => updateSelectedNode((n) => { n.x = v; })} />
              <NumberRow label="Y" value={Math.round(selectedNode.y)} onChange={(v) => updateSelectedNode((n) => { n.y = v; })} />
            </div>
          </section>

          <div style={dividerStyle} />

          {/* Size */}
          <section style={sectionStyle}>
            <div style={sectionTitleStyle}>Size</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginBottom: selectedNode.type === 'Text' ? 8 : 0 }}>
              <NumberRow label="W" value={Math.round(selectedNode.width)} onChange={(v) => updateSelectedNode((n) => { n.width = Math.max(1, v); })} />
              <NumberRow label="H" value={Math.round(selectedNode.height)} onChange={(v) => updateSelectedNode((n) => { n.height = Math.max(1, v); })} />
            </div>

            {selectedNode.type === 'Text' && (
              <button
                type="button"
                onClick={() => fitTextNodeToContent(selectedNode.id)}
                style={actionButtonStyle}
              >
                <SFSymbol name="arrow.down.right.and.arrow.up.left" size={13} />
                <span>Fit Box to Text</span>
              </button>
            )}
          </section>

          {/* Align Children */}
          {selectedNode.children && selectedNode.children.length > 0 && (
            <>
              <div style={dividerStyle} />
              <section style={sectionStyle}>
                <div style={sectionTitleStyle}>Align Children ({selectedNode.children.length})</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 4, marginBottom: 6 }}>
                  {(['left', 'center', 'right', 'top', 'middle', 'bottom'] as CanvasStudioAlignment[]).map((a) => (
                    <button
                      key={a}
                      type="button"
                      onClick={() => alignChildren(selectedNode.id, a)}
                      title={`Align ${a}`}
                      style={iconGridBtnStyle}
                    >
                      <SFSymbol name={alignIcon(a)} size={13} />
                    </button>
                  ))}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => distributeChildren(selectedNode.id, 'horizontal')}
                    disabled={selectedNode.children.length < 2}
                    style={actionButtonStyle}
                  >
                    <SFSymbol name="distribute.horizontal" size={13} />
                    <span>Distribute H</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => distributeChildren(selectedNode.id, 'vertical')}
                    disabled={selectedNode.children.length < 2}
                    style={actionButtonStyle}
                  >
                    <SFSymbol name="distribute.vertical" size={13} />
                    <span>Distribute V</span>
                  </button>
                </div>
              </section>
            </>
          )}

          <div style={dividerStyle} />

          {/* Style */}
          <section style={sectionStyle}>
            <div style={sectionTitleStyle}>Style</div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={labelStyle}>Fill</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="color"
                  value={selectedNode.style.fill ?? '#FFFFFF'}
                  onChange={(e) => updateSelectedNodes((n) => { n.style.fill = e.target.value; })}
                  style={{ width: 24, height: 24, border: 'none', borderRadius: 4, cursor: 'pointer', background: 'transparent' }}
                />
                <input
                  type="text"
                  value={selectedNode.style.fill ?? '#FFFFFF'}
                  onChange={(e) => updateSelectedNodes((n) => { n.style.fill = e.target.value; })}
                  style={{ ...textInputStyle, width: 72, textAlign: 'center' }}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginBottom: 8 }}>
              <NumberRow
                label="Radius"
                value={selectedNode.style.cornerRadius ?? 0}
                onChange={(v) => updateSelectedNodes((n) => { n.style.cornerRadius = Math.max(0, v); })}
              />
              <NumberRow
                label="Opacity"
                value={Math.round((selectedNode.style.opacity ?? 1) * 100)}
                onChange={(v) => updateSelectedNodes((n) => { n.style.opacity = Math.min(1, Math.max(0, v / 100)); })}
              />
            </div>

            {/* Stroke / Border */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={labelStyle}>Border</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="color"
                  value={selectedNode.style.stroke ?? '#374151'}
                  onChange={(e) => updateSelectedNodes((n) => { n.style.stroke = e.target.value; })}
                  style={{ width: 24, height: 24, border: 'none', borderRadius: 4, cursor: 'pointer', background: 'transparent' }}
                />
                <input
                  type="text"
                  placeholder="None"
                  value={selectedNode.style.stroke ?? ''}
                  onChange={(e) => updateSelectedNodes((n) => { n.style.stroke = e.target.value || undefined; })}
                  style={{ ...textInputStyle, width: 72, textAlign: 'center' }}
                />
              </div>
            </div>
            <NumberRow
              label="Border Width"
              value={selectedNode.style.strokeWidth ?? 0}
              onChange={(v) => updateSelectedNodes((n) => { n.style.strokeWidth = Math.max(0, v); })}
            />

            {/* Shadow */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, marginBottom: 6 }}>
              <span style={labelStyle}>Shadow</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="color"
                  value={selectedNode.style.shadow?.color ?? '#000000'}
                  onChange={(e) => updateSelectedNodes((n) => {
                    const current = n.style.shadow ?? { color: '#000000', opacity: 0.35, radius: 4, x: 0, y: 2 };
                    n.style.shadow = { ...current, color: e.target.value };
                  })}
                  style={{ width: 24, height: 24, border: 'none', borderRadius: 4, cursor: 'pointer', background: 'transparent' }}
                />
                <input
                  type="text"
                  placeholder="None"
                  value={selectedNode.style.shadow?.color ?? ''}
                  onChange={(e) => updateSelectedNodes((n) => {
                    if (!e.target.value) {
                      n.style.shadow = undefined;
                    } else {
                      const current = n.style.shadow ?? { color: '#000000', opacity: 0.35, radius: 4, x: 0, y: 2 };
                      n.style.shadow = { ...current, color: e.target.value };
                    }
                  })}
                  style={{ ...textInputStyle, width: 72, textAlign: 'center' }}
                />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
              <NumberRow
                label="Blur"
                value={selectedNode.style.shadow?.radius ?? 0}
                onChange={(v) => updateSelectedNodes((n) => {
                  const current = n.style.shadow ?? { color: '#000000', opacity: 0.35, radius: 4, x: 0, y: 2 };
                  n.style.shadow = { ...current, radius: Math.max(0, v) };
                })}
              />
              <NumberRow
                label="X"
                value={selectedNode.style.shadow?.x ?? 0}
                onChange={(v) => updateSelectedNodes((n) => {
                  const current = n.style.shadow ?? { color: '#000000', opacity: 0.35, radius: 4, x: 0, y: 2 };
                  n.style.shadow = { ...current, x: v };
                })}
              />
              <NumberRow
                label="Y"
                value={selectedNode.style.shadow?.y ?? 0}
                onChange={(v) => updateSelectedNodes((n) => {
                  const current = n.style.shadow ?? { color: '#000000', opacity: 0.35, radius: 4, x: 0, y: 2 };
                  n.style.shadow = { ...current, y: v };
                })}
              />
            </div>
          </section>

          {/* Typography */}
          {(selectedNode.type === 'Text' || selectedNode.type === 'Button' || selectedNode.type === 'Input' || selectedNode.type === 'Icon') && (
            <>
              <div style={dividerStyle} />
              <section style={sectionStyle}>
                <div style={sectionTitleStyle}>Typography & Color</div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={labelStyle}>Text Color</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input
                      type="color"
                      value={selectedNode.style.textColor ?? '#FFFFFF'}
                      onChange={(e) => updateSelectedNodes((n) => { n.style.textColor = e.target.value; })}
                      style={{ width: 24, height: 24, border: 'none', borderRadius: 4, cursor: 'pointer', background: 'transparent' }}
                    />
                    <input
                      type="text"
                      value={selectedNode.style.textColor ?? '#FFFFFF'}
                      onChange={(e) => updateSelectedNodes((n) => { n.style.textColor = e.target.value; })}
                      style={{ ...textInputStyle, width: 72, textAlign: 'center' }}
                    />
                  </div>
                </div>

                {selectedNode.type !== 'Icon' && (
                  <>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
                      <span style={labelStyle}>Content</span>
                      <textarea
                        value={selectedNode.text ?? ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          updateSelectedNodes((n) => { n.text = val; });
                          hugTextBoxIfEnabled(selectedNode.id);
                        }}
                        rows={2}
                        style={textAreaStyle}
                      />
                    </div>
                    <div data-tour-target="inspector-text-style" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                      <NumberRow
                        label="Font Size"
                        value={selectedNode.style.fontSize ?? 16}
                        onChange={(v) => updateSelectedNodes((n) => { n.style.fontSize = Math.max(1, v); })}
                      />
                      <select
                        value={selectedNode.style.fontWeight ?? 'regular'}
                        onChange={(e) => updateSelectedNodes((n) => { n.style.fontWeight = e.target.value; })}
                        style={{ ...textInputStyle, height: 28, cursor: 'pointer' }}
                      >
                        <option value="regular">Regular</option>
                        <option value="medium">Medium</option>
                        <option value="semibold">Semibold</option>
                        <option value="bold">Bold</option>
                        <option value="heavy">Heavy</option>
                      </select>
                    </div>

                    {/* Text Alignment */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                      <span style={labelStyle}>Alignment</span>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {(['left', 'center', 'right'] as const).map((align) => {
                          const isSel = (selectedNode.style.textAlign ?? 'left') === align;
                          return (
                            <button
                              key={align}
                              type="button"
                              onClick={() => updateSelectedNodes((n) => { n.style.textAlign = align; })}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: 28,
                                height: 24,
                                borderRadius: 4,
                                border: '1px solid var(--border-subtle)',
                                backgroundColor: isSel ? 'var(--accent-primary)' : 'rgba(255,255,255,0.04)',
                                color: isSel ? '#FFF' : 'var(--text-secondary)',
                                cursor: 'pointer',
                              }}
                            >
                              <SFSymbol name={align === 'left' ? 'text.alignleft' : align === 'center' ? 'text.aligncenter' : 'text.alignright'} size={12} />
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}
              </section>
            </>
          )}

          {/* Image */}
          {selectedNode.type === 'Image' && (
            <>
              <div style={dividerStyle} />
              <section style={sectionStyle}>
                <div style={sectionTitleStyle}>Image Source</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <input
                    type="text"
                    placeholder="URL or asset name"
                    value={selectedNode.imageSource ?? selectedNode.imageName ?? ''}
                    onChange={(e) => updateSelectedNode((n) => { n.imageSource = e.target.value; })}
                    style={textInputStyle}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    style={actionButtonStyle}
                  >
                    <SFSymbol name="photo" size={13} />
                    <span>Choose File...</span>
                  </button>
                </div>
              </section>
            </>
          )}

          {/* Icon */}
          {selectedNode.type === 'Icon' && (
            <>
              <div style={dividerStyle} />
              <section style={sectionStyle}>
                <div style={sectionTitleStyle}>SF Symbol</div>
                <input
                  type="text"
                  value={selectedNode.iconName ?? 'star'}
                  onChange={(e) => updateSelectedNode((n) => { n.iconName = e.target.value; })}
                  style={textInputStyle}
                />
              </section>
            </>
          )}

          {/* Repeat / List Data Binding */}
          <div style={dividerStyle} />
          <section style={sectionStyle}>
            <div style={sectionTitleStyle}>Repeat (List)</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
              <span style={labelStyle}>Data Variable</span>
              <input
                type="text"
                placeholder="e.g. items, products"
                value={selectedNode.repeatBinding?.sourceVariable ?? ''}
                onChange={(e) => {
                  const val = e.target.value.trim();
                  updateSelectedNode((n) => {
                    if (!val) {
                      delete n.repeatBinding;
                    } else {
                      n.repeatBinding = {
                        sourceVariable: val,
                        itemAlias: n.repeatBinding?.itemAlias ?? 'item',
                        axis: n.repeatBinding?.axis ?? 'vertical',
                        isScrollable: n.repeatBinding?.isScrollable ?? true,
                      };
                    }
                  });
                }}
                style={textInputStyle}
              />
            </div>

            {selectedNode.repeatBinding && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={labelStyle}>Item Alias</span>
                  <input
                    type="text"
                    value={selectedNode.repeatBinding.itemAlias ?? 'item'}
                    onChange={(e) => {
                      const alias = e.target.value.trim() || 'item';
                      updateSelectedNode((n) => {
                        if (n.repeatBinding) n.repeatBinding.itemAlias = alias;
                      });
                    }}
                    style={{ ...textInputStyle, width: 90 }}
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={labelStyle}>Direction</span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {(['vertical', 'horizontal'] as RepeatAxis[]).map((axis) => {
                      const isSel = (selectedNode.repeatBinding?.axis ?? 'vertical') === axis;
                      return (
                        <button
                          key={axis}
                          type="button"
                          onClick={() => updateSelectedNode((n) => {
                            if (n.repeatBinding) n.repeatBinding.axis = axis;
                          })}
                          style={{
                            padding: '3px 8px',
                            borderRadius: 4,
                            fontSize: 10,
                            border: '1px solid var(--border-subtle)',
                            backgroundColor: isSel ? 'var(--accent-primary)' : 'rgba(255,255,255,0.05)',
                            color: isSel ? '#FFFFFF' : 'var(--text-muted)',
                            cursor: 'pointer',
                          }}
                        >
                          {axis.charAt(0).toUpperCase() + axis.slice(1)}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={selectedNode.repeatBinding.isScrollable ?? true}
                    onChange={(e) => updateSelectedNode((n) => {
                      if (n.repeatBinding) n.repeatBinding.isScrollable = e.target.checked;
                    })}
                  />
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Scrollable</span>
                </label>

                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                  Use {`{{${selectedNode.repeatBinding.itemAlias || 'item'}.field}}`} in this node or children.
                </div>
              </div>
            )}
          </section>

          {/* Input Specific Properties */}
          {selectedNode.type === 'Input' && (
            <>
              <div style={dividerStyle} />
              <section style={sectionStyle}>
                <div style={sectionTitleStyle}>Input Field</div>
                <label data-tour-target="inspector-input-secure" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={selectedNode.isSecure ?? false}
                    onChange={(e) => updateSelectedNode((n) => { n.isSecure = e.target.checked; })}
                  />
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Password / Secure Field</span>
                </label>
              </section>
            </>
          )}

          {/* Interactions & Navigation */}
          <div style={dividerStyle} />
          <section style={sectionStyle}>
            <div style={sectionTitleStyle}>Interactions & Navigation</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={labelStyle}>On Tap ➔ Navigate To</span>
              <select
                value={targetScreenId ?? ''}
                onChange={(e) => handleTargetScreenChange(e.target.value)}
                style={{
                  ...textInputStyle,
                  backgroundColor: 'rgba(0,0,0,0.4)',
                  cursor: 'pointer',
                }}
              >
                <option value="">None (No interaction)</option>
                {allScreens.map((screen) => (
                  <option key={screen.id} value={screen.id}>
                    {screen.name || 'Untitled Screen'}
                  </option>
                ))}
              </select>
              {activeNavFlow && (
                <span style={{ fontSize: 10, color: 'var(--accent-primary, #0A84FF)' }}>
                  Linked to logic flow: &ldquo;{activeNavFlow.name}&rdquo;
                </span>
              )}
            </div>
          </section>

          {/* Padding */}
          <div style={dividerStyle} />
          <section style={sectionStyle}>
            <div style={sectionTitleStyle}>Padding</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
              <NumberRow label="T" value={selectedNode.style.paddingTop ?? 0} onChange={(v) => updateSelectedNode((n) => { n.style.paddingTop = v; })} />
              <NumberRow label="R" value={selectedNode.style.paddingRight ?? 0} onChange={(v) => updateSelectedNode((n) => { n.style.paddingRight = v; })} />
              <NumberRow label="B" value={selectedNode.style.paddingBottom ?? 0} onChange={(v) => updateSelectedNode((n) => { n.style.paddingBottom = v; })} />
              <NumberRow label="L" value={selectedNode.style.paddingLeft ?? 0} onChange={(v) => updateSelectedNode((n) => { n.style.paddingLeft = v; })} />
            </div>
          </section>

          {/* Margin */}
          <div style={dividerStyle} />
          <section style={sectionStyle}>
            <div style={sectionTitleStyle}>Margin</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
              <NumberRow label="T" value={selectedNode.style.marginTop ?? 0} onChange={(v) => updateSelectedNode((n) => { n.style.marginTop = v; })} />
              <NumberRow label="R" value={selectedNode.style.marginRight ?? 0} onChange={(v) => updateSelectedNode((n) => { n.style.marginRight = v; })} />
              <NumberRow label="B" value={selectedNode.style.marginBottom ?? 0} onChange={(v) => updateSelectedNode((n) => { n.style.marginBottom = v; })} />
              <NumberRow label="L" value={selectedNode.style.marginLeft ?? 0} onChange={(v) => updateSelectedNode((n) => { n.style.marginLeft = v; })} />
            </div>
          </section>
        </div>
      ) : (
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-muted)',
            gap: 8,
            padding: 24,
            textAlign: 'center',
          }}
        >
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>No selection</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Select an element on canvas to inspect</span>
        </div>
      )}
    </div>
  );
}

function alignIcon(a: CanvasStudioAlignment): string {
  switch (a) {
    case 'left': return 'align.horizontal.left';
    case 'center': return 'align.horizontal.center';
    case 'right': return 'align.horizontal.right';
    case 'top': return 'align.vertical.top';
    case 'middle': return 'align.vertical.center';
    case 'bottom': return 'align.vertical.bottom';
    default: return 'align.horizontal.center';
  }
}

function NumberRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.3)', border: '1px solid var(--border-subtle)', borderRadius: 6, padding: '0 8px' }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', marginRight: 6 }}>{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: '100%', border: 'none', outline: 'none', backgroundColor: 'transparent', color: 'var(--text-primary)', fontSize: 11, padding: '6px 0' }}
      />
    </div>
  );
}

const sectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
  letterSpacing: 0.5,
  marginBottom: 8,
};

const dividerStyle: React.CSSProperties = {
  height: 1,
  backgroundColor: 'var(--border-subtle)',
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--text-secondary)',
};

const titleInputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '6px 0',
  border: 'none',
  outline: 'none',
  backgroundColor: 'transparent',
  color: 'var(--text-primary)',
  fontSize: 15,
  fontWeight: 700,
};

const textInputStyle: React.CSSProperties = {
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

const textAreaStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '6px 8px',
  borderRadius: 6,
  backgroundColor: 'rgba(0, 0, 0, 0.3)',
  border: '1px solid var(--border-subtle)',
  color: 'var(--text-primary)',
  fontSize: 11,
  outline: 'none',
  resize: 'vertical',
  fontFamily: 'inherit',
};

const iconGridBtnStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: 28,
  borderRadius: 6,
  backgroundColor: 'rgba(255, 255, 255, 0.03)',
  border: '1px solid var(--border-subtle)',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
};

const actionButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: '7px 10px',
  borderRadius: 6,
  backgroundColor: 'rgba(255, 255, 255, 0.04)',
  border: '1px solid var(--border-subtle)',
  color: 'var(--text-secondary)',
  fontSize: 11,
  cursor: 'pointer',
};

const iconMiniBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 24,
  height: 24,
  borderRadius: 4,
  backgroundColor: 'transparent',
  border: 'none',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  padding: 0,
};

export default InspectorPanel;
