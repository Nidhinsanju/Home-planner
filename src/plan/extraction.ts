import { z } from 'zod';

// What the vision model reads from an uploaded floor plan (step A of building from a drawing).
// Everything is in PIXELS of the image the model was shown; step B (fromExtraction.ts) turns
// it into a plan in feet. Shared by the server (to validate the model's answer) and the app.

const px = z.number().finite();
const pointPx = z.tuple([px, px]);

export const ExtractionSchema = z.object({
  summary: z.string().max(1000).default(''),
  rooms: z.array(z.object({
    name: z.string().min(1).max(60),
    type: z.string().max(30).default(''),
    // The size text exactly as written on the plan, e.g. 12' 6" x 11' 6" (null if none).
    label: z.string().max(40).nullish(),
    labeledWidthFt: z.number().positive().max(200).nullish(),
    labeledDepthFt: z.number().positive().max(200).nullish(),
    approxBoxPx: z.tuple([px, px, px, px]),
    // Outline for a room that isn't a rectangle (diagonal or L-shaped walls).
    polygonPx: z.array(pointPx).min(3).max(30).nullish(),
    connectsTo: z.array(z.string()).max(20).default([]),
    // Rooms it opens into with no wall between (open-plan kitchen and living, for example).
    openTo: z.array(z.string()).max(20).default([]),
  })).min(1).max(60),
  doors: z.array(z.object({
    between: z.tuple([z.string(), z.string()]),
    approxPx: pointPx,
  })).max(80).default([]),
  windows: z.array(z.object({
    room: z.string(),
    wallSide: z.string().max(20).default(''),
    approxPx: pointPx,
  })).max(80).default([]),
  entry: z.object({ approxPx: pointPx }).nullish(),
});

export type Extraction = z.infer<typeof ExtractionSchema>;
export type ExtractedRoom = Extraction['rooms'][number];

// Some models (Gemini) give coordinates on a 0-1000 scale for both axes instead of pixels,
// whatever the prompt says. If every coordinate fits in 0-1000 while the image is clearly
// bigger than that, they are rescaled to pixels. Already-pixel readings are returned as is.
export function toPixelSpace(ex: Extraction, width: number, height: number): Extraction {
  const xs = [...ex.rooms.flatMap(r => [r.approxBoxPx[0], r.approxBoxPx[2], ...(r.polygonPx ?? []).map(p => p[0])]), ...ex.doors.map(d => d.approxPx[0]), ...ex.windows.map(w => w.approxPx[0])];
  const ys = [...ex.rooms.flatMap(r => [r.approxBoxPx[1], r.approxBoxPx[3], ...(r.polygonPx ?? []).map(p => p[1])]), ...ex.doors.map(d => d.approxPx[1]), ...ex.windows.map(w => w.approxPx[1])];
  const normalized = Math.max(...xs) <= 1000 && Math.max(...ys) <= 1000 && Math.max(width, height) > 1300;
  if (!normalized) return ex;
  const kx = width / 1000, ky = height / 1000;
  const p = (q: [number, number]): [number, number] => [q[0] * kx, q[1] * ky];
  return {
    ...ex,
    rooms: ex.rooms.map(r => ({
      ...r,
      approxBoxPx: [r.approxBoxPx[0] * kx, r.approxBoxPx[1] * ky, r.approxBoxPx[2] * kx, r.approxBoxPx[3] * ky],
      ...(r.polygonPx ? { polygonPx: r.polygonPx.map(p) } : {}),
    })),
    doors: ex.doors.map(d => ({ ...d, approxPx: p(d.approxPx) })),
    windows: ex.windows.map(w => ({ ...w, approxPx: p(w.approxPx) })),
    ...(ex.entry ? { entry: { approxPx: p(ex.entry.approxPx) } } : {}),
  };
}

// Feet from a written length: 12' 6", 12'6, 12 ft 6 in, 9'-11", 11' or 12.5. NaN if unreadable.
export function parseFeet(text: string): number {
  const s = text.replace(/[’′]/g, "'").replace(/[”″]|''/g, '"').trim();
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(?:'|ft|feet)?\s*-?\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in|inches)?)?$/i);
  if (!m) return NaN;
  return Number(m[1]) + (m[2] ? Number(m[2]) / 12 : 0);
}

// [width, depth] in feet from a size label like 12' 0" x 9' 11", or null.
export function parseSizeLabel(label: string | null | undefined): [number, number] | null {
  const parts = String(label ?? '').split(/\s*[x×X]\s*/);
  if (parts.length !== 2) return null;
  const [w, d] = parts.map(parseFeet);
  return w > 0 && d > 0 ? [w, d] : null;
}

// The room's written size: the label text when it parses (exact), else the model's numbers.
export function labeledSize(r: ExtractedRoom): [number, number] | null {
  return parseSizeLabel(r.label) ?? (r.labeledWidthFt && r.labeledDepthFt ? [r.labeledWidthFt, r.labeledDepthFt] : null);
}
