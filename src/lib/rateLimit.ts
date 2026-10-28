// A small in-memory rate limiter (sliding window). It protects the AI key from runaway use
// (each account may only make so many AI requests) and the login from password guessing.
// It lives in the server process, which is right for one instance (npm start / a single
// container); behind several instances, use a shared store such as Redis instead.

type Window = { hits: number[] };
const windows = new Map<string, Window>();

// Records a hit for `key` and says whether it is within `limit` hits per `windowMs`.
// `retryAfterSec` is how long until the next hit would be allowed.
export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): { ok: boolean; retryAfterSec: number } {
  const w = windows.get(key) ?? { hits: [] };
  w.hits = w.hits.filter(t => now - t < windowMs);
  if (w.hits.length >= limit) {
    windows.set(key, w);
    return { ok: false, retryAfterSec: Math.ceil((windowMs - (now - w.hits[0])) / 1000) };
  }
  w.hits.push(now);
  windows.set(key, w);
  // Keep memory bounded: forget idle keys now and then.
  if (windows.size > 10_000) for (const [k, v] of windows) if (!v.hits.some(t => now - t < windowMs)) windows.delete(k);
  return { ok: true, retryAfterSec: 0 };
}

// Clears a key (e.g. after a successful login).
export const resetRateLimit = (key: string) => void windows.delete(key);

const positive = (v: string | undefined, fallback: number) => (Number(v) > 0 ? Number(v) : fallback);

// AI requests per user: AI_RATE_LIMIT per AI_RATE_WINDOW_MIN minutes (default 30 per 10).
export function aiRateLimit(userId: unknown): { ok: true } | { ok: false; error: string } {
  const limit = positive(process.env.AI_RATE_LIMIT, 30);
  const minutes = positive(process.env.AI_RATE_WINDOW_MIN, 10);
  const r = rateLimit(`ai:${String(userId)}`, limit, minutes * 60_000);
  return r.ok ? { ok: true } : { ok: false, error: `You've reached the limit of ${limit} AI requests in ${minutes} minutes. Try again in ${Math.ceil(r.retryAfterSec / 60)} minute(s).` };
}
