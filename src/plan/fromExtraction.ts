import type { Background, Vec } from './types';
import { WALL_DEFAULTS } from './types';
import { ExtractedRoom, Extraction, labeledSize } from './extraction';
import type { SetPlanPayload } from './setPlan';
import { closestOnSegment, pointInPolygon } from './geometry';
import { DarkMask, DrawingWalls } from './wallMask';

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
//
// With the drawing's pixels (a DarkMask, see wallMask.ts) two steps use the image itself:
// before 1, each room edge is moved onto the inside face of the wall drawn nearest to it (the
// model's boxes are often a foot or two off), and in 3, every room side where the drawing has
// no wall becomes a divider (open), whatever the model said, while exterior sides stay walls.

const EDGE_TOL = 1; // feet; box edges closer than this are the same wall line
const LABEL_WEIGHT = 50; // how much more a written size counts than a box position
const FOUND_WEIGHT = 200; // a box edge on a wall found in the image (counts more than a label)
const OPEN_WEIGHT = 0.05; // a box edge with no wall drawn there (only the model's guess)
const MAX_RATIO_SKEW = Math.log(1.25); // width and depth scales must agree within 25%

export type RoomCheck = { name: string; labeled: [number, number]; built: [number, number]; offBy: number };
export type DrawingLayout = {
  pxPerFt: number;
  scaleFrom: string[]; // rooms whose written size set the scale
  background: Pick<Background, 'x' | 'y' | 'width' | 'calibrated'>;
  payload: SetPlanPayload;
  checks: RoomCheck[]; // built interior size vs written size, for labelled rectangular rooms
  // Signs the reading was off: rooms built far from where the drawing has them (to fit their
  // written size), and rooms that overlap although a wall should be between them.
  warnings: string[];
};
const MAX_DRIFT = 1.5; // feet a built wall may sit from where the drawing has it before we warn

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
function solveAxis(lineCount: number, obs: { line: number; at: number; weight: number }[], spans: { a: number; b: number; length: number }[]) {
  const n = lineCount;
  const A = Array.from({ length: n }, () => new Array(n + 1).fill(0));
  for (const o of obs) {
    A[o.line][o.line] += o.weight;
    A[o.line][n] += o.weight * o.at;
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

// Which sides of a rectangular room the drawing has a wall on: [left, right] and [top, bottom].
type Faces = { x: [boolean, boolean]; y: [boolean, boolean] };

// Moves every room edge onto the inside face of the nearest wall drawn on the image (within
// 1.5 ft). Sides with no wall nearby (open to another room) stay where the model put them,
// except that two open sides facing each other within 2 ft meet in the middle, so open rooms
// touch instead of leaving a sliver between them.
function alignToWalls(ex: Extraction, walls: DrawingWalls, pxPerFt: number): { ex: Extraction; faces: Faces[] } {
  const reach = 1.5 * pxPerFt;
  const isPoly = (r: ExtractedRoom) => !!r.polygonPx && r.polygonPx.length >= 3 && r.polygonPx.length !== 4;
  const faces: Faces[] = [];
  const boxes = ex.rooms.map(r => norm(r.approxBoxPx));
  const rooms = ex.rooms.map((r, i) => {
    const f: Faces = { x: [false, false], y: [false, false] };
    faces.push(f);
    if (isPoly(r)) {
      const P = r.polygonPx!.map(p => [p[0], p[1]] as [number, number]);
      const poly = () => P.map(p => ({ x: p[0], y: p[1] }));
      for (let k = 0; k < P.length; k++) {
        const a = P[k], b = P[(k + 1) % P.length];
        const vertical = Math.abs(a[0] - b[0]) < 3, horizontal = Math.abs(a[1] - b[1]) < 3;
        if (vertical === horizontal || Math.hypot(b[0] - a[0], b[1] - a[1]) < pxPerFt) continue;
        const ax = vertical ? 0 : 1;
        const at = (a[ax] + b[ax]) / 2;
        const mid = vertical ? { x: at + 3, y: (a[1] + b[1]) / 2 } : { x: (a[0] + b[0]) / 2, y: at + 3 };
        const outward = pointInPolygon(mid, poly()) ? -1 : 1;
        const face = walls.findFace(vertical, at, a[1 - ax], b[1 - ax], outward, reach);
        if (face != null) a[ax] = b[ax] = face;
      }
      return { ...r, polygonPx: P };
    }
    const [x1, y1, x2, y2] = boxes[i];
    const fx = [walls.findFace(true, x1, y1, y2, -1, reach), walls.findFace(true, x2, y1, y2, 1, reach)];
    const fy = [walls.findFace(false, y1, x1, x2, -1, reach), walls.findFace(false, y2, x1, x2, 1, reach)];
    const box = [fx[0] ?? x1, fy[0] ?? y1, fx[1] ?? x2, fy[1] ?? y2];
    // A box squeezed under a foot across (a wall found inside the room) is not trusted.
    if (box[2] - box[0] < pxPerFt || box[3] - box[1] < pxPerFt) return r;
    f.x = [fx[0] != null, fx[1] != null];
    f.y = [fy[0] != null, fy[1] != null];
    boxes[i] = box;
    return r;
  });

  // Open sides facing each other meet in the middle.
  const gap = 2 * pxPerFt;
  for (let i = 0; i < boxes.length; i++) {
    for (let j = 0; j < boxes.length; j++) {
      if (i === j || isPoly(ex.rooms[i]) || isPoly(ex.rooms[j])) continue;
      const A = boxes[i], B = boxes[j];
      // B to the right of A (A's right side faces B's left side), then B below A.
      if (!faces[i].x[1] && !faces[j].x[0] && Math.abs(B[0] - A[2]) < gap && Math.min(A[3], B[3]) - Math.max(A[1], B[1]) > pxPerFt) {
        A[2] = B[0] = (A[2] + B[0]) / 2;
      }
      if (!faces[i].y[1] && !faces[j].y[0] && Math.abs(B[1] - A[3]) < gap && Math.min(A[2], B[2]) - Math.max(A[0], B[0]) > pxPerFt) {
        A[3] = B[1] = (A[3] + B[1]) / 2;
      }
    }
  }
  return {
    ex: { ...ex, rooms: rooms.map((r, i) => (isPoly(r) ? r : { ...r, approxBoxPx: boxes[i] as [number, number, number, number] })) },
    faces,
  };
}

export function layoutFromExtraction(ex: Extraction, image: { width: number; height: number }, thickness = WALL_DEFAULTS.thickness, mask?: DarkMask): DrawingLayout | { error: string } {
  // 1. Scale.
  let estimates = ex.rooms.map(r => ({ r, o: orientation(r) })).filter(e => e.o);
  if (estimates.length === 0) {
    return { error: 'No room on the drawing has a written size that matches its shape, so I can\'t work out the scale. Use Set scale on a wall you know the length of.' };
  }
  let pxPerFt = median(estimates.map(e => e.o!.scale));
  // With the image: line the rooms up with its walls, then measure the scale again from the
  // rooms' true inside sizes.
  const walls = mask && mask.width === image.width && mask.height === image.height ? DrawingWalls.of(mask, pxPerFt) : null;
  let faces: Faces[] | null = null;
  if (walls) {
    ({ ex, faces } = alignToWalls(ex, walls, pxPerFt));
    const exact = ex.rooms.map((r, i) => ({ r, o: orientation(r), i })).filter(e => e.o && faces![e.i].x.every(Boolean) && faces![e.i].y.every(Boolean));
    if (exact.length) pxPerFt = median(exact.map(e => e.o!.scale));
    estimates = ex.rooms.map(r => ({ r, o: orientation(r) })).filter(e => e.o);
  }
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
  const builtAsDrawn = new Set<string>(); // rooms whose written size doesn't match the drawing

  const axis =(lo: 'minX' | 'minY', hi: 'maxX' | 'maxY', size: 'across' | 'down') => {
    const values = rects.flatMap(q => [q[lo], q[hi]]);
    const { group, count } = clusterValues(values);
    const line = [...group];
    let lineCount = count;
    // A written size is kept to, unless the image shows both walls and the room as drawn is
    // more than a foot (and 8%) off it: then the label is wrong and the drawing wins.
    const both = (i: number) => !!faces && faces[i][size === 'across' ? 'x' : 'y'].every(Boolean);
    const spans = rects.flatMap((q, i) => {
      if (!q.o || isPolygon(q.r)) return [];
      const drawn = values[2 * i + 1] - values[2 * i] - thickness, written = q.o[size];
      if (both(i) && Math.abs(drawn - written) > Math.max(1, written * 0.08)) {
        builtAsDrawn.add(q.r.name);
        return [];
      }
      return [{ room: i, length: written + thickness }];
    });
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
    // How much each box edge holds its position: a wall seen on the image holds firm, an open
    // side (no wall drawn) gives way to the written size; without the image all count the same.
    const weight = (k: number) => (!faces ? 1 : faces[k >> 1][size === 'across' ? 'x' : 'y'][k & 1] ? FOUND_WEIGHT : OPEN_WEIGHT);
    const solve = () => solveAxis(lineCount, values.map((at, k) => ({ line: line[k], at, weight: weight(k) })), spans.map(s => ({ a: line[2 * s.room], b: line[2 * s.room + 1], length: s.length })));
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

  // Overlapping rectangles: the larger room (usually a hallway or living room drawn as one big
  // box over its neighbours) keeps only the floor the others leave, so no wall of it runs
  // through another room.
  const carved = new Set<number>();
  const rectIdx = ex.rooms.map((r, i) => i).filter(i => !isPolygon(ex.rooms[i]));
  const area = (i: number) => (X.at(i, 1) - X.at(i, 0)) * (Y.at(i, 1) - Y.at(i, 0));
  const overlaps = (i: number, j: number) =>
    Math.min(X.at(i, 1), X.at(j, 1)) - Math.max(X.at(i, 0), X.at(j, 0)) > thickness + 0.5
    && Math.min(Y.at(i, 1), Y.at(j, 1)) - Math.max(Y.at(i, 0), Y.at(j, 0)) > thickness + 0.5;
  for (const i of [...rectIdx].sort((a, b) => area(b) - area(a))) {
    const inside = rectIdx.filter(j => j !== i && !carved.has(j) && area(j) < area(i) && overlaps(i, j));
    if (!inside.length) continue;
    const box = (k: number): Box => [X.at(k, 0), Y.at(k, 0), X.at(k, 1), Y.at(k, 1)];
    const outline = subtractBoxes(box(i), inside.map(box));
    if (!outline) continue;
    polygons[i] = outline;
    carved.add(i);
  }

  const round = (n: number) => Math.round(n * 1000) / 1000;
  const pt = (p: Vec): [number, number] => [round(p.x), round(p.y)];
  const payload: SetPlanPayload = {
    rooms: ex.rooms.map((r, i) => ({ name: r.name, type: r.type || '', polygon: polygons[i].map(pt) })),
    walls: [],
    doors: [],
    windows: [],
  };

  const byName = new Map(ex.rooms.map((r, i) => [key(r.name), i]));

  // Doors and windows: the model's points are often a foot or two off (or at the middle of a
  // door's swing), so each goes on the wall of the rooms it belongs to: a door on the wall its
  // two rooms share, a window on its room's wall on the side the model named.
  const isCloset = (name: string) => /closet|wardrobe|mech|linen|pantry|laundry/i.test(name);
  for (const d of ex.doors) {
    const widthFt = d.between.some(isCloset) ? 2.5 : 3;
    const [i, j] = d.between.map(n => byName.get(key(n)));
    const own = [i, j].filter((k): k is number => k != null);
    const seen = toFt(d.approxPx);
    const shared = i != null && j != null ? sharedEdges(polygons[i], polygons[j]) : [];
    let at = snapToEdges(seen, shared.length ? shared : own.flatMap(k => edgesOf(polygons[k])), widthFt);
    // A shared wall far from where the door is drawn means the model's outlines overlap (a
    // hallway drawn over a laundry): the nearest wall of either room is likelier.
    if (shared.length && Math.hypot(at.x - seen.x, at.y - seen.y) > 3) at = snapToEdges(seen, own.flatMap(k => edgesOf(polygons[k])), widthFt);
    payload.doors.push({ at: pt(at), widthFt });
  }
  // The entry is usually also in the door list ("outside"); it then widens that door instead.
  if (ex.entry) {
    const at = toFt(ex.entry.approxPx);
    const same = payload.doors.find(d => d.at && Math.hypot(d.at[0] - at.x, d.at[1] - at.y) < 2);
    if (same) same.widthFt = 3.5;
    else payload.doors.push({ at: pt(at), widthFt: 3.5 });
  }
  for (const w of ex.windows) {
    const i = byName.get(key(w.room));
    const edges = i == null ? [] : edgesOf(polygons[i]);
    const side = edges.filter(e => onSide(e, polygons[i!], w.wallSide));
    payload.windows.push({ at: pt(snapToEdges(toFt(w.approxPx), side.length ? side : edges, 4)), widthFt: 4 });
  }

  // 3. Open sides become dividers (drawn in 2D, not built in 3D).
  const open: [Vec, Vec][] = [];
  if (walls) {
    // From the image: every stretch of a room's outline where the drawing has no wall, except
    // door openings and the outside of the building (window bands look open but aren't).
    const doorsAt = payload.doors.map(d => v(d.at!));
    polygons.forEach(P => {
      for (const [a, b] of edgesOf(P)) for (const run of openRuns(a, b, P, walls, pxPerFt, origin, doorsAt)) addSegment(open, run);
    });
  } else {
    // From the model: where it says rooms open into each other, the shared stretch of their
    // outlines, and the edges of one that lie inside the other (a kitchen drawn inside an
    // L-shaped living room).
    const seen = new Set<string>();
    ex.rooms.forEach((r, i) => {
      for (const other of r.openTo) {
        const j = byName.get(key(other));
        if (j == null || j === i || seen.has(`${Math.min(i, j)}|${Math.max(i, j)}`)) continue;
        seen.add(`${Math.min(i, j)}|${Math.max(i, j)}`);
        for (const s of [...sharedEdges(polygons[i], polygons[j]), ...edgesInside(polygons[i], polygons[j]), ...edgesInside(polygons[j], polygons[i])]) addSegment(open, s);
      }
    });
  }
  for (const [from, to] of open) payload.walls.push({ id: `divider-${payload.walls.length + 1}`, from: pt(from), to: pt(to), divider: true });

  // Built interior size vs written size.
  const checks: RoomCheck[] = rects.flatMap((q, i) => {
    if (!q.o || isPolygon(q.r) || carved.has(i)) return [];
    const across = X.at(i, 1) - X.at(i, 0) - thickness, down = Y.at(i, 1) - Y.at(i, 0) - thickness;
    const size = labeledSize(q.r)!;
    const built: [number, number] = q.o.across === size[0] ? [across, down] : [down, across];
    return [{ name: q.r.name, labeled: size, built, offBy: Math.max(Math.abs(built[0] - size[0]), Math.abs(built[1] - size[1])) }];
  });

  const warnings: string[] = [...builtAsDrawn].map(name => `${name} is built as drawn, because its written size doesn't match the drawing`);
  rects.forEach((q, i) => {
    if (isPolygon(q.r)) return;
    // With the image, only sides on a wall it shows count (an open side's position is a guess).
    const seen = (ax: 'x' | 'y', end: 0 | 1) => !faces || faces[i][ax][end];
    const drift = Math.max(
      seen('x', 0) ? Math.abs(X.at(i, 0) - q.minX) : 0, seen('x', 1) ? Math.abs(X.at(i, 1) - q.maxX) : 0,
      seen('y', 0) ? Math.abs(Y.at(i, 0) - q.minY) : 0, seen('y', 1) ? Math.abs(Y.at(i, 1) - q.maxY) : 0,
    );
    if (drift > MAX_DRIFT) warnings.push(`${q.r.name} was moved ${drift.toFixed(1)} ft from where the drawing has it to fit its written size`);
  });
  const opens = (i: number, j: number) => [...ex.rooms[i].openTo, ...ex.rooms[j].openTo].some(n => n && (key(n) === key(ex.rooms[i].name) || key(n) === key(ex.rooms[j].name)));
  for (let i = 0; i < ex.rooms.length; i++) {
    for (let j = i + 1; j < ex.rooms.length; j++) {
      if (isPolygon(ex.rooms[i]) || isPolygon(ex.rooms[j]) || carved.has(i) || carved.has(j) || opens(i, j)) continue;
      const w = Math.min(X.at(i, 1), X.at(j, 1)) - Math.max(X.at(i, 0), X.at(j, 0));
      const h = Math.min(Y.at(i, 1), Y.at(j, 1)) - Math.max(Y.at(i, 0), Y.at(j, 0));
      if (w > thickness + 0.5 && h > thickness + 0.5) warnings.push(`${ex.rooms[i].name} and ${ex.rooms[j].name} overlap`);
    }
  }

  return {
    pxPerFt,
    scaleFrom: estimates.map(e => e.r.name),
    background: { x: origin.x, y: origin.y, width: image.width / pxPerFt, calibrated: true },
    payload,
    checks,
    warnings,
  };
}

type Box = [number, number, number, number]; // minX, minY, maxX, maxY

// The outline of box A minus the boxes `cuts`: the largest connected piece left, as a polygon
// along the boxes' own edges (so it shares them exactly with the rooms cut out). Null if under
// a quarter of A is left (the overlap is more likely a misread than a room drawn around others).
function subtractBoxes(A: Box, cuts: Box[]): Vec[] | null {
  const clip = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const uniq = (vs: number[]) => [...new Set(vs.map(x => Math.round(x * 1000) / 1000))].sort((a, b) => a - b);
  const xs = uniq([A[0], A[2], ...cuts.flatMap(c => [clip(c[0], A[0], A[2]), clip(c[2], A[0], A[2])])]);
  const ys = uniq([A[1], A[3], ...cuts.flatMap(c => [clip(c[1], A[1], A[3]), clip(c[3], A[1], A[3])])]);
  const W = xs.length - 1, H = ys.length - 1;
  const free = (i: number, j: number) => {
    const cx = (xs[i] + xs[i + 1]) / 2, cy = (ys[j] + ys[j + 1]) / 2;
    return !cuts.some(c => cx > c[0] && cx < c[2] && cy > c[1] && cy < c[3]);
  };
  const cell = (i: number, j: number) => j * W + i;
  const comp = new Int32Array(W * H).fill(-1);
  const areas: number[] = [];
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      if (comp[cell(i, j)] !== -1 || !free(i, j)) continue;
      const id = areas.length;
      let a = 0;
      const stack = [[i, j]];
      comp[cell(i, j)] = id;
      while (stack.length) {
        const [ci, cj] = stack.pop()!;
        a += (xs[ci + 1] - xs[ci]) * (ys[cj + 1] - ys[cj]);
        for (const [ni, nj] of [[ci + 1, cj], [ci - 1, cj], [ci, cj + 1], [ci, cj - 1]]) {
          if (ni < 0 || nj < 0 || ni >= W || nj >= H || comp[cell(ni, nj)] !== -1 || !free(ni, nj)) continue;
          comp[cell(ni, nj)] = id;
          stack.push([ni, nj]);
        }
      }
      areas.push(a);
    }
  }
  if (!areas.length) return null;
  const best = areas.indexOf(Math.max(...areas));
  if (areas[best] < 0.25 * (A[2] - A[0]) * (A[3] - A[1])) return null;
  const isIn = (i: number, j: number) => i >= 0 && j >= 0 && i < W && j < H && comp[cell(i, j)] === best;

  // Boundary edges of the piece, clockwise (y down), as grid corners "i,j"; then chained.
  const next = new Map<string, string>();
  const k = (i: number, j: number) => `${i},${j}`;
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      if (!isIn(i, j)) continue;
      if (!isIn(i, j - 1)) next.set(k(i, j), k(i + 1, j));
      if (!isIn(i + 1, j)) next.set(k(i + 1, j), k(i + 1, j + 1));
      if (!isIn(i, j + 1)) next.set(k(i + 1, j + 1), k(i, j + 1));
      if (!isIn(i - 1, j)) next.set(k(i, j + 1), k(i, j));
    }
  }
  // The outer loop starts at the top-left-most corner of the piece.
  let start = '';
  for (let j = 0; j < H && !start; j++) for (let i = 0; i < W && !start; i++) if (isIn(i, j)) start = k(i, j);
  const loop: Vec[] = [];
  let at = start;
  do {
    const [i, j] = at.split(',').map(Number);
    loop.push({ x: xs[i], y: ys[j] });
    at = next.get(at)!;
  } while (at && at !== start && loop.length <= 4 * W * H + 4);
  // Drop corners in the middle of a straight run.
  return loop.filter((p, n) => {
    const a = loop[(n + loop.length - 1) % loop.length], b = loop[(n + 1) % loop.length];
    return Math.abs((p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x)) > 1e-9;
  });
}

const edgesOf = (P: Vec[]) => P.map((p, i) => [p, P[(i + 1) % P.length]] as [Vec, Vec]);
const v = (p: [number, number]): Vec => ({ x: p[0], y: p[1] });

// Adds a segment to a list, merging it with one already there on the same line that it
// overlaps (two rooms report the same open side).
function addSegment(list: [Vec, Vec][], [a, b]: [Vec, Vec]) {
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  if (L < 0.5) return;
  const u = { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
  for (const s of list) {
    const off = (p: Vec) => Math.abs((p.x - a.x) * u.y - (p.y - a.y) * u.x);
    if (off(s[0]) > 0.1 || off(s[1]) > 0.1) continue;
    const t = (p: Vec) => (p.x - a.x) * u.x + (p.y - a.y) * u.y;
    const lo = Math.min(t(s[0]), t(s[1])), hi = Math.max(t(s[0]), t(s[1]));
    if (hi < -0.1 || lo > L + 0.1) continue;
    const from = Math.min(0, lo), to = Math.max(L, hi);
    s[0] = { x: a.x + u.x * from, y: a.y + u.y * from };
    s[1] = { x: a.x + u.x * to, y: a.y + u.y * to };
    return;
  }
  list.push([a, b]);
}

const MIN_OPEN = 2; // feet; shorter gaps in a wall line are doors or drawing noise
const DOOR_KEEP = 2.25; // feet of wall kept either side of a door's centre

// Stretches of the room edge a-b (feet, on polygon P) where the drawing has no wall: at least
// MIN_OPEN long, with no door in them, and not facing the outside of the building.
function openRuns(a: Vec, b: Vec, P: Vec[], walls: DrawingWalls, pxPerFt: number, origin: Vec, doors: Vec[]): [Vec, Vec][] {
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  if (L < MIN_OPEN) return [];
  const u = { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  let n = { x: u.y, y: -u.x };
  if (pointInPolygon({ x: mid.x + n.x * 0.3, y: mid.y + n.y * 0.3 }, P)) n = { x: -n.x, y: -n.y };
  const px = (p: Vec) => ({ x: (p.x - origin.x) * pxPerFt, y: (p.y - origin.y) * pxPerFt });
  // A wall drawn within 0.6 ft either side of the edge line counts.
  const band = Math.max(3, Math.round(0.6 * pxPerFt));
  const solid = (t: number) => {
    const q = px({ x: a.x + u.x * t, y: a.y + u.y * t });
    for (let k = -band; k <= band; k += 2) if (walls.wallNear(q.x + n.x * k, q.y + n.y * k, 1)) return true;
    return false;
  };
  const step = 0.25, end = 0.4; // skip the corners: the walls of the rooms around run into them
  const runs: [number, number][] = [];
  let start: number | null = null;
  for (let t = end; t <= L - end + 1e-9; t += step) {
    if (!solid(t)) start ??= t;
    else if (start != null) { runs.push([start, t - step]); start = null; }
  }
  if (start != null) runs.push([start, L - end]);
  // A door keeps a stretch of wall around it (it needs a wall to sit in); the rest stays open.
  const doorSpans = doors
    .filter(d => Math.abs((d.x - a.x) * u.y - (d.y - a.y) * u.x) < 0.75)
    .map(d => (d.x - a.x) * u.x + (d.y - a.y) * u.y)
    .map(t => [t - DOOR_KEEP, t + DOOR_KEEP] as [number, number]);
  const minus = (run: [number, number]) => doorSpans.reduce<[number, number][]>((pieces, [ds, de]) => pieces.flatMap(([s, e]) => {
    if (de <= s || ds >= e) return [[s, e]];
    return [[s, ds], [de, e]].filter(([x, y]) => y > x) as [number, number][];
  }), [run]);
  return runs
    .map(([s, e]) => [s <= end ? 0 : s, e >= L - end - 1e-9 ? L : e] as [number, number])
    .flatMap(minus)
    .filter(([s, e]) => e - s >= MIN_OPEN)
    .filter(([s, e]) => {
      const q = px({ x: a.x + u.x * (s + e) / 2, y: a.y + u.y * (s + e) / 2 });
      return !walls.leadsOutside(q.x, q.y, n.x, n.y);
    })
    .map(([s, e]) => [{ x: a.x + u.x * s, y: a.y + u.y * s }, { x: a.x + u.x * e, y: a.y + u.y * e }]);
}

// The point on the nearest of `edges` closest to p, kept far enough from the edge's ends for an
// opening `width` wide to fit (when the edge is long enough). p itself if there are no edges.
function snapToEdges(p: Vec, edges: [Vec, Vec][], width: number): Vec {
  let best: { q: Vec; d: number } | null = null;
  for (const [a, b] of edges) {
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    if (L < 0.5) continue;
    const u = { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
    const margin = Math.min(L / 2, width / 2 + 0.25);
    const t = Math.min(L - margin, Math.max(margin, (p.x - a.x) * u.x + (p.y - a.y) * u.y));
    const q = { x: a.x + u.x * t, y: a.y + u.y * t };
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (!best || d < best.d) best = { q, d };
  }
  return best?.q ?? p;
}

// Whether an edge of polygon P faces `side` (north = up the image). Any edge if side is unknown.
function onSide([a, b]: [Vec, Vec], P: Vec[], side: string) {
  const s = side.toLowerCase();
  const c = { x: P.reduce((t, p) => t + p.x, 0) / P.length, y: P.reduce((t, p) => t + p.y, 0) / P.length };
  const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const horizontal = Math.abs(b.y - a.y) < Math.abs(b.x - a.x);
  if (/north|top/.test(s)) return horizontal && m.y < c.y;
  if (/south|bottom/.test(s)) return horizontal && m.y > c.y;
  if (/east|right/.test(s)) return !horizontal && m.x > c.x;
  if (/west|left/.test(s)) return !horizontal && m.x < c.x;
  return true;
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
