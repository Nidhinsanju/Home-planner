import { deflateSync } from 'node:zlib';

// A tiny greyscale raster with a 5x7 pixel font and a PNG encoder, enough to draw synthetic
// floor plans (walls, door gaps, room labels, sizes) without any image library.

const GLYPHS: Record<string, string> = {
  A: '01110 10001 10001 11111 10001 10001 10001', B: '11110 10001 10001 11110 10001 10001 11110',
  C: '01110 10001 10000 10000 10000 10001 01110', D: '11110 10001 10001 10001 10001 10001 11110',
  E: '11111 10000 10000 11110 10000 10000 11111', F: '11111 10000 10000 11110 10000 10000 10000',
  G: '01110 10001 10000 10111 10001 10001 01111', H: '10001 10001 10001 11111 10001 10001 10001',
  I: '01110 00100 00100 00100 00100 00100 01110', J: '00111 00010 00010 00010 00010 10010 01100',
  K: '10001 10010 10100 11000 10100 10010 10001', L: '10000 10000 10000 10000 10000 10000 11111',
  M: '10001 11011 10101 10101 10001 10001 10001', N: '10001 10001 11001 10101 10011 10001 10001',
  O: '01110 10001 10001 10001 10001 10001 01110', P: '11110 10001 10001 11110 10000 10000 10000',
  Q: '01110 10001 10001 10001 10101 10010 01101', R: '11110 10001 10001 11110 10100 10010 10001',
  S: '01111 10000 10000 01110 00001 00001 11110', T: '11111 00100 00100 00100 00100 00100 00100',
  U: '10001 10001 10001 10001 10001 10001 01110', V: '10001 10001 10001 10001 10001 01010 00100',
  W: '10001 10001 10001 10101 10101 10101 01010', X: '10001 10001 01010 00100 01010 10001 10001',
  Y: '10001 10001 01010 00100 00100 00100 00100', Z: '11111 00001 00010 00100 01000 10000 11111',
  '0': '01110 10001 10011 10101 11001 10001 01110', '1': '00100 01100 00100 00100 00100 00100 01110',
  '2': '01110 10001 00001 00010 00100 01000 11111', '3': '11111 00010 00100 00010 00001 10001 01110',
  '4': '00010 00110 01010 10010 11111 00010 00010', '5': '11111 10000 11110 00001 00001 10001 01110',
  '6': '00110 01000 10000 11110 10001 10001 01110', '7': '11111 00001 00010 00100 01000 01000 01000',
  '8': '01110 10001 10001 01110 10001 10001 01110', '9': '01110 10001 10001 01111 00001 00010 01100',
  "'": '00100 00100 01000 00000 00000 00000 00000', x: '00000 00000 10001 01010 00100 01010 10001',
  '-': '00000 00000 00000 11111 00000 00000 00000', '.': '00000 00000 00000 00000 00000 01100 01100',
  ' ': '00000 00000 00000 00000 00000 00000 00000',
};

export class Raster {
  readonly px: Uint8Array;
  constructor(readonly width: number, readonly height: number, background = 255) {
    this.px = new Uint8Array(width * height).fill(background);
  }

  rect(x: number, y: number, w: number, h: number, value: number) {
    const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(this.width, Math.round(x + w)), y1 = Math.min(this.height, Math.round(y + h));
    for (let j = y0; j < y1; j++) this.px.fill(value, j * this.width + x0, j * this.width + x1);
  }

  // Outline of a rectangle with walls `t` pixels thick, centred on its edges.
  outline(x: number, y: number, w: number, h: number, t: number, value = 0) {
    this.rect(x - t / 2, y - t / 2, w + t, t, value);
    this.rect(x - t / 2, y + h - t / 2, w + t, t, value);
    this.rect(x - t / 2, y - t / 2, t, h + t, value);
    this.rect(x + w - t / 2, y - t / 2, t, h + t, value);
  }

  textWidth(text: string, scale: number) {
    return text.length * 6 * scale - scale;
  }

  // Draws text centred on (cx, cy) with the 5x7 font at `scale` pixels per font pixel.
  text(text: string, cx: number, cy: number, scale: number, value = 40) {
    let x = Math.round(cx - this.textWidth(text, scale) / 2);
    const y = Math.round(cy - (7 * scale) / 2);
    for (const ch of text) {
      const rows = (GLYPHS[ch] ?? GLYPHS[ch.toUpperCase()] ?? GLYPHS[' ']).split(' ');
      rows.forEach((row, r) => [...row].forEach((bit, c) => bit === '1' && this.rect(x + c * scale, y + r * scale, scale, scale, value)));
      x += 6 * scale;
    }
  }

  png(): Buffer {
    const raw = Buffer.alloc((this.width + 1) * this.height);
    for (let j = 0; j < this.height; j++) {
      raw[j * (this.width + 1)] = 0; // filter: none
      raw.set(this.px.subarray(j * this.width, (j + 1) * this.width), j * (this.width + 1) + 1);
    }
    const header = Buffer.alloc(13);
    header.writeUInt32BE(this.width, 0);
    header.writeUInt32BE(this.height, 4);
    header[8] = 8; // bit depth
    header[9] = 0; // greyscale
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(raw, { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ]);
  }
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export const crc32 = (buf: Buffer) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
