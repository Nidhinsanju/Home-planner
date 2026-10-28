import jwt from 'jsonwebtoken';
import { connectToDatabase, User } from './db';

export const PLAN_IDS = ['p1', 'p2'] as const;
export type PlanId = (typeof PLAN_IDS)[number];
export const isPlanId = (id: unknown): id is PlanId => PLAN_IDS.includes(id as PlanId);

// No fallback: a hard-coded default secret would let anyone forge login tokens.
function getJwtSecret() {
  const secret = process.env.SUPER_KEY;
  if (!secret) throw new Error('SUPER_KEY environment variable is not set');
  return secret;
}

export function signToken(email: string) {
  return jwt.sign({ email }, getJwtSecret(), { expiresIn: '7d' });
}

// Returns the lean user document for a valid token, or null.
export async function getUserByToken(token: string): Promise<any | null> {
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, getJwtSecret()) as any;
    await connectToDatabase();
    return await User.findOne({ email: decoded.email }).lean();
  } catch (err: any) {
    if (err?.message?.includes('SUPER_KEY')) console.error(err.message);
    return null;
  }
}
