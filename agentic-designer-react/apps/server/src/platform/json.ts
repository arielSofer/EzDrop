// JSON shaping that matches Foundation's JSONEncoder output closely enough for
// the Swift app and the port to share the same files: `.sortedKeys` ordering,
// `.prettyPrinted` layout (`"key" : value`, two-space indent) and Foundation's
// default `\/` escaping of forward slashes.

export type JSONValue = null | boolean | number | string | JSONValue[] | { [key: string]: JSONValue };

export function sortedKeysDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => sortedKeysDeep(item)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      if (source[key] === undefined) continue;
      result[key] = sortedKeysDeep(source[key]);
    }
    return result as T;
  }
  return value;
}

function escapeString(text: string): string {
  let out = '"';
  for (const char of text) {
    const code = char.codePointAt(0)!;
    switch (char) {
      case '"': out += '\\"'; break;
      case '\\': out += '\\\\'; break;
      case '/': out += '\\/'; break;
      case '\n': out += '\\n'; break;
      case '\r': out += '\\r'; break;
      case '\t': out += '\\t'; break;
      case '\b': out += '\\b'; break;
      case '\f': out += '\\f'; break;
      default:
        if (code < 0x20) {
          out += '\\u' + code.toString(16).padStart(4, '0');
        } else {
          out += char;
        }
    }
  }
  return out + '"';
}

function serialize(value: unknown, indent: string, pretty: boolean): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('JSON does not support non-finite numbers.');
    return String(value);
  }
  if (typeof value === 'string') return escapeString(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return pretty ? `[\n\n${indent}]` : '[]';
    if (!pretty) return '[' + value.map((item) => serialize(item, indent, false)).join(',') + ']';
    const inner = indent + '  ';
    return '[\n' + value.map((item) => inner + serialize(item, inner, true)).join(',\n') + `\n${indent}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return pretty ? `{\n\n${indent}}` : '{}';
    if (!pretty) return '{' + entries.map(([k, v]) => escapeString(k) + ':' + serialize(v, indent, false)).join(',') + '}';
    const inner = indent + '  ';
    return '{\n' + entries.map(([k, v]) => inner + escapeString(k) + ' : ' + serialize(v, inner, true)).join(',\n') + `\n${indent}}`;
  }
  throw new Error(`Cannot serialise value of type ${typeof value}`);
}

/// JSONEncoder with `[.prettyPrinted, .sortedKeys]`.
export function prettySortedJSON(value: unknown): string {
  return serialize(sortedKeysDeep(value), '', true);
}

/// JSONEncoder with default (compact) formatting.
export function compactJSON(value: unknown): string {
  return serialize(value, '', false);
}

/// The one-line form used by console logs / tool results.
export function safeParseJSON(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
