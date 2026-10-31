// apps/web/src/views/pdf/PDFPageThumbnailsPanel.tsx
//
// Ported 1:1 from AgenticDesigner/Views/PDF/PDFPageThumbnailsPanel.swift.
// Left panel in PDF Editor mode: page thumbnails with add/remove/duplicate/
// rotate/reorder (drag to reorder) — the page-management surface of the
// PDF Editor.

import React, { useState, useEffect } from 'react';
import { usePDFStore } from '../../stores/pdfStore';
import { PDFRenderer } from '../../pdf/PDFRenderer';
import SFSymbol from '../../components/SFSymbol';

export function PDFPageThumbnailsPanel() {
  const document = usePDFStore((s) => s.document);
  const pageCount = usePDFStore((s) => s.pageCount);
  const currentPageIndex = usePDFStore((s) => s.currentPageIndex);
  const revision = usePDFStore((s) => s.revision);

  const setCurrentPageIndex = usePDFStore((s) => s.setCurrentPageIndex);
  const addPage = usePDFStore((s) => s.addPage);
  const duplicatePage = usePDFStore((s) => s.duplicatePage);
  const removePage = usePDFStore((s) => s.removePage);
  const rotatePage = usePDFStore((s) => s.rotatePage);
  const reorderPage = usePDFStore((s) => s.reorderPage);

  const [thumbnails, setThumbnails] = useState<Map<number, string>>(new Map());
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  // Generate page thumbnails
  useEffect(() => {
    let cancelled = false;
    async function loadThumbnails() {
      if (!document) {
        setThumbnails(new Map());
        return;
      }
      try {
        const bytes = await document.dataRepresentation();
        const renderer = new PDFRenderer(bytes);
        const map = new Map<number, string>();
        for (let i = 0; i < pageCount; i++) {
          if (cancelled) return;
          try {
            const url = await renderer.renderThumbnail(i, 180);
            map.set(i, url);
          } catch {
            // ignore render error for corrupt page
          }
        }
        if (!cancelled) setThumbnails(map);
        renderer.destroy();
      } catch {
        // ignore
      }
    }
    loadThumbnails();
    return () => {
      cancelled = true;
    };
  }, [document, pageCount, revision]);

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.setData('text/plain', String(index));
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === targetIndex) return;
    const dest = draggedIndex < targetIndex ? targetIndex + 1 : targetIndex;
    reorderPage(draggedIndex, dest);
    setDraggedIndex(null);
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        backgroundColor: 'var(--bg-secondary)',
        borderRight: '1px solid var(--border-color)',
        userSelect: 'none',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 12px',
          borderBottom: '1px solid var(--border-color)',
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600 }}>Pages</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{pageCount}</span>
          <button
            onClick={() => addPage(currentPageIndex)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-primary)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              padding: 2,
            }}
            title="Add page after current"
          >
            <SFSymbol name="plus.rectangle" size={14} />
          </button>
        </div>
      </div>

      {/* Pages List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 10 }}>
        {Array.from({ length: pageCount }).map((_, index) => {
          const isSelected = index === currentPageIndex;
          const thumbUrl = thumbnails.get(index);

          return (
            <div
              key={index}
              draggable
              onDragStart={(e) => handleDragStart(e, index)}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, index)}
              onClick={() => setCurrentPageIndex(index)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 6,
                padding: 8,
                marginBottom: 10,
                borderRadius: 6,
                backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.12)' : 'transparent',
                cursor: 'pointer',
              }}
            >
              {/* Thumbnail Container */}
              <div
                style={{
                  position: 'relative',
                  width: 140,
                  height: 180,
                  backgroundColor: '#FFFFFF',
                  borderRadius: 4,
                  overflow: 'hidden',
                  boxShadow: isSelected
                    ? '0 0 0 2px var(--accent-primary), 0 2px 8px rgba(0,0,0,0.3)'
                    : '0 1px 4px rgba(0,0,0,0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {thumbUrl ? (
                  <img
                    src={thumbUrl}
                    alt={`Page ${index + 1}`}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'contain',
                    }}
                  />
                ) : (
                  <SFSymbol name="doc.richtext" size={24} color="#9CA3AF" />
                )}

                {/* Page Number Badge */}
                <div
                  style={{
                    position: 'absolute',
                    top: 4,
                    left: 4,
                    backgroundColor: 'rgba(0,0,0,0.65)',
                    color: '#FFFFFF',
                    fontSize: 10,
                    fontWeight: 600,
                    padding: '2px 5px',
                    borderRadius: 4,
                  }}
                >
                  {index + 1}
                </div>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    rotatePage(index, -90);
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    padding: 2,
                  }}
                  title="Rotate Left"
                >
                  <SFSymbol name="rotate.left" size={11} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    rotatePage(index, 90);
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    padding: 2,
                  }}
                  title="Rotate Right"
                >
                  <SFSymbol name="rotate.right" size={11} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    duplicatePage(index);
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    padding: 2,
                  }}
                  title="Duplicate Page"
                >
                  <SFSymbol name="plus.square.on.square" size={11} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removePage(index);
                  }}
                  disabled={pageCount <= 1}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: pageCount <= 1 ? 'var(--text-muted)' : '#EF4444',
                    cursor: pageCount <= 1 ? 'default' : 'pointer',
                    padding: 2,
                  }}
                  title="Delete Page"
                >
                  <SFSymbol name="trash" size={11} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default PDFPageThumbnailsPanel;
