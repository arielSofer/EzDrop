// apps/web/src/views/logic/FlowSimulatorPanel.tsx
//
// 1:1 port of Views/Logic/FlowSimulatorPanel.swift.
// Bottom console for the flow simulator: live execution step log, variable inspector,
// and interactive branch choice bar when an async flow requires user decisions.

import React, { useEffect, useRef, useState } from 'react';
import { SFSymbol } from '../../components/SFSymbol';
import type { LogicSimulator, SimLogEntry, BranchChoice } from '@agentic/core';

export interface FlowSimulatorPanelProps {
  simulator: LogicSimulator;
  onClose?: () => void;
}

export function FlowSimulatorPanel({ simulator, onClose }: FlowSimulatorPanelProps) {
  const [, setTick] = useState(0);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return simulator.subscribe(() => setTick((t) => t + 1));
  }, [simulator]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [simulator.log.length]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: 160,
        backgroundColor: '#1E1F23',
        borderTop: '1px solid var(--border-subtle)',
        userSelect: 'none',
        position: 'relative',
      }}
    >
      {/* Interactive Branch Choice Bar (when awaiting a branch decision) */}
      {simulator.awaitingChoice && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '6px 14px',
            backgroundColor: 'rgba(79, 70, 229, 0.9)',
            color: '#FFFFFF',
            zIndex: 100,
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600 }}>
            <SFSymbol name="questionmark.circle.fill" size={13} color="#FFFFFF" />
            <span>{simulator.awaitingChoice.blockLabel}: Choose branch</span>
          </div>

          <div style={{ display: 'flex', gap: 6 }}>
            {simulator.awaitingChoice.labels.map((label, idx) => (
              <button
                key={label}
                type="button"
                onClick={() => simulator.choose(idx)}
                style={{
                  padding: '3px 10px',
                  borderRadius: 4,
                  backgroundColor: idx === 0 ? '#10B981' : '#EF4444',
                  border: 'none',
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
        </div>
      )}

      {/* Split Console: Log on left, Variables on right */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Execution Log */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflowY: 'auto',
            padding: '8px 12px',
            gap: 4,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            fontSize: 11,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              Execution Console ({simulator.log.length} steps)
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                onClick={() => {
                  simulator.log = [];
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  fontSize: 10,
                  cursor: 'pointer',
                }}
              >
                Clear
              </button>
              {onClose && (
                <button
                  type="button"
                  onClick={onClose}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    padding: 0,
                  }}
                >
                  <SFSymbol name="xmark" size={10} />
                </button>
              )}
            </div>
          </div>

          {simulator.log.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontStyle: 'italic', padding: '12px 0' }}>
              Simulator idle. Run a flow or trigger an on-tap event to begin execution.
            </div>
          ) : (
            simulator.log.map((entry) => (
              <div
                key={entry.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  color: entry.isError ? 'var(--accent-danger)' : 'var(--text-primary)',
                  lineHeight: 1.4,
                }}
              >
                <SFSymbol
                  name={entry.icon}
                  size={11}
                  color={entry.isError ? 'var(--accent-danger)' : 'var(--text-muted)'}
                />
                <span>{entry.message}</span>
              </div>
            ))
          )}
          <div ref={logEndRef} />
        </div>

        {/* Live Variables Panel */}
        <div
          style={{
            width: 220,
            borderLeft: '1px solid var(--border-subtle)',
            backgroundColor: 'rgba(0, 0, 0, 0.2)',
            display: 'flex',
            flexDirection: 'column',
            overflowY: 'auto',
            padding: '8px 10px',
            gap: 4,
          }}
        >
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>
            Live Variables
          </span>

          {Object.keys(simulator.variables).length === 0 ? (
            <span style={{ fontSize: 10, color: 'var(--text-muted)', fontStyle: 'italic' }}>
              No variables defined
            </span>
          ) : (
            Object.entries(simulator.variables).map(([k, v]) => (
              <div
                key={k}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: 10,
                  padding: '3px 0',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
                }}
              >
                <span style={{ color: 'var(--text-muted)' }}>{k}</span>
                <span
                  style={{
                    color: 'var(--accent-primary)',
                    fontFamily: 'monospace',
                    fontWeight: 600,
                    maxWidth: 110,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default FlowSimulatorPanel;
