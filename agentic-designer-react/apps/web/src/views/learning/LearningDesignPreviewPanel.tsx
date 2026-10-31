// apps/web/src/views/learning/LearningDesignPreviewPanel.tsx
//
// Side-by-side design reference panel for Code Mode.
// Displays the student's frozen DesignSnapshot inside a phone mockup so the
// student can compare their Jetpack Compose code with their visual design.

import React, { useState } from 'react';
import { useLearningStore } from '../../stores/learningStore';
import { KotlinRuntimePreview } from './KotlinRuntimePreview';
import { DesignReferenceCanvas } from './DesignReferenceCanvas';
import SFSymbol from '../../components/SFSymbol';

export function LearningDesignPreviewPanel() {
  const designSnapshot = useLearningStore((s) => s.learningStage === 'code' ? s.designSnapshot : null);
  const activeTaskId = useLearningStore(s => s.activeKotlinTaskId);
  const selectScreen = useLearningStore(s => s.selectKotlinScreen);
  const [previewMode, setPreviewMode] = useState(true);
  const [isCollapsed, setIsCollapsed] = useState(false);

  if (!designSnapshot || designSnapshot.screens.length === 0) {
    return null;
  }

  const screens = designSnapshot.screens;
  const selectedScreenIndex = Math.max(0, screens.findIndex(screen => activeTaskId?.startsWith(`${screen.id}_kotlin_`)));
  const currentScreen = screens[selectedScreenIndex];

  if (isCollapsed) {
    return (
      <div
        style={{
          width: 36,
          height: '100%',
          backgroundColor: 'var(--bg-secondary, #12141A)',
          borderLeft: '1px solid var(--border-color, #232734)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          paddingTop: 12,
          gap: 12,
        }}
      >
        <button
          onClick={() => setIsCollapsed(false)}
          style={{
            background: 'none',
            border: 'none',
            color: '#3B82F6',
            cursor: 'pointer',
            padding: 4,
          }}
          title="פתח תצוגת עיצוב יעד"
        >
          <SFSymbol name="chevron.left" size={14} />
        </button>
        <span
          style={{
            writingMode: 'vertical-rl',
            transform: 'rotate(180deg)',
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--text-secondary, #9CA3AF)',
            letterSpacing: 1,
          }}
        >
          עיצוב היעד
        </span>
      </div>
    );
  }

  return (
    <div
      style={{
        width: 320,
        minWidth: 320,
        maxWidth: 340,
        height: '100%',
        backgroundColor: 'var(--bg-secondary, #12141A)',
        borderLeft: '1px solid var(--border-color, #232734)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* ─── Header ────────────────────────────────────────────── */}
      <div
        style={{
          padding: '10px 14px',
          borderBottom: '1px solid var(--border-color, #232734)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: 'rgba(255, 255, 255, 0.02)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <SFSymbol name="iphone" size={13} color="#3B82F6" />
          <span style={{ fontSize: 12, fontWeight: 700, color: '#FFFFFF' }}>{previewMode ? 'Preview מהקוד' : 'עיצוב היעד'}</span>
          <span
            style={{
              fontSize: 9,
              padding: '1px 5px',
              borderRadius: 4,
              backgroundColor: 'rgba(59, 130, 246, 0.2)',
              color: '#60A5FA',
            }}
          >
            {previewMode ? 'Live' : 'Reference'}
          </span>
        </div>

        <button
          onClick={() => setIsCollapsed(true)}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-muted, #9CA3AF)',
            cursor: 'pointer',
            padding: 4,
          }}
          title="צמצם פאנל"
        >
          <SFSymbol name="chevron.right" size={12} />
        </button>
      </div>

      <div role="group" aria-label="מצב תצוגה" dir="rtl" style={{ display: 'flex', gap: 6, padding: 8 }}>
        <button className="learning-control" aria-pressed={!previewMode} onClick={() => setPreviewMode(false)} style={{ flex: 1, padding: 8 }}>עיצוב היעד</button>
        <button className="learning-control" aria-pressed={previewMode} onClick={() => setPreviewMode(true)} style={{ flex: 1, padding: 8 }}>Preview מהקוד</button>
      </div>
      {/* Screen Selector if multiple screens */}
      {screens.length > 1 && (
        <div
          style={{
            display: 'flex',
            padding: '6px 10px',
            backgroundColor: 'rgba(0, 0, 0, 0.2)',
            borderBottom: '1px solid var(--border-color, #232734)',
            gap: 4,
          }}
        >
          {screens.map((sc, idx) => (
            <button
              key={sc.id}
              onClick={() => selectScreen(sc.id)}
              aria-pressed={idx === selectedScreenIndex}
              title={`כתוב והרץ את המסך ${sc.name}`}
              style={{
                flex: 1,
                padding: '4px 6px',
                borderRadius: 4,
                border: 'none',
                backgroundColor: idx === selectedScreenIndex ? 'var(--accent-primary, #3B82F6)' : 'transparent',
                color: idx === selectedScreenIndex ? '#FFFFFF' : 'var(--text-secondary, #9CA3AF)',
                fontSize: 10,
                fontWeight: 600,
                cursor: 'pointer',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {sc.name}
            </button>
          ))}
        </div>
      )}
      {previewMode ? <KotlinRuntimePreview /> : <div style={{ flex: 1, overflow: 'auto', padding: 16, display: 'flex', justifyContent: 'center' }}><DesignReferenceCanvas screen={currentScreen} /></div>}
    </div>
  );
}
