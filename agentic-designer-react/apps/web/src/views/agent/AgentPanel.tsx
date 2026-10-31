// apps/web/src/views/agent/AgentPanel.tsx
//
// 1:1 port of Views/AgentPanel.swift.
// Standalone agent controls: API keys configuration, provider fallbacks,
// model selector, run mode ("Agent Loop" vs "Pipeline"), prompt input,
// and live loop activity viewer.

import React, { useState, useEffect } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { designAgentDesignHost } from '../../stores/projectHost';
import { SFSymbol } from '../../components/SFSymbol';
import {
  OpenRouterConfiguration,
  ModelProviderCatalog,
  AgentToolLoop,
  AgentPipelineCoordinator,
  DesignAgentService,
} from '@agentic/core';
import { AgentLoopActivityView } from './AgentLoopActivityView';

export interface AgentPanelProps {
  loop?: AgentToolLoop;
  pipeline?: AgentPipelineCoordinator;
}

export function AgentPanel({ loop: externalLoop, pipeline: externalPipeline }: AgentPanelProps) {
  const [pipeline] = useState(() => externalPipeline ?? new AgentPipelineCoordinator());
  const [loop] = useState(
    () =>
      externalLoop ??
      new AgentToolLoop({
        design: designAgentDesignHost,
      }),
  );

  const [prompt, setPrompt] = useState('');
  const [steerText, setSteerText] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Settings stored in localStorage
  const [openRouterAPIKey, setOpenRouterAPIKey] = useState(
    () => localStorage.getItem('openRouterAPIKey') ?? '',
  );
  const [geminiAPIKey, setGeminiAPIKey] = useState(
    () => localStorage.getItem('geminiAPIKey') ?? '',
  );
  const [groqAPIKey, setGroqAPIKey] = useState(() => localStorage.getItem('groqAPIKey') ?? '');
  const [cerebrasAPIKey, setCerebrasAPIKey] = useState(
    () => localStorage.getItem('cerebrasAPIKey') ?? '',
  );
  const [selectedModel, setSelectedModel] = useState(
    () => localStorage.getItem('openRouterModel') ?? OpenRouterConfiguration.model,
  );
  const [runMode, setRunMode] = useState<'loop' | 'pipeline'>('loop');
  const [showKeys, setShowKeys] = useState(false);

  useEffect(() => {
    localStorage.setItem('openRouterAPIKey', openRouterAPIKey);
  }, [openRouterAPIKey]);
  useEffect(() => {
    localStorage.setItem('geminiAPIKey', geminiAPIKey);
  }, [geminiAPIKey]);
  useEffect(() => {
    localStorage.setItem('groqAPIKey', groqAPIKey);
  }, [groqAPIKey]);
  useEffect(() => {
    localStorage.setItem('cerebrasAPIKey', cerebrasAPIKey);
  }, [cerebrasAPIKey]);
  useEffect(() => {
    localStorage.setItem('openRouterModel', selectedModel);
  }, [selectedModel]);

  const handleRun = async () => {
    const text = prompt.trim();
    if (!text || isRunning) return;
    setIsRunning(true);
    setErrorMessage(null);

    try {
      if (runMode === 'loop') {
        await loop.run(text);
      } else {
        const service = new DesignAgentService(designAgentDesignHost, pipeline);
        await service.runFullPipeline(text, true);
      }
      setPrompt('');
    } catch (err) {
      setErrorMessage((err as Error).message || 'Run failed');
    } finally {
      setIsRunning(false);
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
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 16px 10px',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Autonomous Agent
        </span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            type="button"
            onClick={() => setRunMode('loop')}
            style={pillStyle(runMode === 'loop')}
          >
            Loop
          </button>
          <button
            type="button"
            onClick={() => setRunMode('pipeline')}
            style={pillStyle(runMode === 'pipeline')}
          >
            Pipeline
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '14px' }}>
        {/* Model Selector */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={labelStyle}>AI Model</span>
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            style={selectStyle}
          >
            {OpenRouterConfiguration.availableModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        {/* API Keys Accordion */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <button
            type="button"
            onClick={() => setShowKeys(!showKeys)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '6px 0',
              backgroundColor: 'transparent',
              border: 'none',
              color: 'var(--text-secondary)',
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            <span>Provider API Keys</span>
            <SFSymbol name={showKeys ? 'chevron.down' : 'chevron.right'} size={11} />
          </button>

          {showKeys && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 0' }}>
              <KeyInput
                label="OpenRouter"
                value={openRouterAPIKey}
                onChange={setOpenRouterAPIKey}
                placeholder="sk-or-v1-..."
              />
              <KeyInput
                label="Google AI Studio"
                value={geminiAPIKey}
                onChange={setGeminiAPIKey}
                placeholder="AIzaSy..."
              />
              <KeyInput
                label="Groq"
                value={groqAPIKey}
                onChange={setGroqAPIKey}
                placeholder="gsk_..."
              />
              <KeyInput
                label="Cerebras"
                value={cerebrasAPIKey}
                onChange={setCerebrasAPIKey}
                placeholder="csk-..."
              />
            </div>
          )}
        </div>

        <div style={{ height: 1, backgroundColor: 'var(--border-subtle)' }} />

        {/* Prompt Input */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={labelStyle}>Instructions</span>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                handleRun();
              }
            }}
            rows={4}
            placeholder="Describe an app to build, screen to add, or design changes..."
            style={textAreaStyle}
          />

          <button
            type="button"
            onClick={handleRun}
            disabled={isRunning || !prompt.trim()}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              width: '100%',
              padding: '8px 12px',
              borderRadius: 6,
              backgroundColor: 'var(--accent-primary)',
              border: 'none',
              color: '#FFFFFF',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              opacity: isRunning || !prompt.trim() ? 0.6 : 1,
            }}
          >
            <SFSymbol name={isRunning ? 'sparkles' : 'play.fill'} size={13} />
            <span>{isRunning ? 'Agent Working...' : 'Start Agent'}</span>
          </button>
        </div>

        {errorMessage && (
          <div
            style={{
              padding: '8px 10px',
              borderRadius: 6,
              backgroundColor: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: 'var(--accent-danger)',
              fontSize: 11,
            }}
          >
            {errorMessage}
          </div>
        )}

        {/* Live Loop Dashboard */}
        <AgentLoopActivityView
          loop={loop}
          steerText={steerText}
          onSteerChange={setSteerText}
        />
      </div>
    </div>
  );
}

function KeyInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{label}</span>
      <input
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          padding: '4px 8px',
          borderRadius: 6,
          backgroundColor: 'rgba(0, 0, 0, 0.3)',
          border: '1px solid var(--border-subtle)',
          color: 'var(--text-primary)',
          fontSize: 11,
          outline: 'none',
        }}
      />
    </div>
  );
}

function pillStyle(active: boolean): React.CSSProperties {
  return {
    padding: '3px 8px',
    borderRadius: 4,
    fontSize: 10,
    fontWeight: active ? 600 : 400,
    color: active ? 'var(--accent-primary)' : 'var(--text-muted)',
    backgroundColor: active ? 'rgba(79, 70, 229, 0.15)' : 'transparent',
    border: active ? '1px solid rgba(79, 70, 229, 0.4)' : '1px solid transparent',
    cursor: 'pointer',
  };
}

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--text-secondary)',
};

const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
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
  padding: '8px 10px',
  borderRadius: 6,
  backgroundColor: 'rgba(0, 0, 0, 0.3)',
  border: '1px solid var(--border-subtle)',
  color: 'var(--text-primary)',
  fontSize: 11,
  outline: 'none',
  resize: 'vertical',
  fontFamily: 'inherit',
};

export default AgentPanel;
