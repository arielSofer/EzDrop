// Ported 1:1 from AgenticDesigner/Services/SpriteGenerator.swift (OS half)
//
// The image-model round trip (`generateSprite` → provider.generateImageAsset)
// runs in the browser; the parts that need Vision / CoreGraphics / the
// GeneratedAssets directory run here. Vision's subject lift and CG flipping
// are compiled from resources/SpriteTools.swift on first use.
import fs from 'node:fs';
import path from 'node:path';
import { agenticDotDirectory, agenticSupportDirectory, contentModificationDate, ensureDirectory, fileExists, uuidString } from '../platform/Paths.js';
import { runProcess } from '../platform/ProcessRunner.js';
import { resourcePath } from './LocalBridges.js';

export class SpriteGeneratorError extends Error {
  static noSubjectFound(): SpriteGeneratorError {
    return new SpriteGeneratorError('Vision could not find a foreground subject to cut out.');
  }
  static renderFailed(): SpriteGeneratorError {
    return new SpriteGeneratorError('Failed to render the cut-out sprite to PNG.');
  }
  static sourceUnreadable(): SpriteGeneratorError {
    return new SpriteGeneratorError('Could not read the generated source image.');
  }
}

export interface SpriteGenerationResult {
  /// Final sprite file paths (transparent PNGs when cut-out succeeded).
  framePaths: string[];
  /// Whether background removal actually ran on each frame.
  cutout: boolean;
}

let compiledToolPath: string | null = null;

async function spriteTool(): Promise<string> {
  if (compiledToolPath && fileExists(compiledToolPath)) return compiledToolPath;
  const source = resourcePath('SpriteTools.swift');
  const binDir = path.join(agenticDotDirectory(), 'bin');
  ensureDirectory(binDir);
  const binary = path.join(binDir, 'SpriteTools');
  if (!fileExists(binary) || contentModificationDate(binary) < contentModificationDate(source)) {
    const result = await runProcess('/usr/bin/swiftc', ['-O', source, '-o', binary]).catch((error: Error) => ({ status: 1, output: error.message }));
    if (result.status !== 0) {
      throw new SpriteGeneratorError(`Could not compile SpriteTools (Xcode / Command Line Tools required): ${result.output.slice(-600)}`);
    }
  }
  compiledToolPath = binary;
  return binary;
}

async function runTool(args: string[]): Promise<string> {
  const tool = await spriteTool();
  const result = await runProcess(tool, args);
  if (result.status !== 0) {
    throw new SpriteGeneratorError(result.output.trim().split('\n').pop() || 'SpriteTools failed.');
  }
  return result.output.trim();
}

export const SpriteGenerator = {
  /// The most common colours across some reference images, as #RRGGBB — the
  /// game's working palette, sampled on-device.
  async dominantPalette(paths: string[], maxColors: number = 5): Promise<string[]> {
    if (paths.length === 0) return [];
    const output = await runTool(['palette', String(maxColors), ...paths.slice(0, 6)]);
    try {
      const parsed = JSON.parse(output.split('\n').pop() ?? '[]');
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
    } catch {
      return [];
    }
  },

  /// A prompt fragment that steers a new sprite toward the existing art —
  /// null when there are no usable references.
  async styleDirective(paths: string[]): Promise<string | null> {
    const palette = await SpriteGenerator.dominantPalette(paths);
    if (palette.length === 0) return null;
    return 'Match the existing game\'s art style so it clearly belongs in the same game: '
      + `reuse this colour palette ${palette.join(', ')}; `
      + 'keep the same lighting, outline weight, shading and overall rendering style.';
  },

  /// Cut the dominant foreground subject out of an image, returning the path
  /// of a new transparent PNG (Vision's foreground-instance mask).
  async cutoutSubject(imagePath: string): Promise<string> {
    if (!fileExists(imagePath)) throw SpriteGeneratorError.sourceUnreadable();
    const output = newSpritePath();
    await runTool(['cutout', imagePath, output]);
    return output;
  },

  /// Mirror a sprite left↔right and save a new PNG. Returns the new file path.
  async flipHorizontal(imagePath: string): Promise<string> {
    if (!fileExists(imagePath)) throw SpriteGeneratorError.renderFailed();
    const output = newSpritePath();
    await runTool(['flip', imagePath, output]);
    return output;
  },

  /// A facing-direction phrase to steer the prompt.
  facingDirective(facing: string): string | null {
    switch (facing.toLowerCase()) {
      case 'right': return 'side profile, facing right';
      case 'left': return 'side profile, facing left';
      case 'front': return 'front view, facing the camera';
      case 'back': return 'back view, seen from behind';
      case 'up': return 'top-down view, seen from above';
      default: return null;
    }
  },

  /// The folder every generated sprite lands in (transparent PNGs).
  get assetsDirectoryURL(): string {
    return generatedAssetsDirectory();
  },

  /// Existing sprites, newest first — the Studio's sprite library.
  librarySprites(): string[] {
    const dir = generatedAssetsDirectory();
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return [];
    }
    return names
      .filter((name) => name.toLowerCase().endsWith('.png'))
      .map((name) => path.join(dir, name))
      .sort((a, b) => contentModificationDate(b) - contentModificationDate(a));
  },

  /// OpenRouterProvider.saveGeneratedImageData — where every generated image
  /// (cloud or mflux) is written: GeneratedAssets/<UUID>.<ext>.
  saveGeneratedImageData(data: Buffer, preferredExtension: string): string {
    const assetsDirectory = generatedAssetsDirectory();
    const sanitizedExtension = preferredExtension.replace(/^\.+|\.+$/g, '').trim();
    const fileExtension = sanitizedExtension.length === 0 ? 'png' : sanitizedExtension;
    const fileURL = path.join(assetsDirectory, `${uuidString()}.${fileExtension}`);
    fs.writeFileSync(fileURL, data);
    return fileURL;
  },
};

function newSpritePath(): string {
  return path.join(generatedAssetsDirectory(), `sprite-${uuidString()}.png`);
}

/// Same location the rest of the app saves generated assets, so exports and
/// the asset browser find sprites the normal way.
function generatedAssetsDirectory(): string {
  const dir = agenticSupportDirectory('GeneratedAssets');
  ensureDirectory(dir);
  return dir;
}
