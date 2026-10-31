// Ported 1:1 from AgenticDesigner/ViewModels/ProjectViewModel.swift
// (the private colour helpers used by repairTextContrast / expandContainersToFitChildren).

export interface ColorComponents {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Swift's `trimmingCharacters(in: CharacterSet.alphanumerics.inverted)`. */
function trimmingNonAlphanumerics(value: string): string {
  return value.replace(/^[^0-9A-Za-z]+/, '').replace(/[^0-9A-Za-z]+$/, '');
}

// Parses hex (#RGB, #RRGGBB, #RRGGBBAA) and rgb()/rgba() color strings.
export function parseColorComponents(value: string): ColorComponents | null {
  const source = value.trim().toLowerCase();

  if (source === 'white') return { r: 1, g: 1, b: 1, a: 1 };
  if (source === 'black') return { r: 0, g: 0, b: 0, a: 1 };
  if (source === 'transparent' || source === 'clear') return { r: 0, g: 0, b: 0, a: 0 };

  if (source.startsWith('rgb')) {
    const open = source.indexOf('(');
    const close = source.lastIndexOf(')');
    if (open >= 0 && close >= 0 && open < close) {
      const parts = source
        .slice(open + 1, close)
        .split(',')
        .map((part) => part.trim());

      const channel = (part: string): number | null => {
        if (part.endsWith('%')) {
          const number = Number(part.slice(0, -1));
          return Number.isFinite(number) ? number / 100 : null;
        }
        const number = Number(part);
        if (!Number.isFinite(number) || part.length === 0) return null;
        return number > 1 ? number / 255 : number;
      };

      if (parts.length >= 3) {
        const r = channel(parts[0]);
        const g = channel(parts[1]);
        const b = channel(parts[2]);
        if (r !== null && g !== null && b !== null) {
          const rawAlpha = parts.length >= 4 ? Number(parts[3]) : 1;
          const a = Number.isFinite(rawAlpha) ? rawAlpha : 1;
          return {
            r: Math.min(Math.max(r, 0), 1),
            g: Math.min(Math.max(g, 0), 1),
            b: Math.min(Math.max(b, 0), 1),
            a: Math.min(Math.max(a, 0), 1),
          };
        }
      }
      return null;
    }
  }

  const cleaned = trimmingNonAlphanumerics(source);
  if (cleaned.length === 0 || !/^[0-9a-f]+$/.test(cleaned)) return null;
  const int = Number.parseInt(cleaned, 16);
  if (!Number.isFinite(int)) return null;

  switch (cleaned.length) {
    case 8:
      return {
        r: ((int >>> 24) & 0xff) / 255,
        g: ((int >>> 16) & 0xff) / 255,
        b: ((int >>> 8) & 0xff) / 255,
        a: (int & 0xff) / 255,
      };
    case 6:
      return {
        r: ((int >>> 16) & 0xff) / 255,
        g: ((int >>> 8) & 0xff) / 255,
        b: (int & 0xff) / 255,
        a: 1,
      };
    case 3:
      return {
        r: ((int >>> 8) & 0xf) / 15,
        g: ((int >>> 4) & 0xf) / 15,
        b: (int & 0xf) / 15,
        a: 1,
      };
    default:
      return null;
  }
}

export function hexString(r: number, g: number, b: number): string {
  const byte = (value: number): string => {
    const rounded = Math.sign(value * 255) * Math.round(Math.abs(value * 255));
    return Math.trunc(rounded).toString(16).toUpperCase().padStart(2, '0');
  };
  return `#${byte(r)}${byte(g)}${byte(b)}`;
}

// Composites a possibly-translucent color over the opaque background
// behind it and returns the resulting opaque hex.
export function compositedFill(fill: string, background: string): string {
  const top = parseColorComponents(fill);
  if (!top) return background;

  if (top.a >= 0.999) {
    return hexString(top.r, top.g, top.b);
  }

  const bottom = parseColorComponents(background) ?? { r: 1, g: 1, b: 1, a: 1 };
  const r = top.r * top.a + bottom.r * (1 - top.a);
  const g = top.g * top.a + bottom.g * (1 - top.a);
  const b = top.b * top.a + bottom.b * (1 - top.a);
  return hexString(r, g, b);
}

export function isTransparentHex(hex: string): boolean {
  const cleaned = trimmingNonAlphanumerics(hex);
  if (cleaned.length !== 8) return false;
  return cleaned.slice(-2).toLowerCase() === '00';
}

export function contrastRatio(firstHex: string, secondHex: string): number {
  const first = luminance(firstHex);
  const second = luminance(secondHex);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

export function luminance(hex: string): number {
  const cleaned = trimmingNonAlphanumerics(hex);
  let rgbHex: string;

  switch (cleaned.length) {
    case 8:
      rgbHex = cleaned.slice(0, 6);
      break;
    case 6:
      rgbHex = cleaned;
      break;
    default:
      return 1;
  }

  // Scanner.scanHexInt64 stops at the first non-hex character and yields 0 for none.
  const match = /^[0-9a-fA-F]+/.exec(rgbHex);
  const int = match ? Number.parseInt(match[0], 16) : 0;

  const channel = (value: number): number => {
    const normalized = value / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
  };

  const r = channel((int >>> 16) & 0xff);
  const g = channel((int >>> 8) & 0xff);
  const b = channel(int & 0xff);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** `isLightOpaqueFill(_:)` — 8-digit (alpha) or invalid → skip. */
export function isLightOpaqueFill(hex: string): boolean {
  const h = hex.startsWith('#') ? hex.slice(1) : hex;
  if (h.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(h)) return false;
  const v = Number.parseInt(h, 16);
  const r = (v >>> 16) & 0xff;
  const g = (v >>> 8) & 0xff;
  const b = v & 0xff;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.82;
}
