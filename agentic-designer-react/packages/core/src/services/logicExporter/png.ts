// Minimal, dependency-free PNG encoder for the exported AppIcon
// (Swift: LogicExporter.appIconPNGData draws it with AppKit). Rows of a
// vertical gradient are runs of one colour, so a fixed-Huffman DEFLATE stream
// with back-references at distance 3 compresses a 1024×1024 icon to a few KB.

class BitWriter {
  private bytes: number[] = [];
  private current = 0;
  private bitCount = 0;

  writeBits(value: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const bit = (value >>> i) & 1;
      this.current |= bit << this.bitCount;
      this.bitCount += 1;
      if (this.bitCount === 8) {
        this.bytes.push(this.current);
        this.current = 0;
        this.bitCount = 0;
      }
    }
  }

  /** Huffman codes are written MSB-first. */
  writeCode(code: number, length: number): void {
    for (let i = length - 1; i >= 0; i--) this.writeBits((code >>> i) & 1, 1);
  }

  finish(): Uint8Array {
    if (this.bitCount > 0) this.bytes.push(this.current);
    return Uint8Array.from(this.bytes);
  }
}

function writeLiteral(w: BitWriter, value: number): void {
  if (value <= 143) w.writeCode(0x30 + value, 8);
  else w.writeCode(0x190 + (value - 144), 9);
}

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

function writeMatch(w: BitWriter, length: number, distance: number): void {
  let li = LENGTH_BASE.length - 1;
  while (LENGTH_BASE[li]! > length) li -= 1;
  const symbol = 257 + li;
  if (symbol <= 279) w.writeCode(symbol - 256, 7);
  else w.writeCode(0xc0 + (symbol - 280), 8);
  if (LENGTH_EXTRA[li]! > 0) w.writeBits(length - LENGTH_BASE[li]!, LENGTH_EXTRA[li]!);
  let di = DIST_BASE.length - 1;
  while (DIST_BASE[di]! > distance) di -= 1;
  w.writeCode(di, 5);
  if (DIST_EXTRA[di]! > 0) w.writeBits(distance - DIST_BASE[di]!, DIST_EXTRA[di]!);
}

function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]!) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function u32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function chunk(type: string, data: number[]): number[] {
  const typeBytes = Array.from(type, (c) => c.charCodeAt(0));
  const body = Uint8Array.from([...typeBytes, ...data]);
  return [...u32(data.length), ...body, ...u32(crc32(body))];
}

export interface RGB {
  r: number;
  g: number;
  b: number;
}

/**
 * A square PNG whose rows run a vertical gradient from `top` to `bottom`
 * (8-bit RGB, no alpha — app icons must be opaque).
 */
export function gradientPNG(side: number, top: RGB, bottom: RGB): Uint8Array {
  const rowBytes = side * 3;
  const raw = new Uint8Array((rowBytes + 1) * side);
  const w = new BitWriter();
  w.writeBits(1, 1); // BFINAL
  w.writeBits(1, 2); // BTYPE = fixed Huffman
  let offset = 0;
  for (let y = 0; y < side; y++) {
    const t = side > 1 ? y / (side - 1) : 0;
    const r = Math.round(top.r + (bottom.r - top.r) * t);
    const g = Math.round(top.g + (bottom.g - top.g) * t);
    const b = Math.round(top.b + (bottom.b - top.b) * t);
    raw[offset] = 0; // filter: None
    writeLiteral(w, 0);
    raw[offset + 1] = r;
    raw[offset + 2] = g;
    raw[offset + 3] = b;
    writeLiteral(w, r);
    writeLiteral(w, g);
    writeLiteral(w, b);
    for (let x = 1; x < side; x++) {
      raw[offset + 1 + x * 3] = r;
      raw[offset + 2 + x * 3] = g;
      raw[offset + 3 + x * 3] = b;
    }
    let remaining = rowBytes - 3;
    while (remaining > 0) {
      const len = Math.min(258, remaining);
      if (len < 3) {
        for (let i = 0; i < len; i++) writeLiteral(w, [r, g, b][i]!);
      } else {
        writeMatch(w, len, 3);
      }
      remaining -= len;
    }
    offset += rowBytes + 1;
  }
  w.writeCode(0, 7); // end of block
  const deflated = w.finish();
  const zlib = [0x78, 0x01, ...deflated, ...u32(adler32(raw))];

  const ihdr = [...u32(side), ...u32(side), 8, 2, 0, 0, 0];
  const png = [
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...chunk('IHDR', ihdr),
    ...chunk('IDAT', zlib),
    ...chunk('IEND', []),
  ];
  return Uint8Array.from(png);
}
