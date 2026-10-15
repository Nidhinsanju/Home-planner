import type { Background, Vec } from './types';
import { WALL_DEFAULTS } from './types';
import { ExtractedRoom, Extraction, labeledSize } from './extraction';
import type { SetPlanPayload } from './setPlan';
import { closestOnSegment, pointInPolygon } from './geometry';

// Step B of building from a drawing, done in code rather than by the AI: turns what the vision
// model read (pixels) into a plan in feet.
//
// 1. Scale: each room with a written size gives a px-per-foot estimate (its box size divided
//    by its written size, in whichever orientation fits better); the median is used.
// 2. Layout: room boxes become wall centre-lines (box edge + half a wall). Edges that nearly
//    line up are one wall, and their positions are solved by least squares so that every
//    labelled room comes out at its written size while staying where the drawing has it.
// 3. Rooms with no wall between them (openTo) get a room divider; doors, windows and the
//    entry are placed at their points on the nearest wall.

const EDGE_TOL = 1; // feet; box edges closer than this are the same wall line
const LABEL_WEIGHT = 50; // how much more a written size counts than a box position
const MAX_RATIO_SKEW = Math.log(1.25); // width and depth scales must agree within 25%

export type RoomCheck = { name: string; labeled: [number, number]; built: [number, number]; offBy: number };
export type DrawingLayout = {
  pxPerFt: number;
  scaleFrom: string[]; // rooms whose written size set the scale
  background: Pick<Background, 'x' | 'y' | 'width' | 'calibrated'>;
  payload: SetPlanPayload;
  checks: RoomCheck[]; // built interior size vs written size, for labelled rectangular rooms
};

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const norm = (box: number[]) => [Math.min(box[0], box[2]), Math.min(box[1], box[3]), Math.max(box[0], box[2]), Math.max(box[1], box[3])];
const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Which written dimension runs across (x) the drawing: 'wd' = width across, 'dw' = depth across.
function orientation(r: ExtractedRoom): { scale: number; across: number; down: number } | null {
  const size = labeledSize(r);
  if (!size) return null;
  const [x1, y1, x2, y2] = norm(r.approxBoxPx);
  const bw = x2 - x1, bh = y2 - y1;
  if (bw <= 0 || bh <= 0) return null;
  const [w, d] = size;
  const options = [
    { across: w, down: d, sx: bw / w, sy: bh / d },
    { across: d, down: w, sx: bw / d, sy: bh / w },
  ].map(o => ({ ...o, skew: Math.abs(Math.log(o.sx / o.sy)) }));
  const best = options[0].skew <= options[1].skew ? options[0] : options[1];
  if (best.skew > MAX_RATIO_SKEW) return null;
  return { scale: Math.sqrt(best.sx * best.sy), across: best.across, down: best.down };
}

// Least squares on one axis. Each observation pulls a line to a position; each labelled room
// pulls the distance between two lines to its size.
function solveAxis(lineCount: number, obs: { line: number; at: number }[], spans: { a: number; b: number; length: number }[]) {
  const n = lineCount;
  const A = Array.from({ length: n }, () => new Array(n + 1).fill(0));
  for (const o of obs) {
    A[o.line][o.line] += 1;
    A[o.line][n] += o.at;
  }
  for (const s of spans) {
    // LABEL_WEIGHT * (x_b - x_a - length)^2
    const w = LABEL_WEIGHT;
    A[s.a][s.a] += w; A[s.b][s.b] += w;
    A[s.a][s.b] -= w; A[s.b][s.a] -= w;
    A[s.b][n] += w * s.length; A[s.a][n] -= w * s.length;
  }
  for (let i = 0; i < n; i++) A[i][i] += 1e-6;
  // Gaussian elimination with partial pivoting.
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < n; r++) {
      if (r === c || A[r][c] === 0) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k <= n; k++) A[r][k] -= f * A[c][k];
    }
  }
  return A.map((row, i) => row[n] / row[i]);
}

// Groups nearby values; returns each value's group index and the group count.
function clusterValues(values: number[]) {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const group = new Array<number>(values.length);
  let g = -1, last = -Infinity;
  for (const { v, i } of order) {
    if (v - last >= EDGE_TOL) g++;
    group[i] = g;
    last = v;
  }
  return { group, count: g + 1 };
}

export function layoutFromExtraction(ex: Extraction, image: { width: number; height: number }, thickness = WALL_DEFAULTS.thickness): DrawingLayout | { error: string } {
  // 1. Scale.
  const estimates = ex.rooms.map(r => ({ r, o: orientation(r) })).filter(e => e.o);
  if (estimates.length === 0) {
    return { error: 'No room on the drawing has a written size that matches its shape, so I can\'t work out the scale. Use Set scale on a wall you know the length of.' };
  }
  const pxPerFt = median(estimates.map(e => e.o!.scale));
  // The image is centred on the plan's origin.
  const origin = { x: -image.width / pxPerFt / 2, y: -image.height / pxPerFt / 2 };
  const toFt = (p: [number, number]): Vec => ({ x: origin.x + p[0] / pxPerFt, y: origin.y + p[1] / pxPerFt });
  const half = thickness / 2;

  // 2. Rectangular rooms: box edges, widened to wall centre-lines.
  const rects = ex.rooms.map(r => {
    const [x1, y1, x2, y2] = norm(r.approxBoxPx);
    const a = toFt([x1, y1]), b = toFt([x2, y2]);
    const o = orientation(r);
    return { r, o, minX: a.x - half, maxX: b.x + half, minY: a.y - half, maxY: b.y + half };
  });
  const isPolygon = (r: ExtractedRoom) => !!r.polygonPx && r.polygonPx.length >= 3 && r.polygonPx.length !== 4;

  const axis = (lo: 'minX' | 'minY', hi: 'maxX' | 'maxY', size: 'across' | 'down') => {
    const values = rects.flatMap(q => [q[lo], q[hi]]);
    const { group, count } = clusterValues(values);
    const line = [...group];
    let lineCount = count;
    const spans = rects.flatMap((q, i) => (q.o && !isPolygon(q.r) ? [{ room: i, length: q.o[size] + thickness }] : []));
    // Two labelled rooms on the same pair of lines with different written sizes can't both be
    // right: the one whose box fits its label worse gets its own line for the edge it shares
    // with fewer rooms, so both come out at their written size.
    const pairs = new Map<string, typeof spans>();
    for (const s of spans) {
      const k = `${line[2 * s.room]}|${line[2 * s.room + 1]}`;
      pairs.set(k, [...(pairs.get(k) ?? []), s]);
    }
    // Gives a room its own line for the edge it shares with fewer rooms (if either is shared).
    const free = (room: number) => {
      const shared = (end: number) => line.filter(l => l === line[2 * room + end]).length;
      const end = shared(0) <= shared(1) ? 0 : 1;
      if (shared(end) > 1) line[2 * room + end] = lineCount++;
      else if (shared(1 - end) > 1) line[2 * room + 1 - end] = lineCount++;
    };
    for (const group of pairs.values()) {
      if (group.length < 2 || Math.max(...group.map(s => s.length)) - Math.min(...group.map(s => s.length)) <= 0.5) continue;
      const misfit = (s: (typeof spans)[number]) => Math.abs(values[2 * s.room + 1] - values[2 * s.room] - s.length);
      const [, ...others] = [...group].sort((a, b) => misfit(a) - misfit(b));
      for (const s of others) free(s.room);
    }
    const solve = () => solveAxis(lineCount, values.map((at, i) => ({ line: line[i], at })), spans.map(s => ({ a: line[2 * s.room], b: line[2 * s.room + 1], length: s.length })));
    let pos = solve();
    // Rooms still more than 6 in off their written size (loose boxes pulling shared wall lines
    // different ways) get their own line and the axis is solved again.
    for (let round = 0; round < 3; round++) {
      const off = spans.filter(s => Math.abs(pos[line[2 * s.room + 1]] - pos[line[2 * s.room]] - s.length) > 0.5);
      if (off.length === 0) break;
      const before = lineCount;
      off.forEach(s => free(s.room));
      if (lineCount === before) break;
      pos = solve();
    }
    return { lines: pos, at: (i: number, end: 0 | 1) => pos[line[2 * i + end]] };
  };
  const X = axis('minX', 'maxX', 'across');
  const Y = axis('minY', 'maxY', 'down');
  // Snaps a free coordinate (a polygon corner) onto a solved wall line when it is close.
  const snap = (lines: number[], value: number) => {
    let best = value, d = EDGE_TOL;
    for (const l of lines) if (Math.abs(l - value) < d) { d = Math.abs(l - value); best = l; }
    return best;
  };

  const polygons: Vec[][] = ex.rooms.map((r, i) => {
    if (isPolygon(r)) {
      return r.polygonPx!.map(p => toFt(p)).map(p => ({ x: snap(X.lines, p.x), y: snap(Y.lines, p.y) }));
    }
    const x1 = X.at(i, 0), x2 = X.at(i, 1), y1 = Y.at(i, 0), y2 = Y.at(i, 1);
    return [{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }];
  });

  const round = (n: number) => Math.round(n * 1000) / 1000;
  const pt = (p: Vec): [number, number] => [round(p.x), round(p.y)];
  const payload: SetPlanPayload = {
    rooms: ex.rooms.map((r, i) => ({ name: r.name, type: r.type || '', polygon: polygons[i].map(pt) })),
    walls: [],
    doors: [],
    windows: [],
  };

  // 3. Dividers where rooms open into each other: the shared stretch of their outlines, and the
  //    edges of one that lie inside the other (a kitchen drawn inside an L-shaped living room).
  const byName = new Map(ex.rooms.map((r, i) => [key(r.name), i]));
  const seen = new Set<string>();
  ex.rooms.forEach((r, i) => {
    for (const other of r.openTo) {
      const j = byName.get(key(other));
      if (j == null || j === i || seen.has(`${Math.min(i, j)}|${Math.max(i, j)}`)) continue;
      seen.add(`${Math.min(i, j)}|${Math.max(i, j)}`);
      const open = [...sharedEdges(polygons[i], polygons[j]), ...edgesInside(polygons[i], polygons[j]), ...edgesInside(polygons[j], polygons[i])];
      for (const [from, to] of open) {
        payload.walls.push({ id: `divider-${payload.walls.length + 1}`, from: pt(from), to: pt(to), divider: true });
      }
    }
  });

  const isCloset = (name: string) => /closet|wardrobe|mech|linen|pantry|laundry/i.test(name);
  for (const d of ex.doors) payload.doors.push({ at: pt(toFt(d.approxPx)), widthFt: d.between.some(isCloset) ? 2.5 : 3 });
  if (ex.entry) payload.doors.push({ at: pt(toFt(ex.entry.approxPx)), widthFt: 3.5 });
  for (const w of ex.windows) payload.windows.push({ at: pt(toFt(w.approxPx)), widthFt: 4 });

  // Built interior size vs written size.
  const checks: RoomCheck[] = rects.flatMap((q, i) => {
    if (!q.o || isPolygon(q.r)) return [];
    const across = X.at(i, 1) - X.at(i, 0) - thickness, down = Y.at(i, 1) - Y.at(i, 0) - thickness;
    const size = labeledSize(q.r)!;
    const built: [number, number] = q.o.across === size[0] ? [across, down] : [down, across];
    return [{ name: q.r.name, labeled: size, built, offBy: Math.max(Math.abs(built[0] - size[0]), Math.abs(built[1] - size[1])) }];
  });

  return {
    pxPerFt,
    scaleFrom: estimates.map(e => e.r.name),
    background: { x: origin.x, y: origin.y, width: image.width / pxPerFt, calibrated: true },
    payload,
    checks,
  };
}

// Edges of polygon A that run through the inside of polygon B.
function edgesInside(A: Vec[], B: Vec[]): [Vec, Vec][] {
  return A.map((p, i) => [p, A[(i + 1) % A.length]] as [Vec, Vec])
    .filter(([a, b]) => Math.hypot(b.x - a.x, b.y - a.y) >= 0.5 && pointInPolygon({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, B)
      && !B.some((q, k) => closestOnSegment({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, q, B[(k + 1) % B.length]).distance < 0.05));
}

// Stretches where an edge of polygon A lies on an edge of polygon B (same line, overlapping).
function sharedEdges(A: Vec[], B: Vec[]): [Vec, Vec][] {
  const out: [Vec, Vec][] = [];
  const edges = (P: Vec[]) => P.map((p, i) => [p, P[(i + 1) % P.length]] as [Vec, Vec]);
  for (const [a1, a2] of edges(A)) {
    const L = Math.hypot(a2.x - a1.x, a2.y - a1.y);
    if (L < 0.5) continue;
    const u = { x: (a2.x - a1.x) / L, y: (a2.y - a1.y) / L };
    const offLine = (p: Vec) => Math.abs((p.x - a1.x) * u.y - (p.y - a1.y) * u.x);
    const along = (p: Vec) => (p.x - a1.x) * u.x + (p.y - a1.y) * u.y;
    for (const [b1, b2] of edges(B)) {
      if (offLine(b1) > 0.05 || offLine(b2) > 0.05) continue;
      const lo = Math.max(0, Math.min(along(b1), along(b2)));
      const hi = Math.min(L, Math.max(along(b1), along(b2)));
      if (hi - lo < 0.5) continue;
      out.push([{ x: a1.x + u.x * lo, y: a1.y + u.y * lo }, { x: a1.x + u.x * hi, y: a1.y + u.y * hi }]);
    }
  }
  return out;
}
