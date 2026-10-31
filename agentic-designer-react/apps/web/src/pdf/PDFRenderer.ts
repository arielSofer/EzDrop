// apps/web/src/pdf/PDFRenderer.ts
//
// Rendering and text extraction layer using pdfjs-dist.
// Renders pages to HTML Canvas, extracts glyph runs for PDFTextExtractor,
// and generates 200pt thumbnails.

import * as pdfjsLib from 'pdfjs-dist';
import type { GlyphRun } from '@agentic/core';

// Configure pdfjs worker if available in browser
if (typeof window !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
  // Use unpkg or local worker bundle
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
}

export interface RenderPageOptions {
  scale?: number;
  rotation?: number;
}

export interface RenderResult {
  width: number;
  height: number;
}

export class PDFRenderer {
  private pdfDoc: pdfjsLib.PDFDocumentProxy | null = null;
  private readonly data: Uint8Array;

  constructor(data: Uint8Array) {
    this.data = data;
  }

  async load(): Promise<pdfjsLib.PDFDocumentProxy> {
    if (this.pdfDoc) return this.pdfDoc;
    const loadingTask = pdfjsLib.getDocument({
      data: this.data,
      cMapUrl: `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/cmaps/`,
      cMapPacked: true,
    });
    this.pdfDoc = await loadingTask.promise;
    return this.pdfDoc;
  }

  async pageCount(): Promise<number> {
    const doc = await this.load();
    return doc.numPages;
  }

  /**
   * Renders a 1-based page index to a canvas context.
   */
  async renderPage(
    pageIndex: number,
    canvas: HTMLCanvasElement,
    options: RenderPageOptions = {},
  ): Promise<RenderResult> {
    const doc = await this.load();
    const pageNum = Math.max(1, Math.min(pageIndex + 1, doc.numPages));
    const page = await doc.getPage(pageNum);

    const scale = options.scale ?? 1.0;
    const viewport = page.getViewport({ scale, rotation: options.rotation ?? 0 });

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get 2d context for PDF rendering');

    await page.render({
      canvasContext: ctx,
      viewport,
    }).promise;

    return { width: viewport.width, height: viewport.height };
  }

  /**
   * Generates a thumbnail image data URL for a page (1-based index 0..n-1),
   * capped to 200pt max dimension.
   */
  async renderThumbnail(pageIndex: number, maxDimension = 200): Promise<string> {
    const doc = await this.load();
    const pageNum = Math.max(1, Math.min(pageIndex + 1, doc.numPages));
    const page = await doc.getPage(pageNum);

    const unscaledViewport = page.getViewport({ scale: 1.0 });
    const scale = maxDimension / Math.max(unscaledViewport.width, unscaledViewport.height);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get 2d context for thumbnail rendering');

    await page.render({
      canvasContext: ctx,
      viewport,
    }).promise;

    return canvas.toDataURL('image/jpeg', 0.85);
  }

  /**
   * Extracts text runs with PDF-space coordinates for PDFTextExtractor.
   */
  async extractGlyphRuns(pageIndex: number): Promise<GlyphRun[]> {
    const doc = await this.load();
    const pageNum = Math.max(1, Math.min(pageIndex + 1, doc.numPages));
    const page = await doc.getPage(pageNum);

    const textContent = await page.getTextContent();
    const runs: GlyphRun[] = [];

    for (const item of textContent.items) {
      if (!('str' in item)) continue;
      const str = item.str;
      if (!str || str.length === 0) continue;

      // item.transform is [scaleX, skewY, skewX, scaleY, tx, ty]
      const tx = item.transform[4] ?? 0;
      const ty = item.transform[5] ?? 0;
      const width = item.width ?? 0;
      const height = item.height ?? Math.abs(item.transform[3] ?? 12);

      runs.push({
        text: str,
        bounds: {
          x: tx,
          y: ty,
          width,
          height,
        },
      });
    }

    return runs;
  }

  destroy(): void {
    if (this.pdfDoc) {
      this.pdfDoc.destroy();
      this.pdfDoc = null;
    }
  }
}
