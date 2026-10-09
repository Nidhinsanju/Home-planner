import type { Background } from './types';

// Turns the rooms the vision model found on an uploaded plan into plan coordinates (feet),
// using where the image sits on the plan and its scale. The model's boxes are approximate,
// so edges that nearly line up are snapped together: neighbouring rooms then share one wall
// instead of leaving thin gaps or overlaps.

const SNAP = 1; // feet; edges closer than this become one edge
const round = (v: number) => Math.round(v * 2) / 2; // to 0.5 ft

// Groups nearby values and replaces each with its group's average.
function clusterEdges(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const groups: number[][] = [];
  for (const v of sorted) {
    const g = groups[groups.length - 1];
    if (g && v - g[g.length - 1] < SNAP) g.push(v);
    else groups.push([v]);
  }
  return (v: number) => {
    const g = groups.find(gr => gr.includes(v))!;
    return round(g.reduce((s, x) => s + x, 0) / g.length);
  };
}

export function imageRoomBounds(bg: Background) {
  const rooms = bg.analysis?.rooms ?? [];
  const h = bg.width * bg.aspect;
  const raw = rooms.map(r => ({
    name: r.name,
    type: r.type,
    minX: bg.x + r.box[0] * bg.width,
    minY: bg.y + r.box[1] * h,
    maxX: bg.x + r.box[2] * bg.width,
    maxY: bg.y + r.box[3] * h,
  }));
  const snapX = clusterEdges(raw.flatMap(r => [r.minX, r.maxX]));
  const snapY = clusterEdges(raw.flatMap(r => [r.minY, r.maxY]));
  return raw
    .map(r => ({ ...r, minX: snapX(r.minX), maxX: snapX(r.maxX), minY: snapY(r.minY), maxY: snapY(r.maxY) }))
    .filter(r => r.maxX - r.minX >= 2 && r.maxY - r.minY >= 2);
}

// AI build commands (see commands.ts) that draw every room found on the image.
export function imageRoomCommands(bg: Background) {
  return imageRoomBounds(bg).map(r => ({
    action: 'build',
    type: 'room',
    name: r.name,
    roomType: r.type,
    x: (r.minX + r.maxX) / 2,
    y: (r.minY + r.maxY) / 2,
    width: r.maxX - r.minX,
    depth: r.maxY - r.minY,
  }));
}
