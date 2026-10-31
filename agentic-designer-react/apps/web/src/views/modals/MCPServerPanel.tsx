// apps/web/src/views/modals/MCPServerPanel.tsx
//
// 1:1 port of Views/MCPServerPanel.swift.
// Configures and monitors the embedded MCP server.

import React, { useState, useEffect } from 'react';
import { ModalDialog } from '../../components/ModalDialog';
import { SFSymbol } from '../../components/SFSymbol';
import { bridge } from '../../bridge/bridgeClient';
import type { MCPStatus, MCPCallLogEntry } from '../../bridge/protocol';

export interface MCPServerPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export function MCPServerPanel({ isOpen, onClose }: MCPServerPanelProps) {
  const [status, setStatus] = useState<MCPStatus>({
    isRunning: false,
    port: 8765,
    enabled: true,
    lastError: null,
    endpointURL: 'http://127.0.0.1:8765/mcp',
    claudeCodeCommand: 'claude mcp add agenticdesigner -- http://127.0.0.1:8765/mcp',
    editorConnected: true,
    toolCount: 0,
  });
  const [portInput, setPortInput] = useState('8765');
  const [callLog, setCallLog] = useState<MCPCallLogEntry[]>([]);
  const [copiedEndpoint, setCopiedEndpoint] = useState(false);
  const [copiedClaude, setCopiedClaude] = useState(false);

  const endpointURL = `http://127.0.0.1:${status.port}/mcp`;
  const claudeCodeCommand = `claude mcp add agenticdesigner -- http://127.0.0.1:${status.port}/mcp`;

  useEffect(() => {
    if (!isOpen) return;

    // Fetch initial status
    bridge.call('mcp.status').then((s) => {
      if (s) {
        setStatus(s);
        setPortInput(String(s.port));
      }
    });

    // Fetch initial log
    bridge.call('mcp.callLog').then((entries) => {
      if (entries) setCallLog(entries);
    });

    // Listen to log events
    const unsubLog = bridge.on('mcp.log', (entry) => {
      setCallLog((prev) => [...prev.slice(-199), entry]);
    });

    const unsubStatus = bridge.on('mcp.status', (s) => {
      setStatus(s);
      setPortInput(String(s.port));
    });

    return () => {
      unsubLog();
      unsubStatus();
    };
  }, [isOpen]);

  const handleToggleRunning = async () => {
    const next = !status.isRunning;
    const updated = await bridge.call('mcp.setEnabled', { enabled: next });
    if (updated) setStatus(updated);
  };

  const handlePortBlur = async () => {
    const portNum = Number.parseInt(portInput, 10);
    if (portNum >= 1024 && portNum <= 65535 && portNum !== status.port) {
      const updated = await bridge.call('mcp.setPort', { port: portNum });
      if (updated) setStatus(updated);
    } else {
      setPortInput(String(status.port));
    }
  };

  const copyToClipboard = async (text: string, setCopied: (val: boolean) => void) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <ModalDialog
      isOpen={isOpen}
      onClose={onClose}
      title="MCP Server"
      icon="point.3.connected.trianglepath.dotted"
      width={520}
      height={580}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Status card */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            backgroundColor: 'var(--bg-panel-secondary)',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border-color)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                backgroundColor: status.isRunning ? 'var(--accent-green)' : 'var(--text-dim)',
                boxShadow: status.isRunning ? '0 0 8px var(--accent-green)' : 'none',
              }}
            />
            <div>
              <div style={{ fontWeight: 600, fontSize: 13 }}>
                {status.isRunning ? 'Server Running' : 'Server Stopped'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {status.toolCount} tools registered & exposed
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <span>Port:</span>
              <input
                type="number"
                disabled={status.isRunning}
                value={portInput}
                onChange={(e) => setPortInput(e.target.value)}
                onBlur={handlePortBlur}
                style={{
                  width: 68,
                  padding: '3px 6px',
                  opacity: status.isRunning ? 0.6 : 1,
                  textAlign: 'center',
                }}
              />
            </div>
            <button
              type="button"
              onClick={handleToggleRunning}
              style={{
                padding: '5px 14px',
                borderRadius: 'var(--radius-md)',
                backgroundColor: status.isRunning ? 'var(--accent-red)' : 'var(--accent-green)',
                color: '#ffffff',
                fontWeight: 600,
                fontSize: 12,
              }}
            >
              {status.isRunning ? 'Stop' : 'Start'}
            </button>
          </div>
        </div>

        {/* Connect Instructions */}
        {status.isRunning && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
              Connect Your AI Agent
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 12px',
                backgroundColor: 'var(--bg-input)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-color)',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {endpointURL}
              </span>
              <button
                type="button"
                onClick={() => copyToClipboard(endpointURL, setCopiedEndpoint)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--accent-blue)', marginLeft: 8 }}
              >
                <SFSymbol name={copiedEndpoint ? 'checkmark' : 'doc.on.doc'} size={12} />
                <span>{copiedEndpoint ? 'Copied' : 'Copy'}</span>
              </button>
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 12px',
                backgroundColor: 'var(--bg-input)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-color)',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {claudeCodeCommand}
              </span>
              <button
                type="button"
                onClick={() => copyToClipboard(claudeCodeCommand, setCopiedClaude)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--accent-blue)', marginLeft: 8 }}
              >
                <SFSymbol name={copiedClaude ? 'checkmark' : 'doc.on.doc'} size={12} />
                <span>{copiedClaude ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>
        )}

        {/* Activity Call Log */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
            Activity Log
          </div>
          <div
            style={{
              height: 180,
              backgroundColor: 'var(--bg-input)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-md)',
              padding: 8,
              overflowY: 'auto',
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            {callLog.length === 0 ? (
              <span style={{ color: 'var(--text-dim)', fontStyle: 'italic' }}>
                No MCP calls yet. Connect Claude Code to execute tools.
              </span>
            ) : (
              callLog.map((log) => (
                <div key={log.id} style={{ display: 'flex', gap: 8, color: 'var(--text-secondary)' }}>
                  <span style={{ color: 'var(--text-dim)' }}>
                    {new Date(log.date).toLocaleTimeString()}
                  </span>
                  <span>{log.message}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </ModalDialog>
  );
}

export default MCPServerPanel;
