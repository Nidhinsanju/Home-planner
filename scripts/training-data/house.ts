import { Raster } from './raster';

// Random house layouts: a rectangle split into rooms (like a real plan), with room types
// assigned by size. Coordinates are whole feet, centred near (0, 0) like the app's plans.

export type Rng = () => number;

// Seeded random numbers, so the dataset is reproducible.
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const int = (rng: Rng, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
export const pick = <T,>(rng: Rng, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)];

export interface HouseRoom { name: string; type: string; minX: number; minY: number; maxX: number; maxY: number }

// Typical size order, largest first, used to give big rectangles big-room types.
const SIZE_RANK = ['living', 'parking', 'bed', 'dining', 'kitchen', 'study', 'balcony', 'utility', 'toilet', 'pooja', 'store'];
const EXTRA_TYPES = ['bed', 'dining', 'pooja', 'toilet', 'study', 'bed', 'utility', 'store', 'balcony'];
const NAMES: Record<string, string[]> = {
  living: ['Living Room', 'Living', 'Hall', 'Drawing Room'], bed: ['Bedroom', 'Master Bedroom', 'Bedroom 2', 'Guest Bedroom', 'Kids Bedroom'],
  kitchen: ['Kitchen'], dining: ['Dining', 'Dining Room'], toilet: ['Toilet', 'Bath', 'Bathroom', 'Common Toilet'],
  pooja: ['Pooja Room', 'Pooja'], study: ['Study', 'Office'], utility: ['Utility', 'Wash Area'], store: ['Store', 'Store Room'],
  balcony: ['Balcony', 'Sit Out'], parking: ['Parking', 'Car Porch'],
};

export function randomHouse(rng: Rng, nRooms = int(rng, 3, 8)): HouseRoom[] {
  const W = int(rng, 14, 30) * 2, D = int(rng, 12, 24) * 2;
  const ox = -W / 2, oy = -D / 2;
  let rects = [{ minX: ox, minY: oy, maxX: ox + W, maxY: oy + D }];
  // Split the biggest piece along its longer side until there are enough rooms.
  for (let guard = 0; rects.length < nRooms && guard < 50; guard++) {
    rects.sort((a, b) => (b.maxX - b.minX) * (b.maxY - b.minY) - (a.maxX - a.minX) * (a.maxY - a.minY));
    const r = rects[0];
    const w = r.maxX - r.minX, d = r.maxY - r.minY;
    const alongX = w >= d;
    const len = alongX ? w : d;
    if (len < 12) break;
    const cut = int(rng, Math.ceil(len * 0.3), Math.floor(len * 0.7));
    rects = rects.slice(1).concat(alongX
      ? [{ ...r, maxX: r.minX + cut }, { ...r, minX: r.minX + cut }]
      : [{ ...r, maxY: r.minY + cut }, { ...r, minY: r.minY + cut }]);
  }
  const types = ['living', 'kitchen', 'bed', 'toilet'];
  while (types.length < rects.length) types.push(pick(rng, EXTRA_TYPES));
  types.length = rects.length;
  types.sort((a, b) => SIZE_RANK.indexOf(a) - SIZE_RANK.indexOf(b));
  rects.sort((a, b) => (b.maxX - b.minX) * (b.maxY - b.minY) - (a.maxX - a.minX) * (a.maxY - a.minY));
  const used = new Set<string>();
  return rects.map((r, i) => {
    const type = types[i];
    let name = pick(rng, NAMES[type]);
    for (let k = 2; used.has(name); k++) name = `${NAMES[type][0]} ${k}`;
    used.add(name);
    return { ...r, name, type };
  });
}

export const roomW = (r: HouseRoom) => r.maxX - r.minX;
export const roomD = (r: HouseRoom) => r.maxY - r.minY;
export const sizeLabel = (r: HouseRoom) => `${roomW(r)}'x${roomD(r)}'`;

// A drawn floor plan of the house, plus each room's box in pixels (inside the walls).
export function drawHouse(rng: Rng, rooms: HouseRoom[]) {
  const scale = int(rng, 9, 16); // pixels per foot
  const margin = int(rng, 30, 70);
  const wall = int(rng, 4, 9);
  const minX = Math.min(...rooms.map(r => r.minX)), minY = Math.min(...rooms.map(r => r.minY));
  const maxX = Math.max(...rooms.map(r => r.maxX)), maxY = Math.max(...rooms.map(r => r.maxY));
  const width = Math.round((maxX - minX) * scale + margin * 2), height = Math.round((maxY - minY) * scale + margin * 2);
  const img = new Raster(width, height);
  const X = (ft: number) => margin + (ft - minX) * scale, Y = (ft: number) => margin + (ft - minY) * scale;
  const sizes = rng() < 0.6; // rooms are always labelled: an unlabelled room can't be named from the image
  const ink = int(rng, 0, 60);

  for (const r of rooms) img.outline(X(r.minX), Y(r.minY), roomW(r) * scale, roomD(r) * scale, wall, ink);
  // Door gaps in some interior walls, for realism.
  for (const r of rooms) {
    if (rng() < 0.5 || roomW(r) < 6) continue;
    const gx = X(r.minX + roomW(r) / 2) - 1.5 * scale;
    const gy = rng() < 0.5 ? Y(r.minY) : Y(r.maxY);
    if (gy > Y(minY) + 1 && gy < Y(maxY) - 1) img.rect(gx, gy - wall, 3 * scale, wall * 2, 255);
  }
  for (const r of rooms) {
    const cx = X((r.minX + r.maxX) / 2), cy = Y((r.minY + r.maxY) / 2);
    const name = r.name.toUpperCase();
    let s = 3;
    while (s > 1 && img.textWidth(name, s) > roomW(r) * scale - wall * 2 - 6) s--;
    img.text(name, cx, cy - (sizes ? 5 * s : 0), s, ink + 30);
    if (sizes) img.text(sizeLabel(r), cx, cy + 6 * s, Math.max(1, s - 1), ink + 50);
  }
  const boxes = rooms.map(r => [
    Math.round(X(r.minX) + wall / 2), Math.round(Y(r.minY) + wall / 2),
    Math.round(X(r.maxX) - wall / 2), Math.round(Y(r.maxY) - wall / 2),
  ] as [number, number, number, number]);
  return { png: img.png(), width, height, boxes, sizes, scale, margin };
}
