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
  // Set by toPixelSpace once the coordinates are known to be pixels, so they aren't rescaled again.
  space: z.literal('px').optional(),
});

export type Extraction = z.infer<typeof ExtractionSchema>;
export type ExtractedRoom = Extraction['rooms'][number];

// ---- What the model answers ----------------------------------------------------------------
// The model gets short, neutral field names and is told which coordinate system to use
// ("norm1000" = 0-1000 across and down the image, the one Gemini is trained on; "px" = image
// pixels). Field names that say "Px" made Gemini mix the two in one answer. The answer is
// converted to the Extraction above by fromWire.

export type CoordinateSpace = 'px' | 'norm1000';

const coord = z.number().finite();
const point = z.tuple([coord, coord]);
const nameList = z.array(z.string()).max(20).nullish().transform(v => v ?? []);

export const WireSchema = z.object({
  summary: z.string().nullish().transform(v => (v ?? '').slice(0, 1000)),
  rooms: z.array(z.object({
    name: z.string().min(1).max(60),
    type: z.string().max(30).nullish().transform(v => v ?? ''),
    label: z.string().max(40).nullish(),
    widthFt: z.number().positive().max(200).nullish(),
    depthFt: z.number().positive().max(200).nullish(),
    box: z.tuple([coord, coord, coord, coord]),
    polygon: z.array(point).min(3).max(30).nullish(),
    connectsTo: nameList,
    openTo: nameList,
  })).min(1).max(60),
  doors: z.array(z.object({ between: z.tuple([z.string(), z.string()]), at: point })).max(80).nullish().transform(v => v ?? []),
  windows: z.array(z.object({ room: z.string(), side: z.string().max(20).nullish().transform(v => v ?? ''), at: point })).max(80).nullish().transform(v => v ?? []),
  entry: point.nullish(),
});
export type Wire = z.infer<typeof WireSchema>;

// The same shape as a JSON schema, sent as the response format so the model's answer always
// has this structure (providers that support structured output enforce it).
const num = { type: 'number' };
const pair = { type: 'array', items: num, minItems: 2, maxItems: 2 };
const strs = { type: 'array', items: { type: 'string' } };
const nullable = (schema: object) => ({ anyOf: [schema, { type: 'null' }] });
const obj = (properties: Record<string, object>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
export const WIRE_JSON_SCHEMA = obj({
  summary: { type: 'string' },
  rooms: {
    type: 'array',
    items: obj({
      name: { type: 'string' },
      type: { type: 'string' },
      label: nullable({ type: 'string' }),
      widthFt: nullable(num),
      depthFt: nullable(num),
      box: { type: 'array', items: num, minItems: 4, maxItems: 4 },
      polygon: nullable({ type: 'array', items: pair }),
      connectsTo: strs,
      openTo: strs,
    }),
  },
  doors: { type: 'array', items: obj({ between: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 2 }, at: pair }) },
  windows: { type: 'array', items: obj({ room: { type: 'string' }, side: { type: 'string' }, at: pair }) },
  entry: nullable(pair),
});

// The model's answer as an Extraction in pixels of a width x height image.
export function fromWire(w: Wire, space: CoordinateSpace, width: number, height: number): Extraction {
  const ex: Extraction = {
    summary: w.summary,
    rooms: w.rooms.map(r => ({
      name: r.name,
      type: r.type,
      label: r.label ?? null,
      labeledWidthFt: r.widthFt ?? null,
      labeledDepthFt: r.depthFt ?? null,
      approxBoxPx: r.box,
      polygonPx: r.polygon ?? null,
      connectsTo: r.connectsTo,
      openTo: r.openTo,
    })),
    doors: w.doors.map(d => ({ between: d.between, approxPx: d.at })),
    windows: w.windows.map(x => ({ room: x.room, wallSide: x.side, approxPx: x.at })),
    entry: w.entry ? { approxPx: w.entry } : null,
  };
  return toPixelSpace(ex, width, height, space);
}

// Some models (Gemini) give coordinates on a 0-1000 scale for both axes instead of pixels,
// whatever the prompt says, and may even mix the two in one answer (a room's x in pixels, its
// y on 0-1000). When nearly every coordinate fits in 0-1000 while the image is clearly bigger,
// the answer is taken as 0-1000 and rescaled to pixels, except values that can only be pixels
// (over 1000): for each room, each axis is rescaled only if all its values on that axis fit.
// The result is marked as pixels, so calling this again changes nothing. `declared` is the
// coordinate system the model was asked for; without it (older reads) it is guessed.
export function toPixelSpace(ex: Extraction, width: number, height: number, declared?: CoordinateSpace): Extraction {
  if (ex.space === 'px') return ex;
  if (declared === 'px') return { ...ex, space: 'px' };
  const points: [number, number][] = [
    ...ex.rooms.flatMap(r => [[r.approxBoxPx[0], r.approxBoxPx[1]], [r.approxBoxPx[2], r.approxBoxPx[3]], ...(r.polygonPx ?? [])] as [number, number][]),
    ...ex.doors.map(d => d.approxPx),
    ...ex.windows.map(w => w.approxPx),
    ...(ex.entry ? [ex.entry.approxPx] : []),
  ];
  const values = points.flat();
  const over = values.filter(v => v > 1000).length;
  const normalized = declared === 'norm1000' || (Math.max(width, height) > 1300 && over <= values.length * 0.15);
  if (!normalized) return { ...ex, space: 'px' };
  const kx = width / 1000, ky = height / 1000;
  // Scale for one axis of a group of values: rescaled only if none of them can only be pixels.
  const k = (vs: number[], s: number) => (vs.every(v => v <= 1000) ? s : 1);
  const p = (q: [number, number]): [number, number] => [q[0] * k([q[0]], kx), q[1] * k([q[1]], ky)];
  return {
    ...ex,
    space: 'px',
    rooms: ex.rooms.map(r => {
      const xs = [r.approxBoxPx[0], r.approxBoxPx[2], ...(r.polygonPx ?? []).map(q => q[0])];
      const ys = [r.approxBoxPx[1], r.approxBoxPx[3], ...(r.polygonPx ?? []).map(q => q[1])];
      const sx = k(xs, kx), sy = k(ys, ky);
      return {
        ...r,
        approxBoxPx: [r.approxBoxPx[0] * sx, r.approxBoxPx[1] * sy, r.approxBoxPx[2] * sx, r.approxBoxPx[3] * sy],
        ...(r.polygonPx ? { polygonPx: r.polygonPx.map(q => [q[0] * sx, q[1] * sy] as [number, number]) } : {}),
      };
    }),
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
