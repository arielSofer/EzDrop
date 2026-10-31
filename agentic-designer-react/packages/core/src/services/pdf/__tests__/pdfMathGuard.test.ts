import { describe, expect, it } from 'vitest';
import { PDFMathGuard, maskedTextHasFormulas } from '../PDFMathGuard';

// The Swift suite: 10 samples, 4 of which are negative cases that must stay
// untouched (Services/PDFMathGuard.swift header + pdf-formula-translation notes).
const FORMULA_SAMPLES: string[] = [
  'The kinetic energy is E = mc² whenever the mass is constant.',
  'Consider $\\frac{a}{b}$ and the identity \\alpha + \\beta.',
  'Water is H2O and the exhaust is CO2 in every sample.',
  'As shown in (Eq. 3) and reported by [12], the value holds.',
  'The acceleration is 9.81 m/s² near the surface.',
  'We write \\[ x + y = z \\] for the displayed form.',
  'The relation F = ma follows directly from the axioms.',
  'The de Broglie relation λ = h/p connects the two pictures.',
  'A concentration of 25 °C was maintained throughout.',
  'The scale factor 10^-9 appears in the correction term.',
];

const PROSE_SAMPLES: string[] = [
  'The USA published the PDF report last week.',
  'Vectors and matrices are the objects of linear algebra.',
  'This chapter introduces probability and its interpretation.',
  'We recommend reading the introduction and/or the appendix first.',
];

describe('PDFMathGuard', () => {
  it('round-trips all ten formula samples through mask → restore', () => {
    for (const sample of FORMULA_SAMPLES) {
      const masked = PDFMathGuard.mask(sample);
      expect(maskedTextHasFormulas(masked), sample).toBe(true);
      const result = PDFMathGuard.restore(masked.masked, masked);
      expect(result.kind, sample).toBe('restored');
      if (result.kind === 'restored') expect(result.text).toBe(sample);
    }
  });

  it('leaves ordinary prose untouched (no molecules in "PDF"/"USA", no ratio in "and/or")', () => {
    for (const sample of PROSE_SAMPLES) {
      const masked = PDFMathGuard.mask(sample);
      expect(masked.masked, sample).toBe(sample);
      expect(maskedTextHasFormulas(masked), sample).toBe(false);
      expect(masked.isMostlyFormula).toBe(false);
    }
  });

  it('keeps the equation and only the equation ("is" ends the run)', () => {
    const masked = PDFMathGuard.mask('The kinetic energy is E = mc² whenever the mass is constant.');
    const fragments = Object.values(masked.fragments);
    expect(fragments.some((fragment) => fragment.includes('E = mc'))).toBe(true);
    expect(fragments.some((fragment) => fragment.includes('energy'))).toBe(false);
    expect(masked.masked).toContain('The kinetic energy is ');
    expect(masked.masked).toContain(' whenever the mass is constant.');
  });

  it('admits a short operand directly after an operator (F = ma, λ = h/p)', () => {
    for (const [source, operand] of [
      ['The relation F = ma follows.', 'ma'],
      ['The relation λ = h/p follows.', 'h/p'],
    ] as const) {
      const masked = PDFMathGuard.mask(source);
      expect(Object.values(masked.fragments).some((fragment) => fragment.includes(operand))).toBe(true);
    }
  });

  it('flags a displayed equation as mostly formula', () => {
    const masked = PDFMathGuard.mask('x + y = z');
    expect(masked.isMostlyFormula).toBe(true);
  });

  it('accepts a respaced sentinel but rejects a destroyed one', () => {
    const source = 'The energy E = mc² grows.';
    const masked = PDFMathGuard.mask(source);
    const token = Object.keys(masked.fragments)[0];
    const digits = token.replace(/\D/g, '');
    const respaced = masked.masked.replace(token, `[[ ${digits} ]]`);
    const loose = PDFMathGuard.restore(respaced, masked);
    expect(loose.kind).toBe('restored');

    const eaten = PDFMathGuard.restore(masked.masked.replace(token, 'שלום'), masked);
    expect(eaten.kind).toBe('corrupted');
    if (eaten.kind === 'corrupted') expect(eaten.missing).toContain(token);
  });

  it('detects notation the translation invented', () => {
    // `mathScalars` is the Swift set: ⇒ is in it, ⇓ deliberately is not.
    expect(PDFMathGuard.introducesForeignMath('In the beginning', '⇒ח')).toBe(true);
    expect(PDFMathGuard.introducesForeignMath('In the beginning', '⇓ח')).toBe(false);
    expect(PDFMathGuard.introducesForeignMath('E = mc', 'E = mc')).toBe(false);
  });
});
