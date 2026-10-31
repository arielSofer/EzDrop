// Ported 1:1 from AgenticDesigner/Services/PDFTextExtractor.swift
//
//  Rebuilding lines and paragraphs from CHARACTER geometry.
//
//  `PDFSelection.selectionsByLine()` is the obvious way to read a page and the
//  wrong one for a technical book. Measured on Mathematics for Machine
//  Learning: of the line pairs it emitted, 27 per page were split for "low
//  horizontal overlap" — an inline formula has a taller, offset box, so the
//  run before it and the run after it stop looking like the same line. The
//  paragraph then arrives as fragments, none of which ends in a full stop, and
//  every downstream prose filter correctly rejects them. Coverage died in the
//  extractor, not in the filters.
//
//  Characters carry their own boxes, so lines can be rebuilt from BASELINES
//  instead: a superscript or a √ sits at a different height but shares the
//  line's baseline, and clustering on that keeps the sentence whole.
//
// PORT NOTE: the Swift version read `page.characterBounds(at:)` off a
// `PDFPage`. Here the input is a generic glyph-run list so the same clustering
// runs on pdf.js `textContent` items; a run carrying several characters is
// split into per-character boxes by advancing evenly across its width, which
// is what `characterBounds` reports for a horizontal run.
//
// This file is kept faithfully but is NOT wired into the translation path —
// see the Swift header and the measurements recorded with it: production's
// PDFKit line extraction scored 99% word integrity against this rewrite's 84%.

import { rectUnion, type Rect } from '../../models/Geometry';
import type { PDFParagraph } from '../../models/PDFEditorModels';

export interface ExtractedLine {
  text: string;
  bounds: Rect;
  /**
   * Median glyph height on the line — the basis for matching a replacement's
   * font size, and far more stable than the union box when a formula is in
   * the middle of it.
   */
  bodyHeight: number;
  baseline: number;
}

/** One glyph run as pdf.js reports it (or a single character, as PDFKit does). */
export interface GlyphRun {
  text: string;
  bounds: Rect;
}

interface Glyph {
  character: string;
  box: Rect;
}

/**
 * Characters whose boxes are this close vertically belong to one line.
 * Expressed as a fraction of the running body height so it scales with
 * the page's type size.
 */
const baselineTolerance = 0.55;

const WHITESPACE = /\s/u;
/** `Character.isNewline` */
const NEWLINE = /[\n\r\u0085\u2028\u2029]/u;

function median(values: number[]): number {
  const sorted = [...values].sort((lhs, rhs) => lhs - rhs);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Splits multi-character runs into per-character boxes across the run width. */
export function glyphsFromRuns(runs: readonly GlyphRun[]): Glyph[] {
  const glyphs: Glyph[] = [];
  for (const run of runs) {
    const characters = [...run.text];
    if (characters.length === 0) continue;
    if (characters.length === 1) {
      glyphs.push({ character: characters[0], box: run.bounds });
      continue;
    }
    const advance = run.bounds.width / characters.length;
    characters.forEach((character, index) => {
      glyphs.push({
        character,
        box: { x: run.bounds.x + advance * index, y: run.bounds.y, width: advance, height: run.bounds.height },
      });
    });
  }
  return glyphs;
}

// MARK: - Lines

function lines(runs: readonly GlyphRun[]): ExtractedLine[] {
  // Character boxes, skipping whitespace (its box is unreliable and it
  // would drag the baseline statistics around).
  const glyphs: Glyph[] = [];
  for (const glyph of glyphsFromRuns(runs)) {
    if (!(glyph.box.width > 0) || !(glyph.box.height > 0)) continue;
    if (NEWLINE.test(glyph.character)) continue;
    glyphs.push(glyph);
  }
  if (glyphs.length === 0) return [];

  // Typical glyph height on this page — the yardstick for "same line".
  const bodyHeight = median(glyphs.map((glyph) => glyph.box.height));
  const tolerance = Math.max(1.5, bodyHeight * baselineTolerance);

  // PDF origin is bottom-left, so lines descend as minY decreases.
  // Cluster on the box BOTTOM: a superscript's top is far above the
  // line's, but its bottom stays near the baseline it hangs from.
  const sorted = [...glyphs].sort((lhs, rhs) => {
    if (Math.abs(lhs.box.y - rhs.box.y) > tolerance) return rhs.box.y - lhs.box.y;
    return lhs.box.x - rhs.box.x;
  });

  const rows: Glyph[][] = [];
  let current: Glyph[] = [sorted[0]];
  let rowBaseline = sorted[0].box.y;
  for (const glyph of sorted.slice(1)) {
    if (Math.abs(glyph.box.y - rowBaseline) <= tolerance) {
      current.push(glyph);
      // Track the dominant baseline so a tall formula doesn't drag it.
      rowBaseline = median(current.map((item) => item.box.y));
    } else {
      rows.push(current);
      current = [glyph];
      rowBaseline = glyph.box.y;
    }
  }
  rows.push(current);

  const extracted: ExtractedLine[] = [];
  for (const row of rows) {
    const ordered = [...row].sort((lhs, rhs) => lhs.box.x - rhs.box.x);
    const first = ordered[0];
    if (!first) continue;

    // Word breaks come from horizontal gaps, because the raw character
    // stream's spaces are unreliable once a formula is inline.
    const medianWidth = median(ordered.map((glyph) => glyph.box.width));
    const spaceThreshold = Math.max(1.0, medianWidth * 0.42);

    let text = first.character;
    let previous = first.box;
    for (const glyph of ordered.slice(1)) {
      const gap = glyph.box.x - (previous.x + previous.width);
      const lastCharacter = text.slice(-1);
      const lastIsWhitespace = lastCharacter.length > 0 && WHITESPACE.test(lastCharacter);
      const glyphIsWhitespace = WHITESPACE.test(glyph.character);
      if (gap > spaceThreshold && !glyphIsWhitespace && !lastIsWhitespace) text += ' ';
      const lastAfter = text.slice(-1);
      const lastAfterIsWhitespace = lastAfter.length > 0 && WHITESPACE.test(lastAfter);
      if (!glyphIsWhitespace || !lastAfterIsWhitespace) text += glyph.character;
      previous = glyph.box;
    }

    let bounds = first.box;
    for (const glyph of ordered.slice(1)) bounds = rectUnion(bounds, glyph.box);
    const trimmed = text.replace(/^[ \t]+|[ \t]+$/g, '');
    if (trimmed.length === 0) continue;
    extracted.push({
      text: trimmed,
      bounds,
      bodyHeight: median(ordered.map((glyph) => glyph.box.height)),
      baseline: median(ordered.map((glyph) => glyph.box.y)),
    });
  }
  return extracted;
}

// MARK: - Paragraphs

/**
 * Groups lines into paragraphs using column position and line spacing —
 * deliberately NOT using "does the sentence look finished", because the
 * character stream of a formula-heavy page rarely provides that evidence.
 */
function paragraphs(runs: readonly GlyphRun[]): PDFParagraph[] {
  const extracted = lines(runs);
  if (extracted.length === 0) return [];

  // The body's left margin: the most common line start, rounded into
  // buckets so justified text with slight variation still agrees.
  const leftFrequency = new Map<number, number>();
  for (const line of extracted) {
    const bucket = Math.round(line.bounds.x / 6) * 6;
    leftFrequency.set(bucket, (leftFrequency.get(bucket) ?? 0) + 1);
  }
  let bodyLeft = extracted[0].bounds.x;
  let best = -1;
  for (const [bucket, count] of leftFrequency) {
    if (count > best) {
      best = count;
      bodyLeft = bucket;
    }
  }

  const medianBody = median(extracted.map((line) => line.bodyHeight));
  const widestRight = Math.max(...extracted.map((line) => line.bounds.x + line.bounds.width));

  const startsNewParagraph = (previous: ExtractedLine, line: ExtractedLine): boolean => {
    const gap = previous.bounds.y - (line.bounds.y + line.bounds.height);
    // A clear vertical break.
    if (gap > medianBody * 1.15) return true;
    // Moving backwards or sideways = a different column or region.
    if (line.bounds.y + line.bounds.height > previous.bounds.y + previous.bounds.height + medianBody) return true;
    // A first-line indent starts a paragraph, but only when the
    // previous line reached the right margin (i.e. it was full).
    const indented = line.bounds.x > bodyLeft + medianBody * 0.6;
    const previousWasFull = previous.bounds.x + previous.bounds.width > widestRight - medianBody;
    if (indented && previousWasFull && line.bounds.x > previous.bounds.x + 4) return true;
    // A heading or caption: markedly different type size.
    const ratio = previous.bodyHeight / Math.max(0.1, line.bodyHeight);
    if (ratio < 0.75 || ratio > 1.33) return true;
    return false;
  };

  const groups: ExtractedLine[][] = [];
  let current: ExtractedLine[] = [extracted[0]];
  for (const line of extracted.slice(1)) {
    if (startsNewParagraph(current[current.length - 1], line)) {
      groups.push(current);
      current = [line];
    } else {
      current.push(line);
    }
  }
  groups.push(current);

  return groups.map((group) => {
    let bounds = group[0].bounds;
    for (const line of group.slice(1)) bounds = rectUnion(bounds, line.bounds);
    return {
      text: joinWrapped(group.map((line) => line.text)),
      bounds,
      lineHeight: median(group.map((line) => line.bodyHeight)),
    };
  });
}

/** Rejoins wrapped lines, healing the hyphenation the typesetter added. */
function joinWrapped(input: readonly string[]): string {
  let output = '';
  for (const line of input) {
    if (output.length === 0) {
      output = line;
      continue;
    }
    if (output.endsWith('-')) {
      output = output.slice(0, -1) + line;
    } else {
      output += ' ' + line;
    }
  }
  return output;
}

/** `enum PDFTextExtractor` — a Swift caseless enum is a namespace. */
export const PDFTextExtractor = {
  lines,
  paragraphs,
  joinWrapped,
} as const;
