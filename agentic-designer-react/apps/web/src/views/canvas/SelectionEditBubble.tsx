// apps/web/src/views/canvas/SelectionEditBubble.tsx
//
// 1:1 port of Views/SelectionEditBubble.swift.
// Floating quick-edit pill anchored over bottom of the design canvas.

import React, { useState } from 'react';
import SFSymbol from '../../components/SFSymbol';
import { useProjectStore } from '../../stores/projectStore';
import { designAgentDesignHost } from '../../stores/projectHost';
import { DesignAgentService, AgentPipelineCoordinator } from '@agentic/core';

const pipeline = new AgentPipelineCoordinator();

export function SelectionEditBubble() {
  const selectedNodeId = useProjectStore((s) => s.selectedNodeId);
  const [prompt, setPrompt] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!selectedNodeId) return null;

  const handleRun = async () => {
    const instruction = prompt.trim();
    if (!instruction || isRunning) return;
    setIsRunning(true);
    setErrorMessage(null);

    try {
      const service = new DesignAgentService(designAgentDesignHost, pipeline);
      await service.runFullPipeline(instruction, true);
      setPrompt('');
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setIsRunning(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleRun();
    }
  };

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 18,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1200,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        pointerEvents: 'auto',
      }}
    >
      {errorMessage && (
        <div
          style={{
            fontSize: 11,
            color: 'var(--accent-red)',
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            padding: '2px 8px',
            borderRadius: 'var(--radius-sm)',
            maxWidth: 380,
            textAlign: 'center',
          }}
        >
          {errorMessage}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 14px',
          backgroundColor: 'rgba(37, 39, 45, 0.88)',
          backdropFilter: 'blur(20px)',
          border: '1px solid var(--border-color)',
          borderRadius: 24,
          boxShadow: '0 12px 32px rgba(0, 0, 0, 0.45)',
        }}
      >
        <SFSymbol name="sparkles" size={15} color="var(--accent-blue)" />
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isRunning}
          placeholder='Edit this element — e.g. "coral gradient, bolder title"'
          style={{
            width: 320,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            fontSize: 13,
            color: 'var(--text-primary)',
            padding: '4px 0',
          }}
        />

        <button
          type="button"
          disabled={isRunning || prompt.trim().length === 0}
          onClick={handleRun}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: prompt.trim().length > 0 ? 'var(--accent-blue)' : 'var(--text-dim)',
            cursor: prompt.trim().length > 0 ? 'pointer' : 'default',
          }}
        >
          {isRunning ? (
            <div
              style={{
                width: 14,
                height: 14,
                border: '2px solid var(--accent-blue)',
                borderTopColor: 'transparent',
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
              }}
            />
          ) : (
            <SFSymbol name="arrow.up.circle.fill" size={18} />
          )}
        </button>
      </div>
    </div>
  );
}

export default SelectionEditBubble;
