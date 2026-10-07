import { emptyPlan, itemSpec, Plan, WALL_DEFAULTS } from './types';
import { addItem, addOpening, addRectRoom, addWall, wallEnds } from './ops';
import { closestOnSegment } from './geometry';

const FT_PER_M = 3.28084;

// Older saves stored some sizes in metres (e.g. walls 0.15 x 2.8, doors 1 x 2.1) while the
// world was in feet. Values that are clearly metric are converted.
const ft = (v: unknown, metricBelow: number, fallback: number) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n < metricBelow ? n * FT_PER_M : n;
};

// Converts a saved build (new or old format) into a Plan.
export function planFromBuild(build: any): Plan {
  if (build?.plan?.version === 2) return { ...emptyPlan(), ...build.plan };
  return migrateLegacy(build);
}

export function migrateLegacy(build: any): Plan {
  let plan = emptyPlan();
  if (!build) return plan;
  if (build.plot?.width && build.plot?.depth) plan.plot = { width: build.plot.width, depth: build.plot.depth };

  for (const r of build.rooms || []) {
    if (!(r.width > 0 && r.depth > 0)) continue;
    plan = addRectRoom(plan, { x: Number(r.x) || 0, y: Number(r.y) || 0, width: r.width, depth: r.depth }, WALL_DEFAULTS, {
      name: String(r.name || '').split('\n')[0],
      type: r.type || '',
    });
  }

  for (const w of build.walls || []) {
    if (!w.start || !w.end) continue;
    plan = addWall(plan, w.start, w.end, {
      thickness: ft(w.thickness, 0.3, WALL_DEFAULTS.thickness),
      height: ft(w.height, 5, WALL_DEFAULTS.height),
    }).plan;
  }

  const openings = [
    ...(build.doors || []).map((d: any) => ({ ...d, kind: 'door' as const })),
    ...(build.windows || []).map((w: any) => ({ ...w, kind: 'window' as const })),
  ];
  for (const o of openings) {
    const p = { x: Number(o.x) || 0, y: Number(o.y) || 0 };
    let best: { id: string; d: number } | null = null;
    for (const w of plan.walls) {
      const { a, b } = wallEnds(plan, w);
      const d = closestOnSegment(p, a, b).distance;
      if (!best || d < best.d) best = { id: w.id, d };
    }
    if (!best) continue;
    plan = addOpening(plan, best.id, p, o.kind, {
      width: ft(o.width, 2.5, o.kind === 'door' ? 3 : 4),
      height: ft(o.height, 3, o.kind === 'door' ? 7 : 4),
      ...(o.kind === 'window' ? { sill: ft(o.sillHeight, 1.5, 3) } : {}),
    });
  }

  for (const a of build.assets || []) {
    if (!itemSpec(a.type)) continue; // old 1x1 "lego" blocks have no equivalent
    plan = addItem(plan, a.type, { x: Number(a.x) || 0, y: Number(a.z) || 0 }, Number(a.rotation) || 0);
  }
  return plan;
}

// The read-only example house.
const EXAMPLE_ROOMS = [
  { name: 'Parking', type: 'parking', x: -10, y: -4.5, width: 8, depth: 9 },
  { name: 'Staircase', type: 'staircase', x: -17, y: -9.5, width: 6, depth: 9 },
  { name: 'Living Room', type: 'living', x: -1, y: -8.5, width: 10, depth: 17 },
  { name: 'Dining', type: 'dining', x: 0, y: 5.5, width: 12, depth: 11 },
  { name: 'Master Bedroom', type: 'bed', x: -14, y: 5.5, width: 16, depth: 11 },
  { name: 'Master Toilet', type: 'toilet', x: -18, y: -2.5, width: 8, depth: 5 },
  { name: 'Common Toilet', type: 'toilet', x: -2.5, y: 14, width: 5, depth: 6 },
  { name: 'Pooja', type: 'pooja', x: 3, y: 14, width: 6, depth: 6 },
  { name: 'Utility', type: 'utility', x: 13, y: 13.5, width: 14, depth: 5 },
  { name: 'Kitchen', type: 'kitchen', x: 13, y: 5.5, width: 14, depth: 11 },
  { name: 'Bedroom 2', type: 'bed', x: 10.5, y: -4, width: 9, depth: 8 },
  { name: 'Bed 2 Toilet', type: 'toilet', x: 17.5, y: -4, width: 5, depth: 8 },
  { name: 'Elder Bedroom', type: 'bed', x: 9, y: -12, width: 10, depth: 8 },
  { name: 'Elder Toilet', type: 'toilet', x: 18, y: -10.5, width: 8, depth: 5 },
];

export function examplePlan(): Plan {
  return migrateLegacy({ rooms: EXAMPLE_ROOMS, plot: { width: 46, depth: 36 } });
}
