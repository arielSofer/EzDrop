// apps/web/src/views/logic/FirebaseConfigView.tsx
//
// 1:1 port of Views/Logic/FirebaseConfigView.swift.
// Modal sheet for configuring project-level Firebase settings: credentials,
// authentication providers, and Firestore collection schemas.

import React, { useState } from 'react';
import { ModalDialog } from '../../components/ModalDialog';
import { SFSymbol } from '../../components/SFSymbol';
import { useProjectStore } from '../../stores/projectStore';
import { makeFirebaseConfig, type FirebaseConfig } from '@agentic/core';

export interface FirebaseConfigViewProps {
  isOpen: boolean;
  onClose: () => void;
}

export function FirebaseConfigView({ isOpen, onClose }: FirebaseConfigViewProps) {
  const project = useProjectStore((s) => s.project);
  const mutateProject = useProjectStore((s) => s.mutateProject);

  const [config, setConfig] = useState<FirebaseConfig>(() =>
    makeFirebaseConfig(project.firebaseConfig ?? {}),
  );
  const [newColName, setNewColName] = useState('');

  const handleSave = () => {
    mutateProject((p) => {
      p.firebaseConfig = config;
    });
    onClose();
  };

  const handleAddCollection = () => {
    const name = newColName.trim();
    if (!name) return;
    setConfig((prev) => ({
      ...prev,
      defaultCollections: [
        ...prev.defaultCollections,
        { id: `col-${Date.now()}`, name, fields: [] },
      ],
    }));
    setNewColName('');
  };

  const handleDeleteCollection = (id: string) => {
    setConfig((prev) => ({
      ...prev,
      defaultCollections: prev.defaultCollections.filter((c) => c.id !== id),
    }));
  };

  return (
    <ModalDialog
      isOpen={isOpen}
      onClose={onClose}
      title="Firebase Configuration"
      icon="flame.fill"
      width={480}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Enable Toggle */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={config.isEnabled}
            onChange={(e) => setConfig((prev) => ({ ...prev, isEnabled: e.target.checked }))}
            style={{ width: 16, height: 16 }}
          />
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
            Enable Firebase for this project
          </span>
        </label>

        <div style={{ height: 1, backgroundColor: 'var(--border-subtle)' }} />

        {/* Credentials */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={sectionHeaderStyle}>Project Credentials</span>
          <TextField
            label="Project ID"
            value={config.projectId}
            placeholder="my-project-12345"
            onChange={(v) => setConfig((prev) => ({ ...prev, projectId: v }))}
          />
          <TextField
            label="API Key"
            value={config.apiKey}
            placeholder="AIzaSy..."
            onChange={(v) => setConfig((prev) => ({ ...prev, apiKey: v }))}
          />
          <TextField
            label="Auth Domain"
            value={config.authDomain}
            placeholder="my-project.firebaseapp.com"
            onChange={(v) => setConfig((prev) => ({ ...prev, authDomain: v }))}
          />
          <TextField
            label="Storage Bucket"
            value={config.storageBucket}
            placeholder="my-project.appspot.com"
            onChange={(v) => setConfig((prev) => ({ ...prev, storageBucket: v }))}
          />
        </div>

        <div style={{ height: 1, backgroundColor: 'var(--border-subtle)' }} />

        {/* Auth Methods */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={sectionHeaderStyle}>Authentication Providers</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
            <AuthToggle
              label="Email / Password"
              checked={config.enableEmailAuth}
              onChange={(c) => setConfig((prev) => ({ ...prev, enableEmailAuth: c }))}
            />
            <AuthToggle
              label="Google Sign-In"
              checked={config.enableGoogleAuth}
              onChange={(c) => setConfig((prev) => ({ ...prev, enableGoogleAuth: c }))}
            />
            <AuthToggle
              label="Apple Sign-In"
              checked={config.enableAppleAuth}
              onChange={(c) => setConfig((prev) => ({ ...prev, enableAppleAuth: c }))}
            />
            <AuthToggle
              label="Anonymous Guest"
              checked={config.enableAnonymousAuth}
              onChange={(c) => setConfig((prev) => ({ ...prev, enableAnonymousAuth: c }))}
            />
          </div>
        </div>

        <div style={{ height: 1, backgroundColor: 'var(--border-subtle)' }} />

        {/* Collections */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={sectionHeaderStyle}>Firestore Collections</span>
          {config.defaultCollections.map((col) => (
            <div
              key={col.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '4px 8px',
                borderRadius: 6,
                backgroundColor: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                <SFSymbol name="folder.fill" size={12} color="#F59E0B" />
                <span style={{ color: 'var(--text-primary)' }}>{col.name}</span>
              </div>
              <button
                type="button"
                onClick={() => handleDeleteCollection(col.id)}
                style={{ background: 'none', border: 'none', color: 'var(--accent-danger)', cursor: 'pointer', padding: 0 }}
              >
                <SFSymbol name="trash" size={11} color="var(--accent-danger)" />
              </button>
            </div>
          ))}

          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type="text"
              placeholder="New collection name (e.g. users, orders)"
              value={newColName}
              onChange={(e) => setNewColName(e.target.value)}
              style={inputStyle}
            />
            <button
              type="button"
              onClick={handleAddCollection}
              disabled={!newColName.trim()}
              style={{
                padding: '4px 12px',
                borderRadius: 6,
                backgroundColor: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-primary)',
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              Add
            </button>
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
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
      </div>
    </ModalDialog>
  );
}

function TextField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
      <span style={{ fontSize: 11, color: 'var(--text-secondary)', width: 110 }}>{label}</span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...inputStyle, flex: 1 }}
      />
    </div>
  );
}

function AuthToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--text-secondary)', cursor: 'pointer' }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

const sectionHeaderStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
  letterSpacing: 0.5,
};

const inputStyle: React.CSSProperties = {
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

export default FirebaseConfigView;
