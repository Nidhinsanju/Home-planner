import OpenAI from 'openai';

// The AI provider and the bits every request needs. Only AI_API_KEY has to be set: the
// provider (and its API address) is worked out from the key, and requests go to the models
// in AI_MODELS, in order. When a model fails (out of credit, rate limited, unavailable, or
// it gave an unusable answer) the next one is tried, and the failed one is skipped for a
// while, so the app keeps working on the free models when paid credit runs out.

type Provider = { name: string; baseURL: string; models: string[] };

// Models that can read images and call tools (both are needed: the chat sends the floor plan
// image and uses the set_plan tool). Best first; the free ones keep the app working without credit.
const PROVIDERS: { prefix: string; provider: Provider }[] = [
  {
    prefix: 'sk-or-',
    provider: {
      name: 'openrouter',
      baseURL: 'https://openrouter.ai/api/v1',
      models: ['anthropic/claude-sonnet-5.5', 'anthropic/claude-haiku-5.5', 'google/gemma-4-31b-it:free', 'google/gemma-4-26b-a4b-it:free', 'thinkingmachines/inkling:free'],
    },
  },
  { prefix: 'sk-ant-', provider: { name: 'anthropic', baseURL: 'https://api.anthropic.com/v1/', models: ['claude-sonnet-5-5', 'claude-haiku-5-5'] } },
  {
    // Google AI Studio keys. Newest Flash models first; the free tier often answers 503 (busy)
    // on one model while another works, so several are listed.
    prefix: 'AIza',
    provider: {
      name: 'gemini',
      baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      models: ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.5-flash', 'gemini-flash-latest', 'gemini-3.5-flash-lite', 'gemma-4-31b-it'],
    },
  },
];
const OTHER: Provider = { name: 'openai-compatible', baseURL: 'https://api.openai.com/v1', models: [] };

export function aiProvider(): Provider {
  const key = (process.env.AI_API_KEY || '').trim();
  const known = PROVIDERS.find(p => key.startsWith(p.prefix))?.provider ?? OTHER;
  return { ...known, baseURL: process.env.AI_BASE_URL || known.baseURL };
}

// AI_MODELS (comma-separated) if set, otherwise the provider's defaults above.
export function aiModels(): string[] {
  const listed = (process.env.AI_MODELS || '').split(',').map(s => s.trim()).filter(Boolean);
  return listed.length ? listed : aiProvider().models;
}

// No SDK retries: a failing model is skipped for the next one at once (see withModels).
// A model that hasn't answered in 3 minutes counts as failed (reading a plan with reasoning
// can take a minute or two).
export const aiClient = () => new OpenAI({ baseURL: aiProvider().baseURL, apiKey: (process.env.AI_API_KEY || '').trim(), maxRetries: 0, timeout: 180_000 });

// Enough room for a whole plan as JSON. OpenRouter reserves credit for the full amount.
export const CHAT_MAX_TOKENS = () => Number(process.env.AI_MAX_TOKENS || 8000);
export const EXTRACT_MAX_TOKENS = () => Number(process.env.EXTRACT_MAX_TOKENS || 12000);
// Reasoning effort for reading drawings ("off" to disable). OpenRouter's `reasoning` field.
export const EXTRACT_REASONING = () => process.env.EXTRACT_REASONING || 'medium';

// ---- model rotation ------------------------------------------------------------------------

// Thrown by a caller when a model answered but the answer was unusable: try the next model.
export class TryNextModel extends Error {}

const skipUntil = new Map<string, number>(); // model -> time until which it is skipped
const MINUTE = 60_000;

// How long to skip a model after this error, or null if switching models won't help.
function cooldown(error: any): number | null {
  if (error instanceof TryNextModel) return 10 * MINUTE;
  const status = error?.status;
  if (status == null) return MINUTE; // network error / timeout
  if (status === 401) return null; // bad key: every model fails the same way
  if (status === 402) return 30 * MINUTE; // out of credit
  if (status === 429 || status === 408 || status >= 500) return 2 * MINUTE;
  if (status === 400 || status === 403 || status === 404 || status === 413 || status === 422) return 60 * MINUTE; // model can't take this request
  return null;
}

// Runs `request` with each model in turn until one succeeds. Models that failed recently are
// tried last. Throws the last error if every model fails.
export async function withModels<T>(kind: string, request: (model: string) => Promise<T>, signal?: AbortSignal): Promise<{ result: T; model: string }> {
  const models = aiModels();
  if (models.length === 0) throw new Error('No AI models configured: set AI_MODELS in .env (comma-separated model names).');
  const now = Date.now();
  const order = [...models.filter(m => (skipUntil.get(m) ?? 0) <= now), ...models.filter(m => (skipUntil.get(m) ?? 0) > now)];
  let lastError: unknown;
  for (const model of order) {
    try {
      const result = await request(model);
      skipUntil.delete(model);
      return { result, model };
    } catch (error: any) {
      if (signal?.aborted) throw error;
      lastError = error;
      const wait = cooldown(error);
      if (wait == null) throw error;
      skipUntil.set(model, Date.now() + wait);
      console.warn(`[ai] ${kind}: ${model} failed (${error?.status ?? ''} ${String(error?.message ?? error).slice(0, 160)}); trying the next model`);
    }
  }
  throw lastError;
}

// The reasoning setting in the form the provider accepts (OpenRouter and Gemini only).
export function reasoningField(effort: string) {
  if (effort === 'off') return {};
  const name = aiProvider().name;
  if (name === 'openrouter') return { reasoning: { effort } };
  if (name === 'gemini') return { reasoning_effort: effort };
  return {};
}

// ---- logging & errors --------------------------------------------------------------------

// Pixel size of a PNG or JPEG data URL, read from its header, plus its size in bytes.
export function imageInfo(dataUrl: string): { bytes: number; width?: number; height?: number } {
  const b = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return { bytes: b.length, width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i + 9 < b.length;) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { bytes: b.length, height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
      }
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  return { bytes: b.length };
}

// One log line per AI request, and a warning if the provider answered with a different model.
export function logAiCall(kind: string, requested: string, response: { model?: string; choices?: { finish_reason?: string | null }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } | null }, image?: { bytes: number; width?: number; height?: number }) {
  const img = image ? ` image=${image.bytes}B ${image.width ?? '?'}x${image.height ?? '?'}px` : '';
  console.info(`[ai] ${kind} model=${requested} answered-by=${response.model} finish=${response.choices?.[0]?.finish_reason} tokens=${response.usage?.prompt_tokens ?? '?'}/${response.usage?.completion_tokens ?? '?'}${img}`);
  const base = requested.replace(/:free$/, '');
  if (response.model && !response.model.startsWith(base)) {
    console.warn(`[ai] ${kind}: asked for ${requested} but ${response.model} answered (provider fallback?)`);
  }
}

// A message for the user from a provider error (after every model was tried).
export function aiErrorMessage(error: any): string {
  const status = error?.status;
  if (error instanceof TryNextModel) return error.message;
  if (status === 401) return 'The AI key is invalid. Check AI_API_KEY in .env.';
  if (status === 402) return 'The AI account is out of credit, and the free models in AI_MODELS failed too. Add credit, or try again later.';
  if (status === 404) return `None of the AI models in AI_MODELS is available: ${error?.message ?? ''}`.trim();
  if (status === 429) return 'Every AI model is busy (rate limited). Try again in a minute.';
  if (!status && /AI_MODELS/.test(String(error?.message))) return String(error.message);
  return 'Could not reach the AI. Check your internet connection and AI_API_KEY.';
}
