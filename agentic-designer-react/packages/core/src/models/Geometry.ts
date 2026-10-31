// Ported 1:1 from CoreGraphics CGPoint/CGSize/CGRect as used across AgenticDesigner.
// Plain data shapes; helpers mirror the CGRect accessors the Swift code relies on.

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const zeroPoint: Readonly<Point> = Object.freeze({ x: 0, y: 0 });
export const zeroSize: Readonly<Size> = Object.freeze({ width: 0, height: 0 });
export const zeroRect: Readonly<Rect> = Object.freeze({ x: 0, y: 0, width: 0, height: 0 });

export function point(x: number, y: number): Point {
  return { x, y };
}

export function size(width: number, height: number): Size {
  return { width, height };
}

export function rect(x: number, y: number, width: number, height: number): Rect {
  return { x, y, width, height };
}

export function rectFrom(origin: Point, s: Size): Rect {
  return { x: origin.x, y: origin.y, width: s.width, height: s.height };
}

export function rectMinX(r: Rect): number { return Math.min(r.x, r.x + r.width); }
export function rectMinY(r: Rect): number { return Math.min(r.y, r.y + r.height); }
export function rectMaxX(r: Rect): number { return Math.max(r.x, r.x + r.width); }
export function rectMaxY(r: Rect): number { return Math.max(r.y, r.y + r.height); }
export function rectMidX(r: Rect): number { return r.x + r.width / 2; }
export function rectMidY(r: Rect): number { return r.y + r.height / 2; }
export function rectOrigin(r: Rect): Point { return { x: r.x, y: r.y }; }
export function rectSize(r: Rect): Size { return { width: r.width, height: r.height }; }
export function rectCenter(r: Rect): Point { return { x: rectMidX(r), y: rectMidY(r) }; }

export function rectIsEmpty(r: Rect): boolean {
  return r.width <= 0 || r.height <= 0;
}

/** CGRect.standardized — non-negative width/height. */
export function rectStandardized(r: Rect): Rect {
  return {
    x: rectMinX(r),
    y: rectMinY(r),
    width: Math.abs(r.width),
    height: Math.abs(r.height),
  };
}

export function rectContainsPoint(r: Rect, p: Point): boolean {
  const s = rectStandardized(r);
  return p.x >= s.x && p.x < s.x + s.width && p.y >= s.y && p.y < s.y + s.height;
}

export function rectContainsRect(outer: Rect, inner: Rect): boolean {
  const a = rectStandardized(outer);
  const b = rectStandardized(inner);
  return (
    b.x >= a.x &&
    b.y >= a.y &&
    b.x + b.width <= a.x + a.width &&
    b.y + b.height <= a.y + a.height
  );
}

export function rectIntersects(a: Rect, b: Rect): boolean {
  const s = rectStandardized(a);
  const t = rectStandardized(b);
  return (
    s.x < t.x + t.width &&
    s.x + s.width > t.x &&
    s.y < t.y + t.height &&
    s.y + s.height > t.y
  );
}

export function rectIntersection(a: Rect, b: Rect): Rect {
  const s = rectStandardized(a);
  const t = rectStandardized(b);
  const x = Math.max(s.x, t.x);
  const y = Math.max(s.y, t.y);
  const maxX = Math.min(s.x + s.width, t.x + t.width);
  const maxY = Math.min(s.y + s.height, t.y + t.height);
  if (maxX <= x || maxY <= y) return { ...zeroRect };
  return { x, y, width: maxX - x, height: maxY - y };
}

export function rectUnion(a: Rect, b: Rect): Rect {
  const s = rectStandardized(a);
  const t = rectStandardized(b);
  const x = Math.min(s.x, t.x);
  const y = Math.min(s.y, t.y);
  const maxX = Math.max(s.x + s.width, t.x + t.width);
  const maxY = Math.max(s.y + s.height, t.y + t.height);
  return { x, y, width: maxX - x, height: maxY - y };
}

/** CGRect.insetBy(dx:dy:) */
export function rectInset(r: Rect, dx: number, dy: number): Rect {
  return { x: r.x + dx, y: r.y + dy, width: r.width - 2 * dx, height: r.height - 2 * dy };
}

/** CGRect.offsetBy(dx:dy:) */
export function rectOffset(r: Rect, dx: number, dy: number): Rect {
  return { x: r.x + dx, y: r.y + dy, width: r.width, height: r.height };
}

export function pointsEqual(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

export function sizesEqual(a: Size, b: Size): boolean {
  return a.width === b.width && a.height === b.height;
}

export function rectsEqual(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

export function pointDistance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function pointAdd(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function pointSubtract(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function pointScale(p: Point, factor: number): Point {
  return { x: p.x * factor, y: p.y * factor };
}
