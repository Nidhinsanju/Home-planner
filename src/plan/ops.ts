import {
  Corner, DOOR_DEFAULTS, Item, Opening, Plan, RoomLabel, Vec, Wall, WALL_DEFAULTS, WINDOW_DEFAULTS,
} from './types';
import { closestOnSegment, dist, lerp, pointInPolygon, projectT, segmentIntersection, sub, len } from './geometry';
import { detectRooms, detectSpaces, Room } from './rooms';

// Pure, immutable operations on a Plan. Every edit (2D tools, AI commands, migration)
// goes through these so the wall graph stays connected and consistent.

export const TOL = 0.05; // feet; points closer than this are treated as the same point

let counter = 0;
export const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${(counter++).toString(36)}`;

export const cornerOf = (plan: Plan, id: string) => plan.corners.find(c => c.id === id);

export function wallEnds(plan: Plan, wall: Wall): { a: Vec; b: Vec } {
  const a = cornerOf(plan, wall.a);
  const b = cornerOf(plan, wall.b);
  return { a: a ?? { x: 0, y: 0 }, b: b ?? { x: 0, y: 0 } };
}

export function wallLength(plan: Plan, wall: Wall) {
  const { a, b } = wallEnds(plan, wall);
  return dist(a, b);
}

export function openingCenter(plan: Plan, o: Opening): Vec {
  const wall = plan.walls.find(w => w.id === o.wallId);
  if (!wall) return { x: 0, y: 0 };
  const { a, b } = wallEnds(plan, wall);
  return lerp(a, b, o.t);
}

const wallBetween = (plan: Plan, c1: string, c2: string) =>
  plan.walls.find(w => (w.a === c1 && w.b === c2) || (w.a === c2 && w.b === c1));

// Keeps an opening fully inside its wall.
function clampOpeningT(plan: Plan, o: Opening, t: number) {
  const wall = plan.walls.find(w => w.id === o.wallId);
  const L = wall ? wallLength(plan, wall) : 0;
  if (L <= o.width) return 0.5;
  const half = o.width / 2 / L;
  return Math.min(1 - half, Math.max(half, t));
}

// ---- corners & walls --------------------------------------------------------------------

// Splits a wall at the point closest to p. Returns the new (or existing end) corner id.
export function splitWall(plan: Plan, wallId: string, p: Vec): { plan: Plan; cornerId: string } {
  const wall = plan.walls.find(w => w.id === wallId);
  if (!wall) throw new Error(`No wall ${wallId}`);
  const { a, b } = wallEnds(plan, wall);
  const L = dist(a, b);
  const t = Math.min(1, Math.max(0, projectT(p, a, b)));
  if (t * L < TOL) return { plan, cornerId: wall.a };
  if ((1 - t) * L < TOL) return { plan, cornerId: wall.b };

  const corner: Corner = { id: newId('c'), ...lerp(a, b, t) };
  const second: Wall = { ...wall, id: newId('wall'), a: corner.id };
  const openings = plan.openings.map(o => {
    if (o.wallId !== wallId) return o;
    return o.t <= t ? { ...o, t: o.t / t } : { ...o, wallId: second.id, t: (o.t - t) / (1 - t) };
  });
  return {
    cornerId: corner.id,
    plan: {
      ...plan,
      corners: [...plan.corners, corner],
      walls: [...plan.walls.map(w => (w.id === wallId ? { ...w, b: corner.id } : w)), second],
      openings,
    },
  };
}

// Returns the corner at p, splitting a wall or creating a free corner if needed.
export function cornerAt(plan: Plan, p: Vec, tol = TOL): { plan: Plan; cornerId: string } {
  const existing = plan.corners.find(c => dist(c, p) < tol);
  if (existing) return { plan, cornerId: existing.id };
  for (const w of plan.walls) {
    const { a, b } = wallEnds(plan, w);
    if (closestOnSegment(p, a, b).distance < tol) return splitWall(plan, w.id, p);
  }
  const corner: Corner = { id: newId('c'), x: p.x, y: p.y };
  return { plan: { ...plan, corners: [...plan.corners, corner] }, cornerId: corner.id };
}

// Adds a straight wall from p to q, connecting it into the existing wall graph: it joins
// corners it touches, splits walls it crosses or ends on, and doesn't duplicate walls it
// overlaps.
export function addWall(plan: Plan, p: Vec, q: Vec, dims: { thickness: number; height: number } = WALL_DEFAULTS) {
  if (dist(p, q) < TOL) return { plan, wallIds: [] as string[] };
  const cuts: Vec[] = [p, q];
  for (const w of plan.walls) {
    const { a, b } = wallEnds(plan, w);
    const hit = segmentIntersection(p, q, a, b);
    if (hit) cuts.push(hit.point);
    for (const end of [a, b]) if (closestOnSegment(end, p, q).distance < TOL) cuts.push(end);
  }
  cuts.sort((m, n) => projectT(m, p, q) - projectT(n, p, q));

  let next = plan;
  const ids: string[] = [];
  for (const cut of cuts) {
    const res = cornerAt(next, cut);
    next = res.plan;
    if (ids[ids.length - 1] !== res.cornerId) ids.push(res.cornerId);
  }

  const wallIds: string[] = [];
  const added: Wall[] = [];
  for (let i = 0; i + 1 < ids.length; i++) {
    const existing = wallBetween(next, ids[i], ids[i + 1]);
    if (existing) {
      wallIds.push(existing.id);
      continue;
    }
    const wall: Wall = { id: newId('wall'), a: ids[i], b: ids[i + 1], ...dims };
    added.push(wall);
    wallIds.push(wall.id);
    next = { ...next, walls: [...next.walls, wall] };
  }
  return { plan: next, wallIds };
}

// Adds a rectangular room (4 walls) centred at (x, y) and marks it as a room.
export function addRectRoom(
  plan: Plan,
  rect: { x: number; y: number; width: number; depth: number },
  dims = WALL_DEFAULTS,
  label: { name: string; type: string } = { name: '', type: '' },
) {
  const { x, y, width, depth } = rect;
  const pts = [
    { x: x - width / 2, y: y - depth / 2 },
    { x: x + width / 2, y: y - depth / 2 },
    { x: x + width / 2, y: y + depth / 2 },
    { x: x - width / 2, y: y + depth / 2 },
  ];
  let next = plan;
  for (let i = 0; i < 4; i++) next = addWall(next, pts[i], pts[(i + 1) % 4], dims).plan;
  const room: RoomLabel = { id: newId('room'), x, y, ...label };
  return { ...next, labels: [...next.labels, room] };
}

// Merges corner `from` into corner `into`, dropping walls that collapse or duplicate.
function mergeCorners(plan: Plan, from: string, into: string): Plan {
  if (from === into) return plan;
  const seen = new Set<string>();
  const walls: Wall[] = [];
  for (const w of plan.walls) {
    const nw = { ...w, a: w.a === from ? into : w.a, b: w.b === from ? into : w.b };
    if (nw.a === nw.b) continue;
    const pair = nw.a < nw.b ? `${nw.a}|${nw.b}` : `${nw.b}|${nw.a}`;
    if (seen.has(pair)) continue;
    seen.add(pair);
    walls.push(nw);
  }
  const wallIds = new Set(walls.map(w => w.id));
  return {
    ...plan,
    corners: plan.corners.filter(c => c.id !== from),
    walls,
    openings: plan.openings.filter(o => wallIds.has(o.wallId)),
  };
}

// After a corner is dropped: join it to a corner or wall it landed on.
export function settleCorner(plan: Plan, id: string): Plan {
  const c = cornerOf(plan, id);
  if (!c) return plan;
  const other = plan.corners.find(o => o.id !== id && dist(o, c) < TOL * 4);
  if (other) return mergeCorners(plan, id, other.id);
  for (const w of plan.walls) {
    if (w.a === id || w.b === id) continue;
    const { a, b } = wallEnds(plan, w);
    if (closestOnSegment(c, a, b).distance < TOL * 4) {
      const res = splitWall(plan, w.id, c);
      return mergeCorners(res.plan, id, res.cornerId);
    }
  }
  return plan;
}

export function moveCorner(plan: Plan, id: string, p: Vec): Plan {
  return { ...plan, corners: plan.corners.map(c => (c.id === id ? { ...c, x: p.x, y: p.y } : c)) };
}

export function moveCorners(plan: Plan, ids: string[], delta: Vec): Plan {
  const set = new Set(ids);
  return { ...plan, corners: plan.corners.map(c => (set.has(c.id) ? { ...c, x: c.x + delta.x, y: c.y + delta.y } : c)) };
}

// Unit normal of a wall (perpendicular to a->b).
export function wallNormal(plan: Plan, wall: Wall): Vec {
  const { a, b } = wallEnds(plan, wall);
  const d = sub(b, a);
  const l = len(d) || 1;
  return { x: -d.y / l, y: d.x / l };
}

// Moves a wall sideways (perpendicular to itself); attached walls stretch to follow.
export function offsetWall(plan: Plan, wallId: string, distance: number): Plan {
  const wall = plan.walls.find(w => w.id === wallId);
  if (!wall) return plan;
  const n = wallNormal(plan, wall);
  return moveCorners(plan, [wall.a, wall.b], { x: n.x * distance, y: n.y * distance });
}

// Changes a wall's length by moving its b corner along the wall direction.
export function setWallLength(plan: Plan, wallId: string, length: number): Plan {
  const wall = plan.walls.find(w => w.id === wallId);
  if (!wall || length <= TOL) return plan;
  const { a, b } = wallEnds(plan, wall);
  const d = sub(b, a);
  const l = len(d) || 1;
  return moveCorner(plan, wall.b, { x: a.x + (d.x / l) * length, y: a.y + (d.y / l) * length });
}

export function updateWall(plan: Plan, wallId: string, data: Partial<Pick<Wall, 'thickness' | 'height'>>): Plan {
  return { ...plan, walls: plan.walls.map(w => (w.id === wallId ? { ...w, ...data } : w)) };
}

const dropOrphanCorners = (plan: Plan): Plan => {
  const used = new Set(plan.walls.flatMap(w => [w.a, w.b]));
  return { ...plan, corners: plan.corners.filter(c => used.has(c.id)) };
};

export function deleteWalls(plan: Plan, wallIds: string[]): Plan {
  const set = new Set(wallIds);
  return dropOrphanCorners({
    ...plan,
    walls: plan.walls.filter(w => !set.has(w.id)),
    openings: plan.openings.filter(o => !set.has(o.wallId)),
  });
}

// ---- openings ----------------------------------------------------------------------------

export function addOpening(plan: Plan, wallId: string, at: Vec, kind: 'door' | 'window', size?: Partial<Opening>): Plan {
  const wall = plan.walls.find(w => w.id === wallId);
  if (!wall) return plan;
  const { a, b } = wallEnds(plan, wall);
  const o: Opening = { id: newId(kind), wallId, kind, t: 0.5, ...(kind === 'door' ? DOOR_DEFAULTS : WINDOW_DEFAULTS), ...size };
  o.t = clampOpeningT(plan, o, projectT(at, a, b));
  return { ...plan, openings: [...plan.openings, o] };
}

export function updateOpening(plan: Plan, id: string, data: Partial<Opening>): Plan {
  return {
    ...plan,
    openings: plan.openings.map(o => {
      if (o.id !== id) return o;
      const next = { ...o, ...data };
      return { ...next, t: clampOpeningT(plan, next, next.t) };
    }),
  };
}

// Slides an opening along its wall to the point closest to p.
export function moveOpeningTo(plan: Plan, id: string, p: Vec): Plan {
  const o = plan.openings.find(x => x.id === id);
  const wall = o && plan.walls.find(w => w.id === o.wallId);
  if (!o || !wall) return plan;
  const { a, b } = wallEnds(plan, wall);
  return updateOpening(plan, id, { t: projectT(p, a, b) });
}

export const deleteOpening = (plan: Plan, id: string): Plan => ({ ...plan, openings: plan.openings.filter(o => o.id !== id) });

// ---- items -------------------------------------------------------------------------------

export function addItem(plan: Plan, type: string, p: Vec, rotation = 0): Plan {
  const item: Item = { id: newId(type), type, x: p.x, y: p.y, rotation };
  return { ...plan, items: [...plan.items, item] };
}

export const updateItem = (plan: Plan, id: string, data: Partial<Item>): Plan => ({
  ...plan,
  items: plan.items.map(i => (i.id === id ? { ...i, ...data } : i)),
});

export const deleteItem = (plan: Plan, id: string): Plan => ({ ...plan, items: plan.items.filter(i => i.id !== id) });

// ---- rooms -------------------------------------------------------------------------------

export function setRoomLabel(plan: Plan, room: Room, data: Partial<Pick<RoomLabel, 'name' | 'type'>>): Plan {
  if (room.label) {
    return { ...plan, labels: plan.labels.map(l => (l.id === room.label!.id ? { ...l, ...data } : l)) };
  }
  const label: RoomLabel = { id: newId('room'), ...room.center, name: '', type: '', ...data };
  return { ...plan, labels: [...plan.labels, label] };
}

// Turns a room back into a plain space: the walls stay, the room marker goes.
export const unmarkRoom = (plan: Plan, room: Room): Plan => ({ ...plan, labels: plan.labels.filter(l => l.id !== room.label?.id) });

// Deletes a room: its walls that don't also enclose another area, and its label.
export function deleteRoom(plan: Plan, room: Room): Plan {
  const others = detectSpaces(plan).filter(r => r.key !== room.key);
  const shared = new Set(others.flatMap(r => r.wallIds));
  const next = deleteWalls(plan, room.wallIds.filter(id => !shared.has(id)));
  return { ...next, labels: next.labels.filter(l => l.id !== room.label?.id) };
}

// Moves a room by moving its corners. Shared walls stretch neighbouring rooms.
export const moveRoom = (plan: Plan, room: Room, delta: Vec): Plan => {
  const moved = moveCorners(plan, room.cornerIds, delta);
  return room.label
    ? { ...moved, labels: moved.labels.map(l => (l.id === room.label!.id ? { ...l, x: l.x + delta.x, y: l.y + delta.y } : l)) }
    : moved;
};

export const clearPlan = (plan: Plan): Plan => ({ ...plan, corners: [], walls: [], openings: [], labels: [], items: [] });

// Keeps room markers attached to "their" area after walls change:
// - a room follows the new area that shares the most walls with its old area;
// - when a wall splits a room, the other pieces become new unnamed rooms;
// - markers left outside any enclosed area, or sharing an area with another marker (rooms
//   merged), are dropped.
// Areas that were never part of a room stay plain spaces.
export function reconcileLabels(prev: Plan, next: Plan): Plan {
  if (next.labels.length === 0) return next;
  const prevRooms = detectRooms(prev);
  const spaces = detectSpaces(next);
  const taken = new Set<string>();
  const labels: RoomLabel[] = [];
  for (const label of next.labels) {
    const before = prevRooms.find(r => r.label?.id === label.id);
    let target: Room | undefined;
    if (before) {
      const old = new Set(before.wallIds);
      let best = 0;
      for (const s of spaces) {
        if (taken.has(s.key)) continue;
        const shared = s.wallIds.filter(id => old.has(id)).length;
        if (shared > best) {
          best = shared;
          target = s;
        }
      }
    } else {
      target = spaces.find(s => s.label?.id === label.id);
    }
    if (!target || taken.has(target.key)) continue;
    taken.add(target.key);
    const stillInside = target.label?.id === label.id;
    labels.push(stillInside ? label : { ...label, ...target.center });
  }
  // Pieces carved out of a room that still exists (e.g. split by a new wall) become rooms of
  // their own. Rooms whose marker was deliberately removed are left as plain spaces.
  const kept = new Set(next.labels.map(l => l.id));
  const continuing = prevRooms.filter(r => r.label && kept.has(r.label.id));
  for (const s of spaces) {
    if (taken.has(s.key) || !continuing.some(r => pointInPolygon(s.center, r.polygon))) continue;
    taken.add(s.key);
    labels.push({ id: newId('room'), ...s.center, name: '', type: '' });
  }
  return { ...next, labels };
}
