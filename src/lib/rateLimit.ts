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
export function aiRateLimit(userId: unknown, exempt = false): { ok: true } | { ok: false; error: string } {
  if (exempt) return { ok: true }; // admins
  const limit = positive(process.env.AI_RATE_LIMIT, 30);
  const minutes = positive(process.env.AI_RATE_WINDOW_MIN, 10);
  const r = rateLimit(`ai:${String(userId)}`, limit, minutes * 60_000);
  return r.ok ? { ok: true } : { ok: false, error: `You've reached the limit of ${limit} AI requests in ${minutes} minutes. Try again in ${Math.ceil(r.retryAfterSec / 60)} minute(s).` };
}

// Ordinary requests (saving a plan, loading chat history, opening the app): generous enough
// that nobody notices them, tight enough that a script can't hammer the database.
export const REQUEST_LIMITS = {
  save: { limit: 60, windowMs: 60_000 }, // plan saves per account per minute
  chat: { limit: 120, windowMs: 60_000 }, // chat history reads/writes per account per minute
  session: { limit: 300, windowMs: 60_000 }, // session checks per network address per minute (a room on one Wi-Fi shares it)
  api: { limit: 300, windowMs: 60_000 }, // AI route calls per network address per minute (each device: 60, see the routes)
  apiDevice: { limit: 60, windowMs: 60_000 }, // AI route calls per device per minute
} as const;

export function requestRateLimit(kind: keyof typeof REQUEST_LIMITS, who: unknown): { ok: true } | { ok: false; error: string; retryAfterSec: number } {
  const { limit, windowMs } = REQUEST_LIMITS[kind];
  const r = rateLimit(`${kind}:${String(who)}`, limit, windowMs);
  return r.ok ? { ok: true } : { ok: false, error: `Too many requests. Please wait ${r.retryAfterSec} second(s) and try again.`, retryAfterSec: r.retryAfterSec };
}

// The caller's network address from request headers (behind a proxy, its first forwarded
// address), for per-address limits.
export const clientAddressOf = (h: Headers) => (h.get('x-forwarded-for')?.split(',')[0] || h.get('x-real-ip') || 'local').trim().slice(0, 64);

// A 429 response for a route, with Retry-After so clients know when to try again.
export const tooManyRequests = (r: { error: string; retryAfterSec: number }) =>
  Response.json({ error: r.error }, { status: 429, headers: { 'Retry-After': String(r.retryAfterSec) } });
