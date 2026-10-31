// apps/web/src/views/agent/AgentLoopActivityView.tsx
//
// 1:1 port of Views/AgentLoopActivityView.swift.
// Live dashboard of a running AgentToolLoop: plan checklist, live tool transcript,
// interactive blocking question resolution, token/cost counters, and mid-run steering.

import React, { useState, useEffect, useRef } from 'react';
import { SFSymbol } from '../../components/SFSymbol';
import type { AgentToolLoop, PlanItem, TranscriptEntry } from '@agentic/core';

export interface AgentLoopActivityViewProps {
  loop: AgentToolLoop;
  steerText?: string;
  onSteerChange?: (val: string) => void;
}

export function AgentLoopActivityView({
  loop,
  steerText = '',
  onSteerChange,
}: AgentLoopActivityViewProps) {
  // Trigger re-render whenever the loop publishes state updates
  const [, setTick] = useState(0);
  const [localSteer, setLocalSteer] = useState(steerText);
  const [questionText, setQuestionText] = useState('');
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsub = loop.subscribe(() => {
      setTick((t) => t + 1);
    });
    return unsub;
  }, [loop]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [loop.transcript.length]);

  const currentSteer = onSteerChange ? steerText : localSteer;
  const setSteer = (val: string) => {
    if (onSteerChange) onSteerChange(val);
    else setLocalSteer(val);
  };

  const handleSendSteer = () => {
    const t = currentSteer.trim();
    if (!t) return;
    loop.steer(t);
    setSteer('');
  };

  const handleSendAnswer = () => {
    const t = questionText.trim();
    if (!t) return;
    loop.answer(t);
    setQuestionText('');
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        backgroundColor: 'rgba(255, 255, 255, 0.02)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 8,
        padding: 10,
      }}
    >
      {/* Plan Checklist */}
      {loop.plan.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            padding: 8,
            backgroundColor: 'rgba(0, 0, 0, 0.25)',
            borderRadius: 6,
            border: '1px solid var(--border-subtle)',
          }}
        >
          <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: 0.5 }}>
            Plan
          </span>
          {loop.plan.map((item) => (
            <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <SFSymbol
                name={
                  item.status === 'done'
                    ? 'checkmark.circle.fill'
                    : item.status === 'doing'
                    ? 'arrow.triangle.2.circlepath.circle.fill'
                    : 'circle'
                }
                size={13}
                color={
                  item.status === 'done'
                    ? 'var(--accent-success)'
                    : item.status === 'doing'
                    ? 'var(--accent-primary)'
                    : 'var(--text-muted)'
                }
              />
              <span
                style={{
                  fontSize: 11,
                  color: item.status === 'pending' ? 'var(--text-muted)' : 'var(--text-primary)',
                  textDecoration: item.status === 'done' ? 'line-through' : 'none',
                }}
              >
                {item.title}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Transcript Scroll Area */}
      {loop.transcript.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            maxHeight: 180,
            overflowY: 'auto',
            padding: 6,
            backgroundColor: 'rgba(0, 0, 0, 0.35)',
            borderRadius: 6,
            border: '1px solid var(--border-subtle)',
            gap: 6,
          }}
        >
          {loop.transcript.map((entry) => (
            <div key={entry.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
              <SFSymbol
                name={iconForKind(entry.kind)}
                size={12}
                color={colorForKind(entry.kind)}
              />
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)' }}>
                  {entry.title}
                </span>
                {entry.detail && (
                  <span
                    style={{
                      fontSize: 10,
                      color: 'var(--text-muted)',
                      wordBreak: 'break-word',
                      lineHeight: 1.3,
                    }}
                  >
                    {entry.detail}
                  </span>
                )}
              </div>
            </div>
          ))}
          <div ref={transcriptEndRef} />
        </div>
      )}

      {/* Interactive Blocking Question */}
      {loop.pendingQuestion && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            padding: 10,
            backgroundColor: 'rgba(79, 70, 229, 0.12)',
            border: '1px solid var(--accent-primary)',
            borderRadius: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--accent-primary)', fontWeight: 600, fontSize: 12 }}>
            <SFSymbol name="questionmark.bubble.fill" size={14} />
            <span>{loop.pendingQuestion.question}</span>
          </div>

          {loop.pendingQuestion.options && loop.pendingQuestion.options.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {loop.pendingQuestion.options.map((opt, idx) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => loop.answer(opt)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '6px 10px',
                    borderRadius: 6,
                    backgroundColor: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-primary)',
                    fontSize: 11,
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  <SFSymbol
                    name={idx === 0 ? 'star.fill' : 'circle'}
                    size={11}
                    color={idx === 0 ? '#F59E0B' : 'var(--text-muted)'}
                  />
                  <span>{opt}</span>
                </button>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type="text"
              placeholder="Or type your own answer..."
              value={questionText}
              onChange={(e) => setQuestionText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSendAnswer();
              }}
              style={{
                flex: 1,
                padding: '4px 8px',
                borderRadius: 6,
                backgroundColor: 'rgba(0, 0, 0, 0.3)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-primary)',
                fontSize: 11,
                outline: 'none',
              }}
            />
            <button
              type="button"
              onClick={handleSendAnswer}
              disabled={!questionText.trim()}
              style={{
                padding: '4px 10px',
                borderRadius: 6,
                backgroundColor: 'var(--accent-primary)',
                border: 'none',
                color: '#FFFFFF',
                fontSize: 11,
                cursor: 'pointer',
                opacity: questionText.trim() ? 1 : 0.5,
              }}
            >
              Answer
            </button>
            <button
              type="button"
              onClick={() => loop.skipQuestion()}
              style={{
                padding: '4px 8px',
                borderRadius: 6,
                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-muted)',
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              Skip
            </button>
          </div>
        </div>
      )}

      {/* Mid-Run Activity & Controls */}
      {loop.isRunning && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
          {/* Token counter / Cost */}
          {(loop.runPromptTokens > 0 || loop.runCostUSD > 0) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--text-muted)' }}>
              <SFSymbol name="dollarsign.circle" size={11} />
              <span>
                Run {loop.runPromptTokens.toLocaleString()} in · {loop.runCompletionTokens.toLocaleString()} out · ${loop.runCostUSD.toFixed(4)}
              </span>
              {loop.costApprovalRequired && (
                <span style={{ color: 'var(--accent-warning)', marginLeft: 4, fontWeight: 600 }}>
                  (approval needed)
                </span>
              )}
            </div>
          )}

          {/* Status Line */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                display: 'inline-block',
                width: 8,
                height: 8,
                borderRadius: '50%',
                backgroundColor: loop.isPaused
                  ? 'var(--accent-warning)'
                  : 'var(--accent-primary)',
                animation: loop.isPaused ? 'none' : 'pulse 1.5s infinite ease-in-out',
              }}
            />
            <span style={{ fontSize: 11, color: 'var(--text-secondary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {loop.statusLine || 'Working...'}
            </span>
          </div>

          {/* Steer Bar */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="text"
              placeholder="Steer the agent mid-run..."
              value={currentSteer}
              onChange={(e) => setSteer(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSendSteer();
              }}
              style={{
                flex: 1,
                padding: '5px 8px',
                borderRadius: 6,
                backgroundColor: 'rgba(0, 0, 0, 0.3)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-primary)',
                fontSize: 11,
                outline: 'none',
              }}
            />
            <button
              type="button"
              onClick={handleSendSteer}
              disabled={!currentSteer.trim()}
              style={{
                padding: '5px 10px',
                borderRadius: 6,
                backgroundColor: 'var(--accent-primary)',
                border: 'none',
                color: '#FFFFFF',
                fontSize: 11,
                cursor: 'pointer',
                opacity: currentSteer.trim() ? 1 : 0.5,
              }}
            >
              Send
            </button>

            {/* Pause / Resume */}
            <button
              type="button"
              onClick={() => (loop.isPaused ? loop.resume() : loop.pause())}
              title={loop.isPaused ? 'Resume run' : 'Pause run'}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 26,
                height: 26,
                borderRadius: 6,
                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid var(--border-subtle)',
                color: loop.isPaused ? 'var(--accent-success)' : 'var(--accent-warning)',
                cursor: 'pointer',
              }}
            >
              <SFSymbol name={loop.isPaused ? 'play.circle.fill' : 'pause.circle.fill'} size={15} />
            </button>

            {/* Cancel */}
            <button
              type="button"
              onClick={() => loop.cancel()}
              title="Cancel agent run"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 26,
                height: 26,
                borderRadius: 6,
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                color: 'var(--accent-danger)',
                cursor: 'pointer',
              }}
            >
              <SFSymbol name="stop.circle.fill" size={15} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function iconForKind(kind: TranscriptEntry['kind']): string {
  switch (kind) {
    case 'info': return 'text.bubble';
    case 'tool': return 'wrench.and.screwdriver';
    case 'result': return 'arrow.turn.down.right';
    case 'error': return 'exclamationmark.triangle';
    case 'steer': return 'person.wave.2';
    case 'done': return 'checkmark.seal.fill';
    default: return 'circle';
  }
}

function colorForKind(kind: TranscriptEntry['kind']): string {
  switch (kind) {
    case 'error': return 'var(--accent-danger)';
    case 'done': return 'var(--accent-success)';
    case 'steer': return 'var(--accent-primary)';
    case 'tool': return '#38BDF8';
    default: return 'var(--text-muted)';
  }
}

export default AgentLoopActivityView;
