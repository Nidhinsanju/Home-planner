import Anthropic from '@anthropic-ai/sdk';
import { CloudUsage, connectToDatabase } from './db';
import { cloudPlanImagePrompt, cloudPlannerSystem, cloudPlannerUser } from './aiPrompt';

// The cloud model (Claude) does only the hard work: reading uploaded drawings and planning
// complex changes. Everything else stays on the local model. Calls are kept small (no chat
// history beyond a few lines, JSON-only answers) and limited per user per day.

export const cloudEnabled = () => !!process.env.ANTHROPIC_API_KEY;
const CLOUD_MODEL = () => process.env.CLOUD_MODEL || 'claude-opus-5-5';
const DAILY_LIMIT = () => Number(process.env.CLOUD_DAILY_LIMIT || 10);
const EFFORT = () => (process.env.CLOUD_EFFORT || 'medium') as 'low' | 'medium' | 'high';

const today = () => new Date().toISOString().slice(0, 10);

export async function cloudCallsLeft(userId: unknown) {
  await connectToDatabase();
  const usage = await CloudUsage.findOne({ userId, day: today() }).lean() as any;
  return Math.max(0, DAILY_LIMIT() - (usage?.calls ?? 0));
}

async function recordUsage(userId: unknown, usage: { input_tokens: number; output_tokens: number }) {
  await CloudUsage.updateOne(
    { userId, day: today() },
    { $inc: { calls: 1, inputTokens: usage.input_tokens, outputTokens: usage.output_tokens } },
    { upsert: true },
  );
}

export type CloudResult<T> = { data: T } | { error: string } | { aborted: true };

// One JSON-only request. `schema` constrains the answer, so it always parses.
async function askClaude<T>(userId: unknown, system: string | undefined, content: Anthropic.Beta.BetaContentBlockParam[], schema: Record<string, unknown>, signal?: AbortSignal): Promise<CloudResult<T>> {
  if (!cloudEnabled()) return { error: 'The advanced AI is not set up (no ANTHROPIC_API_KEY).' };
  if ((await cloudCallsLeft(userId)) <= 0) return { error: `You've used today's ${DAILY_LIMIT()} advanced AI requests. The local AI is still available.` };

  const client = new Anthropic();
  try {
    const response = await client.beta.messages.create(
      {
        model: CLOUD_MODEL(),
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: EFFORT(), format: { type: 'json_schema', schema } },
        ...(system ? { system } : {}),
        messages: [{ role: 'user', content }],
      },
      { signal },
    );
    await recordUsage(userId, response.usage);
    if (response.stop_reason === 'refusal') return { error: 'The advanced AI declined this request.' };
    if (response.stop_reason === 'max_tokens') return { error: 'The advanced AI ran out of room for its answer. Try a smaller request.' };
    const text = response.content.map(b => (b.type === 'text' ? b.text : '')).join('');
    return { data: JSON.parse(text) as T };
  } catch (error) {
    if (signal?.aborted) return { aborted: true };
    console.error('Claude error:', error);
    if (error instanceof Anthropic.AuthenticationError) return { error: 'The advanced AI key is invalid.' };
    if (error instanceof Anthropic.RateLimitError) return { error: 'The advanced AI is busy. Try again in a minute.' };
    return { error: 'Could not reach the advanced AI.' };
  }
}

const ROOM_TYPES = ['living', 'bed', 'kitchen', 'dining', 'toilet', 'pooja', 'study', 'utility', 'store', 'staircase', 'parking', 'balcony', 'hallway'];

const drawingSchema = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    rooms: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          type: { type: 'string', enum: ROOM_TYPES },
          box: { type: 'array', items: { type: 'number' } },
        },
        required: ['name', 'type', 'box'],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'rooms'],
  additionalProperties: false,
};

export type CloudDrawing = { summary: string; rooms: { name: string; type: string; box: number[] }[] };

// Reads an uploaded floor plan (a JPEG/PNG/WebP data URL, w x h pixels).
export function readDrawing(userId: unknown, image: string, w: number, h: number, signal?: AbortSignal) {
  const [, mediaType, data] = image.match(/^data:(image\/(?:png|jpeg|webp));base64,(.*)$/) ?? [];
  if (!data) return Promise.resolve({ error: 'Invalid image.' } as CloudResult<CloudDrawing>);
  return askClaude<CloudDrawing>(userId, undefined, [
    { type: 'image', source: { type: 'base64', media_type: mediaType as 'image/png' | 'image/jpeg' | 'image/webp', data } },
    { type: 'text', text: cloudPlanImagePrompt(w, h) },
  ], drawingSchema, signal);
}

const planSchema = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: { instruction: { type: 'string' }, command: { type: 'string' } },
        required: ['instruction', 'command'],
        additionalProperties: false,
      },
    },
  },
  required: ['reply', 'steps'],
  additionalProperties: false,
};

export type CloudStep = { instruction: string; command: Record<string, any> | null };
export type CloudPlan = { reply: string; steps: CloudStep[] };

// Plans a complex request as simple steps for the local model to carry out.
export async function planRequest(userId: unknown, prompt: string, sceneData: unknown, recent: { role: string; content: string }[], signal?: AbortSignal): Promise<CloudResult<CloudPlan>> {
  const res = await askClaude<{ reply: string; steps: { instruction: string; command: string }[] }>(
    userId, cloudPlannerSystem, [{ type: 'text', text: cloudPlannerUser(prompt, sceneData, recent) }], planSchema, signal,
  );
  if (!('data' in res)) return res;
  const parseCommand = (s: string) => {
    try {
      const c = JSON.parse(s);
      return c && typeof c === 'object' && typeof c.action === 'string' ? c : null;
    } catch {
      return null;
    }
  };
  return {
    data: {
      reply: String(res.data.reply ?? '').trim(),
      steps: (res.data.steps ?? []).slice(0, 20)
        .map(s => ({ instruction: String(s.instruction ?? '').trim(), command: parseCommand(String(s.command ?? '')) }))
        .filter(s => s.instruction),
    },
  };
}
