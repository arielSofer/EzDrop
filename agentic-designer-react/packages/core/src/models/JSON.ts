// JSON value types standing in for Swift's `[String: Any]` / `Any` JSON payloads.

export type JSONPrimitive = string | number | boolean | null;
export type JSONValue = JSONPrimitive | JSONValue[] | { [key: string]: JSONValue };
export type JSONObject = { [key: string]: JSONValue };
export type JSONArray = JSONValue[];

export function isJSONObject(value: unknown): value is JSONObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isJSONArray(value: unknown): value is JSONArray {
  return Array.isArray(value);
}

export function isJSONPrimitive(value: unknown): value is JSONPrimitive {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

/**
 * Deep-clone a JSON value (structured-clone semantics for plain data).
 */
export function cloneJSON<T extends JSONValue>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Stable stringify with sorted object keys at every level — the equivalent of
 * Foundation's `JSONEncoder.OutputFormatting.sortedKeys`.
 * `indent` > 0 also mirrors `.prettyPrinted` (Foundation uses 2 spaces).
 */
export function stringifySorted(value: unknown, indent = 0): string {
  return JSON.stringify(sortKeysDeep(value), null, indent > 0 ? indent : undefined);
}

export function sortKeysDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => sortKeysDeep(v)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortKeysDeep(v);
    }
    return out as T;
  }
  return value;
}
