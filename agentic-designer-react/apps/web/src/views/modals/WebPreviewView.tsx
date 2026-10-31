// apps/web/src/views/modals/WebPreviewView.tsx
//
// 1:1 port of Views/WebPreviewView.swift.
// Live interactive web preview using WebExporter rendered in a sandboxed iframe.

import React, { useMemo, useState } from 'react';
import { ModalDialog } from '../../components/ModalDialog';
import { SFSymbol } from '../../components/SFSymbol';
import { WebExporter } from '@agentic/core';
import { useProjectStore } from '../../stores/projectStore';

export interface WebPreviewViewProps {
  isOpen: boolean;
  onClose: () => void;
}

export function WebPreviewView({ isOpen, onClose }: WebPreviewViewProps) {
  const project = useProjectStore((s) => s.project);
  const currentPageIndex = useProjectStore((s) => s.currentPageIndex);
  const [copied, setCopied] = useState(false);

  const html = useMemo(() => {
    const page = project.pages[currentPageIndex] ?? project.pages[0];
    if (!page) return '<html><body>No screens found</body></html>';
    const screens = page.nodes.filter((n) => n.type === 'Frame');
    return WebExporter.html({
      screens: screens.length > 0 ? screens : page.nodes,
      appName: project.name,
      flows: page.logicFlows,
      globalVariables: project.globalVariables,
      supabase: project.supabaseConfig,
      interactive: true,
    });
  }, [project, currentPageIndex]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(html);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleDownload = () => {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name.replaceAll(' ', '-')}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <ModalDialog
      isOpen={isOpen}
      onClose={onClose}
      title="Web Preview"
      icon="globe"
      width={1020}
      height={760}
    >
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 12 }}>
        {/* Action bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10 }}>
          <button
            type="button"
            onClick={handleCopy}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'var(--bg-panel-secondary)',
              border: '1px solid var(--border-color)',
              color: 'var(--text-primary)',
              fontSize: 12,
              fontWeight: 500,
            }}
          >
            <SFSymbol name={copied ? 'checkmark' : 'doc.on.doc'} size={13} color={copied ? 'var(--accent-green)' : undefined} />
            <span>{copied ? 'Copied HTML' : 'Copy HTML'}</span>
          </button>

          <button
            type="button"
            onClick={handleDownload}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 14px',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'var(--accent-blue)',
              color: '#000000',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            <SFSymbol name="square.and.arrow.down" size={13} />
            <span>Save .html</span>
          </button>
        </div>

        {/* Sandboxed iframe */}
        <div
          style={{
            flex: 1,
            borderRadius: 'var(--radius-lg)',
            overflow: 'hidden',
            border: '1px solid var(--border-color)',
            backgroundColor: '#0a0a0c',
          }}
        >
          <iframe
            title="Web App Preview"
            srcDoc={html}
            sandbox="allow-scripts allow-forms allow-modals"
            style={{
              width: '100%',
              height: '100%',
              border: 'none',
              display: 'block',
            }}
          />
        </div>
      </div>
    </ModalDialog>
  );
}

export default WebPreviewView;
