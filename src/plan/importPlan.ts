import type { Plan, Vec } from './types';
import { emptyPlan, normalizeRoomType, WALL_DEFAULTS } from './types';
import { applySetPlan, describeCounts, formatIssues, SetPlanSchema, type SetPlanPayload } from './setPlan';
import { parseSizeLabel } from './extraction';
import { sharedEdges, solveAxis } from './fromExtraction';
import { closestOnSegment, pointInPolygon } from './geometry';

// Takes a floor plan written as JSON by someone else, usually another AI (or this app's own
// "Download Plan JSON"), and turns it into a plan without breaking on the small ways such JSON
// differs from ours. Accepted:
//   - this app's saved plan (version 2: corners, walls, openings, labels, items);
//   - the setPlan shape (rooms as polygons, walls, doors, windows), and its common variants:
//     walls with start/end or a/b, thickness or thicknessFt, points as [x, y] or {x, y} or a
//     corner id from a "corners" list or map, openings given by wallId + offset, extra fields
//     (names, swings, types) ignored, the whole thing wrapped in {plan}, {floor} or {data};
//   - sizes in mm, cm, m or inches when a "unit" says so (or when the numbers are clearly mm).
// Then the geometry is tidied the way a drawing is read:
//   - coordinates within ~3 in of each other are one wall line;
//   - a plan drawn to the INSIDE faces of its walls (neighbouring rooms consistently a wall's
//     thickness apart) is turned into wall centre-lines, the way this app draws walls;
//   - rooms with a written size ("size": "12' 6\" x 11' 6\"", or widthFt/depthFt) come out at
//     exactly that inside size: the wall lines are solved like the drawing reader does;
//   - rooms listed in a room's "openTo" get an open divider between them instead of a wall. When
//     the JSON says nothing about it, kitchen, living, dining and hallway are open to each other
//     wherever no door is drawn between them (as on most floor plans).

export type ImportResult = { plan: Plan; message: string; notes: string[] } | { error: string };

type Pt = [number, number];
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : typeof v === 'number' ? v : NaN);

const UNITS: Record<string, number> = { ft: 1, feet: 1, foot: 1, in: 1 / 12, inch: 1 / 12, inches: 1 / 12, mm: 1 / 304.8, millimeter: 1 / 304.8, millimetre: 1 / 304.8, cm: 1 / 30.48, m: 3.28084, meter: 3.28084, metre: 3.28084 };
const SNAP = 0.25; // feet; coordinates closer than this on the same axis are one line
const FACE_GAP = 1.25; // feet; the widest wall a plan drawn to inside faces is read with
const EXACT = 1 / 48; // feet; a written size further off than this is reported
const OPEN_TYPES = new Set(['kitchen', 'living', 'dining', 'hallway']);
const MAX_PLAN_FT = 500; // no house is bigger: larger numbers must be mm

// The JSON in a pasted text (code fences and prose around it are fine), or null.
export function parseJsonText(text: string): unknown {
  const t = text.trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch {
    return null;
  }
}

// Whether a value looks like a floor plan (so a pasted chat message can be applied directly).
export function looksLikePlan(raw: unknown): boolean {
  const b = unwrap(raw).body;
  return isObj(b) && (Array.isArray(b.rooms) || (b.version === 2 && Array.isArray(b.walls)));
}

// Finds the plan inside wrappers like {plan: ...}, {floor: ...}, {project, floor}, {data: {plan}}.
function unwrap(raw: unknown): { body: any; unit?: string } {
  let body: any = raw;
  let unit: string | undefined;
  for (let i = 0; i < 4 && isObj(body); i++) {
    unit ??= body.unit ?? body.units ?? body.project?.unit ?? body.project?.units;
    if (Array.isArray(body.rooms) || Array.isArray(body.walls) || Array.isArray(body.corners)) break;
    body = body.plan ?? body.floor ?? body.data ?? body.layout ?? body.floorPlan ?? body.floorplan;
  }
  return { body, unit: typeof unit === 'string' ? unit : undefined };
}

// Plans in this app's own format: kept as they are, with anything broken left out.
function fromSavedPlan(current: Plan, p: any): { plan: Plan; dropped: number } {
  const corners = (Array.isArray(p.corners) ? p.corners : []).filter((c: any) => c && typeof c.id === 'string' && Number.isFinite(num(c.x)) && Number.isFinite(num(c.y)))
    .map((c: any) => ({ id: c.id, x: num(c.x), y: num(c.y) }));
  const ids = new Set(corners.map((c: any) => c.id));
  const walls = (Array.isArray(p.walls) ? p.walls : []).filter((w: any) => w && typeof w.id === 'string' && ids.has(w.a) && ids.has(w.b) && w.a !== w.b)
    .map((w: any) => ({ id: w.id, a: w.a, b: w.b, thickness: num(w.thickness) > 0 ? num(w.thickness) : 0.5, height: num(w.height) > 0 ? num(w.height) : 9, ...(w.divider ? { divider: true } : {}) }));
  const wallIds = new Set(walls.map((w: any) => w.id));
  const openings = (Array.isArray(p.openings) ? p.openings : []).filter((o: any) => o && wallIds.has(o.wallId) && (o.kind === 'door' || o.kind === 'window') && num(o.t) >= 0 && num(o.t) <= 1 && num(o.width) > 0)
    .map((o: any) => ({ id: String(o.id), wallId: o.wallId, kind: o.kind, t: num(o.t), width: num(o.width), height: num(o.height) > 0 ? num(o.height) : o.kind === 'door' ? 7 : 4, sill: num(o.sill) >= 0 ? num(o.sill) : o.kind === 'door' ? 0 : 3, ...(o.flip ? { flip: true } : {}) }));
  const labels = (Array.isArray(p.labels) ? p.labels : []).filter((l: any) => l && Number.isFinite(num(l.x)) && Number.isFinite(num(l.y)))
    .map((l: any) => ({ id: String(l.id ?? `room-${Math.random().toString(36).slice(2)}`), x: num(l.x), y: num(l.y), name: String(l.name ?? ''), type: String(l.type ?? '') }));
  const items = (Array.isArray(p.items) ? p.items : []).filter((i: any) => i && typeof i.type === 'string' && Number.isFinite(num(i.x)) && Number.isFinite(num(i.y)))
    .map((i: any) => ({ ...i, x: num(i.x), y: num(i.y), rotation: Number.isFinite(num(i.rotation)) ? num(i.rotation) : 0 }));
  const total = [p.corners, p.walls, p.openings, p.labels, p.items].reduce((s, a) => s + (Array.isArray(a) ? a.length : 0), 0);
  const plan: Plan = { ...emptyPlan(), corners, walls, openings, labels, items, ...(current.background ? { background: current.background } : {}), ...(Number.isFinite(num(p.northDeg)) ? { northDeg: num(p.northDeg) } : {}) };
  return { plan, dropped: total - (corners.length + walls.length + openings.length + labels.length + items.length) };
}

// The setPlan payload in feet from any of the accepted shapes, plus notes on what was assumed
// or left out. Exported for the chat's setPlan answers, which vary in the same ways.
export function normalizePlanPayload(raw: unknown): { payload: SetPlanPayload; notes: string[]; thickness: number } | { errors: string[] } {
  const { body: b, unit: unitName } = unwrap(raw);
  if (!isObj(b)) return { errors: ['No floor plan found in the JSON (it needs a "rooms" list).'] };
  const notes: string[] = [];

  // Named corners, as a map {"c1": {x, y}} or a list [{id, x, y}].
  const named = new Map<string, Pt>();
  const cornerSrc = b.corners ?? b.points ?? b.vertices;
  if (isObj(cornerSrc)) for (const [id, v] of Object.entries(cornerSrc)) named.set(id, [num((v as any)?.x ?? (v as any)?.[0]), num((v as any)?.y ?? (v as any)?.[1])]);
  else if (Array.isArray(cornerSrc)) for (const c of cornerSrc) if (isObj(c) && c.id != null) named.set(String(c.id), [num(c.x), num(c.y)]);

  const pt = (v: unknown): Pt | null => {
    const p: Pt = Array.isArray(v) ? [num(v[0]), num(v[1])] : isObj(v) ? [num(v.x), num(v.y)] : typeof v === 'string' && named.has(v) ? named.get(v)! : [NaN, NaN];
    return Number.isFinite(p[0]) && Number.isFinite(p[1]) ? p : null;
  };

  // Rooms.
  const rooms: { name: string; type: string; polygon: Pt[]; size: [number, number] | null; openTo?: string[] }[] = [];
  (Array.isArray(b.rooms) ? b.rooms : []).forEach((r: any, i: number) => {
    const name = String(r?.name ?? r?.label ?? `Room ${i + 1}`).slice(0, 60) || `Room ${i + 1}`;
    const src = r?.polygon ?? r?.points ?? r?.vertices ?? r?.outline ?? r?.corners;
    let polygon = (Array.isArray(src) ? src : []).map(pt).filter((p: Pt | null): p is Pt => !!p);
    // A rectangle given as x, y, width, depth (or a bounds box) instead of corners.
    if (polygon.length < 3 && isObj(r)) {
      const box = isObj(r.bounds) ? r.bounds : r;
      const x0 = num(box.minX ?? box.x), y0 = num(box.minY ?? box.y);
      const w = num(box.width ?? (num(box.maxX) - x0)), d = num(box.depth ?? box.height ?? (num(box.maxY) - y0));
      if ([x0, y0, w, d].every(Number.isFinite) && w > 0 && d > 0) polygon = [[x0, y0], [x0 + w, y0], [x0 + w, y0 + d], [x0, y0 + d]];
    }
    if (polygon.length < 3) return notes.push(`Left out room "${name}": it has no outline.`);
    // The size written in the room (inside the walls), in feet.
    const sizeText = r?.size ?? r?.label ?? r?.dimensions ?? r?.size_imperial ?? r?.writtenSize;
    const size = typeof sizeText === 'string' ? parseSizeLabel(sizeText)
      : Array.isArray(sizeText) && num(sizeText[0]) > 0 && num(sizeText[1]) > 0 ? [num(sizeText[0]), num(sizeText[1])] as [number, number]
      : num(r?.widthFt) > 0 && num(r?.depthFt) > 0 ? [num(r.widthFt), num(r.depthFt)] as [number, number] : null;
    const openTo = Array.isArray(r?.openTo) ? r.openTo.map(String) : undefined;
    rooms.push({ name, type: String(r?.type ?? r?.roomType ?? '').slice(0, 30), polygon, size, ...(openTo ? { openTo } : {}) });
  });
  if (rooms.length === 0) return { errors: ['No room in the JSON has an outline (a "polygon" list of [x, y] corners).'] };

  // Walls.
  const walls: { id: string; from: Pt; to: Pt; thickness?: number; thicknessIsFt: boolean; divider: boolean }[] = [];
  const wallById = new Map<string, { from: Pt; to: Pt }>();
  (Array.isArray(b.walls) ? b.walls : []).forEach((w: any, i: number) => {
    const from = pt(w?.from ?? w?.start ?? w?.a ?? w?.p1), to = pt(w?.to ?? w?.end ?? w?.b ?? w?.p2);
    if (!from || !to) return notes.push(`Left out wall ${w?.id ?? i + 1}: it has no start and end.`);
    const id = String(w?.id ?? `w${i + 1}`);
    const t = num(w?.thicknessFt ?? w?.thickness);
    walls.push({ id, from, to, ...(t > 0 ? { thickness: t } : {}), thicknessIsFt: w?.thicknessFt != null, divider: !!w?.divider || /divider|open|virtual/i.test(String(w?.type ?? '')) });
    wallById.set(id, { from, to });
  });

  // Doors and windows: separate lists, or one "openings" list with a kind or type.
  type Open = { at: Pt; width?: number; widthIsFt: boolean; swing?: 'left' | 'right'; kind: 'door' | 'window' };
  const openings: Open[] = [];
  const addOpening = (o: any, kind: 'door' | 'window', i: number) => {
    let at = pt(o?.at ?? o?.position ?? o?.center ?? o?.centre ?? o?.point ?? (o?.x != null ? { x: o.x, y: o.y } : null));
    // On a wall by id, "offset" from its start to the opening's centre.
    if (!at && o?.wallId != null && wallById.has(String(o.wallId))) {
      const w = wallById.get(String(o.wallId))!;
      const L = Math.hypot(w.to[0] - w.from[0], w.to[1] - w.from[1]) || 1;
      let off = num(o.offset ?? o.offsetFt ?? L / 2);
      if (!(off >= 0 && off <= L)) {
        notes.push(`${kind} ${o?.id ?? o?.name ?? i + 1} was past the end of its wall; put in the middle of it.`);
        off = L / 2;
      }
      at = [w.from[0] + ((w.to[0] - w.from[0]) * off) / L, w.from[1] + ((w.to[1] - w.from[1]) * off) / L];
    }
    if (!at) return notes.push(`Left out ${kind} ${o?.name ?? o?.id ?? i + 1}: it has no position.`);
    const width = num(o?.widthFt ?? o?.width);
    const swing = /right/i.test(String(o?.swing ?? '')) ? 'right' : /left/i.test(String(o?.swing ?? '')) ? 'left' : undefined;
    openings.push({ at, kind, widthIsFt: o?.widthFt != null, ...(width > 0 ? { width } : {}), ...(swing ? { swing } : {}) });
  };
  (Array.isArray(b.doors) ? b.doors : []).forEach((o: any, i: number) => addOpening(o, 'door', i));
  (Array.isArray(b.windows) ? b.windows : []).forEach((o: any, i: number) => addOpening(o, 'window', i));
  (Array.isArray(b.openings) ? b.openings : []).forEach((o: any, i: number) => addOpening(o, /window|vent/i.test(String(o?.kind ?? o?.type ?? '')) ? 'window' : 'door', i));

  // Units: as stated, else feet unless the numbers are far too big for feet.
  const all = [...rooms.flatMap(r => r.polygon), ...walls.flatMap(w => [w.from, w.to]), ...openings.map(o => o.at)].flat();
  const extent = Math.max(...all) - Math.min(...all);
  let k = unitName ? UNITS[unitName.toLowerCase().trim()] : undefined;
  if (unitName && k == null) notes.push(`Unknown unit "${unitName}"; read as feet.`);
  if (k == null) {
    k = 1;
    if (extent > MAX_PLAN_FT) {
      k = UNITS.mm;
      notes.push('The sizes look like millimetres, so they were converted to feet.');
    }
  }
  const s = (p: Pt): Pt => [p[0] * k!, p[1] * k!];

  const R = rooms.map(r => ({ ...r, polygon: r.polygon.map(s) }));
  const geo = tidyGeometry(R, walls.map(w => ({ from: s(w.from), to: s(w.to), thickness: w.thickness ? (w.thicknessIsFt ? w.thickness : w.thickness * k!) : undefined })), openings.map(o => s(o.at)), notes);

  const clampWidth = (w: number | undefined, ft: boolean, fallback: number) => (w ? Math.min(16, Math.max(1.5, ft ? w : w * k!)) : fallback);
  const dividers = openSides(R.map((r, i) => ({ ...r, polygon: geo.rooms[i] })), geo.openings.filter((_, i) => openings[i].kind === 'door'), walls.some(w => w.divider), notes);
  const payload = {
    rooms: R.map((r, i) => ({ name: r.name, type: r.type, polygon: geo.rooms[i] })),
    walls: [
      ...walls.map((w, i) => ({
        id: w.id, from: geo.walls[i].from, to: geo.walls[i].to,
        ...(w.thickness ? { thickness: Math.min(3, w.thicknessIsFt ? w.thickness : w.thickness * k!) } : {}),
        ...(w.divider ? { divider: true } : {}),
      })).filter(w => w.from[0] !== w.to[0] || w.from[1] !== w.to[1]),
      ...dividers.map((d, i) => ({ id: `open-${i + 1}`, from: d[0], to: d[1], divider: true })),
    ],
    doors: openings.map((o, i) => ({ o, at: geo.openings[i] })).filter(x => x.o.kind === 'door').map(({ o, at }) => ({ at, widthFt: clampWidth(o.width, o.widthIsFt, 3), ...(o.swing ? { swing: o.swing } : {}) })),
    windows: openings.map((o, i) => ({ o, at: geo.openings[i] })).filter(x => x.o.kind === 'window').map(({ o, at }) => ({ at, widthFt: clampWidth(o.width, o.widthIsFt, 4) })),
  };
  const parsed = SetPlanSchema.safeParse(payload);
  if (!parsed.success) return { errors: formatIssues(parsed.error) };
  return { payload: parsed.data, notes, thickness: geo.thickness };
}

// ---- geometry ------------------------------------------------------------------------------

const r3 = (v: number) => Math.round(v * 1000) / 1000;

// Groups values within SNAP of the first of each group: each group is one wall line.
function makeLines(values: number[]) {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  const pos: number[] = [];
  const members: number[][] = [];
  for (const v of sorted) {
    const g = members[members.length - 1];
    if (g && v - g[0] < SNAP) g.push(v);
    else members.push([v]);
  }
  for (const g of members) pos.push(g.reduce((t, v) => t + v, 0) / g.length);
  const index = new Map<number, number>();
  members.forEach((g, i) => g.forEach(v => index.set(v, i)));
  return { pos, of: (v: number) => index.get(v)! };
}

type GeoRoom = { name: string; polygon: Pt[]; size: [number, number] | null };

// The tidied geometry: room outlines and wall ends on shared wall lines, inside-face plans
// turned into centre-lines, written sizes made exact, and doors and windows moved with their
// walls. Returns the wall thickness to build with.
function tidyGeometry(rooms: GeoRoom[], walls: { from: Pt; to: Pt; thickness?: number }[], openings: Pt[], notes: string[]) {
  const axes = [0, 1].map(ax => makeLines(rooms.flatMap(r => r.polygon.map(p => p[ax]))));
  const refs = rooms.map(r => r.polygon.map(p => [axes[0].of(p[0]), axes[1].of(p[1])]));
  // Merged lines (union-find) and line positions, per axis.
  const parent = axes.map(a => a.pos.map((_, i) => i));
  const find = (ax: number, i: number): number => (parent[ax][i] === i ? i : (parent[ax][i] = find(ax, parent[ax][i])));
  const pos = axes.map(a => [...a.pos]);

  // The straight sides of every room: which line, its extent along it, and which way is out.
  type Side = { room: number; ax: number; line: number; lo: number; hi: number; out: 1 | -1 };
  const sides: Side[] = [];
  rooms.forEach((r, i) => {
    const P = r.polygon, poly = P.map(p => ({ x: p[0], y: p[1] }));
    P.forEach((a, k) => {
      const b = P[(k + 1) % P.length];
      const ra = refs[i][k], rb = refs[i][(k + 1) % P.length];
      for (const ax of [0, 1]) {
        if (ra[ax] !== rb[ax]) continue;
        const other = 1 - ax;
        const lo = Math.min(a[other], b[other]), hi = Math.max(a[other], b[other]);
        if (hi - lo < 0.5) continue;
        const mid = (lo + hi) / 2;
        const probe = ax === 0 ? { x: a[0] + 0.05, y: mid } : { x: mid, y: a[1] + 0.05 };
        sides.push({ room: i, ax, line: ra[ax], lo, hi, out: pointInPolygon(probe, poly) ? -1 : 1 });
      }
    });
  });
  const overlap = (p: Side, q: Side) => Math.min(p.hi, q.hi) - Math.max(p.lo, q.lo);

  // Sides of two rooms facing each other a little apart are one wall between them: either the
  // plan is drawn to the inside faces of its walls (then the gaps are all the same, the wall's
  // thickness), or its coordinates are a little off.
  const gaps: { p: Side; q: Side; gap: number }[] = [];
  for (const p of sides) {
    for (const q of sides) {
      if (p.room === q.room || p.ax !== q.ax || p.out !== 1 || q.out !== -1 || overlap(p, q) < 1 || p.line === q.line) continue;
      const gap = pos[p.ax][q.line] - pos[p.ax][p.line];
      if (gap > SNAP - 0.01 && gap < FACE_GAP) gaps.push({ p, q, gap });
    }
  }
  const sorted = gaps.map(g => g.gap).sort((a, b) => a - b);
  const typical = sorted[sorted.length >> 1] ?? 0;
  const insideFaces = gaps.length >= 3 && gaps.filter(g => Math.abs(g.gap - typical) < 0.06).length >= gaps.length * 0.8;
  let thickness = WALL_DEFAULTS.thickness;
  if (insideFaces) thickness = r3(Math.min(FACE_GAP, Math.max(SNAP, typical)));
  // Each pair of facing sides becomes one wall line in the middle (a slightly-off plan: only
  // gaps under a foot, wider ones may be real).
  for (const { p, q, gap } of gaps) {
    if (!insideFaces && gap >= 1) continue;
    const a = find(p.ax, p.line), b = find(q.ax, q.line);
    if (a === b) continue;
    pos[p.ax][a] = (pos[p.ax][a] + pos[p.ax][b]) / 2;
    parent[p.ax][b] = a;
  }
  if (insideFaces) {
    // Sides with rooms on one side only are outside walls: moved out to the wall's middle.
    for (const ax of [0, 1]) {
      const outs = new Map<number, Set<number>>();
      for (const sd of sides.filter(x => x.ax === ax)) {
        const l = find(ax, sd.line);
        outs.set(l, (outs.get(l) ?? new Set()).add(sd.out));
      }
      for (const [l, set] of outs) {
        if (set.size !== 1) continue;
        const out = [...set][0];
        // By half the outside wall the JSON gives along it (thicker outside walls), else half the
        // inside walls' thickness.
        const own = walls.find(w => w.thickness && Math.abs(w.from[ax] - w.to[ax]) < 0.01 && (w.from[ax] - pos[ax][l]) * out > 0 && Math.abs(w.from[ax] - pos[ax][l]) < FACE_GAP + 0.5);
        pos[ax][l] += out * (own?.thickness ?? thickness) / 2;
      }
    }
    notes.push(`The rooms are drawn to the inside faces of their walls, so walls ${Math.round(thickness * 12)} in thick were built between them.`);
  }
  const before = pos.map(p => [...p]);

  // Written sizes: the two wall lines on each side of a rectangular room are held exactly the
  // written size (plus a wall) apart; every other line keeps its place as far as it can.
  const spans: { ax: number; a: number; b: number; length: number; room: number }[][] = [[], []];
  rooms.forEach((r, i) => {
    if (!r.size) return;
    const xs = [...new Set(refs[i].map(v => find(0, v[0])))], ys = [...new Set(refs[i].map(v => find(1, v[1])))];
    if (r.polygon.length !== 4 || xs.length !== 2 || ys.length !== 2) {
      notes.push(`${r.name}: its written size was not applied, because the room isn't a rectangle.`);
      return;
    }
    const [x0, x1] = xs.sort((a, b) => pos[0][a] - pos[0][b]), [y0, y1] = ys.sort((a, b) => pos[1][a] - pos[1][b]);
    const bw = pos[0][x1] - pos[0][x0] - thickness, bh = pos[1][y1] - pos[1][y0] - thickness;
    const [w, d] = r.size;
    const [across, down] = Math.abs(bw - w) + Math.abs(bh - d) <= Math.abs(bw - d) + Math.abs(bh - w) ? [w, d] : [d, w];
    if (Math.abs(across - bw) > Math.max(1.5, across * 0.2) || Math.abs(down - bh) > Math.max(1.5, down * 0.2)) {
      notes.push(`${r.name}: its written size ${fmt(across)} x ${fmt(down)} is far from its outline (${fmt(bw)} x ${fmt(bh)}), so the outline was kept.`);
      return;
    }
    spans[0].push({ ax: 0, a: x0, b: x1, length: across + thickness, room: i });
    spans[1].push({ ax: 1, a: y0, b: y1, length: down + thickness, room: i });
  });
  for (const ax of [0, 1]) {
    if (!spans[ax].length) continue;
    const roots = [...new Set(pos[ax].map((_, i) => find(ax, i)))];
    const idx = new Map(roots.map((l, n) => [l, n]));
    const solved = solveAxis(roots.length, roots.map(l => ({ line: idx.get(l)!, at: pos[ax][l], weight: 1 })),
      spans[ax].map(sp => ({ a: idx.get(sp.a)!, b: idx.get(sp.b)!, length: sp.length })));
    roots.forEach(l => { pos[ax][l] = solved[idx.get(l)!]; });
  }
  const off = new Set<string>();
  for (const sp of [...spans[0], ...spans[1]]) if (Math.abs(pos[sp.ax][sp.b] - pos[sp.ax][sp.a] - sp.length) > EXACT) off.add(rooms[sp.room].name);
  if (off.size) notes.push(`These written sizes contradict their neighbours', so they couldn't all be met exactly: ${[...off].join(', ')}.`);

  // Where a line now is, and the line nearest a coordinate (before solving), if close enough.
  const at = (ax: number, line: number) => r3(pos[ax][find(ax, line)]);
  const nearest = (ax: number, v: number, tol: number) => {
    let best = -1, d = tol;
    before[ax].forEach((p, i) => { if (find(ax, i) === i && Math.abs(p - v) < d) { d = Math.abs(p - v); best = i; } });
    return best;
  };
  const move = (p: Pt, tol: number): Pt => [0, 1].map(ax => {
    const l = nearest(ax, p[ax] + 0, tol);
    return l === -1 ? r3(p[ax]) : at(ax, l);
  }) as Pt;
  // Doors and windows: the coordinate across their wall follows that wall.
  const moveOpening = (p: Pt): Pt => {
    const lx = nearest(0, p[0], 0.75), ly = nearest(1, p[1], 0.75);
    const dx = lx === -1 ? Infinity : Math.abs(before[0][lx] - p[0]), dy = ly === -1 ? Infinity : Math.abs(before[1][ly] - p[1]);
    if (dx === Infinity && dy === Infinity) return [r3(p[0]), r3(p[1])];
    return dx <= dy ? [at(0, lx), r3(p[1])] : [r3(p[0]), at(1, ly)];
  };
  // A corner that lies on another room's wall (a T-junction, or along a diagonal wall) is put
  // exactly on it, so no hairline gap is left between the two rooms.
  const outlines = refs.map(r => r.map(v => [at(0, v[0]), at(1, v[1])] as Pt));
  outlines.forEach((P, i) => P.forEach((p, k) => {
    for (let j = 0; j < outlines.length; j++) {
      if (j === i) continue;
      const Q = outlines[j];
      for (let e = 0; e < Q.length; e++) {
        const a = Q[e], b = Q[(e + 1) % Q.length];
        const hit = closestOnSegment({ x: p[0], y: p[1] }, { x: a[0], y: a[1] }, { x: b[0], y: b[1] });
        if (hit.distance > 1e-6 && hit.distance < 0.15) {
          P[k] = [r3(hit.point.x), r3(hit.point.y)];
          return;
        }
      }
    }
  }));
  return {
    rooms: outlines,
    walls: walls.map(w => ({ from: move(w.from, 1), to: move(w.to, 1) })),
    openings: openings.map(moveOpening),
    thickness,
  };
}

const fmt = (v: number) => {
  let f = Math.floor(v + 1e-6), i = Math.round((v - f) * 12);
  if (i === 12) { f++; i = 0; }
  return `${f}'${i ? ` ${i}"` : ''}`;
};

// The stretches between rooms that should be open (dividers, not walls): those the JSON names in
// "openTo"; or, when it says nothing about openness at all, those between kitchen, living,
// dining and hallway areas with no door drawn on them.
function openSides(rooms: { name: string; type: string; polygon: Pt[]; openTo?: string[] }[], doors: Pt[], hasDividers: boolean, notes: string[]): [Pt, Pt][] {
  const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const polys = rooms.map(r => r.polygon.map(p => ({ x: p[0], y: p[1] }) as Vec));
  const out: [Pt, Pt][] = [];
  const pairs: [number, number][] = [];
  const said = rooms.some(r => r.openTo);
  if (said) {
    const byName = new Map(rooms.map((r, i) => [key(r.name), i]));
    rooms.forEach((r, i) => (r.openTo ?? []).forEach(n => {
      const j = byName.get(key(n));
      if (j != null && j !== i && !pairs.some(([a, b]) => (a === i && b === j) || (a === j && b === i))) pairs.push([i, j]);
    }));
  } else if (!hasDividers) {
    const open = rooms.map(r => OPEN_TYPES.has(normalizeRoomType(r.type) || normalizeRoomType(r.name)));
    for (let i = 0; i < rooms.length; i++) for (let j = i + 1; j < rooms.length; j++) if (open[i] && open[j]) pairs.push([i, j]);
  }
  const opened: string[] = [];
  for (const [i, j] of pairs) {
    for (const [a, b] of sharedEdges(polys[i], polys[j])) {
      // A door on it means a wall is there (auto mode only; "openTo" is followed as given).
      if (!said && doors.some(d => closestOnSegment({ x: d[0], y: d[1] }, a, b).distance < 1)) continue;
      out.push([[r3(a.x), r3(a.y)], [r3(b.x), r3(b.y)]]);
      const label = `${rooms[i].name} and ${rooms[j].name}`;
      if (!opened.includes(label)) opened.push(label);
    }
  }
  if (!said && opened.length) notes.push(`Left open (no wall or door between them in the JSON): ${opened.join('; ')}. Add "openTo" lists to rooms to choose this yourself.`);
  return out;
}

// The plan from a JSON value (or pasted text), replacing everything drawn on `current` (its
// background image is kept). Never throws; anything it can't use is listed in `notes`.
export function importPlanJson(current: Plan, input: unknown): ImportResult {
  const raw = typeof input === 'string' ? parseJsonText(input) : input;
  if (raw == null) return { error: "That isn't valid JSON. Paste the whole plan, from the first { to the last }." };
  const { body } = unwrap(raw);
  if (isObj(body) && body.version === 2 && Array.isArray(body.corners) && Array.isArray(body.walls)) {
    const { plan, dropped } = fromSavedPlan(current, body);
    if (plan.walls.length === 0) return { error: 'That saved plan has no usable walls.' };
    return { plan, message: `Loaded the saved plan: ${plan.walls.length} walls, ${plan.labels.length} rooms.`, notes: dropped ? [`${dropped} broken entries were left out.`] : [] };
  }
  const norm = normalizePlanPayload(raw);
  if ('errors' in norm) return { error: `I couldn't build a plan from that JSON: ${norm.errors.slice(0, 4).join('; ')}` };
  const res = applySetPlan(current, norm.payload, { replace: true, thickness: norm.thickness });
  if (res.applied.rooms === 0) return { error: `None of the rooms in that JSON could be built: ${res.errors.slice(0, 3).join('; ')}` };
  return { plan: res.plan, message: `Built the plan from your JSON: ${describeCounts(res.applied)}.`, notes: [...norm.notes, ...res.errors] };
}
