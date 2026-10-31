// Swift standard-library semantics the exporter's string generation relies
// on. The emitted Swift must be byte-identical to what the macOS app writes,
// so Double interpolation, `split`, `trimmingCharacters` and friends are
// reproduced here rather than approximated with their JS namesakes.

/**
 * Swift's `"\(x)"` / `String(describing:)` for a `Double`/`CGFloat`.
 * `1.0` → "1.0", `0.5` → "0.5", `12` → "12.0", `1e16` → "1e+16", `1e-5` → "1e-05".
 */
export function swiftDoubleString(value: number): string {
  if (Number.isNaN(value)) return 'nan';
  if (value === Infinity) return 'inf';
  if (value === -Infinity) return '-inf';
  if (value === 0) return Object.is(value, -0) ? '-0.0' : '0.0';
  // toExponential() with no argument yields the shortest digit string that
  // round-trips — the same digits Swift's description algorithm produces.
  const match = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(value.toExponential());
  if (!match) return String(value);
  const sign = match[1];
  const digits = match[2] + (match[3] ?? '');
  const exponent = parseInt(match[4], 10);
  if (exponent >= -4 && exponent < 16) {
    if (exponent >= 0) {
      const intLen = exponent + 1;
      const intPart = digits.length >= intLen ? digits.slice(0, intLen) : digits + '0'.repeat(intLen - digits.length);
      const frac = digits.length > intLen ? digits.slice(intLen) : '0';
      return `${sign}${intPart}.${frac}`;
    }
    return `${sign}0.${'0'.repeat(-exponent - 1)}${digits}`;
  }
  const mantissa = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits;
  const expSign = exponent < 0 ? '-' : '+';
  const expDigits = String(Math.abs(exponent)).padStart(2, '0');
  return `${sign}${mantissa}e${expSign}${expDigits}`;
}

/** Swift `Int(double)` — truncation toward zero, rendered as an integer literal. */
export function swiftInt(value: number): number {
  return Math.trunc(value);
}

/** Swift `Bool` interpolation. */
export function swiftBoolString(value: boolean): string {
  return value ? 'true' : 'false';
}

/**
 * Swift `Collection.split(separator:maxSplits:omittingEmptySubsequences:)`.
 * Empty subsequences are omitted by default and do NOT count toward
 * `maxSplits` (they were never appended).
 */
export function swiftSplit(
  text: string,
  separator: string,
  maxSplits: number = Number.MAX_SAFE_INTEGER,
  omittingEmptySubsequences: boolean = true,
): string[] {
  const result: string[] = [];
  const chars = Array.from(text);
  let subSequenceStart = 0;
  const appendSubsequence = (end: number): boolean => {
    if (subSequenceStart === end && omittingEmptySubsequences) return false;
    result.push(chars.slice(subSequenceStart, end).join(''));
    return true;
  };
  if (maxSplits === 0 || chars.length === 0) {
    appendSubsequence(chars.length);
    return result;
  }
  let subSequenceEnd = 0;
  while (subSequenceEnd !== chars.length) {
    if (chars[subSequenceEnd] === separator) {
      const didAppend = appendSubsequence(subSequenceEnd);
      subSequenceEnd += 1;
      subSequenceStart = subSequenceEnd;
      if (didAppend && result.length === maxSplits) break;
      continue;
    }
    subSequenceEnd += 1;
  }
  if (subSequenceStart !== chars.length || !omittingEmptySubsequences) {
    result.push(chars.slice(subSequenceStart).join(''));
  }
  return result;
}

const WHITESPACE = /^[\t \p{Zs}]+|[\t \p{Zs}]+$/gu;
const WHITESPACE_AND_NEWLINES = /^[\t\n\v\f\r\u0085\u2028\u2029 \p{Zs}]+|[\t\n\v\f\r\u0085\u2028\u2029 \p{Zs}]+$/gu;

/** `trimmingCharacters(in: .whitespaces)` */
export function trimWhitespaces(text: string): string {
  return text.replace(WHITESPACE, '');
}

/** `trimmingCharacters(in: .whitespacesAndNewlines)` */
export function trimWhitespacesAndNewlines(text: string): string {
  return text.replace(WHITESPACE_AND_NEWLINES, '');
}

/** `trimmingCharacters(in: CharacterSet(charactersIn: chars))` */
export function trimCharacters(text: string, chars: string): string {
  const set = new Set(Array.from(chars));
  const cps = Array.from(text);
  let start = 0;
  let end = cps.length;
  while (start < end && set.has(cps[start]!)) start += 1;
  while (end > start && set.has(cps[end - 1]!)) end -= 1;
  return cps.slice(start, end).join('');
}

const ALNUM = /^[\p{L}\p{M}\p{N}]$/u;
const LETTER = /^\p{L}$/u;
const NUMBER = /^\p{N}$/u;

/** `CharacterSet.alphanumerics.contains` (L*, M*, N* general categories). */
export function isAlphanumeric(char: string): boolean {
  return ALNUM.test(char);
}

/** `Character.isLetter` */
export function isLetter(char: string): boolean {
  return LETTER.test(char);
}

/** `Character.isNumber` */
export function isNumberChar(char: string): boolean {
  return NUMBER.test(char);
}

/** `components(separatedBy: CharacterSet.alphanumerics.inverted)` — pieces between non-alphanumerics (empties kept). */
export function componentsSeparatedByNonAlphanumerics(text: string): string[] {
  const parts: string[] = [];
  let current = '';
  for (const ch of text) {
    if (isAlphanumeric(ch)) {
      current += ch;
    } else {
      parts.push(current);
      current = '';
    }
  }
  parts.push(current);
  return parts;
}

/** Swift `String <` — Unicode scalar ordering (JS default compares UTF-16 units). */
export function swiftStringCompare(a: string, b: string): number {
  const ca = Array.from(a);
  const cb = Array.from(b);
  const n = Math.min(ca.length, cb.length);
  for (let i = 0; i < n; i++) {
    const da = ca[i]!.codePointAt(0)!;
    const db = cb[i]!.codePointAt(0)!;
    if (da !== db) return da < db ? -1 : 1;
  }
  return ca.length === cb.length ? 0 : ca.length < cb.length ? -1 : 1;
}

/** `Int(text, radix: 16)` — the whole string must be hex digits. */
export function swiftHexInt(text: string): number | null {
  if (!/^[+-]?[0-9a-fA-F]+$/.test(text)) return null;
  return parseInt(text, 16);
}

/** `String(format: "%08X", n)` */
export function hex8(value: number): string {
  return value.toString(16).toUpperCase().padStart(8, '0');
}

/** `String.count` — grapheme-ish (code point) length. */
export function swiftCount(text: string): number {
  return Array.from(text).length;
}

/** `String.prefix(n)` on code points. */
export function swiftPrefix(text: string, n: number): string {
  return Array.from(text).slice(0, n).join('');
}

/** `String.dropFirst(n)` on code points. */
export function swiftDropFirst(text: string, n: number = 1): string {
  return Array.from(text).slice(n).join('');
}

/** `UUID.uuidString` — always uppercase. */
export function uuidString(id: string): string {
  return id.toUpperCase();
}
