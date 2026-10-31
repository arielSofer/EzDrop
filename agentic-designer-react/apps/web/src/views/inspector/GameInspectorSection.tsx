// apps/web/src/views/inspector/GameInspectorSection.tsx
//
// 1:1 port of Views/GameInspectorSection.swift.
// Interactive design controls for 2D game mechanics: gravity, flap strength,
// lives, timers, atmosphere, and win conditions.

import React from 'react';
import { useProjectStore } from '../../stores/projectStore';
import type { DesignNode, GameSceneSpec } from '@agentic/core';

interface GameInspectorSectionProps {
  node: DesignNode;
}

export function GameInspectorSection({ node }: GameInspectorSectionProps) {
  const updateSelectedNode = useProjectStore((s) => s.updateSelectedNode);
  const selectedNode = useProjectStore((s) => s.selectedNode());

  const currentNode = selectedNode ?? node;
  const spec: GameSceneSpec | undefined = currentNode.gameScene;

  if (!spec) return null;

  const mutate = (fn: (scene: GameSceneSpec) => void) => {
    updateSelectedNode((n) => {
      if (!n.gameScene) return;
      fn(n.gameScene);
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>
        Game Design
      </div>

      {/* Fall speed / Gravity */}
      <SliderRow
        label="Fall speed (gravity)"
        value={Math.round(-spec.gravity)}
        min={2}
        max={45}
        step={1}
        format={(v) => `${v}`}
        help="Higher = player falls faster"
        onChange={(v) => mutate((s) => { s.gravity = -v; })}
      />

      {/* Difficulty Ramp */}
      <SliderRow
        label="Difficulty ramp"
        value={spec.difficultyRamp ?? 1.0}
        min={0.7}
        max={1.0}
        step={0.01}
        format={(v) => (v >= 0.995 ? 'Constant' : `${v.toFixed(2)}x`)}
        help="Below 1.0, obstacles spawn faster over time"
        onChange={(v) => mutate((s) => { s.difficultyRamp = v >= 0.995 ? undefined : v; })}
      />

      <div style={{ height: 1, backgroundColor: 'var(--border-subtle)' }} />

      {/* Rules: Lives */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={labelStyle}>Lives</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            type="button"
            onClick={() => mutate((s) => {
              const cur = s.lives ?? 0;
              s.lives = cur <= 1 ? undefined : cur - 1;
            })}
            style={stepperBtnStyle}
          >
            -
          </button>
          <span style={{ fontSize: 11, minWidth: 20, textAlign: 'center', color: 'var(--text-primary)' }}>
            {spec.lives ?? 0}
          </span>
          <button
            type="button"
            onClick={() => mutate((s) => {
              const cur = s.lives ?? 0;
              s.lives = Math.min(9, cur + 1);
            })}
            style={stepperBtnStyle}
          >
            +
          </button>
        </div>
      </div>

      {/* Rules: Time limit */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={labelStyle}>Time limit</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            type="button"
            onClick={() => mutate((s) => {
              const cur = s.timeLimit ?? 0;
              s.timeLimit = cur <= 15 ? undefined : cur - 15;
            })}
            style={stepperBtnStyle}
          >
            -
          </button>
          <span style={{ fontSize: 11, minWidth: 32, textAlign: 'center', color: 'var(--text-primary)' }}>
            {spec.timeLimit ? `${spec.timeLimit}s` : 'off'}
          </span>
          <button
            type="button"
            onClick={() => mutate((s) => {
              const cur = s.timeLimit ?? 0;
              s.timeLimit = Math.min(600, cur + 15);
            })}
            style={stepperBtnStyle}
          >
            +
          </button>
        </div>
      </div>

      {spec.timeLimit !== undefined && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={labelStyle}>When time runs out</span>
          <select
            value={spec.timeUpAction}
            onChange={(e) => mutate((s) => { s.timeUpAction = e.target.value; })}
            style={selectInputStyle}
          >
            <option value="win">You win (survival)</option>
            <option value="gameOver">Game over</option>
          </select>
        </div>
      )}

      {/* Win score */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={labelStyle}>Win at score</span>
        <input
          type="text"
          placeholder="off"
          value={spec.winScore !== undefined ? String(spec.winScore) : ''}
          onChange={(e) => mutate((s) => {
            const val = e.target.value.trim();
            s.winScore = val ? parseInt(val, 10) || undefined : undefined;
          })}
          style={{ ...selectInputStyle, width: 64, textAlign: 'center' }}
        />
      </div>

      <div style={{ height: 1, backgroundColor: 'var(--border-subtle)' }} />

      {/* Presentation */}
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={spec.startPaused}
          onChange={(e) => mutate((s) => { s.startPaused = e.target.checked; })}
        />
        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Wait for first tap</span>
      </label>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={spec.showScore}
          onChange={(e) => mutate((s) => { s.showScore = e.target.checked; })}
        />
        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Show score HUD</span>
      </label>

      {/* Atmosphere */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={labelStyle}>Atmosphere</span>
        <select
          value={spec.ambient ?? 'none'}
          onChange={(e) => mutate((s) => { s.ambient = e.target.value === 'none' ? undefined : e.target.value; })}
          style={selectInputStyle}
        >
          <option value="none">None</option>
          <option value="snow">Snow</option>
          <option value="rain">Rain</option>
          <option value="bubbles">Bubbles</option>
          <option value="stars">Stars</option>
          <option value="leaves">Leaves</option>
        </select>
      </div>

      {/* Start overlay text */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={labelStyle}>Start overlay text</span>
        <input
          type="text"
          value={spec.tapToStartText}
          onChange={(e) => mutate((s) => { s.tapToStartText = e.target.value; })}
          style={textInputStyle}
        />
      </div>

      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
        Changes apply instantly — click into the game on the canvas to play-test.
      </div>
    </div>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  format,
  help,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  help: string;
  onChange: (v: number) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }} title={help}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={labelStyle}>{label}</span>
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: 'var(--accent-primary)', cursor: 'pointer' }}
      />
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--text-secondary)',
};

const stepperBtnStyle: React.CSSProperties = {
  width: 20,
  height: 20,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 4,
  backgroundColor: 'rgba(255, 255, 255, 0.05)',
  border: '1px solid var(--border-subtle)',
  color: 'var(--text-primary)',
  cursor: 'pointer',
  fontSize: 12,
};

const selectInputStyle: React.CSSProperties = {
  padding: '4px 8px',
  borderRadius: 6,
  backgroundColor: 'rgba(0, 0, 0, 0.3)',
  border: '1px solid var(--border-subtle)',
  color: 'var(--text-primary)',
  fontSize: 11,
  outline: 'none',
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

export default GameInspectorSection;
