// Ported 1:1 from AgenticDesigner/ViewModels/PDFEditorViewModel.swift
// (`// MARK: - Paragraph detection`, lines ~1170-1330 — `paragraph(at:on:)`,
// `paragraphs(on:)`, `joinLines`, `maskMathRuns`, `unmaskMathRuns` and
// `separateHebrewLatinScripts`).
//
// These are the pure half of the view model: the clustering rules that turn a
// page's extracted text lines into paragraphs, plus the small text transforms
// the translation paths apply around them. They live in core so the store, the
// MCP tools and the tests all share one implementation.
//
// The block of consecutive text lines under a point. Lines cluster into
// one paragraph while they stay in the same column, keep a normal
// leading gap, use a similar font size, and no indented line (a new
// paragraph's first line) interrupts — which handles books like the
// Mathematics-for-Machine-Learning PDF that separate paragraphs by
// indentation rather than spacing.

import {
  rectContainsPoint,
  rectInset,
  rectMaxX,
  rectMaxY,
  rectMinX,
  rectMinY,
  rectUnion,
  type Point,
  type Rect,
} from '../../models/Geometry';
import type { PDFParagraph } from '../../models/PDFEditorModels';

/** `(string: String, bounds: CGRect)` — one extracted text line. */
export interface PDFTextLine {
  string: string;
  bounds: Rect;
}

/** A `CharacterSet` reduced to the one operation the Swift code performs. */
export interface CharacterSetLike {
  contains(scalar: number): boolean;
}

/** `CharacterSet(charactersIn:)` + `insert(charactersIn: a...b)`. */
export function makeCharacterSet(characters: string, ranges: readonly (readonly [number, number])[] = []): CharacterSetLike {
  const scalars = new Set<number>();
  for (const character of characters) {
    const value = character.codePointAt(0);
    if (value !== undefined) scalars.add(value);
  }
  return {
    contains(scalar: number): boolean {
      if (scalars.has(scalar)) return true;
      for (const [lower, upper] of ranges) if (scalar >= lower && scalar <= upper) return true;
      return false;
    },
  };
}

/** Unicode scalars of a string, as Swift's `unicodeScalars` enumerates them. */
export function unicodeScalars(text: string): number[] {
  const scalars: number[] = [];
  for (const character of text) {
    const value = character.codePointAt(0);
    if (value !== undefined) scalars.push(value);
  }
  return scalars;
}

function median(values: number[]): number {
  const sorted = [...values].sort((lhs, rhs) => lhs - rhs);
  return sorted[Math.floor(sorted.length / 2)];
}

// MARK: - paragraph(at:on:)

function continuous(upper: PDFTextLine, lower: PDFTextLine): boolean {
  const gap = rectMinY(upper.bounds) - rectMaxY(lower.bounds);
  const reference = Math.min(upper.bounds.height, lower.bounds.height);
  if (!(gap < reference * 0.9)) return false;
  const overlap = Math.min(rectMaxX(upper.bounds), rectMaxX(lower.bounds)) - Math.max(rectMinX(upper.bounds), rectMinX(lower.bounds));
  if (!(overlap > reference)) return false;
  const sizeRatio = upper.bounds.height / Math.max(1, lower.bounds.height);
  return sizeRatio > 0.7 && sizeRatio < 1.4;
}

/** `func paragraph(at point: CGPoint, on page: PDFPage) -> PDFParagraph?` */
function paragraph(point: Point, lines: readonly PDFTextLine[]): PDFParagraph | null {
  const clicked = lines.findIndex((line) => rectContainsPoint(rectInset(line.bounds, -2, -2), point));
  if (clicked < 0) return null;

  let first = clicked;
  while (first > 0 && continuous(lines[first - 1], lines[first])) {
    // An indented line is a paragraph's first line — stop there.
    if (rectMinX(lines[first].bounds) > rectMinX(lines[first - 1].bounds) + 6) break;
    // A line starting far right of this block (beyond any first-line
    // indent) is a different block — typically a centered heading.
    if (rectMinX(lines[first - 1].bounds) > rectMinX(lines[first].bounds) + 24) break;
    first -= 1;
  }
  let last = clicked;
  while (last + 1 < lines.length && continuous(lines[last], lines[last + 1])) {
    if (rectMinX(lines[last + 1].bounds) > rectMinX(lines[last].bounds) + 6) break;
    // Symmetric centered-heading guard when the CLICKED line is the
    // heading itself: body text far left of it is a different block.
    if (rectMinX(lines[last].bounds) > rectMinX(lines[last + 1].bounds) + 24) break;
    last += 1;
  }

  const block = lines.slice(first, last + 1);
  let bounds = block[0].bounds;
  for (const line of block.slice(1)) bounds = rectUnion(bounds, line.bounds);
  const lineHeight = median(block.map((line) => line.bounds.height));
  return { text: joinLines(block.map((line) => line.string)), bounds, lineHeight };
}

// MARK: - paragraphs(on:)

/**
 * Every text block on the page, top to bottom — the same clustering
 * rules as paragraph(at:), applied sequentially. Used by batch
 * operations (translate a whole page's paragraphs).
 */
function paragraphs(lines: readonly PDFTextLine[]): PDFParagraph[] {
  if (lines.length === 0) return [];

  const splits = (upper: PDFTextLine, lower: PDFTextLine): boolean => {
    const gap = rectMinY(upper.bounds) - rectMaxY(lower.bounds);
    const reference = Math.min(upper.bounds.height, lower.bounds.height);
    if (gap >= reference * 0.9) return true;
    const overlap = Math.min(rectMaxX(upper.bounds), rectMaxX(lower.bounds)) - Math.max(rectMinX(upper.bounds), rectMinX(lower.bounds));
    if (overlap <= reference) return true;
    const sizeRatio = upper.bounds.height / Math.max(1, lower.bounds.height);
    if (sizeRatio <= 0.7 || sizeRatio >= 1.4) return true;
    if (rectMinX(lower.bounds) > rectMinX(upper.bounds) + 6) return true; // indented paragraph start
    if (rectMinX(upper.bounds) > rectMinX(lower.bounds) + 24) return true; // centered heading above
    return false;
  };

  const blocks: PDFTextLine[][] = [];
  let current: PDFTextLine[] = [lines[0]];
  for (let index = 1; index < lines.length; index += 1) {
    if (splits(lines[index - 1], lines[index])) {
      blocks.push(current);
      current = [lines[index]];
    } else {
      current.push(lines[index]);
    }
  }
  blocks.push(current);

  return blocks.map((block) => {
    let bounds = block[0].bounds;
    for (const line of block.slice(1)) bounds = rectUnion(bounds, line.bounds);
    return {
      text: joinLines(block.map((line) => line.string)),
      bounds,
      lineHeight: median(block.map((line) => line.bounds.height)),
    };
  });
}

// MARK: - Text transforms

/**
 * Joins extracted lines into flowing text, merging hyphenated line
 * breaks when the next line starts lowercase.
 */
export function joinLines(lines: readonly string[]): string {
  let result = '';
  for (const line of lines) {
    if (result.length === 0) {
      result = line;
    } else if (result.endsWith('-') && line.length > 0 && isLowercaseLetter(line[0])) {
      result = result.slice(0, -1) + line;
    } else {
      result += ' ' + line;
    }
  }
  return result;
}

const LOWERCASE = /\p{Ll}/u;
const LETTER = /\p{L}/u;

/** `Character.isLowercase` */
function isLowercaseLetter(character: string): boolean {
  return LOWERCASE.test(character);
}

/** `CharacterSet.letters.contains(_:)` */
function isLetter(character: string): boolean {
  return LETTER.test(character);
}

/**
 * Inline math protection: maximal runs of formula tokens become ⟦n⟧
 * placeholders so the surrounding sentence translates as one unit and
 * the original notation returns verbatim.
 */
export function maskMathRuns(text: string, markers: CharacterSetLike): { masked: string; runs: string[] } {
  const tokens = text.split(' ');
  const runs: string[] = [];
  const out: string[] = [];
  let current: string[] = [];

  const isMathToken = (token: string): boolean => {
    if (token.length === 0) return false;
    for (const scalar of unicodeScalars(token)) if (markers.contains(scalar)) return true;
    return ['+', '-', '−', '·', '/', ':=', '|'].includes(token);
  };
  const flush = (): void => {
    if (current.length === 0) return;
    runs.push(current.join(' '));
    out.push(`⟦${runs.length - 1}⟧`);
    current = [];
  };

  for (const token of tokens) {
    if (isMathToken(token)) {
      current.push(token);
    } else {
      flush();
      out.push(token);
    }
  }
  flush();
  return { masked: out.join(' '), runs };
}

/**
 * Re-inserts the original runs; null when the model lost or invented a
 * placeholder — the caller keeps the original text in that case.
 */
export function unmaskMathRuns(text: string, runs: readonly string[]): string | null {
  let result = text;
  for (let index = 0; index < runs.length; index += 1) {
    const token = `⟦${index}⟧`;
    if (!result.includes(token)) return null;
    result = result.split(token).join(runs[index]);
  }
  return result.includes('⟦') ? null : result;
}

/** Inserts a space wherever Hebrew and Latin runs collide. */
export function separateHebrewLatinScripts(text: string): string {
  const script = (character: string): number => {
    for (const scalar of unicodeScalars(character)) {
      if (scalar >= 0x0590 && scalar <= 0x05ff) return 1;
    }
    for (const scalar of unicodeScalars(character)) {
      if (scalar < 0x80 && isLetter(String.fromCodePoint(scalar))) return 2;
    }
    return 0;
  };

  let result = '';
  let previousScript = 0;
  for (const character of text) {
    const currentScript = script(character);
    if (previousScript > 0 && currentScript > 0 && previousScript !== currentScript) result += ' ';
    result += character;
    previousScript = currentScript;
  }
  return result;
}

/** The paragraph-detection half of `PDFEditorViewModel`, as a namespace. */
export const PDFParagraphDetector = {
  isLetter,
  isLowercaseLetter,
  paragraph,
  paragraphs,
  joinLines,
  maskMathRuns,
  unmaskMathRuns,
  separateHebrewLatinScripts,
} as const;
