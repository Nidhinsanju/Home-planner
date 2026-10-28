'use server';

import bcrypt from 'bcryptjs';
import { headers } from 'next/headers';
import { z } from 'zod';
import { connectToDatabase, User, Build, UserDevice } from '../lib/db';
import { getUserByToken, signToken } from '../lib/session';
import { clientAddressOf, rateLimit, requestRateLimit, resetRateLimit } from '../lib/rateLimit';
import { devicePrint } from '../lib/devicePrint';

// Sign-up and login. Inputs are validated, emails are stored lower-case, passwords are hashed
// with bcrypt (cost 12), and attempts are rate-limited per email and per network address, so
// passwords can't be guessed by brute force. A wrong email and a wrong password get the same
// answer, after the same amount of work, so the login doesn't reveal who has an account.

const BCRYPT_COST = 12;
const MINUTE = 60_000;
const Email = z.string().trim().toLowerCase().max(254).email();
const LoginInput = z.object({ email: Email, password: z.string().min(1).max(128) });
const SignupInput = z.object({
  email: Email,
  password: z.string().min(8, 'Use a password of at least 8 characters.').max(128),
  // eslint-disable-next-line no-control-regex -- control characters are removed from names
  name: z.string().trim().min(1, 'Enter your name.').max(60).transform(s => s.replace(/[<>\u0000-\u001F]/g, '')),
});
// A real bcrypt hash to compare against when the email is unknown (same time as a real check).
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_COST);

const field = (formData: FormData, name: string) => {
  const v = formData.get(name);
  return typeof v === 'string' ? v : '';
};
// The caller's network address (behind a proxy, its first forwarded address), for rate limits.
const clientAddress = async () => clientAddressOf(await headers());

// Saves the user's device print (user_devices: name, email, OS, network, location, time; never
// the password). A failure is logged and never blocks signing in.
async function recordDevice(user: { _id: unknown; name?: string; email?: string }, hints: unknown) {
  try {
    const h = await headers();
    const print = devicePrint(h, clientAddressOf(h), hints);
    await UserDevice.updateOne(
      { userId: user._id },
      { $set: { name: user.name ?? '', email: user.email ?? '', ...print, lastSeenAt: new Date() } },
      { upsert: true },
    );
  } catch (err) {
    console.error('recordDevice error:', err);
  }
}
const hintsField = (formData: FormData) => {
  try { return JSON.parse(field(formData, 'deviceHints').slice(0, 1000) || '{}'); } catch { return {}; }
};

export async function login(formData: FormData) {
  const parsed = LoginInput.safeParse({ email: field(formData, 'email'), password: field(formData, 'password') });
  if (!parsed.success) return { error: 'Invalid email or password' };
  const { email, password } = parsed.data;
  const ip = await clientAddress();
  const byEmail = rateLimit(`login:${email}`, 5, 15 * MINUTE);
  const byIp = rateLimit(`login-ip:${ip}`, 30, 15 * MINUTE);
  if (!byEmail.ok || !byIp.ok) return { error: `Too many login attempts. Try again in ${Math.ceil(Math.max(byEmail.retryAfterSec, byIp.retryAfterSec) / 60)} minute(s).` };

  await connectToDatabase();
  // Older accounts may have been stored with capital letters in the email.
  const user = (await User.findOne({ email })) ?? (await User.findOne({ email: field(formData, 'email').trim() }));
  const isMatch = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !isMatch) return { error: 'Invalid email or password' };

  resetRateLimit(`login:${email}`);
  await recordDevice(user, hintsField(formData));
  return { success: true, token: signToken(user.email) };
}

export async function signup(formData: FormData) {
  const parsed = SignupInput.safeParse({ email: field(formData, 'email'), password: field(formData, 'password'), name: field(formData, 'name') });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check your details and try again.' };
  const { email, password, name } = parsed.data;
  const limited = rateLimit(`signup-ip:${await clientAddress()}`, 5, 60 * MINUTE);
  if (!limited.ok) return { error: 'Too many sign-ups from this network. Try again later.' };

  await connectToDatabase();
  const existingUser = await User.findOne({ email });
  if (existingUser) return { error: 'Email already exists' };

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  const newUser = await User.create({ email, passwordHash, name });

  const emptyData = { rooms: [], walls: [], surfaces: [], doors: [], windows: [], assets: [] };
  await Build.insertMany([
    { userId: newUser._id, planId: 'p1', data: emptyData },
    { userId: newUser._id, planId: 'p2', data: emptyData },
  ]);
  await recordDevice(newUser, hintsField(formData));

  return { success: true, token: signToken(email) };
}

// The signed-in user with their plans, or null if the token is invalid. `{ rateLimited: true }`
// when this address checks too often: the token is fine, so the browser must keep it.
export async function getUserFromToken(token: string, deviceHints?: unknown) {
  if (!requestRateLimit('session', await clientAddress()).ok) return { rateLimited: true as const };
  const user = await getUserByToken(token);
  if (!user) return null;
  await recordDevice(user, deviceHints);
  try {
    const builds = await Build.find({ userId: user._id }).lean() as any[];
    const emptyData = { rooms: [], walls: [], surfaces: [], doors: [], windows: [], assets: [] };

    // Never send the password hash to the browser.
    const { passwordHash: _hash, ...safe } = user;
    safe.builds = {
      p1: builds.find(b => b.planId === 'p1')?.data || emptyData,
      p2: builds.find(b => b.planId === 'p2')?.data || emptyData,
    };

    return JSON.parse(JSON.stringify(safe));
  } catch {
    return null;
  }
}
