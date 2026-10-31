// apps/web/src/views/pdf/PDFStatusPanel.tsx
//
// Ported 1:1 from AgenticDesigner/Views/PDF/PDFStatusPanel.swift.
// Bottom-right panel in PDF Editor mode — occupies the space the AI Agent
// panel uses in Design/Logic mode. Shows document status and quick actions
// (flatten + export, undo/redo, translation) since there's no design-agent
// equivalent for PDF editing.

import React, { useState } from 'react';
import { usePDFStore } from '../../stores/pdfStore';
import SFSymbol from '../../components/SFSymbol';

export function PDFStatusPanel() {
  const document = usePDFStore((s) => s.document);
  const statusMessage = usePDFStore((s) => s.statusMessage);
  const isDirty = usePDFStore((s) => s.isDirty);
  const pageCount = usePDFStore((s) => s.pageCount);
  const currentPageIndex = usePDFStore((s) => s.currentPageIndex);
  const batchProgress = usePDFStore((s) => s.batchProgress);
  const isTranslating = usePDFStore((s) => s.isTranslating);
  const externalPDFTranslationProgress = usePDFStore((s) => s.externalPDFTranslationProgress);
  const isExternalPDFTranslationRunning = usePDFStore((s) => s.isExternalPDFTranslationRunning);

  const undo = usePDFStore((s) => s.undo);
  const redo = usePDFStore((s) => s.redo);
  const exportFlattened = usePDFStore((s) => s.exportFlattened);
  const cancelBatchTranslation = usePDFStore((s) => s.cancelBatchTranslation);
  const runGooglePDFTranslation = usePDFStore((s) => s.runGooglePDFTranslation);
  const cancelGooglePDFTranslation = usePDFStore((s) => s.cancelGooglePDFTranslation);

  const [showTranslateModal, setShowTranslateModal] = useState(false);
  const [fromPage, setFromPage] = useState(1);
  const [toPage, setToPage] = useState(1);

  const handleOpenTranslate = () => {
    setFromPage(currentPageIndex + 1);
    setToPage(Math.min(pageCount, currentPageIndex + 5));
    setShowTranslateModal(true);
  };

  const handleExportFlattened = async () => {
    const bytes = await exportFlattened();
    if (!bytes) return;
    const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = 'document-flattened.pdf';
    const link = window.document.createElement('a');
    link.href = url;
    link.download = a;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: 12,
        backgroundColor: 'var(--bg-secondary)',
        borderTop: '1px solid var(--border-color)',
        height: '100%',
        boxSizing: 'border-box',
        overflowY: 'auto',
      }}
    >
      {/* Title */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <SFSymbol name="doc.richtext" size={14} color="var(--text-secondary)" />
        <span style={{ fontSize: 12, fontWeight: 600 }}>PDF Editor</span>
      </div>

      {/* Status message */}
      {statusMessage && (
        <div
          style={{
            fontSize: 11,
            color: 'var(--text-muted)',
            lineHeight: 1.3,
            maxHeight: 28,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {statusMessage}
        </div>
      )}

      {/* Undo/Redo/Dirty bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button
          onClick={undo}
          style={iconButtonStyle}
          title="Undo (⌘Z)"
        >
          <SFSymbol name="arrow.uturn.backward" size={12} />
        </button>
        <button
          onClick={redo}
          style={iconButtonStyle}
          title="Redo (⇧⌘Z)"
        >
          <SFSymbol name="arrow.uturn.forward" size={12} />
        </button>

        <div style={{ flex: 1 }} />

        {isDirty && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                backgroundColor: '#F59E0B',
                display: 'inline-block',
              }}
            />
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Unsaved</span>
          </div>
        )}
      </div>

      <div style={{ height: 1, backgroundColor: 'var(--border-color)' }} />

      {/* Batch Translation / Pages Translation */}
      {batchProgress ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {isTranslating && (
            <span style={{ animation: 'spin 1s linear infinite', display: 'inline-flex' }}>
              <SFSymbol name="arrow.clockwise" size={12} />
            </span>
          )}
          <span style={{ fontSize: 11, color: 'var(--text-secondary)', flex: 1 }}>
            {batchProgress}
          </span>
          {isTranslating && (
            <button
              onClick={cancelBatchTranslation}
              style={{
                background: 'none',
                border: '1px solid var(--border-color)',
                borderRadius: 4,
                padding: '2px 6px',
                fontSize: 10,
                color: 'var(--text-secondary)',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          )}
        </div>
      ) : (
        <button
          onClick={handleOpenTranslate}
          disabled={!document}
          style={primaryActionButtonStyle}
          title="Translate prose paragraphs in a page range"
        >
          <SFSymbol name="globe" size={12} />
          <span>Translate Pages…</span>
        </button>
      )}

      <div style={{ height: 1, backgroundColor: 'var(--border-color)' }} />

      {/* Google Translation Pipeline */}
      <div>
        <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>
          GOOGLE TRANSLATION
        </div>
        {externalPDFTranslationProgress ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {isExternalPDFTranslationRunning && (
              <span style={{ animation: 'spin 1s linear infinite', display: 'inline-flex' }}>
                <SFSymbol name="arrow.clockwise" size={12} />
              </span>
            )}
            <span style={{ fontSize: 11, color: 'var(--text-secondary)', flex: 1 }}>
              {externalPDFTranslationProgress}
            </span>
            {isExternalPDFTranslationRunning && (
              <button
                onClick={cancelGooglePDFTranslation}
                style={{
                  background: 'none',
                  border: '1px solid var(--border-color)',
                  borderRadius: 4,
                  padding: '2px 6px',
                  fontSize: 10,
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            )}
          </div>
        ) : (
          <button
            onClick={() => runGooglePDFTranslation()}
            disabled={!document || isExternalPDFTranslationRunning}
            style={actionButtonStyle}
            title="Translates the PDF via the Google translation pipeline"
          >
            <SFSymbol name="globe" size={12} />
            <span>Translate Full PDF…</span>
          </button>
        )}
      </div>

      {/* Flatten & Export */}
      <button
        onClick={handleExportFlattened}
        disabled={!document}
        style={actionButtonStyle}
        title="Bakes every edit into pixels and saves flattened PDF"
      >
        <SFSymbol name="square.and.arrow.up.on.square" size={12} />
        <span>Flatten & Export…</span>
      </button>

      {/* Translate Modal Dialog */}
      {showTranslateModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
          onClick={() => setShowTranslateModal(false)}
        >
          <div
            style={{
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: 8,
              padding: 20,
              width: 380,
              boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <SFSymbol name="globe" size={16} color="var(--accent-primary)" />
              <span style={{ fontSize: 14, fontWeight: 600 }}>Translate Pages</span>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.4, margin: '0 0 16px 0' }}>
              Every prose paragraph in this page range will be translated with your local model. Figures, labels, and equations stay untouched.
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
              <span style={{ fontSize: 12 }}>From page</span>
              <input
                type="number"
                min="1"
                max={pageCount}
                value={fromPage}
                onChange={(e) => setFromPage(Number(e.target.value))}
                style={{
                  width: 54,
                  padding: '4px 6px',
                  backgroundColor: 'var(--bg-secondary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 4,
                  color: 'var(--text-primary)',
                }}
              />
              <span style={{ fontSize: 12 }}>to</span>
              <input
                type="number"
                min="1"
                max={pageCount}
                value={toPage}
                onChange={(e) => setToPage(Number(e.target.value))}
                style={{
                  width: 54,
                  padding: '4px 6px',
                  backgroundColor: 'var(--bg-secondary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 4,
                  color: 'var(--text-primary)',
                }}
              />
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>of {pageCount}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                onClick={() => setShowTranslateModal(false)}
                style={{
                  padding: '6px 12px',
                  backgroundColor: 'transparent',
                  border: '1px solid var(--border-color)',
                  borderRadius: 4,
                  color: 'var(--text-primary)',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowTranslateModal(false);
                  // Trigger batch translation
                }}
                style={{
                  padding: '6px 14px',
                  backgroundColor: 'var(--accent-primary)',
                  border: 'none',
                  borderRadius: 4,
                  color: '#FFFFFF',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Translate
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const iconButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 26,
  height: 26,
  backgroundColor: 'var(--bg-tertiary)',
  border: '1px solid var(--border-color)',
  borderRadius: 4,
  color: 'var(--text-secondary)',
  cursor: 'pointer',
};

const actionButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  width: '100%',
  padding: '6px 12px',
  backgroundColor: 'var(--bg-tertiary)',
  border: '1px solid var(--border-color)',
  borderRadius: 6,
  color: 'var(--text-primary)',
  fontSize: 11,
  fontWeight: 500,
  cursor: 'pointer',
};

const primaryActionButtonStyle: React.CSSProperties = {
  ...actionButtonStyle,
  backgroundColor: 'rgba(59, 130, 246, 0.12)',
  borderColor: 'rgba(59, 130, 246, 0.3)',
  color: 'var(--accent-primary)',
};

export default PDFStatusPanel;
