import type { Plan, RoomLabel, Vec } from './types';
import { EPS, interiorPoint, pointInPolygon, signedArea } from './geometry';

export interface Room {
  id: string; // the label id when labelled, otherwise derived from the walls
  key: string; // sorted wall ids, stable while the walls around the room don't change
  wallIds: string[];
  cornerIds: string[];
  polygon: Vec[]; // wall centre-lines, counter-clockwise on screen
  area: number; // square feet (centre-line area)
  center: Vec; // a point inside the room, used for labels
  label?: RoomLabel;
}

const hash = (s: string) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};

// Rooms are the enclosed areas that carry a room label. Enclosing an area with walls alone does
// not make a room: it stays a plain "space" until the user (or Draw Room / Quick Room / the AI)
// marks it as one.
export const detectRooms = (plan: Plan): Room[] => detectSpaces(plan).filter(r => r.label);

// Finds every area enclosed by walls (the bounded faces of the wall graph), rooms or not.
//
// Each wall is two half-edges. Walking from u->v we always leave v along the edge with the
// smallest counter-clockwise turn from the way back to u; that walk traces one face. On a
// y-down plan, faces traced this way with negative signed area are the enclosed areas; the
// positive ones are the outside boundary of each connected group of walls.
export function detectSpaces(plan: Plan): Room[] {
  const pos = new Map(plan.corners.map(c => [c.id, c]));
  const adj = new Map<string, { to: string; wallId: string }[]>();
  const seenPairs = new Set<string>();
  for (const w of plan.walls) {
    if (w.a === w.b || !pos.has(w.a) || !pos.has(w.b)) continue;
    const pair = w.a < w.b ? `${w.a}|${w.b}` : `${w.b}|${w.a}`;
    if (seenPairs.has(pair)) continue;
    seenPairs.add(pair);
    if (!adj.has(w.a)) adj.set(w.a, []);
    if (!adj.has(w.b)) adj.set(w.b, []);
    adj.get(w.a)!.push({ to: w.b, wallId: w.id });
    adj.get(w.b)!.push({ to: w.a, wallId: w.id });
  }

  // Dangling walls can never enclose anything; prune them so faces don't include spurs.
  let pruned = true;
  while (pruned) {
    pruned = false;
    for (const [id, edges] of adj) {
      if (edges.length <= 1) {
        for (const e of edges) adj.set(e.to, adj.get(e.to)!.filter(x => x.to !== id));
        adj.delete(id);
        pruned = true;
      }
    }
  }

  const angle = (from: string, to: string) => {
    const a = pos.get(from)!;
    const b = pos.get(to)!;
    return Math.atan2(b.y - a.y, b.x - a.x);
  };

  const visited = new Set<string>();
  const rooms: Room[] = [];
  for (const [start, edges] of adj) {
    for (const first of edges) {
      if (visited.has(`${start}>${first.to}`)) continue;
      const cornerIds: string[] = [];
      const wallIds: string[] = [];
      let u = start;
      let e = first;
      let guard = 0;
      while (!visited.has(`${u}>${e.to}`) && guard++ < 10000) {
        visited.add(`${u}>${e.to}`);
        cornerIds.push(u);
        wallIds.push(e.wallId);
        const v = e.to;
        const back = angle(v, u);
        let best: { to: string; wallId: string } | null = null;
        let bestTurn = Infinity;
        for (const cand of adj.get(v) || []) {
          let turn = angle(v, cand.to) - back;
          while (turn <= EPS) turn += Math.PI * 2;
          if (cand.to === u) turn = Math.PI * 2 + 1; // only go back if there is no other way
          if (turn < bestTurn) {
            bestTurn = turn;
            best = cand;
          }
        }
        if (!best) break;
        u = v;
        e = best;
      }
      const polygon = cornerIds.map(id => ({ x: pos.get(id)!.x, y: pos.get(id)!.y }));
      const area = signedArea(polygon);
      if (polygon.length < 3 || area > -EPS) continue;
      polygon.reverse();
      cornerIds.reverse();
      const key = [...wallIds].sort().join('|');
      rooms.push({
        id: `auto-${hash(key)}`,
        key,
        wallIds,
        cornerIds,
        polygon,
        area: -area,
        center: interiorPoint(polygon),
      });
    }
  }

  // Attach labels: each label belongs to the smallest room that contains its point.
  const bySize = [...rooms].sort((a, b) => a.area - b.area);
  for (const label of plan.labels) {
    const room = bySize.find(r => pointInPolygon(label, r.polygon));
    if (room && !room.label) {
      room.label = label;
      room.id = label.id;
    }
  }
  return rooms;
}

// Width (east-west side) and depth of a rectangular room, or null if it isn't a rectangle.
// Corners in the middle of a straight side (where another wall joins) are ignored.
export function roomDimensions(room: Room): { width: number; depth: number } | null {
  const pts = room.polygon.filter((p, i, arr) => {
    const a = arr[(i - 1 + arr.length) % arr.length];
    const b = arr[(i + 1) % arr.length];
    return Math.abs((p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x)) > 1e-6;
  });
  if (pts.length !== 4) return null;
  for (let i = 0; i < 4; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % 4];
    const c = pts[(i + 2) % 4];
    const dot = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y);
    if (Math.abs(dot) > 1e-6 * Math.hypot(b.x - a.x, b.y - a.y) * Math.hypot(c.x - b.x, c.y - b.y) + 1e-9) return null;
  }
  const side = (i: number) => ({ dx: pts[(i + 1) % 4].x - pts[i].x, dy: pts[(i + 1) % 4].y - pts[i].y });
  const s0 = side(0);
  const s1 = side(1);
  const [w, d] = Math.abs(s0.dx) >= Math.abs(s1.dx) ? [s0, s1] : [s1, s0];
  return { width: Math.hypot(w.dx, w.dy), depth: Math.hypot(d.dx, d.dy) };
}

export const roomAt =(rooms: Room[], p: Vec) =>
  [...rooms].sort((a, b) => a.area - b.area).find(r => pointInPolygon(p, r.polygon));
