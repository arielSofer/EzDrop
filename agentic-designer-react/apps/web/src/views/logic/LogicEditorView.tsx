// apps/web/src/views/logic/LogicEditorView.tsx
//
// 1:1 port of Views/Logic/LogicEditorView.swift.
// Center workspace in Logic Mode: flow switcher toolbar, validation badges,
// modal triggers (Firebase, APIs, interactive App Preview), canvas viewport,
// and bottom simulator console.

import React, { useState } from 'react';
import { useLogicViewModel, useLogicSimulator } from '../../stores/logicStore';
import { SFSymbol } from '../../components/SFSymbol';
import { LogicCanvasView } from './LogicCanvasView';
import { FlowSimulatorPanel } from './FlowSimulatorPanel';
import { FirebaseConfigView } from './FirebaseConfigView';
import { APIEndpointManagerView } from './APIEndpointManagerView';
import { AppPreviewView } from './AppPreviewView';

export function LogicEditorView() {
  const logicViewModel = useLogicViewModel();
  const simulator = useLogicSimulator();

  const [showFirebaseModal, setShowFirebaseModal] = useState(false);
  const [showAPIModal, setShowAPIModal] = useState(false);
  const [showAppPreview, setShowAppPreview] = useState(false);
  const [showSimulatorConsole, setShowSimulatorConsole] = useState(false);
  const [showIssuesPopover, setShowIssuesPopover] = useState(false);

  const currentFlow = logicViewModel.currentFlow;
  const issues = logicViewModel.validationIssues;

  const handleCreateFlow = () => {
    logicViewModel.createFlow(`Flow ${logicViewModel.flows.length + 1}`);
  };

  const handleDuplicateFlow = () => {
    if (currentFlow) {
      const newId = crypto.randomUUID();
      const duplicated = {
        ...currentFlow,
        id: newId,
        name: `${currentFlow.name} Copy`,
        blocks: currentFlow.blocks.map((b) => ({ ...b, id: crypto.randomUUID() })),
        connections: [...currentFlow.connections],
      };
      logicViewModel.flows = [...logicViewModel.flows, duplicated];
      logicViewModel.currentFlowId = newId;
    }
  };

  const handleDeleteFlow = () => {
    if (currentFlow && logicViewModel.flows.length > 1) {
      if (confirm(`Delete flow "${currentFlow.name}"?`)) {
        logicViewModel.deleteFlow(currentFlow.id);
      }
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* Flow Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: 44,
          padding: '0 12px',
          backgroundColor: '#1E1F23',
          borderBottom: '1px solid var(--border-subtle)',
          userSelect: 'none',
          gap: 12,
        }}
      >
        {/* Left: Flow Switcher & Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <SFSymbol name="bolt.fill" size={14} color="#F59E0B" />

          <select
            value={logicViewModel.currentFlowId ?? ''}
            onChange={(e) => {
              logicViewModel.currentFlowId = e.target.value;
              logicViewModel.validate();
            }}
            style={{
              padding: '4px 8px',
              borderRadius: 6,
              backgroundColor: 'rgba(0,0,0,0.3)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-primary)',
              fontSize: 12,
              fontWeight: 600,
              outline: 'none',
              minWidth: 140,
            }}
          >
            {logicViewModel.flows.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={handleCreateFlow}
            title="New Flow"
            style={toolbarIconBtnStyle}
          >
            <SFSymbol name="plus.circle" size={13} />
          </button>

          <button
            type="button"
            onClick={handleDuplicateFlow}
            title="Duplicate Current Flow"
            style={toolbarIconBtnStyle}
          >
            <SFSymbol name="plus.square.on.square" size={13} />
          </button>

          {logicViewModel.flows.length > 1 && (
            <button
              type="button"
              onClick={handleDeleteFlow}
              title="Delete Current Flow"
              style={{ ...toolbarIconBtnStyle, color: 'var(--accent-danger)' }}
            >
              <SFSymbol name="trash" size={13} color="var(--accent-danger)" />
            </button>
          )}

          {/* Validation Issues Badge */}
          {issues.length > 0 && (
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                onClick={() => setShowIssuesPopover(!showIssuesPopover)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '3px 8px',
                  borderRadius: 12,
                  backgroundColor: 'rgba(239, 68, 68, 0.15)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  color: 'var(--accent-danger)',
                  fontSize: 10,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                <SFSymbol name="exclamationmark.triangle.fill" size={11} color="var(--accent-danger)" />
                <span>{issues.length} {issues.length === 1 ? 'issue' : 'issues'}</span>
              </button>

              {showIssuesPopover && (
                <div
                  style={{
                    position: 'absolute',
                    top: 28,
                    left: 0,
                    backgroundColor: '#25272D',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 8,
                    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                    padding: 8,
                    zIndex: 1000,
                    minWidth: 260,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                    Validation Diagnostics
                  </span>
                  {issues.map((iss, idx) => (
                    <div key={idx} style={{ fontSize: 11, color: 'var(--text-primary)', display: 'flex', gap: 6 }}>
                      <span style={{ color: 'var(--accent-danger)' }}>•</span>
                      <span>{iss.message}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: Modal Triggers & Simulator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            onClick={() => setShowFirebaseModal(true)}
            style={actionPillStyle}
          >
            <SFSymbol name="flame.fill" size={12} color="#F59E0B" />
            <span>Firebase</span>
          </button>

          <button
            type="button"
            onClick={() => setShowAPIModal(true)}
            style={actionPillStyle}
          >
            <SFSymbol name="network" size={12} color="#A855F7" />
            <span>APIs</span>
          </button>

          <div style={{ width: 1, height: 16, backgroundColor: 'var(--border-subtle)' }} />

          {/* Interactive Preview Trigger */}
          <button
            type="button"
            onClick={() => setShowAppPreview(true)}
            style={{
              ...actionPillStyle,
              backgroundColor: 'rgba(79, 70, 229, 0.2)',
              border: '1px solid rgba(79, 70, 229, 0.4)',
              color: 'var(--accent-primary)',
              fontWeight: 600,
            }}
          >
            <SFSymbol name="iphone" size={13} color="var(--accent-primary)" />
            <span>Run App</span>
          </button>

          {/* Simulator Console Drawer Toggle */}
          <button
            type="button"
            onClick={() => setShowSimulatorConsole(!showSimulatorConsole)}
            title="Toggle simulator console"
            style={{
              ...toolbarIconBtnStyle,
              backgroundColor: showSimulatorConsole ? 'rgba(255,255,255,0.1)' : 'transparent',
            }}
          >
            <SFSymbol name="terminal" size={13} />
          </button>
        </div>
      </div>

      {/* Main Block Canvas */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <LogicCanvasView />
      </div>

      {/* Bottom Simulator Console */}
      {showSimulatorConsole && (
        <FlowSimulatorPanel
          simulator={simulator}
          onClose={() => setShowSimulatorConsole(false)}
        />
      )}

      {/* Modals */}
      <FirebaseConfigView
        isOpen={showFirebaseModal}
        onClose={() => setShowFirebaseModal(false)}
      />

      <APIEndpointManagerView
        isOpen={showAPIModal}
        onClose={() => setShowAPIModal(false)}
      />

      <AppPreviewView
        simulator={simulator}
        isOpen={showAppPreview}
        onClose={() => setShowAppPreview(false)}
      />
    </div>
  );
}

const toolbarIconBtnStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 28,
  borderRadius: 6,
  backgroundColor: 'transparent',
  border: 'none',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  transition: 'background-color 0.1s ease',
};

const actionPillStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  padding: '4px 10px',
  borderRadius: 6,
  backgroundColor: 'rgba(255, 255, 255, 0.04)',
  border: '1px solid var(--border-subtle)',
  color: 'var(--text-secondary)',
  fontSize: 11,
  cursor: 'pointer',
  transition: 'all 0.15s ease',
};

export default LogicEditorView;
