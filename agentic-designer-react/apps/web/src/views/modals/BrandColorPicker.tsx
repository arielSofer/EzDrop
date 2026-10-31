// apps/web/src/views/modals/BrandColorPicker.tsx
//
// Modal for picking a custom brand accent color and applying it through BrandKit.

import React, { useState } from 'react';
import { ModalDialog } from '../../components/ModalDialog';
import { BrandKit, CheckpointStore, makeBrandIdentity } from '@agentic/core';
import { useProjectStore } from '../../stores/projectStore';

export interface BrandColorPickerProps {
  isOpen: boolean;
  onClose: () => void;
}

const PRESET_SWATCHES = [
  { name: 'Coral', hex: '#F0653C' },
  { name: 'Indigo', hex: '#4F46E5' },
  { name: 'Emerald', hex: '#10B981' },
  { name: 'Amber', hex: '#F59E0B' },
  { name: 'Rose', hex: '#E11D48' },
  { name: 'Teal', hex: '#0F766E' },
  { name: 'Violet', hex: '#7C3AED' },
  { name: 'Slate', hex: '#334155' },
];

export function BrandColorPicker({ isOpen, onClose }: BrandColorPickerProps) {
  const [selectedHex, setSelectedHex] = useState('#4F46E5');
  const project = useProjectStore((s) => s.project);
  const replaceProject = useProjectStore((s) => s.replaceProject);

  const handleApply = (hex: string, name = 'Custom') => {
    CheckpointStore.save(project, `before brand: ${name}`);
    const identity = makeBrandIdentity({
      accent: hex,
      name,
    });
    BrandKit.apply(identity, { project, replaceProject });
    onClose();
  };

  return (
    <ModalDialog
      isOpen={isOpen}
      onClose={onClose}
      title="Brand Accent Color"
      icon="paintbrush.pointed"
      width={420}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>
          Select a brand accent or enter a custom hex value. This automatically themes buttons, active states, and highlights across all screens.
        </p>

        {/* Swatches */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          {PRESET_SWATCHES.map((swatch) => (
            <button
              key={swatch.hex}
              type="button"
              onClick={() => setSelectedHex(swatch.hex)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 6,
                padding: 8,
                borderRadius: 'var(--radius-md)',
                backgroundColor: selectedHex === swatch.hex ? 'var(--bg-active)' : 'var(--bg-panel-secondary)',
                border: `2px solid ${selectedHex === swatch.hex ? 'var(--border-focus)' : 'transparent'}`,
              }}
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  backgroundColor: swatch.hex,
                  boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
                }}
              />
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{swatch.name}</span>
            </button>
          ))}
        </div>

        {/* Custom hex input */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: 12,
            backgroundColor: 'var(--bg-panel-secondary)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-color)',
          }}
        >
          <input
            type="color"
            value={selectedHex}
            onChange={(e) => setSelectedHex(e.target.value.toUpperCase())}
            style={{
              width: 36,
              height: 36,
              padding: 0,
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
              backgroundColor: 'transparent',
            }}
          />
          <input
            type="text"
            value={selectedHex}
            onChange={(e) => setSelectedHex(e.target.value.toUpperCase())}
            style={{
              flex: 1,
              fontFamily: 'var(--font-mono)',
              fontSize: 13,
              fontWeight: 600,
              textAlign: 'center',
            }}
          />
        </div>

        {/* Apply button */}
        <button
          type="button"
          onClick={() => handleApply(selectedHex)}
          style={{
            padding: '8px 16px',
            borderRadius: 'var(--radius-md)',
            backgroundColor: 'var(--accent-blue)',
            color: '#000000',
            fontWeight: 600,
            fontSize: 13,
          }}
        >
          Apply Brand Theme
        </button>
      </div>
    </ModalDialog>
  );
}

export default BrandColorPicker;
