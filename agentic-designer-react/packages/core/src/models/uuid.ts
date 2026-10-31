// Swift `UUID` → string. Swift's `uuidString` is always UPPERCASE and its JSON
// encoder writes it that way; generated ids follow suit so files written by
// the port are byte-compatible with the macOS app.

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function newUUID(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID().toUpperCase();
  }
  // Fallback (should not happen on Node 19+ or any modern browser).
  const hex = '0123456789ABCDEF';
  let out = '';
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) out += '-';
    else if (i === 14) out += '4';
    else if (i === 19) out += hex[(Math.random() * 4) | 8];
    else out += hex[(Math.random() * 16) | 0];
  }
  return out;
}

export function isUUIDString(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/**
 * Equivalent of `UUID(uuidString:)` followed by `.uuidString`: accepts any
 * case, returns the canonical UPPERCASE form, or null when not a UUID.
 */
export function parseUUID(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (!UUID_PATTERN.test(value)) return null;
  return value.toUpperCase();
}

/** Swift `UUID().uuidString.prefix(8)` */
export function shortUUID(length = 8): string {
  return newUUID().slice(0, length);
}
