import jwt from 'jsonwebtoken';
import { connectToDatabase, User } from './db';

export const PLAN_IDS = ['p1', 'p2'] as const;
export type PlanId = (typeof PLAN_IDS)[number];
export const isPlanId = (id: unknown): id is PlanId => PLAN_IDS.includes(id as PlanId);

// Login tokens are JWTs signed with SUPER_KEY (HS256 only, with this app as the issuer), valid
// for 30 minutes, renewed while the user is active (renewSession, called by the app on use),
// so an idle session ends after 30 minutes. No fallback secret: a hard-coded default would let anyone forge login tokens.
const ISSUER = 'vastu-3d-visualizer';
const ALGORITHM = 'HS256' as const;

function getJwtSecret() {
  const secret = process.env.SUPER_KEY;
  if (!secret) throw new Error('SUPER_KEY environment variable is not set');
  if (secret.length < 32) throw new Error('SUPER_KEY is too short: use at least 32 random characters');
  return secret;
}

export function signToken(email: string) {
  return jwt.sign({ email }, getJwtSecret(), { expiresIn: '30m', algorithm: ALGORITHM, issuer: ISSUER });
}

// Returns the lean user document for a valid token, or null.
export async function getUserByToken(token: string): Promise<any | null> {
  if (!token || typeof token !== 'string' || token.length > 2000) return null;
  try {
    const decoded = jwt.verify(token, getJwtSecret(), { algorithms: [ALGORITHM], issuer: ISSUER }) as any;
    if (typeof decoded?.email !== 'string') return null;
    await connectToDatabase();
    return await User.findOne({ email: decoded.email }).lean();
  } catch (err: any) {
    if (err?.message?.includes('SUPER_KEY')) console.error(err.message);
    return null;
  }
}
