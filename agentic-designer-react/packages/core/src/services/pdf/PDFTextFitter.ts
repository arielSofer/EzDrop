// Ported 1:1 from AgenticDesigner/Services/PDFTextFitter.swift
//
//  Fitting translated text back into a source layout.
//
//  Translation changes length — Hebrew runs ~20-30% shorter than English,
//  German longer — so the replacement rarely occupies the same space as the
//  original. The previous approach had exactly one lever: shrink the font
//  until it fits. That always "works" and often looks wrong, because an 11pt
//  paragraph rendered at 7pt next to an untouched 11pt paragraph reads as
//  damage even though nothing overflowed.
//
//  This tries the cheap, invisible adjustments first and only degrades the
//  type size as a last resort — and reports what it had to do, so the result
//  can be measured instead of assumed.
//
// The Swift signature took `fontProvider: (CGFloat) -> NSFont` and measured
// with `NSString.boundingRect`. In the port the measurement goes through the
// `TextMeasurer` platform adapter (canvas `measureText` in the browser); a
// caller that needs a specific face — ArialHebrew for RTL replacements — hands
// in `measureHeight`, which is the fontProvider hook by another name.

import { rectMaxY, rectMinY, rectMinX, rectMaxX, rectsEqual, type Rect } from '../../models/Geometry';
import { getTextMeasurer, type TextMeasurer } from '../../platform/TextMeasurer';

/**
 * `TextFitPlan.Strategy`
 *
 * NOTE: there is deliberately no letter-spacing lever. A `PDFAnnotation`
 * freeText carries only `.font`, so kerning cannot reach the page, and
 * macOS returns no real condensed variant for these faces (measured:
 * identical width). A strategy the renderer cannot honour would make the
 * fitter promise fits it does not deliver — worse than not having it.
 */
export const TextFitStrategy = {
  /** fit as-is */
  unchanged: 'unchanged',
  /** used empty space below the block */
  grewIntoSlack: 'grewIntoSlack',
  /** reduced font size */
  shrunk: 'shrunk',
  /** reduced a lot — visible, flagged */
  shrunkHard: 'shrunkHard',
  /** could not fit even at the floor */
  overflowed: 'overflowed',
} as const;
export type TextFitStrategy = (typeof TextFitStrategy)[keyof typeof TextFitStrategy];
export const AllTextFitStrategy = [
  'unchanged',
  'grewIntoSlack',
  'shrunk',
  'shrunkHard',
  'overflowed',
] as const satisfies readonly TextFitStrategy[];

export interface TextFitPlan {
  bounds: Rect;
  fontSize: number;
  /** What it took, for reporting. */
  strategy: TextFitStrategy;
  /** Ratio against the source size. 1.0 = untouched typography. */
  scale: number;
}

export interface TextFitPlanOptions {
  text: string;
  /** Swift `in bounds:` */
  bounds: Rect;
  sourceFontSize: number;
  /**
   * Free space directly below the block before the next one starts.
   * Growing into it is invisible; growing past it would collide, so it is a
   * hard cap rather than a hint.
   */
  verticalSlack?: number;
  pageBounds: Rect;
  /** `NSFont` weight passed to the measurer. Swift used the annotation font. */
  fontWeight?: string;
  /** The `fontProvider:` hook — a family-aware wrapped-height measurement. */
  measureHeight?: (text: string, width: number, fontSize: number) => number;
  /** Defaults to the injected platform measurer. */
  measurer?: TextMeasurer;
}

/** Never go below this fraction of the source size without flagging it. */
const comfortableFloor = 0.86;
const hardFloor = 0.62;

/** Computes how to place `text` in `bounds`. */
function plan(options: TextFitPlanOptions): TextFitPlan {
  const {
    text,
    bounds,
    sourceFontSize,
    pageBounds,
    verticalSlack = 0,
    fontWeight = 'regular',
    measureHeight,
    measurer = getTextMeasurer(),
  } = options;

  const height = (size: number, width: number): number => {
    if (measureHeight) return Math.ceil(measureHeight(text, width, size));
    return Math.ceil(measurer.wrappedHeight(text, width, size, fontWeight));
  };

  const width = bounds.width;
  const tolerance = 1.5;

  // 1. Does it already fit? Most blocks do — translation often shortens.
  const naturalHeight = height(sourceFontSize, width);
  if (naturalHeight <= bounds.height + tolerance) {
    return { bounds, fontSize: sourceFontSize, strategy: TextFitStrategy.unchanged, scale: 1 };
  }

  // 2. Grow downward into genuinely empty space. Costs no legibility.
  if (verticalSlack > 1) {
    const grown = Math.min(naturalHeight, bounds.height + verticalSlack);
    if (naturalHeight <= grown + tolerance) {
      // PDF origin is bottom-left: growing downward lowers minY.
      const expanded: Rect = {
        x: bounds.x,
        y: Math.max(rectMinY(pageBounds), rectMaxY(bounds) - grown),
        width: bounds.width,
        height: grown,
      };
      return { bounds: expanded, fontSize: sourceFontSize, strategy: TextFitStrategy.grewIntoSlack, scale: 1 };
    }
  }

  // 3. Shrink — but search for the LARGEST size that fits rather than
  //    stepping down blindly past it.
  let low = sourceFontSize * hardFloor;
  let high = sourceFontSize;
  for (let iteration = 0; iteration < 12; iteration += 1) {
    const mid = (low + high) / 2;
    if (height(mid, width) <= bounds.height + tolerance) {
      low = mid;
    } else {
      high = mid;
    }
    if (high - low < 0.05) break;
  }
  const fitted = Math.max(sourceFontSize * hardFloor, low);
  const scale = fitted / sourceFontSize;
  const fits = height(fitted, width) <= bounds.height + tolerance;

  return {
    bounds,
    fontSize: fitted,
    strategy: !fits
      ? TextFitStrategy.overflowed
      : scale >= comfortableFloor
        ? TextFitStrategy.shrunk
        : TextFitStrategy.shrunkHard,
    scale,
  };
}

/**
 * Vertical gap between a block and whatever sits directly beneath it.
 * Only blocks that horizontally overlap can collide, so a caption beside
 * a figure doesn't steal the paragraph's slack.
 */
function verticalSlack(block: Rect, others: readonly Rect[], pageBounds: Rect): number {
  let nearestTop = rectMinY(pageBounds);
  for (const other of others) {
    if (rectsEqual(other, block)) continue;
    const overlapsHorizontally = rectMaxX(other) > rectMinX(block) + 1 && rectMinX(other) < rectMaxX(block) - 1;
    if (!overlapsHorizontally || !(rectMaxY(other) <= rectMinY(block) + 1)) continue;
    nearestTop = Math.max(nearestTop, rectMaxY(other));
  }
  // Leave a hairline so text never kisses the block below.
  return Math.max(0, rectMinY(block) - nearestTop - 2);
}

/** `enum PDFTextFitter` — a Swift caseless enum is a namespace. */
export const PDFTextFitter = {
  comfortableFloor,
  hardFloor,
  plan,
  verticalSlack,
} as const;
