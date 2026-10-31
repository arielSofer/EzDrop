// Platform adapter: system-font text measurement (AppKit's
// `NSString.size(withAttributes:)`, `NSString.boundingRect(with:options:attributes:)`
// and `NSFont.boundingRectForFont`), used by ComponentFactory.fittingFontSize.
//
// The web app injects a canvas-based measurer via `setTextMeasurer`; the default
// is a deterministic approximation of SF Pro metrics so pure logic and tests run
// anywhere and never silently no-op.

export interface TextMeasurer {
  /**
   * Single-line advance width of `text` set in the system font at `fontSize`
   * with the given weight ("regular" | "medium" | "semibold" | "bold" …).
   * AppKit: `(text as NSString).size(withAttributes: [.font: font]).width`.
   */
  width(text: string, fontSize: number, weight: string): number;
  /**
   * Height of `text` word-wrapped into a column of `width` points.
   * AppKit: `boundingRect(with: CGSize(width, .greatestFiniteMagnitude),
   * options: [.usesLineFragmentOrigin, .usesFontLeading]).height`.
   */
  wrappedHeight(text: string, width: number, fontSize: number, weight: string): number;
  /** AppKit: `NSFont.systemFont(ofSize:weight:).boundingRectForFont.height`. */
  fontBoundingHeight(fontSize: number, weight: string): number;
}

/** Average SF Pro glyph advance as a fraction of the point size. */
export function approximateCharWidthFactor(weight: string): number {
  switch (weight.toLowerCase()) {
    case 'semibold':
    case 'bold':
    case 'heavy':
    case 'black':
      return 0.56;
    default:
      return 0.52;
  }
}

/** SF Pro `boundingRectForFont.height` ≈ 1.193 × point size (ascender + descender + leading). */
export const APPROXIMATE_LINE_HEIGHT_FACTOR = 1.193;

/**
 * Deterministic fallback: every character advances `fontSize × factor`
 * (0.52 regular / 0.56 semibold+bold), greedy word wrap for multi-line
 * measurement.
 */
export class ApproximateTextMeasurer implements TextMeasurer {
  width(text: string, fontSize: number, weight: string): number {
    const factor = approximateCharWidthFactor(weight);
    let count = 0;
    for (const _ of text) count += 1;
    return count * fontSize * factor;
  }

  fontBoundingHeight(fontSize: number, _weight: string): number {
    return fontSize * APPROXIMATE_LINE_HEIGHT_FACTOR;
  }

  wrappedHeight(text: string, width: number, fontSize: number, weight: string): number {
    if (text.length === 0) return 0;
    const lineHeight = this.fontBoundingHeight(fontSize, weight);
    if (!(width > 0)) return lineHeight;
    let lines = 0;
    for (const paragraph of text.split(/\r\n|\r|\n/)) {
      lines += this.wrappedLineCount(paragraph, width, fontSize, weight);
    }
    return lines * lineHeight;
  }

  private wrappedLineCount(paragraph: string, width: number, fontSize: number, weight: string): number {
    const words = paragraph.split(' ');
    const spaceWidth = this.width(' ', fontSize, weight);
    let lines = 1;
    let lineWidth = 0;
    for (const word of words) {
      const wordWidth = this.width(word, fontSize, weight);
      if (wordWidth > width) {
        // A single word wider than the column is broken by character, as TextKit does.
        if (lineWidth > 0) lines += 1;
        const wordLines = Math.max(1, Math.ceil(wordWidth / width));
        lines += wordLines - 1;
        lineWidth = wordWidth - (wordLines - 1) * width;
        continue;
      }
      const candidate = lineWidth === 0 ? wordWidth : lineWidth + spaceWidth + wordWidth;
      if (candidate <= width) {
        lineWidth = candidate;
      } else {
        lines += 1;
        lineWidth = wordWidth;
      }
    }
    return lines;
  }
}

let current: TextMeasurer = new ApproximateTextMeasurer();

/** Inject the real (canvas / DOM) measurer. Returns the previous one. */
export function setTextMeasurer(measurer: TextMeasurer): TextMeasurer {
  const previous = current;
  current = measurer;
  return previous;
}

export function getTextMeasurer(): TextMeasurer {
  return current;
}

/** Restore the deterministic approximation (tests). */
export function resetTextMeasurer(): TextMeasurer {
  current = new ApproximateTextMeasurer();
  return current;
}
