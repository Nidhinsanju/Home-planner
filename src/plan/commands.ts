import { Background, itemSize, itemSpec, normalizeRoomType, Plan, ROOM_TYPES, roomType, Vec, WALL_DEFAULTS } from './types';
import { imageRoomBounds } from './imageRooms';
import { buildFromDrawing, drawingLayout } from './buildDrawing';
import {
  addItem, addOpening, addRectRoom, addWall, clearPlan, deleteItem, deleteOpening, deleteRoom, deleteWalls,
  moveCorners, moveOpeningTo, moveRoom, offsetWall, openingCenter, resizeItem, setRoomLabel, updateItem, updateOpening, updateWall, wallEnds,
  wallLength,
} from './ops';
import { detectRooms, insideDimensions, Room, roomInterior } from './rooms';
import { analyzeVastu, swapRoomUse, vastuSummary } from './vastu';
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
      const inside = insideDimensions(plan, r);
      return {
        id: r.id,
        name: r.label?.name || '',
        type: r.label?.type || '',
        // Inside the walls, as sizes are written on plans; bounds are wall centre-lines.
        ...(inside ? { insideSize: `${r1(inside.width)} x ${r1(inside.depth)}` } : {}),
        area: r1(roomInterior(plan, r).area),
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
    ...(plan.background?.analysis ? { referenceDrawing: describeDrawing(plan, plan.background) } : {}),
    // The app's own Vastu analysis (rules in code): what the AI explains and builds on.
    ...(() => { const r = analyzeVastu(plan); return r ? { vastu: vastuSummary(r) } : {}; })(),
    // Built from the uploaded drawing: changes are made to it with commands, not by redrawing.
    ...(plan.background?.use === 'build' && rooms.length ? { builtFromDrawing: true } : {}),
  };
}

// The uploaded floor plan as the vision model read it, positioned on the plan in feet.
function describeDrawing(plan: Plan, bg: Background) {
  const layout = drawingLayout(plan);
  if (layout && !('error' in layout)) {
    const ex = bg.analysis!.extraction!;
    return {
      summary: bg.analysis?.summary ?? '',
      scale: `${r1(layout.pxPerFt)} px per ft, worked out from the written room sizes`,
      rooms: layout.payload.rooms.map((r, i) => {
        const xs = r.polygon.map(p => p[0]), ys = r.polygon.map(p => p[1]);
        return {
          name: r.name, type: r.type, writtenSize: ex.rooms[i]?.label ?? null,
          bounds: { minX: r1(Math.min(...xs)), minY: r1(Math.min(...ys)), maxX: r1(Math.max(...xs)), maxY: r1(Math.max(...ys)) },
          openTo: ex.rooms[i]?.openTo ?? [],
        };
      }),
      doors: ex.doors.length,
      windows: ex.windows.length,
    };
  }
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

// A room by id, name or type; an error message if there is none.
function roomRef(plan: Plan, ref: unknown): Room | string {
  const t = findTarget(plan, ref, ref);
  return t?.kind === 'room' ? t.room : `I couldn't find the room "${ref}".`;
}

// A room's walls along one of its sides (north = smallest y).
function sideWalls(plan: Plan, room: Room, side: string) {
  const dir = directionVector(side);
  if (!dir || (dir.x && dir.y)) return [];
  const along = (p: Vec) => p.x * dir.x + p.y * dir.y;
  const edge = Math.max(...room.polygon.map(along));
  return plan.walls.filter(w => {
    if (!room.wallIds.includes(w.id) || w.divider) return false;
    const { a, b } = wallEnds(plan, w);
    return Math.abs(along(a) - edge) < 0.05 && Math.abs(along(b) - edge) < 0.05;
  });
}

// Walls two rooms share, and the longest of some walls.
const sharedWalls = (plan: Plan, a: Room, b: Room) => plan.walls.filter(w => a.wallIds.includes(w.id) && b.wallIds.includes(w.id));
const longest = (plan: Plan, walls: Plan['walls']) => [...walls].sort((p, q) => wallLength(plan, q) - wallLength(plan, p))[0];

// Sets a rectangular room's inside width and/or depth by moving one of its sides (the east and
// south sides unless "side" says west or north). Walls attached to that side stretch to follow,
// so the rooms next to it change with it, as when dragging a wall.
function resizeRoom(plan: Plan, room: Room, cmd: BuildCommand): { plan: Plan; error?: string } {
  const dims = insideDimensions(plan, room);
  if (!dims) return { plan, error: `${room.label?.name || 'That room'} isn't a rectangle, so I can't set its width and depth. Move one of its walls instead.` };
  const side = String(cmd.side ?? '').toLowerCase();
  let next = plan;
  const moveSide = (dirName: string, by: number) => {
    const dir = directionVector(dirName)!;
    const along = (p: Vec) => p.x * dir.x + p.y * dir.y;
    const edge = Math.max(...room.polygon.map(along));
    const pos = new Map(next.corners.map(c => [c.id, c]));
    const ids = room.cornerIds.filter(id => pos.has(id) && Math.abs(along(pos.get(id)!) - edge) < 0.05);
    next = moveCorners(next, ids, { x: dir.x * by, y: dir.y * by });
  };
  if (cmd.width != null) {
    const w = num(cmd.width, NaN);
    if (!(w >= 2)) return { plan, error: 'The new width must be at least 2 ft.' };
    moveSide(/west|left/.test(side) ? 'west' : 'east', w - dims.width);
  }
  if (cmd.depth != null) {
    const d = num(cmd.depth, NaN);
    if (!(d >= 2)) return { plan, error: 'The new depth must be at least 2 ft.' };
    moveSide(/north|up|top/.test(side) ? 'north' : 'south', d - dims.depth);
  }
  if (next === plan) return { plan, error: 'A resize needs a new "width" and/or "depth" in feet.' };
  return { plan: next };
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
        // The size asked for is the inside size; walls are drawn on their centre-lines.
        const t = WALL_DEFAULTS.thickness;
        const width = Math.max(2, num(cmd.width, 10)) + t, depth = Math.max(2, num(cmd.depth, 10)) + t;
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
        let pt = hasPoint(cmd) ? { x: num(cmd.x, 0), y: num(cmd.y, 0) } : null;
        let wallId: string | undefined = plan.walls.some(w => w.id === cmd.wallId) ? cmd.wallId : undefined;
        // By rooms instead of coordinates: between two rooms, or on a room (one side of it).
        if (!wallId && Array.isArray(cmd.between) && cmd.between.length === 2) {
          const [a, b] = cmd.between.map((r: unknown) => roomRef(plan, r));
          if (typeof a === 'string') return { plan, error: a };
          if (typeof b === 'string') return { plan, error: b };
          const wall = longest(plan, sharedWalls(plan, a, b).filter(w => !w.divider));
          if (!wall) return { plan, error: `${a.label?.name} and ${b.label?.name} don't share a wall, so there's nowhere to put a ${type} between them.` };
          wallId = wall.id;
          pt = null;
        } else if (!wallId && cmd.room != null) {
          const room = roomRef(plan, cmd.room);
          if (typeof room === 'string') return { plan, error: room };
          const walls = cmd.side != null ? sideWalls(plan, room, String(cmd.side)) : plan.walls.filter(w => room.wallIds.includes(w.id) && !w.divider);
          const wall = longest(plan, walls);
          if (!wall) return { plan, error: `${room.label?.name} has no wall${cmd.side != null ? ` on its ${cmd.side} side` : ''} to put a ${type} on.` };
          wallId = wall.id;
          pt = null;
        }
        wallId ??= pt ? nearestWall(plan, pt) : plan.walls[plan.walls.length - 1].id;
        const wall = plan.walls.find(w => w.id === wallId)!;
        const { a, b } = wallEnds(plan, wall);
        const size: Record<string, number> = {};
        if (cmd.width != null) size.width = Math.max(1, num(cmd.width, 3));
        if (cmd.height != null) size.height = Math.max(1, num(cmd.height, 7));
        return { plan: addOpening(plan, wall.id, pt ?? lerp(a, b, 0.5), type, size) };
      }
      if (itemSpec(type)) {
        // In a room (at its centre) when no position is given.
        let at: Vec = { x: num(cmd.x, 0), y: num(cmd.y, 0) };
        if (!hasPoint(cmd) && cmd.room != null) {
          const room = roomRef(plan, cmd.room);
          if (typeof room === 'string') return { plan, error: room };
          at = room.center;
        }
        const next = addItem(plan, type, at, (num(cmd.rotation, 0) * Math.PI) / 180);
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
      const only = Array.isArray(cmd.rooms) ? cmd.rooms.map((n: unknown) => String(n)) : undefined;
      const built = buildFromDrawing(plan, only);
      if (built) return 'error' in built ? { plan, error: built.error } : { plan: built.plan, error: built.result.errors.join(' ') || undefined };
      // Read before the full reader existed: too imprecise to build from.
      return { plan, error: 'This drawing was read by an older reader, so I can\'t build it to scale. Press "Re-read floor plan" on the image card in the chat, then ask me again.' };
    }

    case 'deleteAll':
      return { plan: clearPlan(plan) };

    // Swaps what two rooms are used for (their names and types), the usual Vastu remedy.
    case 'swapRooms': {
      if (!Array.isArray(cmd.between) || cmd.between.length !== 2) return { plan, error: 'swapRooms needs "between": two room names.' };
      const [a, b] = cmd.between.map((r: unknown) => roomRef(plan, r));
      if (typeof a === 'string') return { plan, error: a };
      if (typeof b === 'string') return { plan, error: b };
      if (!a.label || !b.label || a.label.id === b.label.id) return { plan, error: 'Pick two different rooms to swap.' };
      return { plan: swapRoomUse(plan, a.label.id, b.label.id) };
    }

    // Where true north is on the plan: degrees clockwise from "up" (0 = up, 90 = right).
    case 'setNorth': {
      const deg = num(cmd.degrees ?? cmd.deg ?? cmd.northDeg, NaN);
      const named: Record<string, number> = { up: 0, top: 0, right: 90, down: 180, bottom: 180, left: 270 };
      const value = Number.isFinite(deg) ? deg : named[String(cmd.direction ?? '').toLowerCase()];
      if (value == null || !Number.isFinite(value)) return { plan, error: 'setNorth needs "degrees" (0 = north is up on the plan, 90 = right).' };
      return { plan: { ...plan, northDeg: ((Math.round(value) % 360) + 360) % 360 } };
    }

    // Sets a rectangular room's inside size.
    case 'resize': {
      const room = roomRef(plan, cmd.id ?? cmd.room ?? cmd.name);
      if (typeof room === 'string') return { plan, error: room };
      return resizeRoom(plan, room, cmd);
    }

    // Opens up the wall between two rooms (it stays on the plan as a divider, isn't built in
    // 3D and loses its doors), or closes it again.
    case 'openWall':
    case 'closeWall': {
      if (!Array.isArray(cmd.between) || cmd.between.length !== 2) return { plan, error: `${action} needs "between": two room names.` };
      const [a, b] = cmd.between.map((r: unknown) => roomRef(plan, r));
      if (typeof a === 'string') return { plan, error: a };
      if (typeof b === 'string') return { plan, error: b };
      const walls = sharedWalls(plan, a, b);
      if (!walls.length) return { plan, error: `${a.label?.name} and ${b.label?.name} don't share a wall.` };
      return { plan: walls.reduce((p, w) => updateWall(p, w.id, { divider: action === 'openWall' }), plan) };
    }

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

// Why a command that changes something already on the plan can't find it (null when it can,
// or when the command doesn't change an existing thing).
function missingTarget(plan: Plan, cmd: BuildCommand): string | null {
  const room = (ref: unknown) => { const r = roomRef(plan, ref); return typeof r === 'string' ? r : null; };
  switch (String(cmd?.action ?? '')) {
    case 'delete':
    case 'remove':
    case 'move':
      return findTarget(plan, cmd.id, cmd.name) ? null : `I couldn't find "${cmd.name ?? cmd.id}" on the plan.`;
    case 'update':
    case 'rename':
      return findTarget(plan, cmd.id) ? null : `I couldn't find "${cmd.id}" on the plan.`;
    case 'resize':
      return room(cmd.id ?? cmd.room ?? cmd.name);
    case 'swapRooms':
    case 'openWall':
    case 'closeWall':
      return Array.isArray(cmd.between) ? cmd.between.map(room).find(Boolean) ?? null : null;
    default:
      return null;
  }
}

// With `allOrNothing`, a command that changes something not on the plan (e.g. "replace the
// balcony" when there is none) cancels the whole set, so half a request is never carried out.
export function applyCommands(plan: Plan, cmds: BuildCommand[], { allOrNothing = false } = {}) {
  const errors: string[] = [];
  let next = plan;
  for (const cmd of cmds) {
    const missing = allOrNothing ? missingTarget(next, cmd) : null;
    if (missing) return { plan, errors: [`${missing} So I didn't change anything.`], missingTarget: true };
    const res = applyCommand(next, cmd);
    next = res.plan;
    if (res.error) errors.push(res.error);
  }
  return { plan: next, errors };
}

// One command in plain words, for showing the user what an AI change did.
export function describeCommand(plan: Plan, cmd: BuildCommand): string {
  const name = (ref: unknown) => {
    const t = findTarget(plan, ref, ref);
    return t?.kind === 'room' ? t.room.label?.name || 'a room' : String(ref ?? '');
  };
  const pair = (v: unknown) => (Array.isArray(v) && v.length === 2 ? `${name(v[0])} and ${name(v[1])}` : 'two rooms');
  switch (String(cmd?.action ?? '')) {
    case 'swapRooms': return `Swapped the use of ${pair(cmd.between)}`;
    case 'update':
    case 'rename': return `Changed ${name(cmd.id)}${cmd.roomType ? ` to a ${roomType(normalizeRoomType(cmd.roomType))?.name ?? cmd.roomType}` : ''}${cmd.name ? ` named "${cmd.name}"` : ''}`;
    case 'move': return cmd.direction ? `Moved ${name(cmd.id)} ${cmd.distance ?? 3} ft ${cmd.direction}` : `Moved ${name(cmd.id)}`;
    case 'resize': return `Resized ${name(cmd.id ?? cmd.room)} to ${[cmd.width, cmd.depth].filter(v => v != null).join(' x ')} ft`;
    case 'openWall': return `Opened the wall between ${pair(cmd.between)}`;
    case 'closeWall': return `Closed the wall between ${pair(cmd.between)}`;
    case 'build': return `Added a ${cmd.type}${cmd.between ? ` between ${pair(cmd.between)}` : cmd.room ? ` to ${name(cmd.room)}${cmd.side ? ` (${cmd.side} side)` : ''}` : ''}`;
    default: return String(cmd?.action ?? 'change');
  }
}
