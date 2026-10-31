// apps/web/src/views/logic/APIEndpointManagerView.tsx
//
// 1:1 port of Views/Logic/APIEndpointManagerView.swift.
// Modal sheet for managing project API endpoints, query parameters,
// headers, JSON body templates, with a live "Test Endpoint" runner.

import React, { useState } from 'react';
import { ModalDialog } from '../../components/ModalDialog';
import { SFSymbol } from '../../components/SFSymbol';
import { useProjectStore } from '../../stores/projectStore';
import {
  makeAPIEndpointConfig,
  apiEndpointFullURL,
  AllHTTPMethod,
  type APIEndpointConfig,
  type HTTPMethod,
} from '@agentic/core';

export interface APIEndpointManagerViewProps {
  isOpen: boolean;
  onClose: () => void;
}

export function APIEndpointManagerView({ isOpen, onClose }: APIEndpointManagerViewProps) {
  const project = useProjectStore((s) => s.project);
  const mutateProject = useProjectStore((s) => s.mutateProject);

  const [endpoints, setEndpoints] = useState<APIEndpointConfig[]>(
    () => project.apiEndpoints ?? [],
  );
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    endpoints.length > 0 ? endpoints[0]!.id : null,
  );
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const selectedEndpoint = endpoints.find((e) => e.id === selectedId);

  const handleAddEndpoint = () => {
    const ep = makeAPIEndpointConfig({ name: `Endpoint ${endpoints.length + 1}` });
    setEndpoints((prev) => [...prev, ep]);
    setSelectedId(ep.id);
  };

  const handleDeleteEndpoint = (id: string) => {
    setEndpoints((prev) => prev.filter((e) => e.id !== id));
    if (selectedId === id) {
      setSelectedId(endpoints.find((e) => e.id !== id)?.id ?? null);
    }
  };

  const updateSelected = (fn: (ep: APIEndpointConfig) => void) => {
    if (!selectedId) return;
    setEndpoints((prev) =>
      prev.map((e) => {
        if (e.id !== selectedId) return e;
        const copy = { ...e };
        fn(copy);
        return copy;
      }),
    );
  };

  const handleTest = async () => {
    if (!selectedEndpoint) return;
    const url = apiEndpointFullURL(selectedEndpoint);
    if (!url) return;

    setIsTesting(true);
    setTestResult(null);

    try {
      const res = await fetch(url, {
        method: selectedEndpoint.method,
        headers: Object.fromEntries(selectedEndpoint.headers.map((h) => [h.key, h.value])),
        body: ['POST', 'PUT', 'PATCH'].includes(selectedEndpoint.method)
          ? selectedEndpoint.bodyTemplate
          : undefined,
      });
      const data = await res.json();
      setTestResult(JSON.stringify(data, null, 2));
    } catch (err) {
      setTestResult(`Error: ${(err as Error).message}`);
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = () => {
    mutateProject((p) => {
      p.apiEndpoints = endpoints;
    });
    onClose();
  };

  return (
    <ModalDialog
      isOpen={isOpen}
      onClose={onClose}
      title="API Endpoints Manager"
      icon="network"
      width={680}
    >
      <div style={{ display: 'flex', height: 480, gap: 12 }}>
        {/* Left Endpoints List */}
        <div
          style={{
            width: 200,
            borderRight: '1px solid var(--border-subtle)',
            paddingRight: 10,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              Endpoints ({endpoints.length})
            </span>
            <button
              type="button"
              onClick={handleAddEndpoint}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '3px 8px',
                borderRadius: 4,
                backgroundColor: 'rgba(255, 255, 255, 0.08)',
                border: 'none',
                color: 'var(--text-primary)',
                fontSize: 10,
                cursor: 'pointer',
              }}
            >
              <SFSymbol name="plus" size={10} />
              <span>Add</span>
            </button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {endpoints.map((ep) => {
              const isSel = ep.id === selectedId;
              return (
                <div
                  key={ep.id}
                  onClick={() => setSelectedId(ep.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '6px 8px',
                    borderRadius: 6,
                    backgroundColor: isSel ? 'rgba(79, 70, 229, 0.2)' : 'transparent',
                    border: isSel ? '1px solid rgba(79, 70, 229, 0.4)' : '1px solid transparent',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: isSel ? '#FFFFFF' : 'var(--text-primary)' }}>
                      {ep.name || 'Unnamed'}
                    </span>
                    <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>
                      {ep.method} {ep.path || '/'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteEndpoint(ep.id);
                    }}
                    style={{ background: 'none', border: 'none', color: 'var(--accent-danger)', cursor: 'pointer', padding: 0 }}
                  >
                    <SFSymbol name="trash" size={11} color="var(--accent-danger)" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Detail & Configuration */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12, paddingLeft: 4 }}>
          {selectedEndpoint ? (
            <>
              {/* Name & Method */}
              <div style={{ display: 'flex', gap: 8 }}>
                <select
                  value={selectedEndpoint.method}
                  onChange={(e) => updateSelected((ep) => { ep.method = e.target.value as HTTPMethod; })}
                  style={{ ...selectStyle, width: 90 }}
                >
                  {AllHTTPMethod.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  placeholder="Endpoint name"
                  value={selectedEndpoint.name}
                  onChange={(e) => updateSelected((ep) => { ep.name = e.target.value; })}
                  style={{ ...inputStyle, flex: 1 }}
                />
              </div>

              {/* URL & Path */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={labelStyle}>Base URL</span>
                <input
                  type="text"
                  placeholder="https://api.example.com"
                  value={selectedEndpoint.baseURL}
                  onChange={(e) => updateSelected((ep) => { ep.baseURL = e.target.value; })}
                  style={inputStyle}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={labelStyle}>Path</span>
                <input
                  type="text"
                  placeholder="/v1/users"
                  value={selectedEndpoint.path}
                  onChange={(e) => updateSelected((ep) => { ep.path = e.target.value; })}
                  style={inputStyle}
                />
              </div>

              {/* Body Template (for POST/PUT/PATCH) */}
              {['POST', 'PUT', 'PATCH'].includes(selectedEndpoint.method) && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={labelStyle}>JSON Body Template</span>
                  <textarea
                    rows={3}
                    placeholder='{"key": "{{variableName}}"}'
                    value={selectedEndpoint.bodyTemplate ?? ''}
                    onChange={(e) => updateSelected((ep) => { ep.bodyTemplate = e.target.value; })}
                    style={{ ...inputStyle, resize: 'vertical', fontFamily: 'monospace' }}
                  />
                </div>
              )}

              {/* Test Runner */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                <button
                  type="button"
                  onClick={handleTest}
                  disabled={isTesting || !selectedEndpoint.baseURL}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    padding: '6px 12px',
                    borderRadius: 6,
                    backgroundColor: 'rgba(79, 70, 229, 0.2)',
                    border: '1px solid rgba(79, 70, 229, 0.4)',
                    color: 'var(--accent-primary)',
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  <SFSymbol name="play.circle.fill" size={13} />
                  <span>{isTesting ? 'Executing request...' : 'Test Endpoint'}</span>
                </button>

                {testResult && (
                  <pre
                    style={{
                      maxHeight: 120,
                      overflowY: 'auto',
                      padding: 8,
                      borderRadius: 6,
                      backgroundColor: 'rgba(0,0,0,0.5)',
                      border: '1px solid var(--border-subtle)',
                      fontSize: 10,
                      color: 'var(--text-primary)',
                      fontFamily: 'monospace',
                    }}
                  >
                    {testResult}
                  </pre>
                )}
              </div>
            </>
          ) : (
            <div
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text-muted)',
                fontSize: 12,
              }}
            >
              Select or create an endpoint on the left
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border-subtle)' }}>
        <button
          type="button"
          onClick={onClose}
          style={{
            padding: '6px 14px',
            borderRadius: 6,
            backgroundColor: 'transparent',
            border: '1px solid var(--border-subtle)',
            color: 'var(--text-secondary)',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          style={{
            padding: '6px 16px',
            borderRadius: 6,
            backgroundColor: 'var(--accent-primary)',
            border: 'none',
            color: '#FFFFFF',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Save
        </button>
      </div>
    </ModalDialog>
  );
}

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  color: 'var(--text-muted)',
};

const selectStyle: React.CSSProperties = {
  padding: '6px 8px',
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
  padding: '6px 8px',
  borderRadius: 6,
  backgroundColor: 'rgba(0, 0, 0, 0.3)',
  border: '1px solid var(--border-subtle)',
  color: 'var(--text-primary)',
  fontSize: 11,
  outline: 'none',
};

export default APIEndpointManagerView;
