import { describe, expect, it } from 'vitest';
import { PDFTextFitter, TextFitStrategy } from '../PDFTextFitter';
import { rect } from '../../../models/Geometry';

// A synthetic measurer: height scales linearly with the font size, so every
// strategy boundary can be hit exactly.
function heightAtSize(naturalAt10: number) {
  return (_text: string, _width: number, fontSize: number): number => (naturalAt10 * fontSize) / 10;
}

const pageBounds = rect(0, 0, 612, 792);

describe('PDFTextFitter.plan', () => {
  it('reports `unchanged` when the text already fits (1.5pt tolerance)', () => {
    const plan = PDFTextFitter.plan({
      text: 'shalom',
      bounds: rect(72, 600, 400, 40),
      sourceFontSize: 10,
      pageBounds,
      measureHeight: heightAtSize(38),
    });
    expect(plan.strategy).toBe(TextFitStrategy.unchanged);
    expect(plan.fontSize).toBe(10);
    expect(plan.scale).toBe(1);
    expect(plan.bounds).toEqual(rect(72, 600, 400, 40));
  });

  it('grows downward into measured slack without touching the type size', () => {
    const plan = PDFTextFitter.plan({
      text: 'shalom',
      bounds: rect(72, 600, 400, 40),
      sourceFontSize: 10,
      verticalSlack: 30,
      pageBounds,
      measureHeight: heightAtSize(60),
    });
    expect(plan.strategy).toBe(TextFitStrategy.grewIntoSlack);
    expect(plan.fontSize).toBe(10);
    // PDF origin is bottom-left: growing downward lowers minY, maxY is pinned.
    expect(plan.bounds.height).toBe(60);
    expect(plan.bounds.y).toBe(640 - 60);
    expect(plan.bounds.y + plan.bounds.height).toBe(640);
  });

  it('binary-searches the largest fitting size and calls it `shrunk` above 0.86', () => {
    const plan = PDFTextFitter.plan({
      text: 'shalom',
      bounds: rect(72, 600, 400, 40),
      sourceFontSize: 10,
      pageBounds,
      measureHeight: heightAtSize(44),
    });
    expect(plan.strategy).toBe(TextFitStrategy.shrunk);
    expect(plan.scale).toBeGreaterThanOrEqual(0.86);
    expect(plan.fontSize).toBeGreaterThan(10 * 0.86);
    expect(plan.fontSize).toBeLessThan(10);
  });

  it('flags a deep reduction as `shrunkHard`', () => {
    const plan = PDFTextFitter.plan({
      text: 'shalom',
      bounds: rect(72, 600, 400, 40),
      sourceFontSize: 10,
      pageBounds,
      measureHeight: heightAtSize(50),
    });
    expect(plan.strategy).toBe(TextFitStrategy.shrunkHard);
    expect(plan.scale).toBeLessThan(0.86);
    expect(plan.scale).toBeGreaterThanOrEqual(0.62);
  });

  it('reports `overflowed` when even the 0.62 hard floor does not fit', () => {
    const plan = PDFTextFitter.plan({
      text: 'shalom',
      bounds: rect(72, 600, 400, 40),
      sourceFontSize: 10,
      pageBounds,
      measureHeight: heightAtSize(200),
    });
    expect(plan.strategy).toBe(TextFitStrategy.overflowed);
    expect(plan.fontSize).toBeCloseTo(6.2, 5);
    expect(plan.scale).toBeCloseTo(0.62, 5);
  });

  it('uses the platform TextMeasurer when no measureHeight hook is given', () => {
    const plan = PDFTextFitter.plan({
      text: 'a short line',
      bounds: rect(72, 600, 400, 200),
      sourceFontSize: 10,
      pageBounds,
    });
    expect(plan.strategy).toBe(TextFitStrategy.unchanged);
  });
});

describe('PDFTextFitter.verticalSlack', () => {
  const block = rect(72, 600, 400, 40);

  it('counts only horizontally overlapping neighbours, minus a 2pt hairline', () => {
    const below = rect(72, 540, 400, 20); // maxY 560, 40pt below the block
    expect(PDFTextFitter.verticalSlack(block, [block, below], pageBounds)).toBe(38);
  });

  it('ignores a side caption that does not overlap horizontally', () => {
    const caption = rect(500, 560, 80, 20);
    expect(PDFTextFitter.verticalSlack(block, [block, caption], pageBounds)).toBe(598);
  });

  it('ignores blocks above the one being fitted', () => {
    const above = rect(72, 660, 400, 20);
    expect(PDFTextFitter.verticalSlack(block, [block, above], pageBounds)).toBe(598);
  });
});
