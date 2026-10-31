// Platform adapter: canvas snapshot (ImageRenderer / NSBitmapImageRep → JPEG).
// The web app implements it with html-to-image over the live canvas DOM.

import { PlatformUnsupportedError } from './FileSystem';

export interface SnapshotRequest {
  /** Page id to render; undefined = current page. */
  pageId?: string;
  /** Restrict to these root node ids; undefined = whole page. */
  nodeIds?: string[];
  /** Device pixel scale (1 = 1x). */
  scale?: number;
  /** JPEG quality 0…1. */
  quality?: number;
  /** Max output width in px; the image is downscaled to fit. */
  maxWidth?: number;
  /** Include the device frame chrome around the artboard. */
  includeDeviceFrame?: boolean;
}

export interface SnapshotResult {
  /** JPEG bytes. */
  jpeg: Uint8Array;
  width: number;
  height: number;
  /** data:image/jpeg;base64,... */
  dataURL: string;
}

export interface Renderer {
  snapshot(request?: SnapshotRequest): Promise<SnapshotResult>;
}

export class UnsupportedRenderer implements Renderer {
  async snapshot(): Promise<SnapshotResult> {
    throw new PlatformUnsupportedError('Renderer.snapshot');
  }
}
