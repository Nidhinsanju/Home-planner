import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { CloudUsage, connectToDatabase } from './db';
import { cloudPlannerSystem, cloudPlannerUser } from './aiPrompt';

// The optional planner model (Claude, off by default) plans complex changes as steps for the
// chat model to carry out. Calls are kept small (no chat history beyond a few lines,
// JSON-only answers) and limited per user per day.

// Claude is reached directly (ANTHROPIC_API_KEY) or through OpenRouter (OPENROUTER_API_KEY).
const viaOpenRouter = () => !process.env.ANTHROPIC_API_KEY && !!process.env.OPENROUTER_API_KEY;
export const cloudEnabled = () => !!process.env.ANTHROPIC_API_KEY || !!process.env.OPENROUTER_API_KEY;
const CLOUD_MODEL = () => process.env.CLOUD_MODEL || 'claude-opus-5-5';
const OPENROUTER_MODEL = () => process.env.OPENROUTER_MODEL || 'anthropic/claude-opus-5.5';
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
  if (!cloudEnabled()) return { error: 'The advanced AI is not set up (no ANTHROPIC_API_KEY or OPENROUTER_API_KEY).' };
  if ((await cloudCallsLeft(userId)) <= 0) return { error: `You've used today's ${DAILY_LIMIT()} advanced AI requests. The local AI is still available.` };
  if (viaOpenRouter()) return askOpenRouter<T>(userId, system, content, schema, signal);

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

// The same request through OpenRouter's OpenAI-compatible API.
async function askOpenRouter<T>(userId: unknown, system: string | undefined, content: Anthropic.Beta.BetaContentBlockParam[], schema: Record<string, unknown>, signal?: AbortSignal): Promise<CloudResult<T>> {
  const client = new OpenAI({ baseURL: 'https://openrouter.ai/api/v1', apiKey: process.env.OPENROUTER_API_KEY });
  const parts = content.map(b => {
    if (b.type === 'image' && b.source.type === 'base64') return { type: 'image_url' as const, image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } };
    return { type: 'text' as const, text: b.type === 'text' ? b.text : '' };
  });
  try {
    const response = await client.chat.completions.create(
      {
        model: OPENROUTER_MODEL(),
        max_tokens: 16000,
        response_format: { type: 'json_schema', json_schema: { name: 'answer', strict: true, schema } },
        messages: [...(system ? [{ role: 'system' as const, content: system }] : []), { role: 'user' as const, content: parts }],
        // OpenRouter-only field: Claude's reasoning effort.
        ...({ reasoning: { effort: EFFORT() } } as object),
      },
      { signal },
    );
    await recordUsage(userId, { input_tokens: response.usage?.prompt_tokens ?? 0, output_tokens: response.usage?.completion_tokens ?? 0 });
    const choice = response.choices[0];
    if (choice?.finish_reason === 'content_filter') return { error: 'The advanced AI declined this request.' };
    if (choice?.finish_reason === 'length') return { error: 'The advanced AI ran out of room for its answer. Try a smaller request.' };
    const text = (choice?.message.content ?? '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
    return { data: JSON.parse(text) as T };
  } catch (error) {
    if (signal?.aborted) return { aborted: true };
    console.error('OpenRouter error:', error);
    if (error instanceof OpenAI.AuthenticationError) return { error: 'The advanced AI key is invalid.' };
    if (error instanceof OpenAI.RateLimitError) return { error: 'The advanced AI is busy. Try again in a minute.' };
    if (error instanceof OpenAI.APIError && error.status === 402) return { error: 'The advanced AI account is out of credit.' };
    return { error: 'Could not reach the advanced AI.' };
  }
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
