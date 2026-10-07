import { itemSpec, Plan, ROOM_TYPES, WALL_DEFAULTS } from './types';
import {
  addItem, addOpening, addRectRoom, addWall, clearPlan, deleteItem, deleteOpening, deleteRoom, deleteWalls,
  moveOpeningTo, moveRoom, offsetWall, openingCenter, setRoomLabel, updateItem, updateOpening, updateWall, wallEnds,
  wallLength,
} from './ops';
import { detectRooms } from './rooms';
import { closestOnSegment, dist, lerp, sub, dot } from './geometry';

// Interprets the JSON commands produced by the AI assistant against a Plan. All coordinates
// are feet on the 2D plan (x to the right/east, y down/south, north is -y).

export type BuildCommand = Record<string, any>;

const num = (v: unknown, fallback: number) => {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
};
const hasPoint = (cmd: BuildCommand) => Number.isFinite(num(cmd.x, NaN)) && Number.isFinite(num(cmd.y, NaN));
const r1 = (n: number) => Math.round(n * 10) / 10;

const ROOM_ALIASES: Record<string, string> = { bedroom: 'bed', bathroom: 'toilet', bath: 'toilet', puja: 'pooja', prayer: 'pooja', hall: 'living', garage: 'parking', stairs: 'staircase', storage: 'store', office: 'study' };
const normalizeRoomType = (t: unknown) => {
  const s = String(t || '').toLowerCase().trim();
  const id = ROOM_ALIASES[s] || s;
  return ROOM_TYPES.some(r => r.id === id) ? id : '';
};

// Compact description of the plan for the AI prompt.
export function describePlan(plan: Plan) {
  const rooms = detectRooms(plan);
  return {
    units: 'feet',
    orientation: 'x grows to the east, y grows to the south (north is negative y)',
    plot: plan.plot,
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
    items: plan.items.map(i => ({ id: i.id, type: i.type, x: r1(i.x), y: r1(i.y) })),
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

function findTarget(plan: Plan, id: unknown) {
  const sid = String(id ?? '');
  const room = detectRooms(plan).find(r => r.id === sid);
  if (room) return { kind: 'room' as const, room };
  const wall = plan.walls.find(w => w.id === sid);
  if (wall) return { kind: 'wall' as const, wall };
  const opening = plan.openings.find(o => o.id === sid);
  if (opening) return { kind: 'opening' as const, opening };
  const item = plan.items.find(i => i.id === sid);
  if (item) return { kind: 'item' as const, item };
  return null;
}

export function applyCommand(plan: Plan, cmd: BuildCommand): { plan: Plan; error?: string } {
  const action = String(cmd?.action || '');
  const type = String(cmd?.type || '').toLowerCase();

  switch (action) {
    case 'build':
    case 'add':
    case 'create': {
      if (type === 'room') {
        const roomType = normalizeRoomType(cmd.roomType ?? cmd.name);
        const name = cmd.name ? String(cmd.name) : ROOM_TYPES.find(r => r.id === roomType)?.name || 'Room';
        return {
          plan: addRectRoom(
            plan,
            { x: num(cmd.x, 0), y: num(cmd.y, 0), width: Math.max(2, num(cmd.width, 10)), depth: Math.max(2, num(cmd.depth, 10)) },
            WALL_DEFAULTS,
            { name, type: roomType },
          ),
        };
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
        return { plan: addItem(plan, type, { x: num(cmd.x, 0), y: num(cmd.y, 0) }, (num(cmd.rotation, 0) * Math.PI) / 180) };
      }
      return { plan, error: `I don't know how to build "${cmd?.type}".` };
    }

    case 'delete':
    case 'remove': {
      const target = findTarget(plan, cmd.id);
      if (!target) return { plan, error: `I couldn't find an item with id "${cmd.id}".` };
      if (target.kind === 'room') return { plan: deleteRoom(plan, target.room) };
      if (target.kind === 'wall') return { plan: deleteWalls(plan, [target.wall.id]) };
      if (target.kind === 'opening') return { plan: deleteOpening(plan, target.opening.id) };
      return { plan: deleteItem(plan, target.item.id) };
    }

    case 'deleteAll':
      return { plan: clearPlan(plan) };

    case 'move': {
      const target = findTarget(plan, cmd.id);
      if (!target) return { plan, error: `I couldn't find an item with id "${cmd.id}".` };
      if (!hasPoint(cmd)) return { plan, error: 'A move needs both x and y coordinates.' };
      const p = { x: num(cmd.x, 0), y: num(cmd.y, 0) };
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
      if (cmd.rotation != null) return { plan: updateItem(plan, target.item.id, { rotation: (num(cmd.rotation, 0) * Math.PI) / 180 }) };
      return { plan };
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
