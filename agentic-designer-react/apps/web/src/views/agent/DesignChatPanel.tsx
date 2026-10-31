// apps/web/src/views/agent/DesignChatPanel.tsx
//
// 1:1 port of Views/DesignChatPanel.swift.
// Conversational AI agent panel with chat message history, point-in-time
// checkpoints and restore rollback, model picker, and embedded tool activity.

import React, { useState, useEffect, useRef } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { designAgentDesignHost } from '../../stores/projectHost';
import { SFSymbol } from '../../components/SFSymbol';
import {
  OpenRouterConfiguration,
  DesignChatSession,
  AgentToolLoop,
  AgentPipelineCoordinator,
  DesignAgentService,
  CheckpointStore,
} from '@agentic/core';
import type { ChatMessage } from '@agentic/core';
import { AgentLoopActivityView } from './AgentLoopActivityView';

export interface DesignChatPanelProps {
  session?: DesignChatSession;
  loop?: AgentToolLoop;
  pipeline?: AgentPipelineCoordinator;
}

export function DesignChatPanel({
  session: externalSession,
  loop: externalLoop,
  pipeline: externalPipeline,
}: DesignChatPanelProps) {
  const [session] = useState(() => externalSession ?? new DesignChatSession());
  const [pipeline] = useState(() => externalPipeline ?? new AgentPipelineCoordinator());
  const [loop] = useState(
    () =>
      externalLoop ??
      new AgentToolLoop({
        design: designAgentDesignHost,
      }),
  );

  const [, setTick] = useState(0);
  const [input, setInput] = useState('');
  const [steerText, setSteerText] = useState('');
  const [engine, setEngine] = useState<'loop' | 'build' | 'edit'>('loop');
  const [model, setModel] = useState(
    () => localStorage.getItem('openRouterModel') ?? OpenRouterConfiguration.model,
  );

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const project = useProjectStore((s) => s.project);

  useEffect(() => {
    const unsubSession = session.subscribe(() => setTick((t) => t + 1));
    const unsubLoop = loop.subscribe(() => setTick((t) => t + 1));
    return () => {
      unsubSession();
      unsubLoop();
    };
  }, [session, loop]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [session.messages.length, loop.transcript.length]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || session.isRunning) return;

    // Snapshot current project before turn runs
    const cp = await CheckpointStore.save(project, `before: ${text.slice(0, 30)}`);
    const checkpoint = cp ? { ...cp, url: cp.id } : undefined;
    const agentMsgId = session.appendUser(text, checkpoint);
    setInput('');

    try {
      if (engine === 'loop') {
        await loop.run(text);
        session.finish(agentMsgId, 'Agent completed all requested actions.');
      } else {
        session.updateStage(agentMsgId, 'Executing design pipeline...');
        const service = new DesignAgentService(designAgentDesignHost, pipeline);
        const result = await service.runFullPipeline(text, engine === 'build');
        session.finish(agentMsgId, result ? 'Design updated successfully.' : 'Finished.');
      }
    } catch (err) {
      session.fail(agentMsgId, (err as Error).message || 'Agent failed');
    }
  };

  const handleRevert = async (msg: ChatMessage) => {
    if (!msg.checkpoint) return;
    if (confirm('Revert the design back to the state before this message?')) {
      await session.revert(msg, designAgentDesignHost, CheckpointStore);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: 320,
        height: '100%',
        backgroundColor: 'var(--bg-panel)',
        borderLeft: '1px solid var(--border-subtle)',
        userSelect: 'none',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 16px 10px',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <SFSymbol name="bubble.left.and.text.bubble.right" size={14} color="var(--accent-primary)" />
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Chat Agent
          </span>
        </div>

        {session.messages.length > 0 && (
          <button
            type="button"
            onClick={() => session.clear()}
            title="Clear conversation"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 24,
              height: 24,
              borderRadius: 6,
              backgroundColor: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            <SFSymbol name="trash" size={12} />
          </button>
        )}
      </div>

      {/* Messages Scroll Thread */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '12px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        {session.messages.length === 0 ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              padding: '16px 8px',
              color: 'var(--text-muted)',
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
              Describe what you want to create.
            </span>
            <span style={{ fontSize: 11, lineHeight: 1.4 }}>
              "A habit tracker with daily streaks, progress rings, and a paywall."
            </span>
            <span style={{ fontSize: 11, lineHeight: 1.4 }}>
              The agent designs screens, wires logic flows, connects APIs, and verifies the layout.
            </span>
          </div>
        ) : (
          session.messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} onRevert={() => handleRevert(msg)} />
          ))
        )}

        {/* Live Loop Activity in thread */}
        {(loop.isRunning || loop.plan.length > 0) && (
          <AgentLoopActivityView
            loop={loop}
            steerText={steerText}
            onSteerChange={setSteerText}
          />
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Composer Area */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          padding: '10px 14px 14px',
          borderTop: '1px solid var(--border-subtle)',
          backgroundColor: 'var(--bg-app)',
        }}
      >
        {/* Engine & Model selectors */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['loop', 'build', 'edit'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setEngine(m)}
                style={pillStyle(engine === m)}
              >
                {m.charAt(0).toUpperCase() + m.slice(1)}
              </button>
            ))}
          </div>

          <select
            value={model}
            onChange={(e) => {
              setModel(e.target.value);
              localStorage.setItem('openRouterModel', e.target.value);
            }}
            style={{
              padding: '3px 6px',
              borderRadius: 4,
              backgroundColor: 'rgba(0,0,0,0.3)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-secondary)',
              fontSize: 10,
              outline: 'none',
              maxWidth: 130,
            }}
          >
            {OpenRouterConfiguration.availableModels.slice(0, 8).map((m) => (
              <option key={m.id} value={m.id}>
                {m.label.split('—')[0].trim()}
              </option>
            ))}
          </select>
        </div>

        {/* Input & Send button */}
        <div style={{ display: 'flex', gap: 6 }}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Ask anything or request changes..."
            rows={2}
            style={{
              flex: 1,
              padding: '6px 8px',
              borderRadius: 6,
              backgroundColor: 'rgba(0, 0, 0, 0.3)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-primary)',
              fontSize: 11,
              outline: 'none',
              resize: 'none',
              fontFamily: 'inherit',
            }}
          />

          <button
            type="button"
            onClick={handleSend}
            disabled={session.isRunning || !input.trim()}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 36,
              height: 36,
              borderRadius: 6,
              backgroundColor: 'var(--accent-primary)',
              border: 'none',
              color: '#FFFFFF',
              cursor: 'pointer',
              opacity: session.isRunning || !input.trim() ? 0.5 : 1,
              alignSelf: 'flex-end',
            }}
          >
            <SFSymbol name="arrow.up" size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  onRevert,
}: {
  message: ChatMessage;
  onRevert: () => void;
}) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  if (isSystem) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          fontSize: 10,
          color: 'var(--text-muted)',
          fontStyle: 'italic',
          padding: '2px 8px',
        }}
      >
        {message.text}
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: isUser ? 'flex-end' : 'flex-start',
        gap: 4,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          maxWidth: '88%',
          padding: '8px 12px',
          borderRadius: 8,
          backgroundColor: isUser ? 'rgba(79, 70, 229, 0.25)' : 'rgba(255, 255, 255, 0.05)',
          border: isUser ? '1px solid rgba(79, 70, 229, 0.4)' : '1px solid var(--border-subtle)',
          color: 'var(--text-primary)',
          fontSize: 11,
          lineHeight: 1.4,
          wordBreak: 'break-word',
        }}
      >
        {message.isRunning && message.stage ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--accent-primary)' }}>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                backgroundColor: 'var(--accent-primary)',
                animation: 'pulse 1s infinite ease-in-out',
              }}
            />
            <span>{message.stage}</span>
          </div>
        ) : (
          <span>{message.text}</span>
        )}
      </div>

      {isUser && message.checkpoint && (
        <button
          type="button"
          onClick={onRevert}
          title="Restore project state before this prompt"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '2px 6px',
            borderRadius: 4,
            backgroundColor: 'transparent',
            border: 'none',
            color: 'var(--text-muted)',
            fontSize: 9,
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--accent-primary)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
        >
          <SFSymbol name="arrow.counterclockwise" size={9} />
          <span>Restore Checkpoint</span>
        </button>
      )}
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

export default DesignChatPanel;
