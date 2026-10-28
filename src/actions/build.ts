'use server';

import { connectToDatabase, Build, BuildData } from '../lib/db';
import { getUserByToken, isPlanId } from '../lib/session';
import { ExtractionSchema } from '../plan/extraction';

const arr = (v: unknown) => (Array.isArray(v) ? v : []);
const MAX_BACKGROUND_CHARS = 6_000_000; // ~4.5 MB image; the browser resizes uploads well below this

// Keeps a background image only if it is a well-formed image data URL with a sane size.
function background(b: any) {
  if (!b || typeof b.src !== 'string' || !/^data:image\/(png|jpeg|webp);base64,/.test(b.src) || b.src.length > MAX_BACKGROUND_CHARS) return undefined;
  const n = (v: unknown, fallback: number) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
  return {
    src: b.src,
    x: n(b.x, 0),
    y: n(b.y, 0),
    width: Math.max(1, n(b.width, 50)),
    aspect: Math.max(0.01, n(b.aspect, 1)),
    opacity: Math.min(1, Math.max(0.05, n(b.opacity, 0.5))),
    locked: b.locked !== false,
    calibrated: b.calibrated === true,
    ...(analysis(b.analysis) ? { analysis: analysis(b.analysis) } : {}),
    ...(b.use === 'build' || b.use === 'context' ? { use: b.use } : {}),
  };
}

// What the vision model read from the image: a summary and room boxes in image fractions.
function analysis(a: any) {
  if (!a || typeof a.summary !== 'string') return undefined;
  const rooms = arr(a.rooms).slice(0, 60)
    .filter((r: any) => Array.isArray(r?.box) && r.box.length === 4 && r.box.every((v: unknown) => Number.isFinite(Number(v))))
    .map((r: any) => ({ name: String(r.name ?? '').slice(0, 60), type: String(r.type ?? '').slice(0, 20), box: r.box.map((v: unknown) => Math.min(1, Math.max(0, Number(v)))) }));
  // The full reading, kept only when it is well-formed (it rebuilds the plan to scale).
  const extraction = ExtractionSchema.safeParse(a.extraction);
  const size = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 && Number(v) <= 10000 ? Number(v) : undefined);
  const imageWidth = size(a.imageWidth), imageHeight = size(a.imageHeight);
  return {
    summary: a.summary.slice(0, 1000),
    rooms,
    ...(extraction.success && imageWidth && imageHeight ? { extraction: extraction.data, imageWidth, imageHeight } : {}),
  };
}

export async function saveBuild(planId: 'p1' | 'p2', buildData: BuildData, token: string) {
  if (!token) return { error: 'Not logged in' };
  if (!isPlanId(planId)) return { error: 'Invalid plan' };

  const p = buildData?.plan;
  if (!p || p.version !== 2) return { error: 'Invalid plan data' };
  const bg = background(p.background);
  const data: BuildData = {
    plan: {
      version: 2,
      corners: arr(p.corners),
      walls: arr(p.walls),
      openings: arr(p.openings),
      labels: arr(p.labels),
      items: arr(p.items),
      ...(bg ? { background: bg } : {}),
    },
  };

  try {
    const user = await getUserByToken(token);
    if (!user) return { error: 'Session expired, please log in again' };

    await connectToDatabase();
    await Build.findOneAndUpdate(
      { userId: user._id, planId },
      { $set: { data } },
      { upsert: true, new: true }
    );

    return { success: true };
  } catch (err) {
    console.error('saveBuild error:', err);
    return { error: 'Failed to save plan' };
  }
}
