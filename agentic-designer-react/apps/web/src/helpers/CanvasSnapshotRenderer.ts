// Ported 1:1 from AgenticDesigner/Helpers/CanvasSnapshotRenderer.swift
//
// מרנדר את הקנבס לתמונה עבור ה-Vision Critic — כך הסוכן שופט את התוצאה
// המרונדרת בפועל ולא רק קואורדינטות JSON.
//
// SwiftUI's `ImageRenderer` over a freshly built `CanvasNodeView` tree becomes
// `html-to-image` over the LIVE canvas DOM node (`CanvasSnapshotElementId`),
// translated so the requested nodes' bounding box lands at the origin. The
// sizing, scale and JPEG-quality rules are the Swift ones.

import { toCanvas } from 'html-to-image';
import type { DesignNode, Renderer, SnapshotRequest, SnapshotResult } from '@agentic/core';
import { getPlatform, setPlatform } from '@agentic/core';
import { useProjectStore } from '../stores/projectStore';

/** The id the mounted canvas surface must carry (`CanvasView`'s content root). */
export const CanvasSnapshotElementId = 'agentic-design-canvas';

/** Per-node element id, so a snapshot can be cropped to one node. */
export function canvasNodeElementId(nodeId: string): string {
  return `canvas-node-${nodeId}`;
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function boundsOf(nodes: readonly DesignNode[]): Bounds {
  return {
    minX: Math.min(...nodes.map((node) => node.x)),
    minY: Math.min(...nodes.map((node) => node.y)),
    maxX: Math.max(...nodes.map((node) => node.x + node.width)),
    maxY: Math.max(...nodes.map((node) => node.y + node.height)),
  };
}

function canvasElement(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  return document.getElementById(CanvasSnapshotElementId);
}

function dataURLToBytes(dataURL: string): Uint8Array {
  const base64 = dataURL.slice(dataURL.indexOf(',') + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function renderRegion(options: {
  translateX: number;
  translateY: number;
  width: number;
  height: number;
  pixelRatio: number;
  scaleX?: number;
  scaleY?: number;
  backgroundColor: string;
}): Promise<HTMLCanvasElement | null> {
  const element = canvasElement();
  if (!element) return null;

  const scalePart =
    options.scaleX !== undefined && options.scaleY !== undefined
      ? ` scale(${options.scaleX}, ${options.scaleY})`
      : '';

  return toCanvas(element, {
    backgroundColor: options.backgroundColor,
    width: Math.max(1, Math.round(options.width)),
    height: Math.max(1, Math.round(options.height)),
    pixelRatio: options.pixelRatio,
    style: {
      transform: `translate(${options.translateX}px, ${options.translateY}px)${scalePart}`,
      transformOrigin: 'top left',
    },
  });
}

export const CanvasSnapshotRenderer = {
  /**
   * Renders the given root nodes to a JPEG data URL suitable for a multimodal
   * chat message. Returns null when there is nothing to render.
   * maxDimension 900 + 0.45 JPEG quality keeps the base64 payload small.
   */
  async jpegDataURL(nodes: readonly DesignNode[], maxDimension = 900): Promise<string | null> {
    if (nodes.length === 0) return null;

    const padding = 24;
    const { minX, minY, maxX, maxY } = boundsOf(nodes);

    const width = maxX - minX + padding * 2;
    const height = maxY - minY + padding * 2;
    if (!(width > 1) || !(height > 1)) return null;

    const scale = Math.min(2, Math.max(0.4, maxDimension / Math.max(width, height)));

    const canvas = await renderRegion({
      translateX: -minX + padding,
      translateY: -minY + padding,
      width,
      height,
      pixelRatio: scale,
      backgroundColor: '#ECEFF3',
    });
    if (!canvas) return null;

    return canvas.toDataURL('image/jpeg', 0.45);
  },

  async jpegData(
    nodes: readonly DesignNode[],
    pixelWidth: number,
    pixelHeight: number,
    physicalWidthCM?: number,
    physicalHeightCM?: number,
    compression = 0.9,
  ): Promise<Uint8Array | null> {
    const canvas = await CanvasSnapshotRenderer.renderedImage(nodes, pixelWidth, pixelHeight);
    if (!canvas) return null;
    // `bitmap.size = NSSize(cm / 2.54 * 72)` only tags the JPEG's print size;
    // the pixel payload is identical, and browsers carry no such tag.
    void physicalWidthCM;
    void physicalHeightCM;
    return dataURLToBytes(canvas.toDataURL('image/jpeg', compression));
  },

  /**
   * Builds a real, correctly-sized PDF page with the rendered artwork filling
   * it (Swift renders through ImageRenderer and draws the CGImage into a
   * CGPDFContext; here pdf-lib embeds the same JPEG).
   */
  async pdfData(
    nodes: readonly DesignNode[],
    physicalWidthCM: number,
    physicalHeightCM: number,
    dpi = 150,
  ): Promise<Uint8Array | null> {
    if (!(physicalWidthCM > 0) || !(physicalHeightCM > 0) || !(dpi > 0)) return null;

    const pixelWidth = Math.max(1, Math.round((physicalWidthCM / 2.54) * dpi));
    const pixelHeight = Math.max(1, Math.round((physicalHeightCM / 2.54) * dpi));

    const jpeg = await CanvasSnapshotRenderer.jpegData(nodes, pixelWidth, pixelHeight, undefined, undefined, 0.92);
    if (!jpeg) return null;

    const { PDFDocument } = await import('pdf-lib');
    const pageWidthPoints = (physicalWidthCM / 2.54) * 72;
    const pageHeightPoints = (physicalHeightCM / 2.54) * 72;

    const pdf = await PDFDocument.create();
    const page = pdf.addPage([pageWidthPoints, pageHeightPoints]);
    const image = await pdf.embedJpg(jpeg);
    page.drawImage(image, { x: 0, y: 0, width: pageWidthPoints, height: pageHeightPoints });
    return pdf.save();
  },

  /**
   * Shared offscreen renderer for the print-export paths: lays the nodes out at
   * their natural size, then scales the whole scene to the exact pixel
   * dimensions requested.
   */
  async renderedImage(
    nodes: readonly DesignNode[],
    pixelWidth: number,
    pixelHeight: number,
  ): Promise<HTMLCanvasElement | null> {
    if (nodes.length === 0 || !(pixelWidth > 1) || !(pixelHeight > 1)) return null;

    const { minX, minY, maxX, maxY } = boundsOf(nodes);

    const sourceWidth = Math.max(1, maxX - minX);
    const sourceHeight = Math.max(1, maxY - minY);
    const outputWidth = pixelWidth;
    const outputHeight = pixelHeight;
    const scaleX = outputWidth / sourceWidth;
    const scaleY = outputHeight / sourceHeight;

    return renderRegion({
      translateX: -minX * scaleX,
      translateY: -minY * scaleY,
      width: outputWidth,
      height: outputHeight,
      pixelRatio: 1,
      scaleX,
      scaleY,
      backgroundColor: '#FFFFFF',
    });
  },
};

/** The `Renderer` platform adapter backed by the live canvas. */
export class CanvasRenderer implements Renderer {
  async snapshot(request: SnapshotRequest = {}): Promise<SnapshotResult> {
    const state = useProjectStore.getState();
    const page =
      request.pageId !== undefined
        ? state.project.pages.find((candidate) => candidate.id === request.pageId)
        : state.currentPage();
    const pageNodes = page?.nodes ?? [];
    const nodes =
      request.nodeIds !== undefined
        ? pageNodes.filter((node) => request.nodeIds?.includes(node.id))
        : pageNodes;

    if (nodes.length === 0) {
      throw new Error('CanvasSnapshotRenderer: nothing to render.');
    }

    const padding = 24;
    const { minX, minY, maxX, maxY } = boundsOf(nodes);
    const width = maxX - minX + padding * 2;
    const height = maxY - minY + padding * 2;
    const maxDimension = request.maxWidth ?? 900;
    const scale = request.scale ?? Math.min(2, Math.max(0.4, maxDimension / Math.max(width, height)));
    const quality = request.quality ?? 0.45;

    const canvas = await renderRegion({
      translateX: -minX + padding,
      translateY: -minY + padding,
      width,
      height,
      pixelRatio: scale,
      backgroundColor: '#ECEFF3',
    });
    if (!canvas) {
      throw new Error('CanvasSnapshotRenderer: the design canvas is not mounted.');
    }

    const dataURL = canvas.toDataURL('image/jpeg', quality);
    return {
      jpeg: dataURLToBytes(dataURL),
      width: canvas.width,
      height: canvas.height,
      dataURL,
    };
  }
}

/** Registers the canvas renderer as the platform `Renderer`. */
export function installCanvasSnapshotRenderer(): Renderer {
  const renderer = new CanvasRenderer();
  setPlatform({ renderer });
  return getPlatform().renderer;
}
