// Ported 1:1 from AgenticDesigner/Services/SpriteGenerator.swift
//
// Turns a text prompt into a game-ready sprite: generate art with the normal
// image pipeline (local mflux first, cloud fallback), then cut the subject out
// to a transparent PNG using Vision's on-device subject-lift — no extra models
// or network. Optionally emits several animation frames.
//
// This is what makes the generated art usable as a game sprite: FLUX/most image
// models bake in an opaque background; a sprite needs alpha.
//
// Platform split: CoreGraphics/ImageIO become the `ImageCodec` adapter (PNG
// encode/decode over RGBA buffers) and Vision's foreground-instance mask
// becomes `SubjectMasker`; the flip is a pure pixel operation here.

import { newUUID } from '../models/uuid';
import type { FileSystem } from '../platform/FileSystem';
import { getPlatform } from '../platform/platform';
import type { ImageAssetProvider, ImageCodec, RGBAImage, SubjectMasker } from './themeHosts';

export const AllSpriteGeneratorErrorKind = ['noSubjectFound', 'renderFailed', 'sourceUnreadable'] as const;
export type SpriteGeneratorErrorKind = (typeof AllSpriteGeneratorErrorKind)[number];

/** `SpriteGeneratorError` — same `errorDescription` strings. */
export class SpriteGeneratorError extends Error {
  readonly kind: SpriteGeneratorErrorKind;
  constructor(kind: SpriteGeneratorErrorKind) {
    super(spriteGeneratorErrorDescription(kind));
    this.kind = kind;
    this.name = 'SpriteGeneratorError';
  }
}

export function spriteGeneratorErrorDescription(kind: SpriteGeneratorErrorKind): string {
  switch (kind) {
    case 'noSubjectFound':
      return 'Vision could not find a foreground subject to cut out.';
    case 'renderFailed':
      return 'Failed to render the cut-out sprite to PNG.';
    case 'sourceUnreadable':
      return 'Could not read the generated source image.';
  }
}

export interface SpriteGenerationResult {
  /** Final sprite file paths (transparent PNGs when cut-out succeeded). */
  framePaths: string[];
  /** Whether background removal actually ran on each frame. */
  cutout: boolean;
}

/** Adapters the sprite pipeline needs beyond the image provider. */
export interface SpriteGeneratorDeps {
  codec: ImageCodec;
  masker?: SubjectMasker;
  fs?: FileSystem;
}

function fileSystem(fs?: FileSystem): FileSystem {
  return fs ?? getPlatform().fileSystem;
}

/**
 * `SpriteGenerator.dominantPalette(fromImagePaths:maxColors:)` — the most
 * common colours across some reference images, as #RRGGBB: the game's
 * working palette, sampled on-device (24×24 downsample, 32-step
 * quantization, alpha > 140).
 */
export async function dominantPalette(
  paths: string[],
  maxColors: number = 5,
  deps: SpriteGeneratorDeps,
): Promise<string[]> {
  const system = fileSystem(deps.fs);
  const counts = new Map<number, number>();
  for (const path of paths.slice(0, 6)) {
    let image: RGBAImage;
    try {
      image = deps.codec.decodePNG(await system.readBytes(path));
    } catch {
      continue;
    }
    const w = 24;
    const h = 24;
    const buf = downsample(image, w, h);
    let i = 0;
    while (i < buf.length) {
      if (buf[i + 3]! > 140) {
        // skip the transparent cutout background
        const r = Math.trunc(buf[i]! / 32) * 32;
        const g = Math.trunc(buf[i + 1]! / 32) * 32;
        const b = Math.trunc(buf[i + 2]! / 32) * 32;
        const key = (r << 16) | (g << 8) | b;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      i += 4;
    }
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxColors)
    .map(([k]) => `#${hex2((k >> 16) & 0xff)}${hex2((k >> 8) & 0xff)}${hex2(k & 0xff)}`);
}

/** Box-filter resize — CGContext.draw's interpolation, deterministically. */
function downsample(image: RGBAImage, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  if (image.width === 0 || image.height === 0) return out;
  for (let y = 0; y < h; y += 1) {
    const y0 = Math.floor((y * image.height) / h);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * image.height) / h));
    for (let x = 0; x < w; x += 1) {
      const x0 = Math.floor((x * image.width) / w);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * image.width) / w));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = y0; sy < Math.min(y1, image.height); sy += 1) {
        for (let sx = x0; sx < Math.min(x1, image.width); sx += 1) {
          const p = (sy * image.width + sx) * 4;
          r += image.pixels[p]!;
          g += image.pixels[p + 1]!;
          b += image.pixels[p + 2]!;
          a += image.pixels[p + 3]!;
          n += 1;
        }
      }
      const o = (y * w + x) * 4;
      if (n > 0) {
        out[o] = Math.round(r / n);
        out[o + 1] = Math.round(g / n);
        out[o + 2] = Math.round(b / n);
        out[o + 3] = Math.round(a / n);
      }
    }
  }
  return out;
}

function hex2(value: number): string {
  return value.toString(16).toUpperCase().padStart(2, '0');
}

/**
 * `SpriteGenerator.styleDirective(fromImagePaths:)` — a prompt fragment that
 * steers a new sprite toward the existing art; undefined when there are no
 * usable references.
 */
export async function styleDirective(
  paths: string[],
  deps: SpriteGeneratorDeps,
): Promise<string | undefined> {
  const palette = await dominantPalette(paths, 5, deps);
  if (palette.length === 0) return undefined;
  return (
    "Match the existing game's art style so it clearly belongs in the same game: " +
    `reuse this colour palette ${palette.join(', ')}; ` +
    'keep the same lighting, outline weight, shading and overall rendering style.'
  );
}

export interface GenerateSpriteOptions {
  prompt: string;
  frames?: number;
  size?: string;
  removeBackground?: boolean;
  assetKind?: string;
  styleReferencePaths?: string[];
  facing?: string;
  provider: ImageAssetProvider;
}

/**
 * `SpriteGenerator.generateSprite(prompt:frames:size:removeBackground:assetKind:styleReferencePaths:facing:provider:)`
 */
export async function generateSprite(
  options: GenerateSpriteOptions,
  deps: SpriteGeneratorDeps,
): Promise<SpriteGenerationResult> {
  const {
    prompt,
    frames = 1,
    size = '768x768',
    removeBackground = true,
    assetKind = 'sprite',
    styleReferencePaths = [],
    facing,
    provider,
  } = options;
  const frameCount = Math.max(1, Math.min(frames, 12));
  // Fold facing direction + the existing game's palette/style into the
  // prompt so the new sprite faces the right way and looks consistent.
  let styledPrompt = prompt;
  if (facing !== undefined) {
    const dir = facingDirective(facing);
    if (dir !== undefined) styledPrompt += `. ${dir}`;
  }
  const directive = await styleDirective(styleReferencePaths, deps);
  if (directive !== undefined) styledPrompt += `. ${directive}`;
  const paths: string[] = [];
  let didCutout = false;

  for (let i = 0; i < frameCount; i += 1) {
    const framePrompt =
      frameCount > 1
        ? `${styledPrompt} — sprite animation frame ${i + 1} of ${frameCount}; same character, same scale and colors, only a small pose/motion change between frames`
        : styledPrompt;

    const rawPath = await provider.generateImageAsset(framePrompt, assetKind, undefined, undefined, size);

    if (removeBackground) {
      try {
        const cut = await cutoutSubject(rawPath, deps);
        paths.push(cut);
        didCutout = true;
        continue;
      } catch {
        // `try?` — a failed cut-out keeps the opaque frame.
      }
    }
    paths.push(rawPath);
  }

  return { framePaths: paths, cutout: didCutout };
}

/**
 * `SpriteGenerator.cutoutSubject(fromImageAt:)` — cut the dominant foreground
 * subject out of an image, returning the path of a new transparent PNG.
 * Vision's foreground-instance mask lives behind the `SubjectMasker` adapter.
 */
export async function cutoutSubject(path: string, deps: SpriteGeneratorDeps): Promise<string> {
  const system = fileSystem(deps.fs);
  let source: RGBAImage;
  try {
    source = deps.codec.decodePNG(await system.readBytes(path));
  } catch {
    throw new SpriteGeneratorError('sourceUnreadable');
  }
  if (deps.masker === undefined) throw new SpriteGeneratorError('noSubjectFound');
  const masked = await deps.masker.cutout(source);
  if (masked === undefined) throw new SpriteGeneratorError('noSubjectFound');
  return writePNG(masked, deps);
}

// MARK: - PNG output (preserves the alpha channel)

/**
 * `SpriteGenerator.flipHorizontal(pathToImage:)` — mirror a sprite left↔right
 * and save a new PNG: the exact, reliable way to set a sprite's facing
 * direction (image models routinely ignore "facing left").
 */
export async function flipHorizontal(path: string, deps: SpriteGeneratorDeps): Promise<string> {
  const system = fileSystem(deps.fs);
  let image: RGBAImage;
  try {
    image = deps.codec.decodePNG(await system.readBytes(path));
  } catch {
    throw new SpriteGeneratorError('renderFailed');
  }
  return writePNG(flippedHorizontally(image), deps);
}

/** The pure pixel operation behind `flipHorizontal` (x axis mirrored). */
export function flippedHorizontally(image: RGBAImage): RGBAImage {
  const { width: w, height: h, pixels } = image;
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const from = (y * w + x) * 4;
      const to = (y * w + (w - 1 - x)) * 4;
      out[to] = pixels[from]!;
      out[to + 1] = pixels[from + 1]!;
      out[to + 2] = pixels[from + 2]!;
      out[to + 3] = pixels[from + 3]!;
    }
  }
  return { width: w, height: h, pixels: out };
}

/**
 * `SpriteGenerator.facingDirective(_:)` — a facing-direction phrase to steer
 * the prompt (best effort; pair with flipHorizontal for a guaranteed left/right).
 */
export function facingDirective(facing: string): string | undefined {
  switch (facing.toLowerCase()) {
    case 'right': return 'side profile, facing right';
    case 'left': return 'side profile, facing left';
    case 'front': return 'front view, facing the camera';
    case 'back': return 'back view, seen from behind';
    case 'up': return 'top-down view, seen from above';
    default: return undefined;
  }
}

async function writePNG(image: RGBAImage, deps: SpriteGeneratorDeps): Promise<string> {
  const system = fileSystem(deps.fs);
  const assetsDirectory = await generatedAssetsDirectory(system);
  const path = system.join(assetsDirectory, `sprite-${newUUID()}.png`);
  let bytes: Uint8Array;
  try {
    bytes = deps.codec.encodePNG(image);
  } catch {
    throw new SpriteGeneratorError('renderFailed');
  }
  await system.writeBytes(path, bytes);
  return path;
}

/**
 * `SpriteGenerator.assetsDirectoryURL` — the folder every generated sprite
 * lands in (transparent PNGs), the same location the rest of the app saves
 * generated assets to.
 */
export function assetsDirectoryURL(fs?: FileSystem): string {
  const system = fileSystem(fs);
  return system.join(system.applicationSupportDirectory(), 'GeneratedAssets');
}

/** `SpriteGenerator.librarySprites()` — existing sprites, newest first. */
export async function librarySprites(fs?: FileSystem): Promise<string[]> {
  const system = fileSystem(fs);
  const dir = assetsDirectoryURL(system);
  let names: string[];
  try {
    names = await system.readdir(dir);
  } catch {
    return [];
  }
  const entries: { path: string; date: number }[] = [];
  for (const name of names) {
    if (!name.toLowerCase().endsWith('.png')) continue;
    const path = system.join(dir, name);
    const stat = await system.stat(path);
    entries.push({ path, date: stat?.modifiedAt ?? -62_135_769_600_000 });
  }
  return entries.sort((a, b) => b.date - a.date).map((e) => e.path);
}

async function generatedAssetsDirectory(system: FileSystem): Promise<string> {
  const dir = assetsDirectoryURL(system);
  await system.mkdirp(dir);
  return dir;
}

/** Static members of the Swift `SpriteGenerator` enum. */
export const SpriteGenerator = {
  dominantPalette,
  styleDirective,
  generateSprite,
  cutoutSubject,
  flipHorizontal,
  flippedHorizontally,
  facingDirective,
  librarySprites,
  assetsDirectoryURL,
} as const;
