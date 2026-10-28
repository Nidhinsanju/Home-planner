import { randomUUID } from 'node:crypto';
import { connectToDatabase, UsageCounter } from './db';
import { fingerprintOf, isDeviceId } from './devicePrint';
import { clientAddressOf } from './rateLimit';
import { reportAiStatus } from './aiClient';

// The AI allowance: every account may send AI_PROMPT_LIMIT (default 10) prompts to the AI in
// total, ever. After that the AI is off for it and the plan can only be edited by hand.
//
// A new account on the same device does not get a new allowance: prompts are counted per
// account AND per device (the browser's device id, see deviceHints.ts) AND per device print
// (network address + browser), and the highest of these counts applies. So clearing the
// browser's storage, or signing up again, starts from what that device has already used.
// Each device may also create at most MAX_ACCOUNTS_PER_DEVICE accounts (default 3).
//
// Admins (role "admin" in the users collection, or listed in ADMIN_EMAILS in .env) have no
// limit. The counts live in the usage_counters collection.

const positive = (v: string | undefined, fallback: number) => (Number(v) > 0 ? Math.floor(Number(v)) : fallback);
export const AI_PROMPT_LIMIT = () => positive(process.env.AI_PROMPT_LIMIT, 10);
export const MAX_ACCOUNTS_PER_DEVICE = () => positive(process.env.MAX_ACCOUNTS_PER_DEVICE, 3);

export const limitMessage = (limit: number) =>
  `You've used all ${limit} of your AI prompts, so the AI is now off for this account. You can keep building and editing your plan by hand.`;

// ---- who is asking -------------------------------------------------------------------------

// The device a request comes from: its device id (when the browser sent a valid one) and its
// device print (address + browser), which still works after the browser's storage is cleared.
export type ClientRef = { deviceId?: string; fingerprint: string };

export function clientRefOf(h: Headers, deviceId?: unknown): ClientRef {
  const id = deviceId ?? h.get('x-device-id');
  return {
    ...(isDeviceId(id) ? { deviceId: id } : {}),
    fingerprint: fingerprintOf(clientAddressOf(h), h.get('user-agent') ?? ''),
  };
}

const adminEmails = () => (process.env.ADMIN_EMAILS ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
export const isAdminEmail = (email: unknown) => adminEmails().includes(String(email ?? '').trim().toLowerCase());
export const isAdmin = (user: { role?: unknown; email?: unknown } | null | undefined) => !!user && (user.role === 'admin' || isAdminEmail(user.email));

// The counters a prompt is counted against: the account first, then the device.
export function quotaKeys(userId: unknown, client: ClientRef): string[] {
  return [`ai:user:${String(userId)}`, ...(client.deviceId ? [`ai:device:${client.deviceId}`] : []), `ai:print:${client.fingerprint}`];
}
const accountKeys = (client: ClientRef) => [...(client.deviceId ? [`accounts:device:${client.deviceId}`] : []), `accounts:print:${client.fingerprint}`];

async function highest(keys: string[]) {
  await connectToDatabase();
  const docs = await UsageCounter.find({ key: { $in: keys } }).lean() as { used?: number }[];
  return Math.max(0, ...docs.map(d => d.used ?? 0));
}
const bump = (keys: string[], by: 1 | -1) => UsageCounter.bulkWrite(keys.map(key => ({
  updateOne: by > 0
    ? { filter: { key }, update: { $inc: { used: 1 } }, upsert: true }
    : { filter: { key, used: { $gt: 0 } }, update: { $inc: { used: -1 } } },
})));

// ---- turns -----------------------------------------------------------------------------------

// One prompt can take several AI calls: the chat model, the planner, then one call per step.
// The first call uses up the prompt and opens a "turn"; the follow-up calls show the turn's id
// and are free. A turn lasts 15 minutes and covers at most 40 calls. Kept in memory, like the
// rate limiter (one server process).
const TURN_MS = 15 * 60_000;
const TURN_CALLS = 40;
const turns = new Map<string, { userId: string; expires: number; calls: number }>();

function openTurn(userId: unknown) {
  const now = Date.now();
  if (turns.size > 10_000) for (const [k, t] of turns) if (t.expires < now) turns.delete(k);
  const id = randomUUID();
  turns.set(id, { userId: String(userId), expires: now + TURN_MS, calls: 0 });
  return id;
}

// ---- charging --------------------------------------------------------------------------------

type Paid = { ok: true } | { ok: false; error: string };

// One AI request's use of the allowance. take() uses one prompt (or says the allowance is used
// up); refund() gives it back when the AI didn't answer (busy, failed, stopped), so a failure
// never costs the user a prompt.
export class AiCharge {
  private taken: string[] | null = null;
  turn?: string;

  constructor(private client: ClientRef) {}

  async take(user: { _id: unknown; role?: unknown; email?: unknown }): Promise<Paid> {
    if (isAdmin(user)) {
      this.turn = openTurn(user._id);
      return { ok: true };
    }
    const limit = AI_PROMPT_LIMIT();
    const keys = quotaKeys(user._id, this.client);
    const used = await highest(keys);
    if (used >= limit) return { ok: false, error: limitMessage(limit) };
    // The account's count is claimed atomically, so two tabs can't both use the last prompt.
    try {
      await UsageCounter.updateOne({ key: keys[0], used: { $lt: limit } }, { $inc: { used: 1 } }, { upsert: true });
    } catch (error: any) {
      if (error?.code === 11000) return { ok: false, error: limitMessage(limit) }; // already at the limit
      throw error;
    }
    await bump(keys.slice(1), 1);
    this.taken = keys;
    this.turn = openTurn(user._id);
    const left = limit - used - 1;
    if (left <= 3) reportAiStatus({ level: left === 0 ? 'warning' : 'info', message: left === 0 ? 'This is your last AI prompt. After it, you can keep editing the plan by hand.' : `You have ${left} AI prompt${left === 1 ? '' : 's'} left after this one.` });
    return { ok: true };
  }

  // A follow-up call of a prompt already paid for (the planner, a step).
  join(user: { _id: unknown; role?: unknown; email?: unknown }, turnId: unknown): Paid {
    if (isAdmin(user)) return { ok: true };
    const t = typeof turnId === 'string' ? turns.get(turnId) : undefined;
    if (!t || t.userId !== String(user._id) || t.expires < Date.now() || t.calls >= TURN_CALLS) {
      return { ok: false, error: 'This request is not part of a message you sent, so the AI did not run. Send your message again.' };
    }
    t.calls++;
    return { ok: true };
  }

  async refund() {
    const keys = this.taken;
    this.taken = null;
    if (keys) await bump(keys, -1).catch(err => console.error('[ai] quota refund failed:', err));
  }
}

// ---- accounts per device -------------------------------------------------------------------

// Whether this device may create another account.
export async function mayCreateAccount(client: ClientRef): Promise<Paid> {
  const max = MAX_ACCOUNTS_PER_DEVICE();
  if ((await highest(accountKeys(client))) >= max) {
    return { ok: false, error: `This device already has ${max} accounts, which is the most allowed. Please sign in to one of them.` };
  }
  return { ok: true };
}

export const recordNewAccount = (client: ClientRef) => bump(accountKeys(client), 1).catch(err => console.error('recordNewAccount error:', err));
