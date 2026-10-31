// apps/web/src/components/ModalDialog.tsx
//
// macOS Sheet / Modal dialog container with dark glassmorphism.

import React, { useEffect } from 'react';
import SFSymbol from './SFSymbol';

export interface ModalDialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  icon?: string;
  width?: number | string;
  height?: number | string;
  children: React.ReactNode;
}

export function ModalDialog({
  isOpen,
  onClose,
  title,
  icon,
  width = 560,
  height = 'auto',
  children,
}: ModalDialogProps) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.65)',
        backdropFilter: 'blur(8px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width,
          height,
          maxHeight: '90vh',
          backgroundColor: 'var(--bg-panel)',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-xl)',
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.6)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 18px',
            borderBottom: '1px solid var(--border-color)',
            backgroundColor: 'var(--bg-panel-secondary)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {icon && <SFSymbol name={icon} size={16} color="var(--accent-blue)" />}
            <span style={{ fontWeight: 600, fontSize: 14 }}>{title}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '4px 10px',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'var(--bg-active)',
              color: 'var(--text-secondary)',
              fontSize: 12,
              fontWeight: 500,
            }}
          >
            Done
          </button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 18 }}>{children}</div>
      </div>
    </div>
  );
}

export default ModalDialog;
