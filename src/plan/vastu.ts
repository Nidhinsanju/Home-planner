import type { Plan, Vec } from './types';
import { normalizeRoomType, roomType } from './types';
import { detectRooms, roomInterior, type Room } from './rooms';
import { centroid, pointInPolygon } from './geometry';
import { setRoomLabel, wallEnds, openingCenter } from './ops';

// Vastu analysis of a plan, done with rules in code (not by the AI), so the same plan always
// gets the same score and every point has a reason. The AI only explains it.
//
// The house is divided into the Vastu grid: its outline's bounding box, measured along the
// compass directions, cut into 3 x 3 zones (the eight directions and the centre, the
// Brahmasthan). Each room falls in the zone of its middle. North comes from the plan's
// `northDeg` (the angle of true north clockwise from "up" on the plan; 0 = up).

export type Zone = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW' | 'C';
export type Status = 'good' | 'ok' | 'fair' | 'bad';
export type VastuCheck = {
  id: string;
  title: string;
  status: Status;
  weight: number;
  reason: string;
  roomId?: string; // the room's label id
  zone?: Zone;
  // A remedy that needs no rebuilding, for rooms that can't simply change use (kitchen, toilets).
  tip?: string;
  // A one-click fix: swap the use (name and type) of two rooms, and the points it gains.
  fix?: { swap: [string, string]; gain: number; text: string };
};
export type VastuReport = {
  score: number; // 0..100
  northDeg: number;
  checks: VastuCheck[];
  rooms: { id: string; name: string; type: string; zone: Zone; area: number }[];
  untyped: string[]; // rooms without a type (they can't be checked)
  entrance?: { facing: Zone; at: Vec };
  grid: { lines: [Vec, Vec][]; labels: { zone: Zone; at: Vec }[]; centre: Vec; north: Vec };
};

export const ZONE_NAMES: Record<Zone, string> = {
  N: 'North', NE: 'North-East', E: 'East', SE: 'South-East', S: 'South', SW: 'South-West', W: 'West', NW: 'North-West', C: 'Centre (Brahmasthan)',
};

// Where each kind of room belongs, from the commonly followed Vastu Shastra guidelines.
// Zones not listed count as "fair".
type Rule = { ideal: Zone[]; ok: Zone[]; avoid: Zone[]; why: string };
const RULES: Record<string, Rule> = {
  kitchen: { ideal: ['SE'], ok: ['NW', 'E'], avoid: ['NE', 'SW', 'N', 'C'], why: 'the South-East is the zone of fire (Agni); the North-West is the accepted alternative' },
  master: { ideal: ['SW'], ok: ['S', 'W'], avoid: ['NE', 'SE', 'C'], why: 'the South-West gives the head of the family stability' },
  bed: { ideal: ['W', 'NW', 'S'], ok: ['N', 'E', 'SW'], avoid: ['NE', 'SE', 'C'], why: 'bedrooms suit the West, North-West and South; the North-East and South-East are avoided' },
  toilet: { ideal: ['NW', 'W'], ok: ['S', 'SE', 'E'], avoid: ['NE', 'SW', 'C'], why: 'toilets belong in the North-West or West, never in the sacred North-East, the South-West or the centre' },
  pooja: { ideal: ['NE'], ok: ['N', 'E'], avoid: ['S', 'SW', 'SE'], why: 'the North-East (Ishanya) is the zone of worship' },
  living: { ideal: ['NE', 'N', 'E'], ok: ['NW', 'W'], avoid: ['SW'], why: 'living areas suit the light, open North and East' },
  dining: { ideal: ['W'], ok: ['N', 'E', 'S', 'C'], avoid: [], why: 'the West is best for dining, close to the kitchen' },
  study: { ideal: ['NE', 'N', 'E', 'W'], ok: ['NW'], avoid: ['SE'], why: 'study rooms suit the North-East, North, East and West' },
  store: { ideal: ['SW', 'S', 'W'], ok: ['NW'], avoid: ['NE', 'C'], why: 'heavy storage belongs in the South-West; keep the North-East light' },
  utility: { ideal: ['NW', 'SE'], ok: ['W', 'S'], avoid: ['NE', 'C'], why: 'utility and laundry suit the North-West or South-East' },
  staircase: { ideal: ['S', 'W', 'SW'], ok: ['SE', 'NW'], avoid: ['NE', 'C', 'N'], why: 'stairs are heavy: South, West or South-West, never the North-East or centre' },
  balcony: { ideal: ['N', 'E', 'NE'], ok: ['NW', 'SE'], avoid: ['SW'], why: 'open spaces belong in the North and East' },
  parking: { ideal: ['NW', 'SE'], ok: ['N', 'E'], avoid: ['NE', 'SW'], why: 'parking suits the North-West or South-East' },
};
const ENTRANCE: Rule = { ideal: ['N', 'NE', 'E'], ok: ['NW', 'W'], avoid: ['SW'], why: 'entrances facing North, North-East or East are the most auspicious; South-West is avoided' };
// Rooms that must not sit in the centre of the house (it should stay open and light).
const HEAVY_IN_CENTRE = new Set(['toilet', 'kitchen', 'staircase', 'store', 'utility']);
// Rooms whose use can be swapped to fix a placement: dry rooms only (a kitchen or toilet can't
// move into a bedroom without new plumbing; those get a remedy instead).
const SWAPPABLE = new Set(['bed', 'pooja', 'living', 'dining', 'study']);
// Rooms smaller than this are closets, ducts and the like: listed, not scored (wet rooms and
// pooja rooms are always scored).
const MIN_SCORED_AREA = 40;
const ALWAYS_SCORED = new Set(['toilet', 'pooja', 'kitchen', 'staircase']);
// Remedies commonly suggested when a room can't be moved.
const TIPS: Record<string, string> = {
  kitchen: "If it can't move: put the stove in the kitchen's South-East corner so the cook faces East, keep the sink away from the stove, and use warm colours.",
  toilet: "If it can't move: keep the door closed, use an exhaust fan, keep it dry and clean, and use light colours; place the WC along the South or West wall.",
  master: "If it can't move: sleep with your head to the South or East, and put heavy furniture (wardrobes) on the South and West walls.",
  bed: "If it can't move: sleep with your head to the South or East, and keep the North-East corner of the room light and clutter-free.",
  staircase: "If it can't move: make it climb clockwise and keep the space under it free of toilets and pooja.",
  entrance: "If it can't move: keep the entrance well lit and clean, add a sturdy door with a threshold, and place auspicious symbols (swastik, toran) at the door.",
};

const VALUE: Record<Status, number> = { good: 1, ok: 0.75, fair: 0.4, bad: 0 };
const ROOM_WEIGHT: Record<string, number> = { kitchen: 15, master: 15, pooja: 10, toilet: 6, bed: 6, living: 6, dining: 4, study: 4, store: 3, utility: 3, staircase: 6, balcony: 2, parking: 2 };

const rate = (rule: Rule, zone: Zone): Status => (rule.ideal.includes(zone) ? 'good' : rule.ok.includes(zone) ? 'ok' : rule.avoid.includes(zone) ? 'bad' : 'fair');
const list = (zones: Zone[]) => zones.map(z => ZONE_NAMES[z]).join(' or ');

// Compass frame: east and north as unit vectors on the plan (y grows down the screen).
function frame(northDeg: number) {
  const t = (northDeg * Math.PI) / 180;
  const north = { x: Math.sin(t), y: -Math.cos(t) };
  const east = { x: Math.cos(t), y: Math.sin(t) };
  return { north, east };
}

// The compass direction (8-way) a vector on the plan points to.
function directionOf(v: Vec, northDeg: number): Zone {
  const { north, east } = frame(northDeg);
  const ang = (Math.atan2(v.x * east.x + v.y * east.y, v.x * north.x + v.y * north.y) * 180) / Math.PI; // 0 = N, 90 = E
  const dirs: Zone[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[((Math.round(ang / 45) % 8) + 8) % 8];
}

const typeOf = (r: Room) => normalizeRoomType(r.label?.type) || normalizeRoomType(r.label?.name);

export function analyzeVastu(plan: Plan, northDeg = plan.northDeg ?? 0): VastuReport | null {
  const rooms = detectRooms(plan);
  if (rooms.length === 0) return null;
  const { north, east } = frame(northDeg);
  const toC = (p: Vec) => ({ e: p.x * east.x + p.y * east.y, n: p.x * north.x + p.y * north.y });
  const fromC = (e: number, n: number): Vec => ({ x: e * east.x + n * north.x, y: e * east.y + n * north.y });

  // The Vastu grid over the house.
  const pts = rooms.flatMap(r => r.polygon.map(toC));
  const e0 = Math.min(...pts.map(p => p.e)), e1 = Math.max(...pts.map(p => p.e));
  const n0 = Math.min(...pts.map(p => p.n)), n1 = Math.max(...pts.map(p => p.n));
  const zoneAt = (p: Vec): Zone => {
    const c = toC(p);
    const col = Math.min(2, Math.max(0, Math.floor(((c.e - e0) / (e1 - e0 || 1)) * 3)));
    const row = Math.min(2, Math.max(0, Math.floor(((c.n - n0) / (n1 - n0 || 1)) * 3)));
    const grid: Zone[][] = [['SW', 'S', 'SE'], ['W', 'C', 'E'], ['NW', 'N', 'NE']];
    return grid[row][col];
  };
  const centre = fromC((e0 + e1) / 2, (n0 + n1) / 2);

  const info = rooms.map(r => {
    const inside = roomInterior(plan, r);
    const mid = pointInPolygon(centroid(inside.polygon), r.polygon) ? centroid(inside.polygon) : r.center;
    return { room: r, type: typeOf(r), zone: zoneAt(mid), area: inside.area };
  });
  // The largest bedroom is the master bedroom.
  const beds = info.filter(i => i.type === 'bed').sort((a, b) => b.area - a.area);
  const master = beds[0]?.room.id;
  const ruleKey = (i: (typeof info)[number]) => (i.room.id === master ? 'master' : i.type);

  const checks: VastuCheck[] = [];

  // Main entrance: the widest door in an outside wall (a wall of only one room).
  const owners = new Map<string, number>();
  for (const r of rooms) for (const id of r.wallIds) owners.set(id, (owners.get(id) ?? 0) + 1);
  const outer = plan.openings
    .filter(o => o.kind === 'door' && (owners.get(o.wallId) ?? 0) <= 1)
    .sort((a, b) => b.width - a.width)[0];
  let entrance: VastuReport['entrance'];
  if (outer) {
    const wall = plan.walls.find(w => w.id === outer.wallId)!;
    const { a, b } = wallEnds(plan, wall);
    const at = openingCenter(plan, outer);
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    let n = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
    // Outward: away from the room the wall belongs to.
    const room = rooms.find(r => r.wallIds.includes(wall.id));
    if (room && pointInPolygon({ x: at.x + n.x * 0.6, y: at.y + n.y * 0.6 }, room.polygon)) n = { x: -n.x, y: -n.y };
    const facing = directionOf(n, northDeg);
    entrance = { facing, at };
    const status = rate(ENTRANCE, facing);
    checks.push({
      id: 'entrance', title: 'Main entrance', status, weight: 20, zone: facing, ...(status === 'good' || status === 'ok' ? {} : { tip: TIPS.entrance }),
      reason: status === 'good' ? `It faces ${ZONE_NAMES[facing]}: ${ENTRANCE.why}.` : `It faces ${ZONE_NAMES[facing]}. Best is ${list(ENTRANCE.ideal)}: ${ENTRANCE.why}.`,
    });
  } else {
    checks.push({ id: 'entrance', title: 'Main entrance', status: 'fair', weight: 20, reason: 'No door in an outside wall was found, so the entrance could not be checked. Add the main door to an outside wall.' });
  }

  // Each room against its rule.
  for (const i of info) {
    const key = ruleKey(i);
    const rule = RULES[key];
    if (!rule || (i.area < MIN_SCORED_AREA && !ALWAYS_SCORED.has(i.type))) continue;
    const status = rate(rule, i.zone);
    const name = i.room.label?.name || roomType(i.type)?.name || 'Room';
    const what = key === 'master' ? `${name} (master bedroom)` : name;
    checks.push({
      id: `room-${i.room.id}`, title: what, status, weight: ROOM_WEIGHT[key] ?? 3, roomId: i.room.label?.id, zone: i.zone,
      ...(status !== 'good' && status !== 'ok' && TIPS[key] ? { tip: TIPS[key] } : {}),
      reason: status === 'good'
        ? `In the ${ZONE_NAMES[i.zone]}: ${rule.why}.`
        : `In the ${ZONE_NAMES[i.zone]}. Best is ${list(rule.ideal)}${rule.ok.length ? ` (or ${list(rule.ok)})` : ''}: ${rule.why}.`,
    });
  }

  // The centre (Brahmasthan) should stay open: no heavy or wet rooms over it.
  const atCentre = info.filter(i => pointInPolygon(centre, i.room.polygon));
  const heavy = atCentre.filter(i => HEAVY_IN_CENTRE.has(i.type));
  checks.push({
    id: 'centre', title: 'Centre (Brahmasthan)', weight: 10,
    status: heavy.length ? 'bad' : 'good',
    reason: heavy.length
      ? `${heavy.map(i => i.room.label?.name || i.type).join(', ')} covers the centre of the house, which should be kept open and light.`
      : `The centre${atCentre[0] ? ` (${atCentre[0].room.label?.name || 'open area'})` : ''} is kept free of toilets, kitchen, stairs and storage.`,
  });

  const total = checks.reduce((s, c) => s + c.weight, 0);
  const score = Math.round((checks.reduce((s, c) => s + c.weight * VALUE[c.status], 0) / total) * 100);

  // Grid lines and zone labels on the plan, for the overlay.
  const lines: [Vec, Vec][] = [];
  for (let k = 0; k <= 3; k++) {
    const e = e0 + ((e1 - e0) * k) / 3, n = n0 + ((n1 - n0) * k) / 3;
    lines.push([fromC(e, n0), fromC(e, n1)], [fromC(e0, n), fromC(e1, n)]);
  }
  const grid: Zone[][] = [['SW', 'S', 'SE'], ['W', 'C', 'E'], ['NW', 'N', 'NE']];
  const labels = grid.flatMap((row, r) => row.map((zone, c) => ({ zone, at: fromC(e0 + ((e1 - e0) * (c + 0.5)) / 3, n0 + ((n1 - n0) * (r + 0.5)) / 3) })));

  return {
    score,
    northDeg,
    checks,
    rooms: info.map(i => ({ id: i.room.label?.id ?? i.room.id, name: i.room.label?.name || roomType(i.type)?.name || 'Room', type: i.type, zone: i.zone, area: i.area })),
    untyped: info.filter(i => !i.type).map(i => i.room.label?.name || 'Unnamed room'),
    ...(entrance ? { entrance } : {}),
    grid: { lines, labels, centre, north },
  };
}

// Swaps the use (name and type) of two rooms: the usual Vastu remedy of using a room in the
// right zone for the right purpose, without moving walls.
export function swapRoomUse(plan: Plan, labelA: string, labelB: string): Plan {
  const rooms = detectRooms(plan);
  const a = rooms.find(r => r.label?.id === labelA), b = rooms.find(r => r.label?.id === labelB);
  if (!a?.label || !b?.label) return plan;
  const la = { name: a.label.name, type: a.label.type }, lb = { name: b.label.name, type: b.label.type };
  return setRoomLabel(setRoomLabel(plan, a, lb), b, la);
}

// The analysis with one-click fixes added: for each badly placed room, the swap with a room of
// similar size that raises the score most (if any does).
export function vastuReport(plan: Plan, northDeg = plan.northDeg ?? 0): VastuReport | null {
  const report = analyzeVastu(plan, northDeg);
  if (!report) return null;
  const rooms = report.rooms;
  for (const c of report.checks) {
    if (!c.roomId || c.status === 'good' || c.status === 'ok') continue;
    const me = rooms.find(r => r.id === c.roomId);
    if (!me || !SWAPPABLE.has(me.type)) continue;
    let best: { other: (typeof rooms)[number]; gain: number } | null = null;
    for (const other of rooms) {
      if (other.id === me.id || !SWAPPABLE.has(other.type) || other.type === me.type) continue;
      const ratio = other.area / (me.area || 1);
      if (ratio < 0.6 || ratio > 1.7) continue; // a kitchen won't fit in a closet
      const swapped = analyzeVastu(swapRoomUse(plan, me.id, other.id), northDeg);
      const gain = (swapped?.score ?? 0) - report.score;
      if (gain >= 3 && (!best || gain > best.gain)) best = { other, gain };
    }
    if (best) c.fix = { swap: [me.id, best.other.id], gain: best.gain, text: `Use ${best.other.name} (${ZONE_NAMES[best.other.zone]}) as the ${me.name}, and ${me.name} as the ${best.other.name}` };
  }
  return report;
}

// A short summary for the AI and the chat.
export function vastuSummary(report: VastuReport) {
  const issues = report.checks.filter(c => c.status === 'bad' || c.status === 'fair');
  return {
    score: report.score,
    northIsDegreesClockwiseFromUp: report.northDeg,
    entranceFacing: report.entrance ? ZONE_NAMES[report.entrance.facing] : null,
    rooms: report.rooms.map(r => `${r.name}: ${ZONE_NAMES[r.zone]}`),
    issues: issues.map(c => `${c.title} (${c.status}): ${c.reason}${c.fix ? ` Fix: ${c.fix.text} (+${c.fix.gain} points).` : ''}`),
    good: report.checks.filter(c => c.status === 'good').map(c => c.title),
    untypedRooms: report.untyped,
  };
}
