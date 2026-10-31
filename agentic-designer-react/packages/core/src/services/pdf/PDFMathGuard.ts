// Ported 1:1 from AgenticDesigner/Services/PDFMathGuard.swift
//
//  Formula-safe translation for scientific documents.
//
//  A translator handed "the energy E = mc² grows" will happily "translate" the
//  formula too — reordering it under RTL rules, swapping digits, or turning
//  superscripts into arrow junk. The established fix (LaTeXMT, BabelDOC,
//  PDFMathTranslate all converge on it) is MASKING: every non-translatable
//  span is replaced by a sentinel before the text is sent, and restored
//  verbatim afterwards. The model only ever sees prose.
//
//  The second half matters as much as the first: if a sentinel comes back
//  corrupted or missing, the translation is REJECTED rather than shipped with
//  a mangled equation. A wrong formula in a physics book is worse than an
//  untranslated sentence.
//
// NOTE ON INDICES: NSRegularExpression works in UTF-16 offsets and so do JS
// regexes without the `u` flag — the ranges below are therefore identical to
// the Swift ones, and every pattern is copied verbatim.

export interface MaskedText {
  masked: string;
  /** Sentinel → original fragment, restored after translation. */
  fragments: Record<string, string>;
  /**
   * True when the source was essentially all formula — such a block should
   * not be sent to a translator at all.
   */
  isMostlyFormula: boolean;
}

/** `MaskedText.hasFormulas` */
export function maskedTextHasFormulas(masked: MaskedText): boolean {
  return Object.keys(masked.fragments).length > 0;
}

/** `PDFMathGuard.RestoreResult` */
export type RestoreResult =
  | { kind: 'restored'; text: string }
  /**
   * The model ate or altered a sentinel — the caller must keep the
   * original text rather than ship a broken formula.
   */
  | { kind: 'corrupted'; missing: string[] };

interface NSRange {
  location: number;
  length: number;
}

/**
 * Sentinels use ASCII digits inside guillemet-free brackets. Tested shape:
 * models leave «[[3]]»-style tokens alone far more reliably than unicode
 * private-use characters, which some tokenizers drop entirely.
 */
function sentinel(index: number): string {
  return `[[${index}]]`;
}

/**
 * Ordered most-specific first: a LaTeX block must win over the loose
 * symbol run that would otherwise chop it in half.
 */
const patterns: string[] = [
  // Display and inline LaTeX
  String.raw`\$\$[^$]{1,400}\$\$`,
  String.raw`\\\[[^\]]{1,400}\\\]`,
  String.raw`\\\([^)]{1,400}\\\)`,
  String.raw`\$[^$\n]{1,200}\$`,
  // LaTeX commands with or without arguments: \alpha, \frac{a}{b}
  String.raw`\\[A-Za-z]+(\{[^}]{0,120}\})*`,
  // Chemical formulae: H2O, CO2, Na2SO4, C6H12O6. The lookahead demands
  // at least one digit so ordinary capitalised runs ("PDF", "USA") are
  // not mistaken for molecules.
  String.raw`\b(?=[A-Za-z0-9]*\d)[A-Z][a-z]?\d{0,3}(?:[A-Z][a-z]?\d{0,3})+\b`,
  // Equation / figure / citation references kept verbatim
  String.raw`\((?:Eq|Fig|Ref|Table|Thm|Lemma)\.?\s*\d+[a-z]?\)`,
  String.raw`\[\d{1,3}(?:[,–-]\s*\d{1,3})*\]`,
  // Numbers with units or exponents: 9.81 m/s², 10^-9, 25 °C.
  // NOTE: no trailing \b — a superscript is not a word character, so the
  // boundary forced the engine to backtrack and drop the ² off "m/s²".
  String.raw`\b\d+(?:[.,]\d+)?\s*(?:[×x]\s*10[\^⁻⁰-⁹\-]?\d*)?\s*(?:°[CFK]|[a-zA-Zµμ]{1,4}(?:/[a-zA-Z]{1,3})?[²³]?)`,
  // Standalone superscript/subscript runs
  String.raw`[⁰-⁹⁻⁺ⁿ]{1,6}`,
  String.raw`[₀-₉₋₊]{1,6}`,
];

const compiled: RegExp[] = patterns.flatMap((pattern) => {
  try {
    return [new RegExp(pattern, 'g')];
  } catch {
    return [];
  }
});

function scalarSet(...sources: string[]): Set<number> {
  const set = new Set<number>();
  for (const source of sources) {
    for (const character of source) {
      const value = character.codePointAt(0);
      if (value !== undefined) set.add(value);
    }
  }
  return set;
}

/** Characters that mean "this is notation, not prose". */
const mathScalars: Set<number> = scalarSet(
  '=≈≠≤≥<>±×÷√∫∑∏∂∇∈∉⊂⊆∪∩→←↔⇒⇔∞°′″^_',
  '⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺ⁿ₀₁₂₃₄₅₆₇₈₉₋₊',
  'ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩαβγδεζηθικλμνξοπρστυφχψω',
);

// MARK: - Equation scanning

// Includes the UNICODE minus/multiply/dot variants a typesetter emits —
// ASCII "-" is not what a real PDF contains.
const operators: Set<string> = new Set('=≈≠≤≥<>±×÷√∫∑∏∂∇∈∉⊂⊆∪∩→←↔⇒⇔−–⋅∙∘⊕⊗≡∝∼');
const mathDecorations: Set<string> = new Set('²³⁰¹⁴⁵⁶⁷⁸⁹⁻⁺ⁿ₀₁₂₃₄₅₆₇₈₉₋₊′″^_');

const LETTER = /\p{L}/u;
const NUMBER = /\p{N}/u;

function letters(token: string): string[] {
  const found: string[] = [];
  for (const character of token) if (LETTER.test(character)) found.push(character);
  return found;
}

/**
 * A whitespace-delimited token that belongs to notation rather than prose.
 * The decisive rule: a run of 2+ plain letters with no digit, decoration,
 * Greek letter or operator is a WORD ("is", "whenever", "energy") and ends
 * the equation. Single letters are variables and are allowed.
 */
function isMathToken(token: string): boolean {
  if (token.length === 0) return false;
  for (const character of token) {
    if (operators.has(character) || mathDecorations.has(character)) return true;
  }
  for (const character of token) if (NUMBER.test(character)) return true;
  const tokenLetters = letters(token);
  for (const letter of tokenLetters) {
    let allGreek = true;
    for (const scalar of letter) {
      const value = scalar.codePointAt(0) ?? 0;
      if (!(value >= 0x0370 && value <= 0x03ff)) allGreek = false;
    }
    if (allGreek) return true; // Greek
  }
  // A short parenthesised term is function application — F(b), f(x) —
  // not a word. Without this the run broke mid-equation at "F(b)".
  for (const character of token) {
    if ('()[]{}'.includes(character) && tokenLetters.length <= 4) return true;
  }
  // A short term containing a slash is a ratio (h/p, m/s); a long one is
  // a word pair ("and/or") and must stay translatable.
  if (token.includes('/') && tokenLetters.length <= 3) return true;
  // Single variable, or pure punctuation like "(" / "," / "/".
  return tokenLetters.length <= 1;
}

interface ScannedToken {
  text: string;
  start: number;
  end: number;
}

function whitespaceTokens(text: string): ScannedToken[] {
  const tokens: ScannedToken[] = [];
  const regex = /\S+/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    tokens.push({ text: match[0], start: match.index, end: match.index + match[0].length });
  }
  return tokens;
}

/** Maximal runs of adjacent math tokens that contain at least one operator. */
function equationRanges(text: string): NSRange[] {
  const ranges: NSRange[] = [];
  let runStart: number | null = null;
  let runEnd: number | null = null;
  let runHasOperator = false;
  let previousWasOperator = false;

  const closeRun = (): void => {
    if (runHasOperator && runStart !== null && runEnd !== null) {
      const length = runEnd - runStart;
      // A single character either side of an operator is not an equation.
      if (length >= 3) ranges.push({ location: runStart, length });
    }
    runStart = null;
    runEnd = null;
    runHasOperator = false;
  };

  for (const token of whitespaceTokens(text)) {
    // "F = ma" and "λ = h/p": the operand is two plain letters, exactly
    // like the word "is". What separates them is POSITION — an operand
    // sits directly against its operator, whereas prose does not. So a
    // short token immediately after an operator is admitted as part of
    // the equation; anything longer, or further away, ends it.
    const isOperandAfterOperator = previousWasOperator && letters(token.text).length <= 3;

    if (isMathToken(token.text) || isOperandAfterOperator) {
      if (runStart === null) runStart = token.start;
      runEnd = token.end;
      let containsOperator = false;
      for (const character of token.text) if (operators.has(character)) containsOperator = true;
      if (containsOperator) runHasOperator = true;
      previousWasOperator = containsOperator;
    } else {
      closeRun();
      previousWasOperator = false;
    }
  }
  closeRun();
  return ranges;
}

function intersects(a: NSRange, b: NSRange): boolean {
  const start = Math.max(a.location, b.location);
  const end = Math.min(a.location + a.length, b.location + b.length);
  return end - start > 0;
}

// MARK: - Mask

function mask(text: string): MaskedText {
  const protectedRanges: NSRange[] = [];

  for (const regex of compiled) {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const range: NSRange = { location: match.index, length: match[0].length };
      if (range.length === 0) {
        regex.lastIndex += 1;
        continue;
      }
      // Skip anything already inside a claimed span — first pattern wins.
      if (protectedRanges.some((claimed) => intersects(claimed, range))) continue;
      protectedRanges.push(range);
    }
  }
  // Equations are found by SCANNING, not by one big regex. A pattern that
  // allows letters and spaces around an operator is greedy by nature and
  // swallowed the prose around it ("The kinetic energy is E = mc" came
  // back as one protected span, with the ² orphaned outside). Growing
  // outward from each operator and stopping at the first real word keeps
  // the equation and only the equation.
  for (const range of equationRanges(text)) {
    if (protectedRanges.some((claimed) => intersects(claimed, range))) continue;
    protectedRanges.push(range);
  }
  if (protectedRanges.length === 0) {
    return { masked: text, fragments: {}, isMostlyFormula: false };
  }

  // Replace back-to-front so earlier ranges stay valid.
  protectedRanges.sort((lhs, rhs) => rhs.location - lhs.location);
  let working = text;
  const fragments: Record<string, string> = {};
  let protectedLength = 0;

  protectedRanges.forEach((range, offset) => {
    const token = sentinel(protectedRanges.length - offset);
    fragments[token] = text.slice(range.location, range.location + range.length);
    protectedLength += range.length;
    working = working.slice(0, range.location) + token + working.slice(range.location + range.length);
  });

  // A "paragraph" that is 60%+ notation is a displayed equation. Sending
  // it to a translator can only damage it.
  const ratio = text.length > 0 ? protectedLength / text.length : 0;
  return { masked: working, fragments, isMostlyFormula: ratio > 0.6 };
}

// MARK: - Restore

function replacingOccurrences(text: string, of: string, withText: string): string {
  return text.split(of).join(withText);
}

/** Finds a sentinel the model reformatted but did not destroy. */
function loosenedMatch(token: string, text: string): string | null {
  let digits = '';
  for (const character of token) if (NUMBER.test(character)) digits += character;
  if (digits.length === 0) return null;
  const pattern = String.raw`\[\s*\[\s*` + digits + String.raw`\s*\]\s*\]`;
  let regex: RegExp;
  try {
    regex = new RegExp(pattern);
  } catch {
    return null;
  }
  const match = regex.exec(text);
  return match ? match[0] : null;
}

function restore(translated: string, masked: MaskedText): RestoreResult {
  if (!maskedTextHasFormulas(masked)) return { kind: 'restored', text: translated };

  let output = translated;
  const missing: string[] = [];

  const entries = Object.entries(masked.fragments).sort((lhs, rhs) => rhs[0].length - lhs[0].length);
  for (const [token, fragment] of entries) {
    if (output.includes(token)) {
      output = replacingOccurrences(output, token, fragment);
    } else {
      // Models sometimes respace a sentinel ("[[ 3 ]]", "[ [3] ]").
      const loosened = loosenedMatch(token, output);
      if (loosened !== null) {
        output = replacingOccurrences(output, loosened, fragment);
      } else {
        missing.push(token);
      }
    }
  }
  return missing.length === 0 ? { kind: 'restored', text: output } : { kind: 'corrupted', missing };
}

/**
 * Guard for the reverse failure: a translation that invents notation the
 * source never had (the "In" → "⇓ח" class of mangling).
 */
function introducesForeignMath(source: string, translated: string): boolean {
  const sourceMarkers = new Set<number>();
  for (const character of source) {
    const value = character.codePointAt(0);
    if (value !== undefined && mathScalars.has(value)) sourceMarkers.add(value);
  }
  for (const character of translated) {
    const value = character.codePointAt(0);
    if (value !== undefined && mathScalars.has(value) && !sourceMarkers.has(value)) return true;
  }
  return false;
}

/** `enum PDFMathGuard` — a Swift caseless enum is a namespace. */
export const PDFMathGuard = {
  mathScalars,
  mask,
  restore,
  introducesForeignMath,
} as const;
