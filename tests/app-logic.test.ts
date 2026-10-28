import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientAddressOf, rateLimit, REQUEST_LIMITS, requestRateLimit } from '../src/lib/rateLimit';
import { browserFrom, devicePrint, deviceTypeFrom, fingerprintOf, osFrom } from '../src/lib/devicePrint';
import { AiCharge, clientRefOf, isAdmin, quotaKeys } from '../src/lib/aiQuota';
import { importPlanJson } from '../src/plan/importPlan';
import { analyzeVastu } from '../src/plan/vastu';
import { applyCommands, describePlan } from '../src/plan/commands';
import { missingPlanRef } from '../src/lib/planRefs';
import { emptyPlan } from '../src/plan/types';

const PLAN = {
  rooms: [
    { name: 'Kitchen', type: 'kitchen', polygon: [[0, 0], [10.5, 0], [10.5, 10.5], [0, 10.5]] },
    { name: 'Living', type: 'living', polygon: [[10.5, 0], [24.5, 0], [24.5, 12.5], [10.5, 12.5]] },
    { name: 'Bedroom', type: 'bed', polygon: [[0, 10.5], [10.5, 10.5], [10.5, 22.5], [0, 22.5]] },
  ],
  doors: [{ at: [24.5, 6], widthFt: 3.5 }],
  windows: [],
};

test('rate limit: allows up to the limit in the window, then refuses until it passes', () => {
  const t0 = 1_000_000;
  for (let i = 0; i < 3; i++) assert.ok(rateLimit('test-key', 3, 60_000, t0 + i).ok);
  const refused = rateLimit('test-key', 3, 60_000, t0 + 10);
  assert.equal(refused.ok, false);
  assert.ok(refused.retryAfterSec > 0);
  assert.ok(rateLimit('test-key', 3, 60_000, t0 + 61_000).ok);
});

test('a plan JSON imports into rooms at their sizes, and bad input never throws', () => {
  const r = importPlanJson(emptyPlan(), JSON.stringify(PLAN));
  assert.ok(!('error' in r));
  if (!('error' in r)) assert.equal(r.plan.labels.length, 3);
  for (const bad of ['', 'not json', '{}', '{"rooms": "x"}', '{"rooms": [{"polygon": [[0,0]]}]}']) {
    assert.doesNotThrow(() => importPlanJson(emptyPlan(), bad));
  }
});

test('the Vastu score is deterministic and follows the north setting', () => {
  const r = importPlanJson(emptyPlan(), JSON.stringify(PLAN));
  if ('error' in r) throw new Error(r.error);
  const a = analyzeVastu(r.plan)!, b = analyzeVastu(r.plan)!;
  assert.equal(a.score, b.score);
  assert.ok(a.score >= 0 && a.score <= 100);
  const turned = applyCommands(r.plan, [{ action: 'setNorth', degrees: 180 }]).plan;
  assert.equal(turned.northDeg, 180);
  assert.notDeepEqual(analyzeVastu(turned)!.rooms.map(x => x.zone), a.rooms.map(x => x.zone));
});

test('a request about a room that is not on the plan is answered without changing anything', () => {
  const ask = 'Remove the Balcony and make it as parking';
  assert.match(missingPlanRef(ask, {})!, /plan is empty.*balcony/i);
  const r = importPlanJson(emptyPlan(), JSON.stringify(PLAN));
  if ('error' in r) throw new Error(r.error);
  const scene = describePlan(r.plan);
  assert.match(missingPlanRef(ask, scene)!, /no balcony/i);
  assert.equal(missingPlanRef('Make the kitchen bigger', scene), null);
  assert.equal(missingPlanRef('Move the bedroom north', scene), null);
  assert.equal(missingPlanRef('Add a balcony east of the living room', scene), null);
  assert.equal(missingPlanRef('Make this plan compliant with Vastu guidelines', scene), null);
  assert.equal(missingPlanRef('Where should the balcony go?', scene), null);
});

test('commands that change something missing cancel the whole set', () => {
  const r = importPlanJson(emptyPlan(), JSON.stringify(PLAN));
  if ('error' in r) throw new Error(r.error);
  const cmds = [
    { action: 'delete', id: 'balcony' },
    { action: 'build', type: 'room', name: 'Parking', roomType: 'parking', width: 10, depth: 18, nextTo: 'Living', side: 'east' },
  ];
  const strict = applyCommands(r.plan, cmds, { allOrNothing: true });
  assert.equal(strict.plan, r.plan);
  assert.ok(strict.missingTarget);
  assert.notEqual(applyCommands(r.plan, cmds).plan, r.plan); // without the option the build still runs
  const ok = applyCommands(r.plan, [{ action: 'update', id: 'Bedroom', name: 'Study', roomType: 'study' }], { allOrNothing: true });
  assert.notEqual(ok.plan, r.plan);
});

test('the device print reads OS, browser, device type and location from the request', () => {
  const win = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0';
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1';
  const android = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
  const h = new Headers({ 'user-agent': win, 'x-vercel-ip-country': 'IN', 'x-vercel-ip-country-region': 'KL', 'x-vercel-ip-city': 'Kochi%20City' });
  const print = devicePrint(h, '203.0.113.7', { platform: 'Windows', platformVersion: '15.0.0', connectionType: 'wifi', effectiveType: '4g' });
  assert.equal(print.deviceId, 'unknown');
  assert.match(print.fingerprint, /^[0-9a-f]{32}$/);
  const { deviceId: _id, fingerprint: _fp, ...rest } = print;
  assert.deepEqual(rest, { os: 'Windows 11', browser: 'Edge 131', deviceType: 'desktop', ip: '203.0.113.7', connectionType: 'wifi', effectiveType: '4g', country: 'IN', region: 'KL', city: 'Kochi City' });
  assert.equal(osFrom(win), 'Windows 10/11');
  assert.equal(osFrom(iphone), 'iOS 17.1');
  assert.equal(browserFrom(iphone), 'Safari 17');
  assert.equal(deviceTypeFrom(iphone), 'mobile');
  assert.equal(osFrom(android), 'Android 14');
  assert.equal(browserFrom(android), 'Chrome 131');
  // Running locally: no location headers. Junk hints are ignored, never stored.
  const local = devicePrint(new Headers({ 'cf-ipcountry': 'XX' }), '', { connectionType: '<script>', platform: 'x'.repeat(500) });
  assert.equal(local.country, 'unknown');
  assert.equal(local.connectionType, 'unknown');
  assert.equal(local.ip, 'unknown');
});

test('ordinary requests are rate limited per account or address', () => {
  for (let i = 0; i < REQUEST_LIMITS.save.limit; i++) assert.ok(requestRateLimit('save', 'user-under-test').ok);
  const r = requestRateLimit('save', 'user-under-test');
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.retryAfterSec > 0);
  assert.ok(requestRateLimit('save', 'another-user').ok);
  assert.equal(clientAddressOf(new Headers({ 'x-forwarded-for': '198.51.100.1, 10.0.0.1' })), '198.51.100.1');
});

test('a prompt is counted against the account, the device id and the device print', () => {
  const id = '3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b';
  const h = new Headers({ 'x-forwarded-for': '203.0.113.7', 'user-agent': 'TestBrowser/1.0', 'x-device-id': id });
  const client = clientRefOf(h);
  assert.equal(client.deviceId, id);
  assert.equal(client.fingerprint, fingerprintOf('203.0.113.7', 'TestBrowser/1.0'));
  assert.deepEqual(quotaKeys('u1', client), ['ai:user:u1', `ai:device:${id}`, `ai:print:${client.fingerprint}`]);
  // A second account on the same device shares the device counters.
  assert.deepEqual(quotaKeys('u2', client).slice(1), quotaKeys('u1', client).slice(1));
  // A made-up device id is ignored; the device print still counts.
  const forged = clientRefOf(new Headers({ 'x-device-id': '../../etc', 'user-agent': 'TestBrowser/1.0' }));
  assert.equal(forged.deviceId, undefined);
  assert.equal(quotaKeys('u1', forged).length, 2);
});

test('admins are recognised by role or by ADMIN_EMAILS, and have no prompt limit', async () => {
  const saved = process.env.ADMIN_EMAILS;
  process.env.ADMIN_EMAILS = 'Admin@Example.com, other@example.com';
  try {
    assert.ok(isAdmin({ email: 'admin@example.com' }));
    assert.ok(isAdmin({ role: 'admin', email: 'x@example.com' }));
    assert.ok(!isAdmin({ role: 'user', email: 'x@example.com' }));
    assert.ok(!isAdmin(null));
    const charge = new AiCharge({ fingerprint: 'f' });
    assert.deepEqual(await charge.take({ _id: 'admin-1', email: 'admin@example.com' }), { ok: true }); // no database needed
    assert.ok(charge.turn);
  } finally {
    process.env.ADMIN_EMAILS = saved;
  }
});

test('follow-up AI calls are free only inside a turn the user opened', async () => {
  const saved = process.env.ADMIN_EMAILS;
  process.env.ADMIN_EMAILS = 'owner@example.com';
  try {
    const owner = { _id: 'owner-1', email: 'owner@example.com' };
    const opener = new AiCharge({ fingerprint: 'f' });
    await opener.take(owner);
    const someone = { _id: 'user-2', email: 'u2@example.com' };
    assert.equal(new AiCharge({ fingerprint: 'f' }).join(someone, opener.turn).ok, false); // another user's turn
    assert.equal(new AiCharge({ fingerprint: 'f' }).join(someone, 'not-a-turn').ok, false);
    assert.equal(new AiCharge({ fingerprint: 'f' }).join(someone, undefined).ok, false);
  } finally {
    process.env.ADMIN_EMAILS = saved;
  }
});
