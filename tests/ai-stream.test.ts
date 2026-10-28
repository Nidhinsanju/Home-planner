import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUSY_WAITS_MS, withModels } from '../src/lib/aiClient';
import { streamAiResult } from '../src/lib/aiStream';
import { readAiResponse, type AiStatusUpdate } from '../src/lib/aiStreamClient';

test('busy models are reported live, then the result arrives', async () => {
  const saved = { ...process.env }, waits = [...BUSY_WAITS_MS];
  Object.assign(process.env, { AI_API_KEY: 'sk-proj-test', AI_MODEL: 'stream-a', AI_FALLBACK_MODELS: 'stream-b', AI_BASE_URL: '' });
  BUSY_WAITS_MS.fill(1);
  try {
    let calls = 0;
    const response = streamAiResult(async () => {
      const { result } = await withModels('test', async () => {
        if (++calls < 3) throw Object.assign(new Error('high demand'), { status: 503 });
        return 'answer';
      });
      return { success: true, reply: result };
    });
    const seen: AiStatusUpdate[] = [];
    const result = await readAiResponse(response, s => seen.push(s));
    assert.deepEqual(result, { success: true, reply: 'answer' });
    assert.deepEqual(seen.map(s => s.message), [
      'AI model 1 of 2 is busy, trying the next one…',
      'AI model 2 of 2 is busy.',
      'Every AI model is busy right now. Trying again in 0s… (attempt 2 of 3)',
    ]);
    assert.ok(seen.every(s => !/stream-a|stream-b|sk-/.test(s.message))); // no model names or keys
  } finally {
    process.env = saved;
    BUSY_WAITS_MS.splice(0, BUSY_WAITS_MS.length, ...waits);
  }
});

test('when every model stays busy, the last status is the error', async () => {
  const saved = { ...process.env }, waits = [...BUSY_WAITS_MS];
  Object.assign(process.env, { AI_API_KEY: 'sk-proj-test', AI_MODEL: 'stream-c', AI_FALLBACK_MODELS: '', AI_BASE_URL: '' });
  BUSY_WAITS_MS.fill(1);
  try {
    const response = streamAiResult(async () => {
      try {
        await withModels('test', async () => { throw Object.assign(new Error('overloaded'), { status: 503 }); });
        return { success: true };
      } catch {
        return { error: 'busy', busy: true };
      }
    });
    const seen: AiStatusUpdate[] = [];
    const result = await readAiResponse(response, s => seen.push(s));
    assert.deepEqual(result, { error: 'busy', busy: true });
    assert.equal(seen[seen.length - 1].level, 'error');
    assert.match(seen[seen.length - 1].message, /very busy/);
  } finally {
    process.env = saved;
    BUSY_WAITS_MS.splice(0, BUSY_WAITS_MS.length, ...waits);
  }
});

test('a plain JSON answer (an early refusal) is read as it is', async () => {
  assert.deepEqual(await readAiResponse(Response.json({ error: 'Not logged in' }, { status: 401 })), { error: 'Not logged in' });
});
