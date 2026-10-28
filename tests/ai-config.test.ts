import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aiConfig, AiConfigError } from '../src/lib/aiClient';

// The AI is configured from .env only: key, model and optional address.

test('the key and the model are both required', () => {
  assert.throws(() => aiConfig({ AI_MODEL: 'some-model' }), AiConfigError);
  assert.throws(() => aiConfig({ AI_API_KEY: 'sk-proj-abc' }), (e: Error) => e instanceof AiConfigError && /AI_MODEL/.test(e.message));
});

test('the provider address is worked out from the key', () => {
  assert.match(aiConfig({ AI_API_KEY: 'sk-or-v1-x', AI_MODEL: 'm' }).baseURL, /openrouter\.ai/);
  assert.match(aiConfig({ AI_API_KEY: 'sk-ant-x', AI_MODEL: 'm' }).baseURL, /anthropic\.com/);
  assert.match(aiConfig({ AI_API_KEY: 'AIzaSyX', AI_MODEL: 'm' }).baseURL, /generativelanguage\.googleapis\.com/);
  assert.match(aiConfig({ AI_API_KEY: 'sk-proj-x', AI_MODEL: 'm' }).baseURL, /api\.openai\.com/);
});

test('any OpenAI-compatible provider works with AI_BASE_URL; a local server needs no key', () => {
  const local = aiConfig({ AI_BASE_URL: 'http://localhost:11434/v1', AI_MODEL: 'llama3.2-vision' });
  assert.equal(local.provider, 'other');
  assert.equal(local.models[0], 'llama3.2-vision');
  assert.ok(aiConfig({ AI_API_KEY: 'k', AI_BASE_URL: 'https://api.together.xyz/v1', AI_MODEL: 'm' }));
  // A remote server must use https.
  assert.throws(() => aiConfig({ AI_API_KEY: 'k', AI_BASE_URL: 'http://example.com/v1', AI_MODEL: 'm' }), AiConfigError);
  // An unknown key needs an address.
  assert.throws(() => aiConfig({ AI_API_KEY: 'unknown-format', AI_MODEL: 'm' }), AiConfigError);
});

test('fallback, vision and planner models come from .env, in order and without repeats', () => {
  const c = aiConfig({ AI_API_KEY: 'sk-proj-x', AI_MODEL: 'a', AI_FALLBACK_MODELS: 'b, c ,a', AI_VISION_MODEL: 'v', AI_PLANNER_MODEL: 'p' });
  assert.deepEqual(c.models, ['a', 'b', 'c']);
  assert.deepEqual(c.visionModels, ['v', 'a', 'b', 'c']);
  assert.equal(c.plannerModel, 'p');
  // Older .env files with AI_MODELS still work.
  assert.deepEqual(aiConfig({ AI_API_KEY: 'sk-proj-x', AI_MODELS: 'x,y' }).models, ['x', 'y']);
});

test('the coordinate system for reading drawings can be chosen, with a sensible default', () => {
  assert.equal(aiConfig({ AI_API_KEY: 'AIzaX', AI_MODEL: 'm' }).coordinates, 'norm1000');
  assert.equal(aiConfig({ AI_API_KEY: 'sk-proj-x', AI_MODEL: 'm' }).coordinates, 'px');
  assert.equal(aiConfig({ AI_API_KEY: 'sk-proj-x', AI_MODEL: 'm', AI_COORDINATES: 'norm1000' }).coordinates, 'norm1000');
});

test('when every model is busy, the error says so (not "check your key")', async () => {
  const { withModels, aiErrorMessage } = await import('../src/lib/aiClient');
  const saved = { ...process.env };
  Object.assign(process.env, { AI_API_KEY: 'sk-proj-test', AI_MODEL: 'busy-a', AI_FALLBACK_MODELS: 'busy-b', AI_BASE_URL: '' });
  try {
    const tried: string[] = [];
    await assert.rejects(
      withModels('test', async model => { tried.push(model); throw Object.assign(new Error('high demand'), { status: 503 }); }),
      (e: Error) => /busy/.test(aiErrorMessage(e)),
    );
    assert.deepEqual(tried, ['busy-a', 'busy-b']);
  } finally {
    process.env = saved;
  }
});
