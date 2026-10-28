import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gateDeletes } from '../src/lib/planRefs';

// A model asked to "remove the parking" also deleted the car in it and the room next to it.
const scene = {
  rooms: [
    { id: 'r1', name: 'Parking', type: 'parking' },
    { id: 'r2', name: 'Sit Out', type: 'balcony' },
    { id: 'r3', name: 'Bedroom 1', type: 'bed' },
  ],
  items: [{ id: 'i1', type: 'car' }, { id: 'i2', type: 'sofa' }],
  walls: [{ id: 'w1' }],
  openings: [{ id: 'o1', kind: 'door' }],
};
const del = (id: string) => ({ action: 'delete', id });

test('a delete only removes what the user named', () => {
  const r = gateDeletes([del('r1'), del('i1'), del('r2')], 'Remove the parking only', scene);
  assert.deepEqual(r.allowed, [del('r1')]);
  assert.equal(r.blocked.length, 2);
  assert.match(r.blocked.join(' '), /Car/);
  assert.match(r.blocked.join(' '), /Sit Out/);
});

test('rooms can be named by name, type or a common word, furniture by its kind', () => {
  assert.equal(gateDeletes([del('r3')], 'delete bedroom 1', scene).allowed.length, 1);
  assert.equal(gateDeletes([del('r1')], 'remove the garage', scene).allowed.length, 1);
  assert.equal(gateDeletes([del('r2')], 'remove the sit out', scene).allowed.length, 1);
  assert.equal(gateDeletes([del('i1'), del('r1')], 'remove the parking and the car', scene).allowed.length, 2);
  assert.equal(gateDeletes([del('i2')], 'remove all the furniture', scene).allowed.length, 1);
  assert.equal(gateDeletes([del('o1')], 'remove the door', scene).allowed.length, 1);
  assert.equal(gateDeletes([del('w1')], 'remove the door', scene).allowed.length, 0);
});

test('other commands, and deletes of things not on the plan, pass through', () => {
  const build = { action: 'build', type: 'room', name: 'Garden' };
  assert.deepEqual(gateDeletes([build, del('missing')], 'remove the parking', scene).allowed, [build, del('missing')]);
});
