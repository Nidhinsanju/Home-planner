// Where the walls are on an uploaded drawing, read from its pixels. The vision model knows what
// the rooms are but places them only roughly; the image itself shows exactly where every wall
// is. Used by fromExtraction.ts to
//   - line each room's edges up with the inside faces of the walls drawn around it, and
//   - leave a room's side open where the drawing has no wall there (open kitchen / living /
//     hallway), instead of walling every room in.
// Walls are the thick dark strokes: text, door swings, furniture, counters and window lines are
// thin and are filtered out (a morphological opening: only dark pixels inside a dark square at
// least about 2.2 in across are kept). Drawings whose walls are only thin outlines (with light
// hatching between) show no walls this way; `usable` is then false and the image isn't used.

// The drawing's pixels as brightness (0 = black, 255 = white), at the size the model read it.
export type DrawingPixels = { width: number; height: number; luma: Uint8Array };

// Pixels by image source, filled in by the editor when an image is loaded (decoding needs the
// browser), so building from the drawing can stay synchronous.
const masks = new Map<string, DrawingPixels>();
export const setDrawingMask = (src: string, pixels: DrawingPixels) => {
  masks.clear(); // only the current drawing is needed
  masks.set(src, pixels);
};
export const drawingMask = (src: string | undefined) => (src ? masks.get(src) : undefined);

// Brightness from RGBA image data (what a canvas gives). Transparent counts as white.
export function pixelsFromRGBA(rgba: ArrayLike<number>, width: number, height: number): DrawingPixels {
  const luma = new Uint8Array(width * height);
  for (let i = 0; i < luma.length; i++) {
    const a = rgba[i * 4 + 3] / 255;
    luma[i] = Math.round((0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]) * a + 255 * (1 - a));
  }
  return { width, height, luma };
}

const DARK = 110; // solid wall strokes
const MIN_WALL_SHARE = 0.003; // less of the image than this as wall: walls aren't drawn solid

// Summed-area table of a 0/1 image: sum over any rectangle in constant time.
function integral(data: Uint8Array, w: number, h: number) {
  const S = new Int32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += data[y * w + x];
      S[(y + 1) * (w + 1) + x + 1] = S[y * (w + 1) + x + 1] + row;
    }
  }
  return S;
}
const rectSum = (S: Int32Array, w: number, x0: number, y0: number, x1: number, y1: number) =>
  S[y1 * (w + 1) + x1] - S[y0 * (w + 1) + x1] - S[y1 * (w + 1) + x0] + S[y0 * (w + 1) + x0];

// Pixels that lie in an s x s square of set pixels (opening: thinner strokes are removed).
function opening(data: Uint8Array, w: number, h: number, s: number) {
  const D = integral(data, w, h);
  const anchor = new Uint8Array(w * h);
  for (let y = 0; y + s <= h; y++) for (let x = 0; x + s <= w; x++) if (rectSum(D, w, x, y, x + s, y + s) === s * s) anchor[y * w + x] = 1;
  const A = integral(anchor, w, h);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[y * w + x] && rectSum(A, w, Math.max(0, x - s + 1), Math.max(0, y - s + 1), x + 1, y + 1) > 0) out[y * w + x] = 1;
    }
  }
  return out;
}

const threshold = (luma: Uint8Array, below: number) => {
  const out = new Uint8Array(luma.length);
  for (let i = 0; i < luma.length; i++) out[i] = luma[i] < below ? 1 : 0;
  return out;
};
const share = (data: Uint8Array) => {
  let n = 0;
  for (let i = 0; i < data.length; i++) n += data[i];
  return n / data.length;
};

// Built wall maps by drawing and stroke size: the plan description for the chat lays the
// drawing out again on every change, and building the map takes tens of milliseconds.
const built = new WeakMap<DrawingPixels, Map<number, DrawingWalls>>();

export class DrawingWalls {
  readonly width: number;
  readonly height: number;
  // Whether the drawing's walls were found: false for drawings whose walls are only outlined,
  // or too small to see; building then relies on what the model read alone.
  readonly usable: boolean;
  private S: Int32Array;

  // The wall map of a drawing. `pxPerFt` sets the smallest stroke counted as a wall (about
  // 2.2 in, between 3 and 12 px): thin enough for balcony and closet walls, thicker than text
  // and furniture lines.
  static of(pixels: DrawingPixels, pxPerFt: number): DrawingWalls {
    const s = Math.max(3, Math.min(12, Math.round(pxPerFt / 5.5)));
    let bySize = built.get(pixels);
    if (!bySize) built.set(pixels, (bySize = new Map()));
    let walls = bySize.get(s);
    if (!walls) bySize.set(s, (walls = new DrawingWalls(pixels, s)));
    return walls;
  }

  private constructor(pixels: DrawingPixels, s: number) {
    const { width: w, height: h, luma } = pixels;
    this.width = w;
    this.height = h;
    const wall = opening(threshold(luma, DARK), w, h, s);
    this.usable = share(wall) >= MIN_WALL_SHARE;
    this.S = integral(wall, w, h);
  }

  // Wall pixels in the rectangle [x0, x1) x [y0, y1) (clipped to the image).
  count(x0: number, y0: number, x1: number, y1: number) {
    const w = this.width;
    const cx0 = Math.max(0, Math.min(w, Math.floor(x0))), cx1 = Math.max(0, Math.min(w, Math.ceil(x1)));
    const cy0 = Math.max(0, Math.min(this.height, Math.floor(y0))), cy1 = Math.max(0, Math.min(this.height, Math.ceil(y1)));
    if (cx1 <= cx0 || cy1 <= cy0) return 0;
    const S = this.S;
    return S[cy1 * (w + 1) + cx1] - S[cy0 * (w + 1) + cx1] - S[cy1 * (w + 1) + cx0] + S[cy0 * (w + 1) + cx0];
  }

  // Share of an axis-aligned line that is wall: the column x (or row y) between `from` and `to`.
  private lineCoverage(vertical: boolean, at: number, from: number, to: number) {
    const lo = Math.min(from, to), hi = Math.max(from, to);
    if (hi - lo < 1) return 0;
    const n = vertical ? this.count(at, lo, at + 1, hi) : this.count(lo, at, hi, at + 1);
    return n / (Math.ceil(hi) - Math.floor(lo));
  }

  // The inside face of the wall nearest to a room edge. The edge is the line x = at (vertical)
  // or y = at, running from `from` to `to`; `outward` (+1/-1) points away from the room. Looks
  // up to `reach` px either way for where floor turns into wall going outward, and returns the
  // closest such face, or null if the drawing has no wall there (an open side).
  findFace(vertical: boolean, at: number, from: number, to: number, outward: 1 | -1, reach: number): number | null {
    // Skip the ends: perpendicular walls run through the corners.
    const m = Math.abs(to - from) * 0.15;
    const a = Math.min(from, to) + m, b = Math.max(from, to) - m;
    const isWall = (pos: number) => this.lineCoverage(vertical, Math.round(pos), a, b) >= 0.25;
    let best: number | null = null;
    for (let t = -Math.round(reach); t <= Math.round(reach); t++) {
      const pos = at + t * outward;
      if (!isWall(pos) || isWall(pos - outward)) continue;
      if (best == null || Math.abs(t) < Math.abs(best - at)) best = pos;
    }
    // The face sits between the last floor pixel and the first wall pixel.
    return best == null ? null : best - (outward > 0 ? 0 : -1);
  }

  // Whether there is wall within `band` px of the point (x, y).
  wallNear(x: number, y: number, band: number) {
    return this.count(x - band, y - band, x + band + 1, y + band + 1) > 0;
  }

  // Whether walking from (x, y) in direction (dx, dy) reaches the edge of the image without
  // crossing any wall: the side faces the outside of the building.
  leadsOutside(x: number, y: number, dx: number, dy: number) {
    const L = Math.hypot(dx, dy) || 1;
    const ux = dx / L, uy = dy / L;
    for (let t = 0; ; t += 2) {
      const px = x + ux * t, py = y + uy * t;
      if (px < 0 || py < 0 || px >= this.width || py >= this.height) return true;
      if (this.count(px - 1, py - 1, px + 2, py + 2) > 0) return false;
    }
  }
}
