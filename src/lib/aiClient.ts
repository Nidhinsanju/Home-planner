import { AsyncLocalStorage } from 'node:async_hooks';
import OpenAI from 'openai';

// The AI provider and the bits every request needs, configured ONLY from .env, so anyone who
// clones the repo can use their own key and model:
//
//   AI_API_KEY          your provider's key (not needed for a local server such as Ollama)
//   AI_MODEL            the model to use, exactly as your provider names it
//   AI_FALLBACK_MODELS  optional, comma-separated: tried in order when AI_MODEL fails
//   AI_VISION_MODEL     optional: the model that reads uploaded floor plans (must accept
//                       images); defaults to AI_MODEL
//   AI_PLANNER_MODEL    optional: a stronger model that plans big requests as steps
//   AI_BASE_URL         optional: the provider's OpenAI-compatible address. Worked out from
//                       the key for OpenAI, OpenRouter, Anthropic and Google Gemini keys.
//
// Every provider is reached through the OpenAI-compatible Chat Completions API, with plain
// text-and-JSON requests that any chat model can answer (no tool calling, no provider-only
// features unless the provider is known to support them, and a fallback when one is refused).
// The answers are parsed and checked in one place (modelReply.ts), so the app never depends on
// how a particular model formats its reply.

export class AiConfigError extends Error {}

type ProviderName = 'openrouter' | 'anthropic' | 'gemini' | 'openai' | 'other';
export type AiConfig = {
  provider: ProviderName;
  baseURL: string;
  apiKey: string;
  models: string[]; // AI_MODEL, then the fallbacks
  visionModels: string[];
  plannerModel?: string;
  coordinates: 'px' | 'norm1000';
};

// Known key formats and their OpenAI-compatible addresses.
const KEY_PREFIXES: { prefix: string; provider: ProviderName; baseURL: string }[] = [
  { prefix: 'sk-or-', provider: 'openrouter', baseURL: 'https://openrouter.ai/api/v1' },
  { prefix: 'sk-ant-', provider: 'anthropic', baseURL: 'https://api.anthropic.com/v1/' },
  { prefix: 'AIza', provider: 'gemini', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/' },
  { prefix: 'sk-', provider: 'openai', baseURL: 'https://api.openai.com/v1' },
];

const list = (v: string | undefined) => (v ?? '').split(',').map(s => s.trim()).filter(Boolean);
const isLocal = (url: string) => /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|host\.docker\.internal)(:|\/|$)/i.test(url);

// The configuration from the environment. Throws AiConfigError with what to fix.
export function aiConfig(env: Record<string, string | undefined> = process.env): AiConfig {
  const apiKey = (env.AI_API_KEY ?? '').trim();
  const baseOverride = (env.AI_BASE_URL ?? '').trim();
  const known = KEY_PREFIXES.find(k => apiKey.startsWith(k.prefix));
  const baseURL = baseOverride || known?.baseURL || '';
  if (!baseURL) throw new AiConfigError('AI is not set up: set AI_API_KEY in .env (and AI_BASE_URL if your provider is not OpenAI, OpenRouter, Anthropic or Google Gemini).');
  if (!apiKey && !isLocal(baseURL)) throw new AiConfigError('AI is not set up: set AI_API_KEY in .env to your provider\'s API key.');
  if (/^https?:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|host\.docker\.internal)/i.test(baseURL) && !/^https:\/\//i.test(baseURL)) {
    throw new AiConfigError('AI_BASE_URL must use https:// (plain http:// is only allowed for a server on this computer).');
  }
  // AI_MODELS (a comma list) is still read, for older .env files.
  const legacy = list(env.AI_MODELS);
  const model = (env.AI_MODEL ?? '').trim() || legacy[0];
  if (!model) throw new AiConfigError('AI is not set up: set AI_MODEL in .env to the name of the model to use, exactly as your provider lists it.');
  const models = [...new Set([model, ...list(env.AI_FALLBACK_MODELS), ...legacy.slice(1)])];
  const vision = (env.AI_VISION_MODEL ?? '').trim();
  const provider: ProviderName = baseOverride
    ? (/openrouter\.ai/i.test(baseOverride) ? 'openrouter' : /anthropic\.com/i.test(baseOverride) ? 'anthropic' : /generativelanguage\.googleapis/i.test(baseOverride) ? 'gemini' : /api\.openai\.com/i.test(baseOverride) ? 'openai' : 'other')
    : known?.provider ?? 'other';
  const coords = (env.AI_COORDINATES ?? 'auto').trim().toLowerCase();
  return {
    provider,
    baseURL,
    apiKey: apiKey || 'not-needed',
    models,
    visionModels: vision ? [...new Set([vision, ...models])] : models,
    ...(env.AI_PLANNER_MODEL?.trim() ? { plannerModel: env.AI_PLANNER_MODEL.trim() } : {}),
    // How the vision model is asked for positions: Gemini models are trained on a 0-1000 grid
    // and slip into it even when asked for pixels; most others handle pixels well.
    coordinates: coords === 'px' || coords === 'norm1000' ? coords : provider === 'gemini' ? 'norm1000' : 'px',
  };
}

export const aiProvider = () => {
  const c = aiConfig();
  return { name: c.provider, baseURL: c.baseURL };
};
export const aiModels = () => aiConfig().models;
export const coordinateSpace = () => aiConfig().coordinates;

const positive = (v: string | undefined, fallback: number) => (Number(v) > 0 ? Number(v) : fallback);

// No SDK retries: a failing model is skipped for the next one at once (see withModels).
// A model that hasn't answered within AI_TIMEOUT_SEC (default 120) counts as failed; reading a
// plan with reasoning can take a minute or more.
export const aiClient = () => {
  const c = aiConfig();
  return new OpenAI({ baseURL: c.baseURL, apiKey: c.apiKey, maxRetries: 0, timeout: positive(process.env.AI_TIMEOUT_SEC, 120) * 1000 });
};
// Enough room for a whole plan as JSON. Some providers reserve credit for the full amount.
export const CHAT_MAX_TOKENS = () => positive(process.env.AI_MAX_TOKENS, 8000);
// Reading a plan takes about 3,000 tokens, but thinking counts towards the limit too.
export const EXTRACT_MAX_TOKENS = () => positive(process.env.EXTRACT_MAX_TOKENS, 32000);
// Reasoning effort for reading drawings ("off" to disable), sent only to providers that take it.
export const EXTRACT_REASONING = () => process.env.EXTRACT_REASONING || 'medium';

// ---- model rotation ------------------------------------------------------------------------

// Thrown by a caller when a model answered but the answer was unusable: try the next model.
export class TryNextModel extends Error {}
// Thrown when every configured model was busy, rate limited or too slow.
export class AllModelsBusy extends Error {}

const skipUntil = new Map<string, number>(); // model -> time until which it is skipped
const MINUTE = 60_000;

// How long to skip a model after this error, or null if switching models won't help.
function cooldown(error: any): number | null {
  if (error instanceof TryNextModel) return 10 * MINUTE;
  if (error instanceof AiConfigError) return null;
  const status = error?.status;
  if (status == null) return MINUTE; // network error / timeout
  if (status === 401) return null; // bad key: every model fails the same way
  if (status === 402) return 30 * MINUTE; // out of credit
  if (status === 429 || status === 408 || status >= 500) return 2 * MINUTE;
  if (status === 400 || status === 403 || status === 404 || status === 413 || status === 422) return 60 * MINUTE; // model can't take this request
  return null;
}

// Which models a kind of request uses: reading drawings needs a model that accepts images.
export type ModelRole = 'chat' | 'vision' | 'planner';
function modelsFor(role: ModelRole) {
  const c = aiConfig();
  if (role === 'vision') return c.visionModels;
  if (role === 'planner') return c.plannerModel ? [c.plannerModel] : [];
  return c.models;
}

// ---- live status -------------------------------------------------------------------------

// What the user is told while a request is still running ("model 1 of 4 is busy, trying the
// next one..."), shown as toasts. A route opts in with withAiStatus (see aiStream.ts); without
// it, reporting does nothing. Messages never contain model names, keys or provider errors.
export type AiStatus = { level: 'info' | 'warning' | 'error'; message: string };
const statusSink = new AsyncLocalStorage<(status: AiStatus) => void>();
export const withAiStatus = <T>(send: (status: AiStatus) => void, run: () => Promise<T>) => statusSink.run(send, run);
export function reportAiStatus(status: AiStatus) {
  try {
    statusSink.getStore()?.(status);
  } catch {
    // the browser went away: nothing to tell
  }
}

// Busy, rate limited, overloaded or unreachable: worth waiting a moment and asking again.
export const isBusyError = (error: any) =>
  error instanceof AllModelsBusy || (!(error instanceof TryNextModel) && !(error instanceof AiConfigError) && (error?.status == null || error.status === 429 || error.status === 408 || error.status >= 500));

// Waits before asking busy models again (free tiers often answer 503 "high demand" for a few
// seconds). A Retry-After from the provider is honoured, up to the longest wait here.
export const BUSY_WAITS_MS = [2_000, 5_000]; // exported for the tests
function retryAfterMs(error: any) {
  const v = Number(error?.headers?.get?.('retry-after') ?? error?.headers?.['retry-after']);
  return Number.isFinite(v) && v > 0 ? v * 1000 : 0;
}
const pause = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) return reject(signal.reason);
  const t = setTimeout(() => { signal?.removeEventListener('abort', stop); resolve(); }, ms);
  const stop = () => { clearTimeout(t); reject(signal!.reason); };
  signal?.addEventListener('abort', stop, { once: true });
});

// Runs `request` with each model in turn until one succeeds. Models that failed recently are
// tried last. When every model was only busy, they are asked again after a short wait (twice
// at most) before giving up with AllModelsBusy. Otherwise the last error is thrown.
export async function withModels<T>(kind: string, request: (model: string) => Promise<T>, signal?: AbortSignal, role: ModelRole = 'chat'): Promise<{ result: T; model: string }> {
  const models = modelsFor(role);
  if (models.length === 0) throw new AiConfigError(role === 'planner' ? 'No planner model is set (AI_PLANNER_MODEL).' : 'No AI model is set: set AI_MODEL in .env.');
  const now = Date.now();
  const order = [...models.filter(m => (skipUntil.get(m) ?? 0) <= now), ...models.filter(m => (skipUntil.get(m) ?? 0) > now)];
  let lastError: unknown;
  // No new attempt starts after AI_TOTAL_SEC (default 170): with one more attempt of up to
  // AI_TIMEOUT_SEC (120) the request still ends before the host's limit (300s on Vercel), so
  // the user always gets an answer instead of a cut-off connection.
  const started = Date.now();
  const outOfTime = () => Date.now() - started > positive(process.env.AI_TOTAL_SEC, 170) * 1000;
  let timedOut = false;
  for (let round = 0; ; round++) {
    let busy = 0;
    for (const model of order) {
      if (lastError && outOfTime()) {
        timedOut = true;
        break;
      }
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
        if (isBusyError(error)) busy++;
        console.warn(`[ai] ${kind}: ${model} failed (${error?.status ?? ''} ${String(error?.message ?? error).slice(0, 160)}); trying the next model`);
        const n = order.indexOf(model) + 1, left = n < order.length;
        const what = isBusyError(error) ? 'is busy' : "couldn't answer";
        reportAiStatus({ level: 'warning', message: order.length > 1 ? `AI model ${n} of ${order.length} ${what}${left ? ', trying the next one…' : '.'}` : `The AI model ${what}.` });
      }
    }
    if (timedOut) break;
    if (busy < order.length || lastError instanceof TryNextModel) throw lastError;
    if (round >= BUSY_WAITS_MS.length || outOfTime()) break;
    const ms = Math.min(Math.max(BUSY_WAITS_MS[round], retryAfterMs(lastError)), BUSY_WAITS_MS[BUSY_WAITS_MS.length - 1]);
    console.warn(`[ai] ${kind}: every model is busy; asking again in ${ms / 1000}s`);
    reportAiStatus({ level: 'warning', message: `Every AI model is busy right now. Trying again in ${Math.round(ms / 1000)}s… (attempt ${round + 2} of ${BUSY_WAITS_MS.length + 1})` });
    await pause(ms, signal);
  }
  if (timedOut && !isBusyError(lastError)) throw lastError;
  console.warn(`[ai] ${kind}: every model in .env (${order.length}) is still busy${order.length === 1 ? '; AI_FALLBACK_MODELS would give it others to try' : ''}`);
  reportAiStatus({ level: 'error', message: BUSY_MESSAGE });
  throw new AllModelsBusy(BUSY_MESSAGE);
}

// What the user is told when the AI is busy. The plan is never changed by a failed request.
export const BUSY_MESSAGE = 'The AI is very busy right now (high demand), so nothing was changed. Please try again in a minute.';

// Optional request features. Each is sent only where it is known to work, and a model that
// rejects one anyway is remembered and asked without it from then on.

// A JSON schema as the response format (OpenAI, Gemini, OpenRouter; Anthropic ignores it).
const noSchema = new Set<string>();
export const supportsJsonSchema = (model: string) => {
  const p = aiConfig().provider;
  return (p === 'openai' || p === 'gemini' || p === 'openrouter') && !noSchema.has(model);
};
export const markNoJsonSchema = (model: string) => noSchema.add(model);

// A reasoning setting (Gemini and OpenRouter; some models there still refuse it).
const noReasoning = new Set<string>();
export const supportsReasoning = (model: string) => !noReasoning.has(model);
export const markNoReasoning = (model: string) => noReasoning.add(model);
export function reasoningField(effort: string) {
  if (effort === 'off') return {};
  const p = aiConfig().provider;
  if (p === 'openrouter') return { reasoning: { effort } };
  if (p === 'gemini') return { reasoning_effort: effort };
  return {};
}

// Whether an error means "the model doesn't take that option" (so ask again without it).
export const isOptionRejected = (error: any) => error?.status === 400 || error?.status === 422;

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

// One log line per AI request (never the key or the content), and a warning if the provider
// answered with a different model.
export function logAiCall(kind: string, requested: string, response: { model?: string; choices?: { finish_reason?: string | null }[]; usage?: { prompt_tokens?: number; completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } } | null }, image?: { bytes: number; width?: number; height?: number }) {
  const img = image ? ` image=${image.bytes}B ${image.width ?? '?'}x${image.height ?? '?'}px` : '';
  const thinking = response.usage?.completion_tokens_details?.reasoning_tokens;
  console.info(`[ai] ${kind} model=${requested} answered-by=${response.model} finish=${response.choices?.[0]?.finish_reason} tokens=${response.usage?.prompt_tokens ?? '?'}/${response.usage?.completion_tokens ?? '?'}${thinking ? ` (thinking ${thinking})` : ''}${img}`);
  const base = requested.replace(/:free$/, '');
  if (response.model && !response.model.startsWith(base) && !base.startsWith(response.model)) {
    console.warn(`[ai] ${kind}: asked for ${requested} but ${response.model} answered (provider fallback?)`);
  }
}

// The error result a route sends back: the message, and whether trying again later may work.
export const aiErrorResult = (error: any) => ({ error: aiErrorMessage(error), ...(isBusyError(error) ? { busy: true as const } : {}) });

// A message for the user from a provider error (after every model was tried). Never includes
// the key or the provider's raw error text.
export function aiErrorMessage(error: any): string {
  if (error instanceof AiConfigError || error instanceof TryNextModel || error instanceof AllModelsBusy) return error.message;
  const status = error?.status;
  if (status === 401) return 'The AI key was refused. Check AI_API_KEY in .env.';
  if (status === 402) return 'The AI account is out of credit. Add credit, or set a different AI_MODEL or AI_FALLBACK_MODELS in .env.';
  if (status === 404) return 'The AI model was not found. Check that AI_MODEL in .env is spelled exactly as your provider lists it.';
  if (status === 429 || status === 408 || status >= 500) return BUSY_MESSAGE;
  if (status === 400 || status === 422) return 'The AI model could not take this request (does it accept images? Set AI_VISION_MODEL in .env to one that does).';
  return 'Could not reach the AI service. Check your internet connection and try again.';
}
