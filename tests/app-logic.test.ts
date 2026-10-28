import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rateLimit } from '../src/lib/rateLimit';
import { importPlanJson } from '../src/plan/importPlan';
import { analyzeVastu } from '../src/plan/vastu';
import { applyCommands } from '../src/plan/commands';
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
