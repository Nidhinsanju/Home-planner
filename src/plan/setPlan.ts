import { z } from 'zod';
import { emptyPlan, normalizeRoomType, Plan, ROOM_TYPES, Vec, WALL_DEFAULTS } from './types';
import { addOpening, addWall, newId, wallEnds } from './ops';
import { detectRooms } from './rooms';
import { closestOnSegment, dist, interiorPoint, pointInPolygon, signedArea } from './geometry';

// A whole plan in absolute coordinates (feet; x east, y south), as the AI's setPlan answer or
// the drawing reader (fromExtraction.ts) produces it. Rooms are polygons, so diagonal walls
// work. Each room's edges become walls; `walls` adds extra ones (room dividers, partitions)
// that doors and windows can refer to by id. Neighbouring rooms share walls automatically.

const ft = z.number().finite().min(-2000).max(2000);
const point = z.tuple([ft, ft]);

const opening = (defaultWidth: number) => z.object({
  wallId: z.string().optional().describe('id of a wall in "walls"; use with offsetFt'),
  offsetFt: z.number().min(0).optional().describe('distance from the wall\'s "from" end to the opening\'s centre'),
  at: point.optional().describe('alternative to wallId/offsetFt: a point on any wall (room edges included)'),
  widthFt: z.number().positive().max(16).default(defaultWidth),
});

export const SetPlanSchema = z.object({
  rooms: z.array(z.object({
    name: z.string().min(1).max(60),
    type: z.string().max(30).default('').describe(`one of ${ROOM_TYPES.map(t => t.id).join(', ')}`),
    polygon: z.array(point).min(3).max(40).describe('wall centre-line corners in order, [[x,y],...]'),
  })).max(80),
  walls: z.array(z.object({
    id: z.string().min(1).max(40),
    from: point,
    to: point,
    thickness: z.number().positive().max(3).optional(),
    divider: z.boolean().optional().describe('true for an open-plan boundary: not built in 3D'),
  })).max(400).default([]),
  doors: z.array(opening(3).extend({ swing: z.enum(['left', 'right']).optional() })).max(120).default([]),
  windows: z.array(opening(4)).max(120).default([]),
});

export type SetPlanPayload = z.infer<typeof SetPlanSchema>;
export type SetPlanCounts = { rooms: number; walls: number; doors: number; windows: number };
export type SetPlanResult = { plan: Plan; applied: SetPlanCounts; errors: string[] };

const SNAP_TO_WALL = 1.5; // feet; an opening's point must be this close to a wall

// Zod issues as short "path: message" lines, for the model to correct.
export const formatIssues = (error: z.ZodError) =>
  error.issues.slice(0, 12).map(i => `${i.path.join('.') || '(root)'}: ${i.message}`);

// Validates an unknown payload. Returns the parsed payload or the exact problems.
export function parseSetPlan(raw: unknown): { payload: SetPlanPayload } | { errors: string[] } {
  const res = SetPlanSchema.safeParse(raw);
  return res.success ? { payload: res.data } : { errors: formatIssues(res.error) };
}

const v = (p: [number, number]): Vec => ({ x: p[0], y: p[1] });

// Where a room's label goes: a point inside its polygon but not inside any other room's (a
// living room drawn around an open kitchen keeps its label out of the kitchen), as far from
// the edges as possible.
function labelPoint(poly: Vec[], others: Vec[][]): Vec {
  const inside = (p: Vec) => pointInPolygon(p, poly) && !others.some(o => pointInPolygon(p, o));
  const first = interiorPoint(poly);
  if (inside(first)) return first;
  const xs = poly.map(p => p.x), ys = poly.map(p => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const edgeDist = (p: Vec) => Math.min(...poly.map((a, i) => closestOnSegment(p, a, poly[(i + 1) % poly.length]).distance));
  let best: { p: Vec; d: number } | null = null;
  const N = 24;
  for (let i = 1; i < N; i++) {
    for (let j = 1; j < N; j++) {
      const p = { x: x0 + ((x1 - x0) * i) / N, y: y0 + ((y1 - y0) * j) / N };
      if (!inside(p)) continue;
      const d = edgeDist(p);
      if (!best || d > best.d) best = { p, d };
    }
  }
  return best?.p ?? first;
}

// Applies a payload. With `replace` the plan is rebuilt from scratch (the background image is
// kept); otherwise the payload is added to what is already drawn. Anything that can't be
// applied is reported in `errors` with its path in the payload, and the rest still applies.
export function applySetPlan(plan: Plan, payload: SetPlanPayload, opts: { replace: boolean; thickness?: number; height?: number }): SetPlanResult {
  const dims = { thickness: opts.thickness ?? WALL_DEFAULTS.thickness, height: opts.height ?? WALL_DEFAULTS.height };
  const errors: string[] = [];
  let next: Plan = opts.replace ? { ...emptyPlan(), ...(plan.background ? { background: plan.background } : {}) } : plan;
  const before = { walls: next.walls.length, openings: next.openings.length, labels: new Set(next.labels.map(l => l.id)) };

  // Extra walls first, so room edges along them reuse them (and keep them as dividers).
  const named = new Map<string, { from: Vec; to: Vec; divider: boolean }>();
  payload.walls.forEach((w, i) => {
    if (named.has(w.id)) errors.push(`walls.${i}.id: duplicate id "${w.id}"`);
    const from = v(w.from), to = v(w.to);
    if (dist(from, to) < 0.25) return errors.push(`walls.${i}: from and to are the same point`);
    named.set(w.id, { from, to, divider: !!w.divider });
    next = addWall(next, from, to, { ...dims, thickness: w.thickness ?? dims.thickness, ...(w.divider ? { divider: true } : {}) }).plan;
  });

  const newLabels: { id: string; path: string; name: string }[] = [];
  payload.rooms.forEach((r, i) => {
    const pts = r.polygon.map(v).filter((p, j, arr) => dist(p, arr[(j + 1) % arr.length]) > 0.05);
    if (pts.length < 3 || Math.abs(signedArea(pts)) < 4) return errors.push(`rooms.${i} "${r.name}": polygon has under 4 sq ft of area`);
    for (let j = 0; j < pts.length; j++) next = addWall(next, pts[j], pts[(j + 1) % pts.length], dims).plan;
    const id = newId('room');
    const type = normalizeRoomType(r.type) || normalizeRoomType(r.name);
    const others = payload.rooms.filter((_, k) => k !== i).map(o => o.polygon.map(v));
    next = { ...next, labels: [...next.labels, { id, ...labelPoint(pts, others), name: r.name, type }] };
    newLabels.push({ id, path: `rooms.${i}`, name: r.name });
  });

  // Doors and windows go on the nearest real (non-divider) wall to their point.
  const place = (kind: 'door' | 'window', o: { wallId?: string; offsetFt?: number; at?: [number, number]; widthFt: number; swing?: string }, path: string) => {
    let p: Vec;
    if (o.wallId != null) {
      const w = named.get(o.wallId);
      if (!w) return errors.push(`${path}.wallId: no wall "${o.wallId}" in walls`);
      if (w.divider) return errors.push(`${path}.wallId: "${o.wallId}" is a divider and can't hold a ${kind}`);
      const L = dist(w.from, w.to);
      const off = o.offsetFt ?? L / 2;
      if (off > L) return errors.push(`${path}.offsetFt: ${off} is past the end of wall "${o.wallId}" (${L.toFixed(1)} ft long)`);
      p = { x: w.from.x + ((w.to.x - w.from.x) * off) / L, y: w.from.y + ((w.to.y - w.from.y) * off) / L };
    } else if (o.at) {
      p = v(o.at);
    } else {
      return errors.push(`${path}: needs wallId (+ offsetFt) or at`);
    }
    let best: { id: string; d: number } | null = null;
    for (const w of next.walls) {
      if (w.divider) continue;
      const { a, b } = wallEnds(next, w);
      const d = closestOnSegment(p, a, b).distance;
      if (!best || d < best.d) best = { id: w.id, d };
    }
    if (!best || best.d > SNAP_TO_WALL) return errors.push(`${path}: (${p.x.toFixed(1)}, ${p.y.toFixed(1)}) is not on a wall`);
    const count = next.openings.length;
    next = addOpening(next, best.id, p, kind, { width: o.widthFt, ...(o.swing === 'right' ? { flip: true } : {}) });
    if (next.openings.length === count) errors.push(`${path}: could not place the ${kind}`);
  };
  payload.doors.forEach((d, i) => place('door', d, `doors.${i}`));
  payload.windows.forEach((w, i) => place('window', w, `windows.${i}`));

  // A room only counts if its walls actually enclose it.
  const enclosed = new Set(detectRooms(next).map(r => r.label?.id));
  for (const l of newLabels) if (!enclosed.has(l.id)) errors.push(`${l.path} "${l.name}": its walls don't enclose an area (overlapping or crossing another room?)`);

  const newOpenings = next.openings.slice(before.openings);
  return {
    plan: next,
    applied: {
      rooms: newLabels.filter(l => enclosed.has(l.id)).length,
      walls: next.walls.length - (opts.replace ? 0 : before.walls),
      doors: newOpenings.filter(o => o.kind === 'door').length,
      windows: newOpenings.filter(o => o.kind === 'window').length,
    },
    errors,
  };
}

// "Built 15 rooms, 48 walls, 11 doors and 9 windows." for chat replies.
export function describeCounts(c: SetPlanCounts) {
  const part = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  return `${part(c.rooms, 'room')}, ${part(c.walls, 'wall')}, ${part(c.doors, 'door')} and ${part(c.windows, 'window')}`;
}
