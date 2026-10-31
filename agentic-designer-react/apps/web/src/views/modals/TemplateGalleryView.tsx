// apps/web/src/views/modals/TemplateGalleryView.tsx
//
// 1:1 port of Views/TemplateGalleryView.swift.
// Multi-screen starters from TemplateFactory with preview cards.

import React, { useState } from 'react';
import { ModalDialog } from '../../components/ModalDialog';
import { SFSymbol } from '../../components/SFSymbol';
import { TemplateFactory, CheckpointStore, type AppTemplate } from '@agentic/core';
import { useProjectStore } from '../../stores/projectStore';

export interface TemplateGalleryViewProps {
  isOpen: boolean;
  onClose: () => void;
}

export function TemplateGalleryView({ isOpen, onClose }: TemplateGalleryViewProps) {
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const project = useProjectStore((s) => s.project);
  const currentPageIndex = useProjectStore((s) => s.currentPageIndex);
  const mutateProject = useProjectStore((s) => s.mutateProject);
  const applyDesignActions = useProjectStore((s) => s.applyDesignActions);

  const handleApply = (template: AppTemplate) => {
    setApplyingId(template.id);
    try {
      CheckpointStore.save(project, `before template: ${template.name}`);
      // Clear page nodes and logic flows
      mutateProject((p) => {
        p.pages[currentPageIndex].nodes = [];
        p.pages[currentPageIndex].logicFlows = [];
      });
      const actions = TemplateFactory.actions(template);
      applyDesignActions(actions);
      onClose();
    } finally {
      setApplyingId(null);
    }
  };

  return (
    <ModalDialog
      isOpen={isOpen}
      onClose={onClose}
      title="Start from a Template"
      icon="square.grid.2x2"
      width={780}
      height={580}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.4 }}>
          Instant multi-screen starters built from the component library — customize with the canvas or the agent afterwards.
        </p>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 16,
            paddingTop: 4,
          }}
        >
          {TemplateFactory.all.map((template) => {
            const isApplying = applyingId === template.id;
            return (
              <div
                key={template.id}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  padding: 12,
                  backgroundColor: 'var(--bg-panel-secondary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-lg)',
                }}
              >
                {/* Placeholder thumbnail header */}
                <div
                  style={{
                    height: 120,
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: 'var(--bg-input)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    color: 'var(--text-muted)',
                  }}
                >
                  <SFSymbol name="app.badge" size={28} color="var(--accent-blue)" />
                  <span style={{ fontSize: 11, fontWeight: 500 }}>{template.screens.length} Screens</span>
                </div>

                <div style={{ fontWeight: 600, fontSize: 14 }}>{template.name}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.3 }}>
                  {template.subtitle}
                </div>

                <button
                  type="button"
                  disabled={applyingId !== null}
                  onClick={() => handleApply(template)}
                  style={{
                    marginTop: 'auto',
                    padding: '6px 12px',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'var(--accent-blue)',
                    color: '#000000',
                    fontWeight: 600,
                    fontSize: 12,
                    opacity: applyingId !== null ? 0.6 : 1,
                  }}
                >
                  {isApplying ? 'Creating…' : 'Use Template'}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </ModalDialog>
  );
}

export default TemplateGalleryView;
