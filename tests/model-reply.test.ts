import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanModelText, firstJson, parseChatReply } from '../src/lib/modelReply';

// Different models format their answers differently; the app must read them all the same way.

const CMD = '{"action": "build", "type": "room", "name": "Study", "width": 10, "depth": 8}';

test('bare JSON, code fences, prose, and thinking blocks all give the same command', () => {
  const variants = [
    CMD,
    '```json\n' + CMD + '\n```',
    'Here you go:\n' + CMD + '\nLet me know if you want changes.',
    '<think>The user wants a study. I will add a room.</think>\n' + CMD,
    '<thinking>planning {not json}</thinking>' + CMD,
  ];
  for (const v of variants) {
    const r = parseChatReply(v);
    assert.equal(r.commands.length, 1, v);
    assert.equal(r.commands[0].name, 'Study');
  }
});

test('one command, an array, or a commands list', () => {
  assert.equal(parseChatReply('[' + CMD + ',' + CMD + ']').commands.length, 2);
  assert.equal(parseChatReply('{"commands": [' + CMD + ']}').commands.length, 1);
});

test('plain text answers carry no commands', () => {
  const r = parseChatReply('The North-East is best for a pooja room.');
  assert.equal(r.commands.length, 0);
  assert.equal(r.text, 'The North-East is best for a pooja room.');
});

test('a whole new plan comes back as setPlan, or as a bare plan object', () => {
  const plan = { rooms: [{ name: 'Hall', polygon: [[0, 0], [10, 0], [10, 10], [0, 10]] }] };
  assert.deepEqual(parseChatReply(JSON.stringify({ action: 'setPlan', plan })).setPlan, plan);
  assert.deepEqual(parseChatReply('```json\n' + JSON.stringify(plan) + '\n```').setPlan, plan);
});

test('broken or missing JSON never throws', () => {
  for (const v of ['{"action": "build", ', '', null, undefined, 42, '{]', '<think>unfinished']) {
    assert.doesNotThrow(() => parseChatReply(v as any));
    assert.doesNotThrow(() => firstJson(v as any));
  }
  assert.equal(cleanModelText('<think>only thinking, no answer'), '');
});

test('the first JSON that parses is used, even after a broken one', () => {
  assert.deepEqual(firstJson('{broken} then {"ok": true}'), { ok: true });
});
