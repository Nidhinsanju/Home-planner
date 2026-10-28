import type { Vec } from './types';

export const EPS = 1e-6;

export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const scale = (a: Vec, s: number): Vec => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y;
export const cross = (a: Vec, b: Vec) => a.x * b.y - a.y * b.x;
export const len = (a: Vec) => Math.hypot(a.x, a.y);
export const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a: Vec, b: Vec, t: number): Vec => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

// Parameter t (unclamped) of the projection of p onto line a-b.
export function projectT(p: Vec, a: Vec, b: Vec) {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  return l2 === 0 ? 0 : dot(sub(p, a), ab) / l2;
}

export function closestOnSegment(p: Vec, a: Vec, b: Vec) {
  const t = Math.min(1, Math.max(0, projectT(p, a, b)));
  const point = lerp(a, b, t);
  return { t, point, distance: dist(p, point) };
}

// Intersection of segments p1-p2 and q1-q2. Returns params along each segment, or null when
// they don't cross (parallel/collinear segments return null; overlap is handled by callers).
export function segmentIntersection(p1: Vec, p2: Vec, q1: Vec, q2: Vec) {
  const r = sub(p2, p1);
  const s = sub(q2, q1);
  const denom = cross(r, s);
  if (Math.abs(denom) < EPS) return null;
  const qp = sub(q1, p1);
  const t = cross(qp, s) / denom;
  const u = cross(qp, r) / denom;
  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return null;
  return { t, u, point: lerp(p1, p2, t) };
}

// Shoelace area; sign depends on winding.
export function signedArea(poly: Vec[]) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function pointInPolygon(p: Vec, poly: Vec[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function centroid(poly: Vec[]): Vec {
  const a = signedArea(poly);
  if (Math.abs(a) < EPS) {
    const n = poly.length || 1;
    return { x: poly.reduce((s, p) => s + p.x, 0) / n, y: poly.reduce((s, p) => s + p.y, 0) / n };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const f = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

// A point guaranteed to be inside the polygon (centroid when possible, otherwise the middle of
// the widest horizontal span through the polygon's vertical middle). Used to place room labels.
export function interiorPoint(poly: Vec[]): Vec {
  const c = centroid(poly);
  if (pointInPolygon(c, poly)) return c;
  const ys = poly.map(p => p.y);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  for (const f of [0.5, 0.33, 0.66, 0.2, 0.8]) {
    const y = minY + (maxY - minY) * f;
    const xs: number[] = [];
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i];
      const b = poly[j];
      if ((a.y > y) !== (b.y > y)) xs.push(((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x);
    }
    xs.sort((m, n) => m - n);
    let best: Vec | null = null;
    let bestW = 0;
    for (let k = 0; k + 1 < xs.length; k += 2) {
      if (xs[k + 1] - xs[k] > bestW) {
        bestW = xs[k + 1] - xs[k];
        best = { x: (xs[k] + xs[k + 1]) / 2, y };
      }
    }
    if (best) return best;
  }
  return c;
}
