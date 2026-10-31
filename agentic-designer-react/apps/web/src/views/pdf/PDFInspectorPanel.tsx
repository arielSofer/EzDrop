// apps/web/src/views/pdf/PDFInspectorPanel.tsx
//
// Ported 1:1 from AgenticDesigner/Views/PDF/PDFInspectorPanel.swift.
// Right panel in PDF Editor mode: tool picker, selected-annotation
// properties (color, text, font), and document metadata.

import React from 'react';
import { PDFToolMode } from '@agentic/core';
import { usePDFStore } from '../../stores/pdfStore';
import SFSymbol from '../../components/SFSymbol';

const TOOLS: { mode: PDFToolMode; label: string; icon: string }[] = [
  { mode: PDFToolMode.select, label: 'Select', icon: 'cursorarrow' },
  { mode: PDFToolMode.editText, label: 'Edit Text', icon: 'character.cursor.ibeam' },
  { mode: PDFToolMode.translate, label: 'Translate', icon: 'globe' },
  { mode: PDFToolMode.replaceImage, label: 'Image', icon: 'photo' },
  { mode: PDFToolMode.draw, label: 'Draw', icon: 'pencil.tip' },
  { mode: PDFToolMode.signature, label: 'Signature', icon: 'signature' },
  { mode: PDFToolMode.highlight, label: 'Highlight', icon: 'highlighter' },
  { mode: PDFToolMode.underline, label: 'Underline', icon: 'underline' },
  { mode: PDFToolMode.strikeOut, label: 'Strikethrough', icon: 'strikethrough' },
  { mode: PDFToolMode.comment, label: 'Comment', icon: 'text.bubble' },
  { mode: PDFToolMode.shapeRect, label: 'Rectangle', icon: 'square' },
  { mode: PDFToolMode.shapeCircle, label: 'Circle', icon: 'circle' },
  { mode: PDFToolMode.shapeLine, label: 'Line', icon: 'line.diagonal' },
  { mode: PDFToolMode.freeText, label: 'Text', icon: 'textformat' },
  { mode: PDFToolMode.formTextField, label: 'Text Field', icon: 'textbox' },
  { mode: PDFToolMode.formCheckbox, label: 'Checkbox', icon: 'checkmark.square' },
  { mode: PDFToolMode.crop, label: 'Crop', icon: 'crop' },
];

const COMMON_LANGUAGES = [
  'Hebrew',
  'English',
  'Spanish',
  'French',
  'German',
  'Russian',
  'Arabic',
  'Japanese',
  'Chinese',
];

export function PDFInspectorPanel() {
  const document = usePDFStore((s) => s.document);
  const fileURL = usePDFStore((s) => s.fileURL);
  const pageCount = usePDFStore((s) => s.pageCount);
  const currentPageIndex = usePDFStore((s) => s.currentPageIndex);
  const toolMode = usePDFStore((s) => s.toolMode);
  const selectedAnnotation = usePDFStore((s) => s.selectedAnnotation);
  const annotationStyle = usePDFStore((s) => s.annotationStyle);
  const metadata = usePDFStore((s) => s.metadata);

  const setToolMode = usePDFStore((s) => s.setToolMode);
  const setAnnotationStyle = usePDFStore((s) => s.setAnnotationStyle);
  const setMetadata = usePDFStore((s) => s.setMetadata);
  const applyMetadata = usePDFStore((s) => s.applyMetadata);
  const removeAnnotation = usePDFStore((s) => s.removeAnnotation);
  const moveAnnotation = usePDFStore((s) => s.moveAnnotation);

  const pageBounds = document ? document.mediaBox(currentPageIndex) : { width: 0, height: 0 };
  const pageSize = { width: pageBounds.width, height: pageBounds.height };
  const pageRotation = document ? document.rotation(currentPageIndex) : 0;
  const pageAnnotationsCount = document ? document.annotations(currentPageIndex).length : 0;

  const needsStyleControls = (
    [
      PDFToolMode.shapeRect,
      PDFToolMode.shapeCircle,
      PDFToolMode.shapeLine,
      PDFToolMode.draw,
      PDFToolMode.highlight,
      PDFToolMode.underline,
      PDFToolMode.strikeOut,
      PDFToolMode.freeText,
      PDFToolMode.editText,
    ] as PDFToolMode[]
  ).includes(toolMode);

  const hintForTool = (mode: PDFToolMode) => {
    switch (mode) {
      case PDFToolMode.editText:
        return 'Click a paragraph to rewrite it, or drag a box over a region.';
      case PDFToolMode.translate:
        return 'Click a paragraph to translate it with your local model.';
      case PDFToolMode.replaceImage:
        return 'Drag a box over an image, then choose a replacement.';
      case PDFToolMode.draw:
      case PDFToolMode.signature:
        return 'Drag to draw freehand.';
      case PDFToolMode.comment:
        return 'Click to drop a comment.';
      case PDFToolMode.crop:
        return 'Drag a box to crop the page to.';
      default:
        return 'Drag to place on the page.';
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        backgroundColor: 'var(--bg-secondary)',
        overflowY: 'auto',
        padding: 12,
        boxSizing: 'border-box',
        gap: 16,
      }}
    >
      {/* Tools Section */}
      <div>
        <div style={sectionLabelStyle}>TOOL</div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 6,
            marginTop: 8,
          }}
        >
          {TOOLS.map((t) => {
            const isSelected = toolMode === t.mode;
            return (
              <button
                key={t.mode}
                onClick={() => setToolMode(t.mode)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4,
                  height: 48,
                  backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.2)' : 'var(--bg-tertiary)',
                  border: isSelected ? '1px solid var(--accent-primary)' : '1px solid transparent',
                  borderRadius: 6,
                  color: isSelected ? 'var(--accent-primary)' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  padding: 2,
                }}
                title={t.label}
              >
                <SFSymbol name={t.icon} size={14} />
                <span
                  style={{
                    fontSize: 9,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    maxWidth: '100%',
                  }}
                >
                  {t.label}
                </span>
              </button>
            );
          })}
        </div>

        {toolMode !== PDFToolMode.select && (
          <div
            style={{
              fontSize: 11,
              color: 'var(--text-muted)',
              marginTop: 8,
              lineHeight: 1.4,
            }}
          >
            {hintForTool(toolMode)}
          </div>
        )}

        {/* Style Controls */}
        {needsStyleControls && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              marginTop: 10,
              padding: 8,
              backgroundColor: 'var(--bg-tertiary)',
              borderRadius: 6,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Color</span>
              <input
                type="color"
                value={annotationStyle.color || '#FBBF24'}
                onChange={(e) => setAnnotationStyle({ color: e.target.value })}
                style={{
                  width: 32,
                  height: 24,
                  padding: 0,
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                  backgroundColor: 'transparent',
                }}
              />
            </div>

            {(toolMode === PDFToolMode.freeText || toolMode === PDFToolMode.editText) ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Text Color</span>
                  <input
                    type="color"
                    value={annotationStyle.textColor || '#000000'}
                    onChange={(e) => setAnnotationStyle({ textColor: e.target.value })}
                    style={{
                      width: 32,
                      height: 24,
                      padding: 0,
                      border: 'none',
                      borderRadius: 4,
                      cursor: 'pointer',
                      backgroundColor: 'transparent',
                    }}
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                    Font Size: {Math.round(annotationStyle.fontSize || 12)}pt
                  </span>
                  <input
                    type="range"
                    min="6"
                    max="96"
                    value={annotationStyle.fontSize || 12}
                    onChange={(e) => setAnnotationStyle({ fontSize: Number(e.target.value) })}
                    style={{ width: 100 }}
                  />
                </div>
              </>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                  Stroke: {Math.round(annotationStyle.strokeWidth || 2)}pt
                </span>
                <input
                  type="range"
                  min="1"
                  max="20"
                  value={annotationStyle.strokeWidth || 2}
                  onChange={(e) => setAnnotationStyle({ strokeWidth: Number(e.target.value) })}
                  style={{ width: 100 }}
                />
              </div>
            )}
          </div>
        )}
      </div>

      <div style={dividerStyle} />

      {/* Selected Annotation Section */}
      {selectedAnnotation && (
        <div>
          <div style={sectionLabelStyle}>SELECTED: {selectedAnnotation.subtype}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
            {selectedAnnotation.contents !== undefined && (
              <div>
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Contents</span>
                <input
                  type="text"
                  value={selectedAnnotation.contents || ''}
                  onChange={(e) => {
                    selectedAnnotation.contents = e.target.value;
                  }}
                  style={inputStyle}
                />
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <div>
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>X</span>
                <input
                  type="number"
                  value={Math.round(selectedAnnotation.bounds.x)}
                  onChange={(e) =>
                    moveAnnotation(selectedAnnotation, {
                      ...selectedAnnotation.bounds,
                      x: Number(e.target.value),
                    })
                  }
                  style={inputStyle}
                />
              </div>
              <div>
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Y</span>
                <input
                  type="number"
                  value={Math.round(selectedAnnotation.bounds.y)}
                  onChange={(e) =>
                    moveAnnotation(selectedAnnotation, {
                      ...selectedAnnotation.bounds,
                      y: Number(e.target.value),
                    })
                  }
                  style={inputStyle}
                />
              </div>
              <div>
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>W</span>
                <input
                  type="number"
                  value={Math.round(selectedAnnotation.bounds.width)}
                  onChange={(e) =>
                    moveAnnotation(selectedAnnotation, {
                      ...selectedAnnotation.bounds,
                      width: Math.max(4, Number(e.target.value)),
                    })
                  }
                  style={inputStyle}
                />
              </div>
              <div>
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>H</span>
                <input
                  type="number"
                  value={Math.round(selectedAnnotation.bounds.height)}
                  onChange={(e) =>
                    moveAnnotation(selectedAnnotation, {
                      ...selectedAnnotation.bounds,
                      height: Math.max(4, Number(e.target.value)),
                    })
                  }
                  style={inputStyle}
                />
              </div>
            </div>

            <button
              onClick={() => removeAnnotation(selectedAnnotation)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: 6,
                color: '#EF4444',
                padding: '6px 12px',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                marginTop: 4,
              }}
            >
              <SFSymbol name="trash" size={12} color="#EF4444" />
              <span>Delete Annotation</span>
            </button>
          </div>
          <div style={dividerStyle} />
        </div>
      )}

      {/* Metadata Section */}
      <div>
        <div style={sectionLabelStyle}>METADATA</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
          <div>
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Title</span>
            <input
              type="text"
              value={metadata.title || ''}
              onChange={(e) => setMetadata({ title: e.target.value })}
              onBlur={applyMetadata}
              style={inputStyle}
              placeholder="Document Title"
            />
          </div>
          <div>
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Author</span>
            <input
              type="text"
              value={metadata.author || ''}
              onChange={(e) => setMetadata({ author: e.target.value })}
              onBlur={applyMetadata}
              style={inputStyle}
              placeholder="Author"
            />
          </div>
          <div>
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Subject</span>
            <input
              type="text"
              value={metadata.subject || ''}
              onChange={(e) => setMetadata({ subject: e.target.value })}
              onBlur={applyMetadata}
              style={inputStyle}
              placeholder="Subject"
            />
          </div>
          <div>
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Keywords</span>
            <input
              type="text"
              value={metadata.keywords || ''}
              onChange={(e) => setMetadata({ keywords: e.target.value })}
              onBlur={applyMetadata}
              style={inputStyle}
              placeholder="Keywords"
            />
          </div>
        </div>
      </div>

      <div style={dividerStyle} />

      {/* Document Section */}
      <div>
        <div style={sectionLabelStyle}>DOCUMENT</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
          <div style={infoRowStyle}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Page Size</span>
            <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)' }}>
              {Math.round(pageSize.width)} × {Math.round(pageSize.height)} pt
            </span>
          </div>
          <div style={infoRowStyle}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Rotation</span>
            <span style={{ fontSize: 11 }}>{pageRotation}°</span>
          </div>
          <div style={infoRowStyle}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Annotations</span>
            <span style={{ fontSize: 11 }}>{pageAnnotationsCount}</span>
          </div>
          <div style={infoRowStyle}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Pages</span>
            <span style={{ fontSize: 11 }}>{pageCount}</span>
          </div>
          {fileURL && (
            <div style={infoRowStyle}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>File</span>
              <span
                style={{
                  fontSize: 11,
                  maxWidth: 140,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {fileURL.split('/').pop()}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const sectionLabelStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  color: 'var(--text-muted)',
  letterSpacing: '0.5px',
};

const dividerStyle: React.CSSProperties = {
  height: 1,
  backgroundColor: 'var(--border-color)',
  width: '100%',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  backgroundColor: 'var(--bg-tertiary)',
  border: '1px solid var(--border-color)',
  borderRadius: 4,
  padding: '4px 8px',
  fontSize: 12,
  color: 'var(--text-primary)',
  boxSizing: 'border-box',
};

const infoRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};

export default PDFInspectorPanel;
