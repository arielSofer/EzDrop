// apps/web/src/views/logic/AppPreviewView.tsx
//
// 1:1 port of Views/Logic/AppPreviewView.swift.
// Interactive simulator shell: renders the running app inside realistic iOS / iPad
// hardware chrome. Buttons trigger wired logic flows, text inputs accept typing,
// and navigation flows change screens seamlessly.

import React, { useState, useEffect, useMemo } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { useLogicViewModel } from '../../stores/logicStore';
import { designHostForLogic, simulatorDesignHost } from '../../stores/projectHost';
import { SFSymbol } from '../../components/SFSymbol';
import { CanvasNodeView } from '../canvas/CanvasNodeView';
import {
  RepeatBindingExpander,
  type LogicSimulator,
  type DesignNode,
  type NodeType,
} from '@agentic/core';

export interface AppPreviewViewProps {
  simulator: LogicSimulator;
  isOpen: boolean;
  onClose: () => void;
}

interface HitArea {
  flowNodeId: string;
  nodeId: string;
  type: NodeType;
  rect: { x: number; y: number; width: number; height: number };
  cornerRadius: number;
  text?: string;
  placeholder?: string;
  itemVariables?: Record<string, string>;
}

function collectHitAreas(
  nodes: DesignNode[],
  offset: { x: number; y: number },
  tappableIds: Set<string>,
  cloneContexts?: Map<string, { templateId: string; variables: Record<string, string> }>,
  inheritedVariables: Record<string, string> = {},
): HitArea[] {
  const res: HitArea[] = [];
  for (const node of nodes) {
    const rect = {
      x: offset.x + node.x,
      y: offset.y + node.y,
      width: node.width,
      height: node.height,
    };
    const clone = cloneContexts?.get(node.id);
    const flowNodeId = clone?.templateId ?? node.id;
    const itemVariables = clone?.variables ?? inheritedVariables;

    const isTappable =
      node.type === 'Button' ||
      node.type === 'Input' ||
      tappableIds.has(flowNodeId) ||
      Boolean(node.logicBindings && node.logicBindings.length > 0);

    if (isTappable) {
      res.push({
        flowNodeId,
        nodeId: node.id,
        type: node.type,
        rect,
        cornerRadius: node.style.cornerRadius ?? (node.type === 'Button' ? 14 : 8),
        text: node.text,
        placeholder: node.text,
        itemVariables,
      });
    }

    if (node.children && node.children.length > 0) {
      res.push(
        ...collectHitAreas(node.children, { x: rect.x, y: rect.y }, tappableIds, cloneContexts, itemVariables),
      );
    }
  }
  return res;
}

export function AppPreviewView({ simulator, isOpen, onClose }: AppPreviewViewProps) {
  const [, setTick] = useState(0);
  const project = useProjectStore((s) => s.project);
  const currentPageIndex = useProjectStore((s) => s.currentPageIndex);
  const logicViewModel = useLogicViewModel();

  const [deviceTarget, setDeviceTarget] = useState<'iphone' | 'ipad'>('iphone');

  // Simulator lifecycle: attach logic model, seed variables, fire launch and screen events
  useEffect(() => {
    if (!isOpen) return;

    logicViewModel.attach(designHostForLogic);
    simulator.logicViewModel = logicViewModel;
    simulator.designViewModel = simulatorDesignHost;
    simulator.previewPlatform = deviceTarget === 'ipad' ? 'iPad' : 'iPhone';
    simulator.speed = 0;

    const currentPage = project.pages[currentPageIndex] ?? project.pages[0];
    const currentScreens = currentPage?.nodes.filter((n) => n.type === 'Frame') ?? [];
    if (!simulator.previewScreenId && currentScreens[0]) {
      const loginScreen = currentScreens.find(
        (s) => s.name.toLowerCase().includes('log in') || s.name.toLowerCase().includes('login'),
      );
      const isUserLoggedIn = Boolean(
        simulator.variables['currentUserId'] || simulator.variables['firebaseUser'],
      );
      simulator.previewScreenId = !isUserLoggedIn && loginScreen ? loginScreen.id : currentScreens[0].id;
    }

    simulator.primeVariables();
    simulator.runEvent(['onAppLaunch']);

    const activeScreenId = simulator.previewScreenId ?? currentScreens[0]?.id;
    if (activeScreenId) {
      simulator.runEvent(['onScreenLoad', 'onScreenOpened'], activeScreenId);
      simulator.scheduleScreenTimers(activeScreenId);
    }

    return () => {
      simulator.stopAllTimers();
    };
  }, [isOpen, simulator, logicViewModel, currentPageIndex, project.pages, deviceTarget]);

  // Handle active screen change
  useEffect(() => {
    if (!isOpen || !simulator.previewScreenId) return;
    simulator.runEvent(['onScreenLoad', 'onScreenOpened'], simulator.previewScreenId);
    simulator.scheduleScreenTimers(simulator.previewScreenId);
  }, [isOpen, simulator.previewScreenId, simulator]);

  // Subscribe to simulator updates (variable changes, navigation, toasts)
  useEffect(() => {
    return simulator.subscribe(() => setTick((t) => t + 1));
  }, [simulator]);

  if (!isOpen) return null;

  const currentPage = project.pages[currentPageIndex] ?? project.pages[0];
  const screens = currentPage?.nodes.filter((n) => n.type === 'Frame') ?? [];
  const currentScreen =
    screens.find((s) => s.id === simulator.previewScreenId) ?? screens[0];

  // Screen repeat list expansion & hit area computation
  const expandedScreen = currentScreen
    ? (() => {
        const originScreen: DesignNode = { ...currentScreen, x: 0, y: 0 };
        const [expandedChildren, cloneContexts] = RepeatBindingExpander.expandWithContext(
          originScreen.children,
          simulator.variables,
        );
        return {
          node: { ...originScreen, children: expandedChildren },
          cloneContexts,
        };
      })()
    : null;

  // Set of all node IDs connected to onTap / onDoubleTap / onLongPress / onSwipe blocks
  const tappableNodeIds = (() => {
    const ids = new Set<string>();
    for (const flow of logicViewModel.flows) {
      for (const block of flow.blocks) {
        if (
          block.type === 'onTap' ||
          block.type === 'onDoubleTap' ||
          block.type === 'onLongPress' ||
          block.type === 'onSwipe'
        ) {
          for (const p of block.parameters) {
            if ((p.key === 'element' || p.key === 'targetNode') && p.nodeReference) {
              ids.add(p.nodeReference);
            }
          }
          if (block.connectedDesignNodeId) {
            ids.add(block.connectedDesignNodeId);
          }
        }
      }
    }
    return ids;
  })();

  const hitAreas = expandedScreen
    ? collectHitAreas(
        expandedScreen.node.children,
        { x: 0, y: 0 },
        tappableNodeIds,
        expandedScreen.cloneContexts,
      )
    : [];

  const handleReset = () => {
    simulator.resetUI();
    if (currentScreen?.id) {
      simulator.runEvent(['onScreenLoad', 'onScreenOpened'], currentScreen.id);
    }
  };

  const screenWidth = currentScreen ? currentScreen.width : deviceTarget === 'iphone' ? 390 : 768;
  const screenHeight = currentScreen ? currentScreen.height : deviceTarget === 'iphone' ? 844 : 1024;

  const maxPreviewWidth = deviceTarget === 'iphone' ? 410 : 780;
  const maxPreviewHeight = typeof window !== 'undefined' ? window.innerHeight - 150 : 720;
  const scale = Math.min(
    maxPreviewWidth / screenWidth,
    maxPreviewHeight / screenHeight,
    0.82,
  );

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.82)',
        backdropFilter: 'blur(16px)',
        zIndex: 2000,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 14,
      }}
    >
      {/* Top Controls Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '8px 18px',
          backgroundColor: '#202227',
          borderRadius: 24,
          border: '1px solid var(--border-subtle)',
          boxShadow: '0 8px 30px rgba(0,0,0,0.6)',
        }}
      >
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            type="button"
            onClick={() => setDeviceTarget('iphone')}
            style={pillStyle(deviceTarget === 'iphone')}
          >
            <SFSymbol name="iphone" size={12} />
            <span>iPhone</span>
          </button>
          <button
            type="button"
            onClick={() => setDeviceTarget('ipad')}
            style={pillStyle(deviceTarget === 'ipad')}
          >
            <SFSymbol name="ipad" size={12} />
            <span>iPad</span>
          </button>
        </div>

        <div style={{ width: 1, height: 16, backgroundColor: 'var(--border-subtle)' }} />

        {/* Screen Picker */}
        <select
          value={currentScreen?.id ?? ''}
          onChange={(e) => {
            simulator.previewScreenId = e.target.value;
          }}
          style={{
            padding: '4px 10px',
            borderRadius: 6,
            backgroundColor: 'rgba(0,0,0,0.4)',
            border: '1px solid var(--border-subtle)',
            color: 'var(--text-primary)',
            fontSize: 12,
            outline: 'none',
            cursor: 'pointer',
          }}
        >
          {screens.map((sc) => (
            <option key={sc.id} value={sc.id}>
              {sc.name}
            </option>
          ))}
        </select>

        <div style={{ width: 1, height: 16, backgroundColor: 'var(--border-subtle)' }} />

        {/* Reset State */}
        <button
          type="button"
          onClick={handleReset}
          title="Reset simulator state"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            background: 'none',
            border: 'none',
            color: 'var(--text-secondary)',
            fontSize: 12,
            cursor: 'pointer',
            padding: '4px 6px',
            borderRadius: 6,
          }}
        >
          <SFSymbol name="arrow.clockwise" size={12} />
          <span>Reset</span>
        </button>

        {/* Close */}
        <button
          type="button"
          onClick={onClose}
          title="Close preview"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 26,
            height: 26,
            borderRadius: '50%',
            backgroundColor: 'rgba(255,255,255,0.1)',
            border: 'none',
            color: 'var(--text-primary)',
            cursor: 'pointer',
          }}
        >
          <SFSymbol name="xmark" size={11} />
        </button>
      </div>

      {/* Hardware Device Shell */}
      <div
        style={{
          width: screenWidth * scale + 24,
          height: screenHeight * scale + 24,
          padding: 12,
          backgroundColor: '#0F1012',
          borderRadius: 54 * scale,
          border: '4px solid #383A42',
          boxShadow: '0 25px 70px rgba(0, 0, 0, 0.85), inset 0 0 4px rgba(255, 255, 255, 0.25)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          position: 'relative',
          overflow: 'hidden',
          boxSizing: 'border-box',
        }}
      >
        {/* Dynamic Island / Speaker Notch */}
        {deviceTarget === 'iphone' && (
          <div
            style={{
              position: 'absolute',
              top: 18,
              left: '50%',
              transform: 'translateX(-50%)',
              width: 120 * scale,
              height: 32 * scale,
              borderRadius: 16 * scale,
              backgroundColor: '#000000',
              zIndex: 100,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              paddingRight: 10 * scale,
              boxShadow: '0 1px 3px rgba(0,0,0,0.8)',
            }}
          >
            {/* Camera lens circle */}
            <div
              style={{
                width: 10 * scale,
                height: 10 * scale,
                borderRadius: '50%',
                backgroundColor: '#111827',
                border: '1px solid #1F2937',
              }}
            />
          </div>
        )}

        {/* Screen Container */}
        <div
          style={{
            width: screenWidth * scale,
            height: screenHeight * scale,
            backgroundColor: currentScreen?.style.fill ?? '#000000',
            borderRadius: 44 * scale,
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          {expandedScreen ? (
            <div
              style={{
                width: screenWidth,
                height: screenHeight,
                transform: `scale(${scale})`,
                transformOrigin: '0 0',
                position: 'relative',
              }}
            >
              {/* Full screen rendered cleanly from origin (0, 0) */}
              <CanvasNodeView
                node={expandedScreen.node}
                parentOffset={{ x: 0, y: 0 }}
                selectedNodeId={undefined}
              />

              {/* Interactive Hit Areas Layer: live buttons, inputs, tappable cards */}
              {hitAreas.map((hit) => {
                if (hit.type === 'Input') {
                  return (
                    <input
                      key={`input-${hit.nodeId}-${hit.rect.x}-${hit.rect.y}`}
                      type="text"
                      defaultValue={hit.text ?? ''}
                      placeholder={hit.placeholder ?? ''}
                      onChange={(e) => {
                        simulator.setInputValue(hit.flowNodeId, e.target.value);
                      }}
                      onBlur={(e) => {
                        simulator.setInputValue(hit.flowNodeId, e.target.value);
                        simulator.runEvent(['onSubmit'], hit.flowNodeId);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          (e.target as HTMLInputElement).blur();
                        }
                      }}
                      style={{
                        position: 'absolute',
                        left: hit.rect.x,
                        top: hit.rect.y,
                        width: hit.rect.width,
                        height: hit.rect.height,
                        backgroundColor: 'transparent',
                        border: 'none',
                        color: '#FFFFFF',
                        caretColor: '#C8FF3D',
                        fontSize: 14,
                        padding: '0 8px',
                        outline: 'none',
                        zIndex: 70,
                        boxSizing: 'border-box',
                        cursor: 'text',
                      }}
                    />
                  );
                }

                return (
                  <div
                    key={`hit-${hit.nodeId}-${hit.rect.x}-${hit.rect.y}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      simulator.runTap(hit.flowNodeId, hit.itemVariables ?? {});
                    }}
                    style={{
                      position: 'absolute',
                      left: hit.rect.x,
                      top: hit.rect.y,
                      width: hit.rect.width,
                      height: hit.rect.height,
                      borderRadius: hit.cornerRadius,
                      cursor: 'pointer',
                      zIndex: 60,
                      backgroundColor: 'transparent',
                      transition: 'background-color 0.12s ease, transform 0.08s ease',
                    }}
                    onMouseDown={(e) => {
                      e.currentTarget.style.transform = 'scale(0.98)';
                    }}
                    onMouseUp={(e) => {
                      e.currentTarget.style.transform = 'scale(1)';
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.06)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent';
                      e.currentTarget.style.transform = 'scale(1)';
                    }}
                    title={`Tap element`}
                  />
                );
              })}
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                color: 'var(--text-muted)',
                fontSize: 12,
              }}
            >
              No screens found
            </div>
          )}

          {/* Branch Choice Floating Overlay */}
          {simulator.awaitingChoice && (
            <div
              style={{
                position: 'absolute',
                bottom: 24,
                left: '50%',
                transform: 'translateX(-50%)',
                backgroundColor: 'rgba(25, 28, 33, 0.95)',
                backdropFilter: 'blur(12px)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 14,
                padding: '10px 14px',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                zIndex: 200,
                boxShadow: '0 8px 24px rgba(0,0,0,0.7)',
              }}
            >
              <span style={{ fontSize: 12, color: '#FFFFFF', fontWeight: 600 }}>
                {simulator.awaitingChoice.blockLabel}
              </span>
              {simulator.awaitingChoice.labels.map((label, idx) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => simulator.choose(idx)}
                  style={{
                    padding: '4px 12px',
                    borderRadius: 8,
                    border: 'none',
                    backgroundColor: idx === 0 ? '#10B981' : '#EF4444',
                    color: '#FFFFFF',
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {/* Toast Message Floating Capsule */}
          {simulator.toastMessage && (
            <div
              style={{
                position: 'absolute',
                bottom: 48,
                left: '50%',
                transform: 'translateX(-50%)',
                backgroundColor: 'rgba(15, 17, 20, 0.92)',
                backdropFilter: 'blur(10px)',
                color: '#FFFFFF',
                padding: '8px 18px',
                borderRadius: 20,
                fontSize: 12,
                fontWeight: 600,
                boxShadow: '0 8px 20px rgba(0,0,0,0.6)',
                zIndex: 150,
                pointerEvents: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              {simulator.toastMessage}
            </div>
          )}
        </div>

        {/* iOS Home Indicator Bar */}
        <div
          style={{
            position: 'absolute',
            bottom: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 134 * scale,
            height: 5 * scale,
            borderRadius: 3 * scale,
            backgroundColor: '#FFFFFF',
            opacity: 0.6,
            zIndex: 100,
          }}
        />
      </div>
    </div>
  );
}

function pillStyle(active: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    padding: '4px 10px',
    borderRadius: 16,
    fontSize: 11,
    fontWeight: active ? 600 : 400,
    color: active ? '#FFFFFF' : 'var(--text-secondary)',
    backgroundColor: active ? 'var(--accent-primary)' : 'transparent',
    border: 'none',
    cursor: 'pointer',
  };
}

export default AppPreviewView;
