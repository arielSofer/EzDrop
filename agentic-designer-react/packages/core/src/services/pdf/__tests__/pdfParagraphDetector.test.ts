import { describe, expect, it } from 'vitest';
import { PDFParagraphDetector, type PDFTextLine } from '../PDFParagraphDetector';
import { rect } from '../../../models/Geometry';

// A synthetic page in PDF coordinates (origin bottom-left), 10pt lines with a
// 12pt leading, so each stop rule can be reproduced in isolation.
const LEFT = 72;
const WIDTH = 400;
const HEIGHT = 10;

function line(text: string, y: number, x = LEFT, width = WIDTH, height = HEIGHT): PDFTextLine {
  return { string: text, bounds: rect(x, y, width, height) };
}

/** Two lines of one paragraph: gap 2pt (< height * 0.9), full overlap, same size. */
const body: PDFTextLine[] = [line('Vectors are objects that can be', 700), line('added together and scaled.', 688)];

describe('PDFParagraphDetector.paragraphs', () => {
  it('keeps continuous lines in one block', () => {
    const blocks = PDFParagraphDetector.paragraphs(body);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe('Vectors are objects that can be added together and scaled.');
    expect(blocks[0].lineHeight).toBe(10);
    expect(blocks[0].bounds).toEqual(rect(72, 688, 400, 22));
  });

  it('splits on a vertical gap >= min(height) * 0.9', () => {
    const blocks = PDFParagraphDetector.paragraphs([line('first', 700), line('second', 681)]);
    expect(blocks).toHaveLength(2);
  });

  it('splits when the horizontal overlap is not greater than the reference height', () => {
    const blocks = PDFParagraphDetector.paragraphs([line('left column', 700, 72, 100), line('right column', 688, 180, 100)]);
    expect(blocks).toHaveLength(2);
  });

  it('splits on a size ratio outside 0.7…1.4', () => {
    const big = line('Chapter heading', 700, 72, 400, 16);
    const small = line('body text follows', 686, 72, 400, 10);
    expect(PDFParagraphDetector.paragraphs([big, small])).toHaveLength(2);

    const ratioInside = PDFParagraphDetector.paragraphs([line('a', 700, 72, 400, 11), line('b', 689, 72, 400, 10)]);
    expect(ratioInside).toHaveLength(1);
  });

  it('splits at an indented line (+6) — a new paragraph first line', () => {
    const blocks = PDFParagraphDetector.paragraphs([line('previous paragraph end.', 700), line('New paragraph starts here.', 688, LEFT + 7)]);
    expect(blocks).toHaveLength(2);
  });

  it('splits below a centred heading (+24)', () => {
    const blocks = PDFParagraphDetector.paragraphs([line('2.1 Systems of Linear Equations', 700, LEFT + 30, 300), line('body text after the heading', 688)]);
    expect(blocks).toHaveLength(2);
  });

  it('heals hyphenation when the next line starts lowercase', () => {
    const blocks = PDFParagraphDetector.paragraphs([line('the eigen-', 700), line('value problem.', 688)]);
    expect(blocks[0].text).toBe('the eigenvalue problem.');
  });

  it('keeps a hyphen when the next line starts uppercase', () => {
    const blocks = PDFParagraphDetector.paragraphs([line('the value-', 700), line('Problem.', 688)]);
    expect(blocks[0].text).toBe('the value- Problem.');
  });
});

describe('PDFParagraphDetector.paragraph', () => {
  const page: PDFTextLine[] = [
    line('2.1 Systems of Linear Equations', 730, LEFT + 30, 300),
    line('Vectors are objects that can be', 700),
    line('added together and scaled.', 688),
    line('A new paragraph begins here', 676, LEFT + 8),
  ];

  it('walks up and down from the clicked line', () => {
    const found = PDFParagraphDetector.paragraph({ x: 100, y: 692 }, page);
    expect(found?.text).toBe('Vectors are objects that can be added together and scaled.');
  });

  it('returns null when nothing is under the point', () => {
    expect(PDFParagraphDetector.paragraph({ x: 100, y: 100 }, page)).toBeNull();
  });

  it('hits a line through the 2pt inset', () => {
    const found = PDFParagraphDetector.paragraph({ x: 100, y: 687 }, page);
    expect(found).not.toBeNull();
  });

  it('stops at the centred heading above', () => {
    const found = PDFParagraphDetector.paragraph({ x: 100, y: 705 }, page);
    expect(found?.text.startsWith('Vectors')).toBe(true);
  });
});

describe('math run masking', () => {
  const markers = { contains: (scalar: number) => '=+-−·/|'.includes(String.fromCodePoint(scalar)) };

  it('masks maximal runs and restores them verbatim', () => {
    // A token only joins a run when it CARRIES a marker (or is one of the bare
    // operator strings) — plain operands stay prose, exactly as in Swift.
    const { masked, runs } = PDFParagraphDetector.maskMathRuns('Note that x = y holds', markers);
    expect(runs).toEqual(['=']);
    expect(masked).toBe('Note that x ⟦0⟧ y holds');
    expect(PDFParagraphDetector.unmaskMathRuns(masked, runs)).toBe('Note that x = y holds');
  });

  it('joins adjacent marker tokens into ONE run', () => {
    const { masked, runs } = PDFParagraphDetector.maskMathRuns('Note that x = − y holds', markers);
    expect(runs).toEqual(['= −']);
    expect(masked).toBe('Note that x ⟦0⟧ y holds');
  });

  it('rejects a translation that lost a placeholder', () => {
    expect(PDFParagraphDetector.unmaskMathRuns('nothing here', ['x = y'])).toBeNull();
  });

  it('rejects a translation that invented one', () => {
    expect(PDFParagraphDetector.unmaskMathRuns('⟦0⟧ and ⟦7⟧', ['x = y'])).toBeNull();
  });
});

describe('separateHebrewLatinScripts', () => {
  it('inserts a space where the scripts collide', () => {
    expect(PDFParagraphDetector.separateHebrewLatinScripts('שלוםworld')).toBe('שלום world');
    expect(PDFParagraphDetector.separateHebrewLatinScripts('שלום world')).toBe('שלום world');
  });
});
