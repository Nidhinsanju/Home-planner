import { Background, itemSize, itemSpec, Plan, ROOM_TYPES, Vec, WALL_DEFAULTS } from './types';
import { imageRoomBounds, imageRoomCommands } from './imageRooms';
import {
  addItem, addOpening, addRectRoom, addWall, clearPlan, deleteItem, deleteOpening, deleteRoom, deleteWalls,
  moveOpeningTo, moveRoom, offsetWall, openingCenter, resizeItem, setRoomLabel, updateItem, updateOpening, updateWall, wallEnds,
  wallLength,
} from './ops';
import { detectRooms } from './rooms';
import { add, closestOnSegment, dist, lerp, sub, dot } from './geometry';

// Interprets the JSON commands produced by the AI assistant against a Plan. All coordinates
// are feet on the 2D plan (x to the right/east, y down/south, north is -y).

export type BuildCommand = Record<string, any>;

const num = (v: unknown, fallback: number) => {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
};
const hasPoint = (cmd: BuildCommand) => Number.isFinite(num(cmd.x, NaN)) && Number.isFinite(num(cmd.y, NaN));
const r1 = (n: number) => Math.round(n * 10) / 10;
// Furniture size fields of a command (width/depth/height in feet); missing ones are left alone.
const sizeOf = (cmd: BuildCommand) => {
  const v = (k: string) => (cmd[k] != null && num(cmd[k], NaN) > 0 ? num(cmd[k], NaN) : undefined);
  return { w: v('width'), d: v('depth'), h: v('height') };
};

// Unit vector on the plan for a compass or screen direction (north = up = -y).
function directionVector(d: unknown) {
  const s = String(d ?? '').toLowerCase().replace(/[\s_-]+/g, '');
  const ns = /north|up|top/.test(s) ? -1 : /south|down|bottom/.test(s) ? 1 : 0;
  const ew = /east|right/.test(s) ? 1 : /west|left/.test(s) ? -1 : 0;
  if (!ns && !ew) return null;
  const l = Math.hypot(ns, ew);
  return { x: ew / l, y: ns / l };
}

const ROOM_ALIASES: Record<string, string> = { bedroom: 'bed', bathroom: 'toilet', bath: 'toilet', puja: 'pooja', prayer: 'pooja', hall: 'living', garage: 'parking', stairs: 'staircase', storage: 'store', office: 'study' };
const normalizeRoomType = (t: unknown) => {
  const s = String(t || '').toLowerCase().trim();
  const id = ROOM_ALIASES[s] || s;
  return ROOM_TYPES.some(r => r.id === id) ? id : '';
};

// Extent of everything drawn, or null for an empty plan. With `house`, only the walls count
// (when there are any), so a sofa or car outside doesn't shift "the north-east of the house".
function planBounds(plan: Plan, house = false) {
  const pts = house && plan.corners.length ? plan.corners : [...plan.corners, ...plan.items];
  if (pts.length === 0) return null;
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  return { minX: r1(Math.min(...xs)), minY: r1(Math.min(...ys)), maxX: r1(Math.max(...xs)), maxY: r1(Math.max(...ys)) };
}

// Compact description of the plan for the AI prompt.
export function describePlan(plan: Plan) {
  const rooms = detectRooms(plan);
  return {
    units: 'feet',
    orientation: 'x grows to the east, y grows to the south (north is negative y)',
    bounds: planBounds(plan),
    rooms: rooms.map(r => {
      const xs = r.polygon.map(p => p.x);
      const ys = r.polygon.map(p => p.y);
      return {
        id: r.id,
        name: r.label?.name || '',
        type: r.label?.type || '',
        area: r1(r.area),
        center: { x: r1(r.center.x), y: r1(r.center.y) },
        bounds: { minX: r1(Math.min(...xs)), minY: r1(Math.min(...ys)), maxX: r1(Math.max(...xs)), maxY: r1(Math.max(...ys)) },
      };
    }),
    walls: plan.walls.map(w => {
      const { a, b } = wallEnds(plan, w);
      return { id: w.id, start: { x: r1(a.x), y: r1(a.y) }, end: { x: r1(b.x), y: r1(b.y) }, length: r1(dist(a, b)) };
    }),
    openings: plan.openings.map(o => {
      const c = openingCenter(plan, o);
      return { id: o.id, kind: o.kind, wallId: o.wallId, x: r1(c.x), y: r1(c.y), width: o.width };
    }),
    items: plan.items.map(i => {
      const s = itemSize(i);
      return { id: i.id, type: i.type, x: r1(i.x), y: r1(i.y), width: r1(s.w), depth: r1(s.d), height: r1(s.h) };
    }),
    ...(plan.background?.analysis ? { referenceDrawing: describeDrawing(plan.background) } : {}),
  };
}

// The uploaded floor plan as the vision model read it, positioned on the plan in feet.
function describeDrawing(bg: Background) {
  return {
    summary: bg.analysis?.summary ?? '',
    scaleSet: !!bg.calibrated,
    rooms: imageRoomBounds(bg).map(r => ({
      name: r.name, type: r.type,
      center: { x: r1((r.minX + r.maxX) / 2), y: r1((r.minY + r.maxY) / 2) },
      width: r1(r.maxX - r.minX), depth: r1(r.maxY - r.minY),
    })),
  };
}

function nearestWall(plan: Plan, p: { x: number; y: number }) {
  let best: { id: string; d: number } | null = null;
  for (const w of plan.walls) {
    const { a, b } = wallEnds(plan, w);
    const d = closestOnSegment(p, a, b).distance;
    if (!best || d < best.d) best = { id: w.id, d };
  }
  return best?.id;
}

// Small models often get ids wrong (inventing "room-123", or giving a name instead), so a room
// can also be found by name or type, or be the only room when the id merely looks like a room's.
// `name` is only a hint for actions where it isn't the new value (move/delete, not update).
function findTarget(plan: Plan, id: unknown, nameHint?: unknown) {
  const sid = String(id ?? '');
  const rooms = detectRooms(plan);
  const key = (s: unknown) => String(s ?? '').toLowerCase().replace(/[\s_-]+/g, ' ').trim();
  const room = rooms.find(r => r.id === sid)
    ?? [sid, nameHint].map(key).filter(Boolean).map(k =>
      rooms.find(r => key(r.label?.name) === k) ?? rooms.find(r => r.label?.type && (key(r.label.type) === k || normalizeRoomType(k) === r.label.type)),
    ).find(Boolean)
    ?? (rooms.length === 1 && /^room\b/i.test(sid) ? rooms[0] : undefined);
  if (room) return { kind: 'room' as const, room };
  const wall = plan.walls.find(w => w.id === sid);
  if (wall) return { kind: 'wall' as const, wall };
  const opening = plan.openings.find(o => o.id === sid);
  if (opening) return { kind: 'opening' as const, opening };
  const item = plan.items.find(i => i.id === sid);
  if (item) return { kind: 'item' as const, item };
  return null;
}

// Where a new w x d room goes. Small models are poor at coordinate arithmetic, so besides an
// explicit centre (x, y) a command can say it in words, and the room is placed touching:
// - "nextTo" (a room id or name) + "side": that side of that room, e.g. east of the kitchen;
// - "position": that side/corner of the whole house, e.g. "north-east".
// The room lines up with the neighbour's north (or west) edge so walls are shared.
function placeRoom(plan: Plan, cmd: BuildCommand, w: number, d: number): Vec | { error: string } {
  // Just outside box b in direction dir. North/south: above or below, west edges aligned.
  // East/west and corners: beside it, north edges aligned (south edges for a southern corner).
  const outside = (b: { minX: number; minY: number; maxX: number; maxY: number }, dir: Vec) => {
    const ew = Math.sign(dir.x), ns = Math.sign(dir.y);
    if (!ew) return { x: b.minX + w / 2, y: ns < 0 ? b.minY - d / 2 : b.maxY + d / 2 };
    return { x: ew > 0 ? b.maxX + w / 2 : b.minX - w / 2, y: ns > 0 ? b.maxY - d / 2 : b.minY + d / 2 };
  };
  if (cmd.nextTo != null) {
    const dir = directionVector(cmd.side ?? 'east');
    if (!dir) return { error: `I don't know the side "${cmd.side}".` };
    const target = findTarget(plan, cmd.nextTo, cmd.nextTo);
    if (target?.kind === 'room') {
      const xs = target.room.polygon.map(p => p.x), ys = target.room.polygon.map(p => p.y);
      return outside({ minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }, dir);
    }
    // The neighbour may be a room on the uploaded drawing that isn't built yet.
    const key = String(cmd.nextTo).toLowerCase().trim();
    const drawn = plan.background ? imageRoomBounds(plan.background).find(r => r.name.toLowerCase().trim() === key || r.type === normalizeRoomType(key)) : undefined;
    if (drawn) return outside(drawn, dir);
    return { error: `I couldn't find the room "${cmd.nextTo}" to build next to.` };
  }
  if (cmd.position != null && !hasPoint(cmd)) {
    const dir = directionVector(cmd.position);
    if (!dir) return { error: `I don't know the position "${cmd.position}".` };
    const b = planBounds(plan, true);
    return b ? outside(b, dir) : { x: 0, y: 0 };
  }
  return { x: num(cmd.x, 0), y: num(cmd.y, 0) };
}

export function applyCommand(plan: Plan, cmd: BuildCommand): { plan: Plan; error?: string } {
  const action = String(cmd?.action || '');
  const type = String(cmd?.type || '').toLowerCase();

  switch (action) {
    case 'build':
    case 'add':
    case 'create': {
      // A room type used as the build type ("type": "kitchen") means a room of that type.
      const roomAsType = type !== 'room' && !itemSpec(type) ? normalizeRoomType(type) : '';
      if (type === 'room' || roomAsType) {
        const roomType = normalizeRoomType(cmd.roomType ?? (roomAsType || cmd.name));
        const name = cmd.name ? String(cmd.name) : ROOM_TYPES.find(r => r.id === roomType)?.name || 'Room';
        const width = Math.max(2, num(cmd.width, 10)), depth = Math.max(2, num(cmd.depth, 10));
        const placed = placeRoom(plan, cmd, width, depth);
        if ('error' in placed) return { plan, error: placed.error };
        return { plan: addRectRoom(plan, { ...placed, width, depth }, WALL_DEFAULTS, { name, type: roomType }) };
      }
      if (type === 'wall') {
        const start = { x: num(cmd.x, -5), y: num(cmd.y, 0) };
        const end = { x: num(cmd.endX, start.x + 10), y: num(cmd.endY, start.y) };
        return { plan: addWall(plan, start, end).plan };
      }
      if (type === 'door' || type === 'window') {
        if (plan.walls.length === 0) return { plan, error: `There is no wall to place the ${type} on. Add a room or wall first.` };
        const pt = hasPoint(cmd) ? { x: num(cmd.x, 0), y: num(cmd.y, 0) } : null;
        const wallId = plan.walls.some(w => w.id === cmd.wallId) ? cmd.wallId : pt ? nearestWall(plan, pt) : plan.walls[plan.walls.length - 1].id;
        const wall = plan.walls.find(w => w.id === wallId)!;
        const { a, b } = wallEnds(plan, wall);
        const size: Record<string, number> = {};
        if (cmd.width != null) size.width = Math.max(1, num(cmd.width, 3));
        if (cmd.height != null) size.height = Math.max(1, num(cmd.height, 7));
        return { plan: addOpening(plan, wall.id, pt ?? lerp(a, b, 0.5), type, size) };
      }
      if (itemSpec(type)) {
        const next = addItem(plan, type, { x: num(cmd.x, 0), y: num(cmd.y, 0) }, (num(cmd.rotation, 0) * Math.PI) / 180);
        return { plan: resizeItem(next, next.items[next.items.length - 1].id, sizeOf(cmd)) };
      }
      return { plan, error: `I don't know how to build "${cmd?.type}".` };
    }

    case 'delete':
    case 'remove': {
      const target = findTarget(plan, cmd.id, cmd.name);
      if (!target) return { plan, error: `I couldn't find an item with id "${cmd.id}".` };
      if (target.kind === 'room') return { plan: deleteRoom(plan, target.room) };
      if (target.kind === 'wall') return { plan: deleteWalls(plan, [target.wall.id]) };
      if (target.kind === 'opening') return { plan: deleteOpening(plan, target.opening.id) };
      return { plan: deleteItem(plan, target.item.id) };
    }

    // Builds the rooms read from the uploaded drawing where they are on it (optionally only
    // the ones named in "rooms"), so the model never has to copy coordinates.
    case 'buildFromDrawing': {
      const bg = plan.background;
      if (!bg?.analysis?.rooms.length) return { plan, error: "I haven't read any rooms from an uploaded drawing yet. Upload a floor plan (Build tab → Background image) and let me read it first." };
      const wanted = Array.isArray(cmd.rooms) ? cmd.rooms.map((n: unknown) => String(n).toLowerCase().trim()) : null;
      const cmds = imageRoomCommands(bg).filter(c => !wanted || wanted.includes(c.name.toLowerCase().trim()) || wanted.includes(String(c.roomType).toLowerCase()));
      if (cmds.length === 0) return { plan, error: `The drawing has no room called ${wanted?.join(', ')}.` };
      const res = applyCommands(plan, cmds);
      return { plan: res.plan, error: res.errors.join(' ') || undefined };
    }

    case 'deleteAll':
      return { plan: clearPlan(plan) };

    case 'move': {
      const target = findTarget(plan, cmd.id, cmd.name);
      if (!target) return { plan, error: `I couldn't find an item with id "${cmd.id}".` };
      // Relative moves are easier for the model than working out a new position. A compass
      // direction + distance is the most reliable (small models often get the sign of dy wrong).
      const dir = directionVector(cmd.direction);
      const offset = dir
        ? { x: dir.x * Math.abs(num(cmd.distance, 3)), y: dir.y * Math.abs(num(cmd.distance, 3)) }
        : cmd.dx != null || cmd.dy != null ? { x: num(cmd.dx, 0), y: num(cmd.dy, 0) } : null;
      if (cmd.direction != null && !dir) return { plan, error: `I don't know the direction "${cmd.direction}".` };
      if (!offset && !hasPoint(cmd)) return { plan, error: 'A move needs a direction and distance, or x and y coordinates.' };
      const from = target.kind === 'room' ? target.room.center
        : target.kind === 'item' ? target.item
        : target.kind === 'opening' ? openingCenter(plan, target.opening)
        : lerp(wallEnds(plan, target.wall).a, wallEnds(plan, target.wall).b, 0.5);
      const p = offset ? add(from, offset) : { x: num(cmd.x, 0), y: num(cmd.y, 0) };
      if (target.kind === 'item') return { plan: updateItem(plan, target.item.id, p) };
      if (target.kind === 'opening') return { plan: moveOpeningTo(plan, target.opening.id, p) };
      if (target.kind === 'room') return { plan: moveRoom(plan, target.room, sub(p, target.room.center)) };
      // Walls move sideways so that they pass through (x, y).
      const { a, b } = wallEnds(plan, target.wall);
      const mid = lerp(a, b, 0.5);
      const d = sub(b, a);
      const l = wallLength(plan, target.wall) || 1;
      const n = { x: -d.y / l, y: d.x / l };
      return { plan: offsetWall(plan, target.wall.id, dot(sub(p, mid), n)) };
    }

    case 'update':
    case 'rename': {
      const target = findTarget(plan, cmd.id);
      if (!target) return { plan, error: `I couldn't find an item with id "${cmd.id}".` };
      if (target.kind === 'room') {
        const data: { name?: string; type?: string } = {};
        if (cmd.name != null) data.name = String(cmd.name);
        if (cmd.roomType != null) data.type = normalizeRoomType(cmd.roomType);
        return { plan: setRoomLabel(plan, target.room, data) };
      }
      if (target.kind === 'wall') {
        const data: Record<string, number> = {};
        if (cmd.thickness != null) data.thickness = Math.max(0.1, num(cmd.thickness, 0.5));
        if (cmd.height != null) data.height = Math.max(1, num(cmd.height, 9));
        return { plan: updateWall(plan, target.wall.id, data) };
      }
      if (target.kind === 'opening') {
        const data: Record<string, number> = {};
        for (const k of ['width', 'height', 'sill'] as const) if (cmd[k] != null) data[k] = Math.max(0, num(cmd[k], 0));
        return { plan: updateOpening(plan, target.opening.id, data) };
      }
      let next = resizeItem(plan, target.item.id, sizeOf(cmd));
      if (cmd.rotation != null) next = updateItem(next, target.item.id, { rotation: (num(cmd.rotation, 0) * Math.PI) / 180 });
      return { plan: next };
    }

    default:
      return { plan, error: `Unknown action "${action}".` };
  }
}

export function applyCommands(plan: Plan, cmds: BuildCommand[]) {
  const errors: string[] = [];
  let next = plan;
  for (const cmd of cmds) {
    const res = applyCommand(next, cmd);
    next = res.plan;
    if (res.error) errors.push(res.error);
  }
  return { plan: next, errors };
}
