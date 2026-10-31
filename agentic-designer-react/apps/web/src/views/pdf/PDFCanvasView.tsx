// apps/web/src/views/pdf/PDFCanvasView.tsx
//
// Ported 1:1 from AgenticDesigner/Views/PDF/PDFCanvasView.swift.
// The PDF Editor's center canvas: PDFRenderer HTML canvas rendering,
// scrolling, zooming, selection and gesture handling (draw shapes/highlights,
// click for comments, drag freehand path for ink/signature, rewrite paragraph).

import React, { useRef, useState, useEffect } from 'react';
import { PDFToolMode, type Point, type Rect } from '@agentic/core';
import { usePDFStore } from '../../stores/pdfStore';
import { PDFRenderer } from '../../pdf/PDFRenderer';
import { PDFAnnotationSubtype } from '../../pdf/PDFDocumentModel';
import SFSymbol from '../../components/SFSymbol';

export function PDFCanvasView() {
  const document = usePDFStore((s) => s.document);
  const pageCount = usePDFStore((s) => s.pageCount);
  const currentPageIndex = usePDFStore((s) => s.currentPageIndex);
  const toolMode = usePDFStore((s) => s.toolMode);
  const selectedAnnotation = usePDFStore((s) => s.selectedAnnotation);
  const annotationStyle = usePDFStore((s) => s.annotationStyle);
  const revision = usePDFStore((s) => s.revision);
  const zoomScale = usePDFStore((s) => s.zoomScale);

  const newDocument = usePDFStore((s) => s.newDocument);
  const open = usePDFStore((s) => s.open);
  const setSelectedAnnotation = usePDFStore((s) => s.setSelectedAnnotation);
  const addAnnotation = usePDFStore((s) => s.addAnnotation);
  const editText = usePDFStore((s) => s.editText);
  const replaceImage = usePDFStore((s) => s.replaceImage);
  const cropPage = usePDFStore((s) => s.cropPage);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [dragStart, setDragStart] = useState<Point | null>(null);
  const [dragCurrent, setDragCurrent] = useState<Point | null>(null);
  const [freehandStrokes, setFreehandStrokes] = useState<Point[][]>([]);
  const [promptDialog, setPromptDialog] = useState<{
    title: string;
    message: string;
    prefill: string;
    onConfirm: (text: string) => void;
  } | null>(null);
  const [promptText, setPromptText] = useState('');

  const pageBounds = document ? document.mediaBox(currentPageIndex) : { width: 612, height: 792 };
  const pageSize = { width: pageBounds.width || 612, height: pageBounds.height || 792 };
  const pageRotation = document ? document.rotation(currentPageIndex) : 0;
  const pageAnnotations = document ? document.annotations(currentPageIndex) : [];

  // Render PDF page to canvas
  useEffect(() => {
    let cancelled = false;
    async function renderPage() {
      if (!document || !canvasRef.current) return;
      try {
        const bytes = await document.dataRepresentation();
        const renderer = new PDFRenderer(bytes);
        if (!cancelled && canvasRef.current) {
          await renderer.renderPage(currentPageIndex, canvasRef.current, {
            scale: zoomScale,
            rotation: pageRotation,
          });
        }
        renderer.destroy();
      } catch (err) {
        console.error('Failed to render PDF page:', err);
      }
    }
    renderPage();
    return () => {
      cancelled = true;
    };
  }, [document, currentPageIndex, revision, zoomScale, pageRotation]);

  // Open file with system file dialog
  const handleOpenLocalPDF = () => {
    const input = window.document.createElement('input');
    input.type = 'file';
    input.accept = 'application/pdf';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const buffer = await file.arrayBuffer();
      await open(new Uint8Array(buffer), file.name);
    };
    input.click();
  };

  // Coordinates conversion from viewport to PDF page space
  const getPagePoint = (e: React.MouseEvent): Point => {
    if (!containerRef.current) return { x: 0, y: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / zoomScale;
    const y = (e.clientY - rect.top) / zoomScale;
    return { x, y };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!document || toolMode === PDFToolMode.select) return;
    const pt = getPagePoint(e);

    if (toolMode === PDFToolMode.comment) {
      addAnnotation(currentPageIndex, {
        subtype: PDFAnnotationSubtype.text,
        bounds: { x: pt.x - 10, y: pt.y - 10, width: 20, height: 20 },
        contents: 'New comment',
      });
      return;
    }

    setDragStart(pt);
    setDragCurrent(pt);

    if (toolMode === PDFToolMode.draw || toolMode === PDFToolMode.signature) {
      setFreehandStrokes([[pt]]);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragStart) return;
    const pt = getPagePoint(e);
    setDragCurrent(pt);

    if (toolMode === PDFToolMode.draw || toolMode === PDFToolMode.signature) {
      setFreehandStrokes((prev) => {
        if (prev.length === 0) return [[pt]];
        const next = [...prev];
        next[next.length - 1] = [...next[next.length - 1], pt];
        return next;
      });
    }
  };

  const handleMouseUp = async (e: React.MouseEvent) => {
    if (!dragStart || !dragCurrent) {
      setDragStart(null);
      setDragCurrent(null);
      return;
    }

    const start = dragStart;
    const end = dragCurrent;
    const dist = Math.hypot(end.x - start.x, end.y - start.y);

    const bounds: Rect = {
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width: Math.max(4, Math.abs(end.x - start.x)),
      height: Math.max(4, Math.abs(end.y - start.y)),
    };

    setDragStart(null);
    setDragCurrent(null);

    // Freehand draw or signature
    if (toolMode === PDFToolMode.draw || toolMode === PDFToolMode.signature) {
      if (freehandStrokes.length > 0 && freehandStrokes.some((s) => s.length > 1)) {
        addAnnotation(currentPageIndex, {
          subtype: PDFAnnotationSubtype.ink,
          bounds: { x: 0, y: 0, width: pageSize.width, height: pageSize.height },
          inkPaths: freehandStrokes,
          color: annotationStyle.color || '#000000',
          borderWidth: annotationStyle.strokeWidth || 2,
        });
      }
      setFreehandStrokes([]);
      return;
    }

    // Edit text paragraph or drag box
    if (toolMode === PDFToolMode.editText) {
      setPromptDialog({
        title: 'Edit Text',
        message: 'Enter replacement text for this region:',
        prefill: '',
        onConfirm: async (text) => {
          if (!text) return;
          await editText(bounds, currentPageIndex, text);
        },
      });
      setPromptText('');
      return;
    }

    // Translate paragraph
    if (toolMode === PDFToolMode.translate) {
      setPromptDialog({
        title: 'Translate Paragraph',
        message: 'Enter translated text to patch over this region:',
        prefill: '',
        onConfirm: async (text) => {
          if (!text) return;
          await editText(bounds, currentPageIndex, text);
        },
      });
      setPromptText('');
      return;
    }

    // Image replacement
    if (toolMode === PDFToolMode.replaceImage) {
      const input = window.document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = async (ev) => {
        const file = (ev.target as HTMLInputElement).files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async () => {
          const base64 = (reader.result as string).split(',')[1];
          if (base64) {
            await replaceImage(bounds, currentPageIndex, base64);
          }
        };
        reader.readAsDataURL(file);
      };
      input.click();
      return;
    }

    // Standard shape annotations
    switch (toolMode) {
      case PDFToolMode.shapeRect:
        addAnnotation(currentPageIndex, {
          subtype: PDFAnnotationSubtype.square,
          bounds,
          color: annotationStyle.color || '#3B82F6',
          borderWidth: annotationStyle.strokeWidth || 2,
        });
        break;
      case PDFToolMode.shapeCircle:
        addAnnotation(currentPageIndex, {
          subtype: PDFAnnotationSubtype.circle,
          bounds,
          color: annotationStyle.color || '#3B82F6',
          borderWidth: annotationStyle.strokeWidth || 2,
        });
        break;
      case PDFToolMode.shapeLine:
        addAnnotation(currentPageIndex, {
          subtype: PDFAnnotationSubtype.line,
          bounds,
          color: annotationStyle.color || '#3B82F6',
          borderWidth: annotationStyle.strokeWidth || 2,
        });
        break;
      case PDFToolMode.highlight:
        addAnnotation(currentPageIndex, {
          subtype: PDFAnnotationSubtype.highlight,
          bounds,
          color: '#FBBF24',
        });
        break;
      case PDFToolMode.underline:
        addAnnotation(currentPageIndex, {
          subtype: PDFAnnotationSubtype.underline,
          bounds,
          color: '#3B82F6',
        });
        break;
      case PDFToolMode.strikeOut:
        addAnnotation(currentPageIndex, {
          subtype: PDFAnnotationSubtype.strikeOut,
          bounds,
          color: '#EF4444',
        });
        break;
      case PDFToolMode.freeText:
        addAnnotation(currentPageIndex, {
          subtype: PDFAnnotationSubtype.freeText,
          bounds,
          contents: 'Text',
          color: annotationStyle.textColor || '#000000',
          fontSize: annotationStyle.fontSize || 12,
        });
        break;
      case PDFToolMode.formTextField:
        addAnnotation(currentPageIndex, {
          subtype: PDFAnnotationSubtype.widget,
          bounds,
          widgetFieldType: 'text',
          fieldName: `field_${Date.now()}`,
        });
        break;
      case PDFToolMode.formCheckbox:
        addAnnotation(currentPageIndex, {
          subtype: PDFAnnotationSubtype.widget,
          bounds,
          widgetFieldType: 'button',
          fieldName: `checkbox_${Date.now()}`,
        });
        break;
      case PDFToolMode.crop:
        cropPage(currentPageIndex, bounds);
        break;
    }
  };

  // If no document is open, show empty state
  if (!document) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          height: '100%',
          backgroundColor: 'var(--bg-canvas)',
          gap: 16,
        }}
      >
        <SFSymbol name="doc.richtext" size={48} color="var(--text-muted)" />
        <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>
          No PDF open
        </span>
        <div style={{ display: 'flex', gap: 12 }}>
          <button
            onClick={() => newDocument()}
            style={{
              padding: '8px 16px',
              backgroundColor: 'var(--accent-primary)',
              color: '#FFFFFF',
              border: 'none',
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            New PDF
          </button>
          <button
            onClick={handleOpenLocalPDF}
            style={{
              padding: '8px 16px',
              backgroundColor: 'var(--bg-tertiary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Open…
          </button>
        </div>
      </div>
    );
  }

  // Active rubber-band rect in screen pixels
  const rubberBandRect =
    dragStart && dragCurrent
      ? {
          left: Math.min(dragStart.x, dragCurrent.x) * zoomScale,
          top: Math.min(dragStart.y, dragCurrent.y) * zoomScale,
          width: Math.abs(dragCurrent.x - dragStart.x) * zoomScale,
          height: Math.abs(dragCurrent.y - dragStart.y) * zoomScale,
        }
      : null;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        backgroundColor: 'var(--bg-canvas)',
        overflow: 'auto',
        position: 'relative',
        padding: 40,
        boxSizing: 'border-box',
      }}
    >
      {/* Page Container */}
      <div
        ref={containerRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        style={{
          position: 'relative',
          width: pageSize.width * zoomScale,
          height: pageSize.height * zoomScale,
          backgroundColor: '#FFFFFF',
          boxShadow: '0 8px 30px rgba(0,0,0,0.3)',
          cursor: toolMode === PDFToolMode.select ? 'default' : 'crosshair',
        }}
      >
        {/* PDF Rendering Canvas */}
        <canvas
          ref={canvasRef}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
          }}
        />

        {/* Existing Annotations Overlay */}
        {pageAnnotations.map((ann) => {
          const isSelected = selectedAnnotation?.annotationId === ann.annotationId;
          const left = ann.bounds.x * zoomScale;
          const top = ann.bounds.y * zoomScale;
          const width = ann.bounds.width * zoomScale;
          const height = ann.bounds.height * zoomScale;

          return (
            <div
              key={ann.annotationId}
              onClick={(e) => {
                e.stopPropagation();
                setSelectedAnnotation(ann);
              }}
              style={{
                position: 'absolute',
                left,
                top,
                width,
                height,
                border: isSelected ? '2px solid var(--accent-primary)' : '1px solid transparent',
                backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
                cursor: 'pointer',
                boxSizing: 'border-box',
              }}
            />
          );
        })}

        {/* Freehand Strokes Drawing Overlay */}
        {freehandStrokes.length > 0 && (
          <svg
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              pointerEvents: 'none',
            }}
          >
            {freehandStrokes.map((stroke, i) => {
              if (stroke.length < 2) return null;
              const d = stroke.reduce(
                (acc, p, idx) =>
                  idx === 0
                    ? `M ${p.x * zoomScale} ${p.y * zoomScale}`
                    : `${acc} L ${p.x * zoomScale} ${p.y * zoomScale}`,
                '',
              );
              return (
                <path
                  key={i}
                  d={d}
                  fill="none"
                  stroke={annotationStyle.color || '#000000'}
                  strokeWidth={(annotationStyle.strokeWidth || 2) * zoomScale}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              );
            })}
          </svg>
        )}

        {/* Rubber-band dragging box */}
        {rubberBandRect && (
          <div
            style={{
              position: 'absolute',
              left: rubberBandRect.left,
              top: rubberBandRect.top,
              width: rubberBandRect.width,
              height: rubberBandRect.height,
              border: '1.5px dashed var(--accent-primary)',
              backgroundColor: 'rgba(59, 130, 246, 0.15)',
              pointerEvents: 'none',
              boxSizing: 'border-box',
            }}
          />
        )}
      </div>

      {/* Prompt Dialog for Text / Replace */}
      {promptDialog && (
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
          onClick={() => setPromptDialog(null)}
        >
          <div
            style={{
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: 8,
              padding: 20,
              width: 440,
              boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
              {promptDialog.title}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
              {promptDialog.message}
            </div>
            <textarea
              autoFocus
              rows={4}
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
              style={{
                width: '100%',
                backgroundColor: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                borderRadius: 6,
                padding: 8,
                fontSize: 13,
                color: 'var(--text-primary)',
                fontFamily: 'inherit',
                boxSizing: 'border-box',
                resize: 'vertical',
                marginBottom: 16,
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                onClick={() => setPromptDialog(null)}
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
                  promptDialog.onConfirm(promptText);
                  setPromptDialog(null);
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
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default PDFCanvasView;
