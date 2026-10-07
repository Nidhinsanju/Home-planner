'use server';

import { connectToDatabase, Build, BuildData } from '../lib/db';
import { getUserByToken, isPlanId } from '../lib/session';

const arr = (v: unknown) => (Array.isArray(v) ? v : []);

export async function saveBuild(planId: 'p1' | 'p2', buildData: BuildData, token: string) {
  if (!token) return { error: 'Not logged in' };
  if (!isPlanId(planId)) return { error: 'Invalid plan' };

  const p = buildData?.plan;
  if (!p || p.version !== 2) return { error: 'Invalid plan data' };
  const data: BuildData = {
    plan: {
      version: 2,
      plot: { width: Number(p.plot?.width) || 40, depth: Number(p.plot?.depth) || 30 },
      corners: arr(p.corners),
      walls: arr(p.walls),
      openings: arr(p.openings),
      labels: arr(p.labels),
      items: arr(p.items),
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
