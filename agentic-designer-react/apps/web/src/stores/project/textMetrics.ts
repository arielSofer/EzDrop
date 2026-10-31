// Text measurement helpers ported from AgenticDesigner/ViewModels/ProjectViewModel.swift.
//
// The Swift code measures with AppKit (`NSAttributedString.size()`,
// `NSString.boundingRect(with:options:[.usesLineFragmentOrigin,.usesFontLeading])`,
// `NSMutableParagraphStyle` min/max line height, `.kern` for letterSpacing).
// Here the same calls go through the injected `TextMeasurer` platform adapter
// (canvas `measureText` in the browser, a deterministic SF-Pro approximation in
// tests), so hit-testing, hugging and the repair passes keep identical logic.

import { getTextMeasurer, type NodeStyle, type Size } from '@agentic/core';

/** `nsFontWeight(_:)` / the weight half of `interactionFont(for:)`. */
export function nsFontWeight(weight?: string): string {
  switch (weight?.toLowerCase()) {
    case 'black':
      return 'black';
    case 'heavy':
    case 'extrabold':
      return 'heavy';
    case 'bold':
      return 'bold';
    case 'semibold':
      return 'semibold';
    case 'medium':
      return 'medium';
    case 'light':
      return 'light';
    default:
      return 'regular';
  }
}

export interface TextAttributes {
  fontSize: number;
  weight: string;
  /** `.kern` */
  letterSpacing?: number;
  /** paragraph min/max line height; undefined = the font's natural leading. */
  lineHeight?: number;
  /** `NSFont(name:size:)`; the canvas measurer uses it when the family exists. */
  fontFamily?: string;
}

/** Attributes for `measuredTextSize(_:style:constrainedToWidth:)` (no paragraph style). */
export function measurementAttributes(style: NodeStyle): TextAttributes {
  const attributes: TextAttributes = {
    fontSize: style.fontSize ?? 16,
    weight: nsFontWeight(style.fontWeight),
  };
  if (style.letterSpacing !== undefined) attributes.letterSpacing = style.letterSpacing;
  return attributes;
}

/**
 * Attributes for `interactionRect(for:origin:)` / `fittedTextBox(for:)`:
 * `interactionFont(for:)` (fontSize defaults to 16), the paragraph line height
 * and the kern.
 */
export function interactionAttributes(style: NodeStyle): TextAttributes {
  const attributes: TextAttributes = {
    fontSize: style.fontSize ?? 16,
    weight: nsFontWeight(style.fontWeight),
  };
  const family = style.fontFamily?.trim();
  if (family) attributes.fontFamily = family;
  if (style.letterSpacing !== undefined) attributes.letterSpacing = style.letterSpacing;
  if (style.lineHeight !== undefined && style.lineHeight > 0) attributes.lineHeight = style.lineHeight;
  return attributes;
}

function characterCount(text: string): number {
  let count = 0;
  for (const _character of text) count += 1;
  return count;
}

/** Advance width of one line, kern included (AppKit adds it after every glyph). */
export function lineWidth(line: string, attributes: TextAttributes): number {
  const measurer = getTextMeasurer();
  const base = measurer.width(line, attributes.fontSize, attributes.weight);
  const kern = attributes.letterSpacing ?? 0;
  return base + kern * characterCount(line);
}

/** One rendered line's height — the paragraph line height, else the font's. */
export function lineHeightFor(attributes: TextAttributes): number {
  if (attributes.lineHeight !== undefined && attributes.lineHeight > 0) return attributes.lineHeight;
  return getTextMeasurer().fontBoundingHeight(attributes.fontSize, attributes.weight);
}

/** Greedy word wrap (`.byWordWrapping`), hard line breaks preserved. */
export function wrappedLines(text: string, attributes: TextAttributes, availableWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r\n|\r|\n/)) {
    if (paragraph.length === 0) {
      lines.push('');
      continue;
    }
    if (!(availableWidth > 0)) {
      lines.push(paragraph);
      continue;
    }
    let current = '';
    for (const word of paragraph.split(' ')) {
      const candidate = current.length === 0 ? word : `${current} ${word}`;
      if (lineWidth(candidate, attributes) <= availableWidth || current.length === 0) {
        current = candidate;
      } else {
        lines.push(current);
        current = word;
      }
    }
    lines.push(current);
  }
  return lines.length === 0 ? [''] : lines;
}

/** `NSAttributedString.size()` — unwrapped, hard line breaks honoured. */
export function unboundedTextSize(text: string, attributes: TextAttributes): Size {
  const lines = text.split(/\r\n|\r|\n/);
  const width = lines.reduce((widest, line) => Math.max(widest, lineWidth(line, attributes)), 0);
  return { width, height: lines.length * lineHeightFor(attributes) };
}

/** `boundingRect(with:options:[.usesLineFragmentOrigin,.usesFontLeading])`. */
export function boundedTextSize(text: string, attributes: TextAttributes, availableWidth: number): Size {
  const lines = wrappedLines(text, attributes, availableWidth);
  const width = lines.reduce((widest, line) => Math.max(widest, lineWidth(line, attributes)), 0);
  return { width: Math.min(width, availableWidth), height: lines.length * lineHeightFor(attributes) };
}

/** `measuredTextSize(_:style:constrainedToWidth:)` */
export function measuredTextSize(text: string, style: NodeStyle, constrainedToWidth?: number): Size {
  const attributes = measurementAttributes(style);
  if (constrainedToWidth === undefined) return unboundedTextSize(text, attributes);
  return boundedTextSize(text, attributes, constrainedToWidth);
}

/** `CGRect.integral` on a measured rect: the size grows to whole points. */
export function integralSize(size: Size): Size {
  return { width: Math.ceil(size.width), height: Math.ceil(size.height) };
}
