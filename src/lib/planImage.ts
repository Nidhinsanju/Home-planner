import { createHash } from 'node:crypto';
import { getUserByToken, isPlanId } from './session';
import type { ImageRoom } from '../plan/types';
import { fromWire, toPixelSpace, WIRE_JSON_SCHEMA, WireSchema, type Extraction } from '../plan/extraction';
import { formatIssues } from '../plan/setPlan';
import { EXTRACTION_VERSION, extractionPrompt } from './aiPrompt';
import { ImageRead } from './db';
import { aiClient, aiErrorMessage, coordinateSpace, EXTRACT_MAX_TOKENS, EXTRACT_REASONING, imageInfo, isOptionRejected, logAiCall, markNoJsonSchema, markNoReasoning, reasoningField, supportsJsonSchema, supportsReasoning, TryNextModel, withModels } from './aiClient';
import { firstJson } from './modelReply';
import { aiRateLimit } from './rateLimit';

// Step A of building from a drawing: the vision model gets the uploaded floor plan itself (at
// the size it was uploaded, up to 2000 px, so the written sizes stay legible) and reads it into
// JSON: every room with its written size and box, the doors, windows and entry, in the
// coordinate system that suits the provider (see coordinateSpace), with the answer's structure
// enforced by a JSON schema where supported. The answer is converted to pixels
// (src/plan/extraction.ts). Step B, turning that into a plan in feet and lining it up with the
// walls on the image, is done in code (src/plan/fromExtraction.ts, src/plan/wallMask.ts).
// The vision model (AI_VISION_MODEL, else AI_MODEL and its fallbacks) is used, each in turn
// (see aiClient.ts). Reads are cached per image and prompt version; `force` reads again anyway.

export type PlanImageResult =
  | { success: true; summary: string; rooms: ImageRoom[]; extraction: Extraction; imageWidth: number; imageHeight: number; model: string }
  | { error: string }
  | { aborted: true };

const MAX_RETRIES = 2;
const MAX_IMAGE_CHARS = 8_000_000; // the browser sends at most ~2000 px JPEGs

// Room boxes as fractions of the image, the older summary form the chat and the card use.
const toImageRooms = (ex: Extraction, w: number, h: number): ImageRoom[] => ex.rooms.map(r => {
  const [x1, y1, x2, y2] = r.approxBoxPx;
  const c = (v: number, s: number) => Math.min(1, Math.max(0, v / s));
  return { name: r.name, type: r.type, box: [c(Math.min(x1, x2), w), c(Math.min(y1, y2), h), c(Math.max(x1, x2), w), c(Math.max(y1, y2), h)] };
});

export async function readPlanImage(token: string, planId: string, image: string, w: number, h: number, signal?: AbortSignal, force = false): Promise<PlanImageResult> {
  if (!isPlanId(planId)) return { error: 'The AI assistant is only available on your own plans.' };
  if (typeof image !== 'string' || image.length > MAX_IMAGE_CHARS || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(image)) return { error: 'Invalid or too large image (PNG, JPEG or WebP).' };
  const user = await getUserByToken(token);
  if (!user) return { error: 'Your session has expired. Please log in again.' };

  const info = imageInfo(image);
  const width = info.width ?? w, height = info.height ?? h;
  const hash = createHash('sha256').update(image).update(`|${EXTRACTION_VERSION}`).digest('hex');
  if (!force) {
    const cached = await ImageRead.findOne({ userId: user._id, hash }).lean() as any;
    if (cached?.extraction) {
      console.info(`[ai] read-plan cache hit (read by ${cached.model}) ${width}x${height}px`);
      // Older cached readings may still be on a 0-1000 scale.
      const extraction = toPixelSpace(cached.extraction, cached.imageWidth, cached.imageHeight);
      return { success: true, summary: cached.summary, rooms: toImageRooms(extraction, cached.imageWidth, cached.imageHeight), extraction, imageWidth: cached.imageWidth, imageHeight: cached.imageHeight, model: cached.model };
    }
  }

  const limited = aiRateLimit(user._id);
  if (!limited.ok) return { error: limited.error };
  const result = await extract(image, width, height, info, signal);
  if ('success' in result) {
    const { summary, rooms, extraction, model } = result;
    await ImageRead.updateOne({ userId: user._id, hash }, { $set: { model, summary, rooms, extraction, imageWidth: width, imageHeight: height } }, { upsert: true }).catch(() => {});
  }
  return result;
}

async function extract(image: string, width: number, height: number, info: ReturnType<typeof imageInfo>, signal?: AbortSignal): Promise<PlanImageResult> {
  try {
    return (await withModels('read-plan', model => extractWith(model, image, width, height, info, signal), signal, 'vision')).result;
  } catch (error: any) {
    if (signal?.aborted) return { aborted: true };
    console.error('[ai] read-plan error:', error?.status, error?.message);
    return { error: aiErrorMessage(error) };
  }
}

const MAX_TOKENS_CEILING = 65_536; // the most a retry after a cut-off answer may ask for

// One model's attempt, with up to MAX_RETRIES corrections. Throws (so the next model is
// tried) on provider errors, or TryNextModel when its answers stay unusable.
async function extractWith(model: string, image: string, width: number, height: number, info: ReturnType<typeof imageInfo>, signal?: AbortSignal): Promise<PlanImageResult> {
  const space = coordinateSpace();
  const messages: any[] = [{
    role: 'user',
    content: [
      { type: 'image_url', image_url: { url: image, detail: 'high' } },
      { type: 'text', text: extractionPrompt(width, height, space) },
    ],
  }];
  // What this model is asked with; adjusted when it rejects an option or runs out of tokens.
  const opts = { maxTokens: EXTRACT_MAX_TOKENS(), reasoning: supportsReasoning(model) ? EXTRACT_REASONING() : 'off', schema: supportsJsonSchema(model) };
  const request = () => aiClient().chat.completions.create(
    {
      model,
      max_tokens: opts.maxTokens,
      messages,
      ...(opts.reasoning !== 'off' ? (reasoningField(opts.reasoning) as object) : { temperature: 0 }),
      ...(opts.schema ? { response_format: { type: 'json_schema' as const, json_schema: { name: 'floor_plan', strict: true, schema: WIRE_JSON_SCHEMA } } } : {}),
    },
    { signal },
  );
  // A model that rejects the reasoning setting or the response schema (400) is asked again
  // without it, and remembered; the prompt describes the shape anyway.
  const send = async () => {
    for (;;) {
      try {
        return await request();
      } catch (error: any) {
        if (!isOptionRejected(error) || signal?.aborted) throw error;
        const message = String(error?.message ?? '');
        if (opts.reasoning !== 'off' && /think|reason/i.test(message)) {
          console.warn(`[ai] read-plan: ${model} doesn't take a reasoning setting; asking without it`);
          markNoReasoning(model);
          opts.reasoning = 'off';
        } else if (opts.schema) {
          console.warn(`[ai] read-plan: ${model} rejected the response schema (${message.slice(0, 120)}); asking without it`);
          markNoJsonSchema(model);
          opts.schema = false;
        } else {
          throw error;
        }
      }
    }
  };

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let response = await send();
    if (signal?.aborted) return { aborted: true };
    logAiCall(`read-plan#${attempt + 1}`, model, response, info);

    // Cut off: thinking counts towards the limit, and a model now and then repeats itself
    // until it runs out. Asked once more with twice the room and less thinking; if that is
    // cut off too, the next model is tried.
    if (response.choices[0]?.finish_reason === 'length') {
      const before = opts.maxTokens;
      opts.maxTokens = Math.min(MAX_TOKENS_CEILING, before * 2);
      if (opts.reasoning !== 'off') opts.reasoning = 'low';
      console.warn(`[ai] read-plan: ${model} was cut off at ${before} tokens; asking again with ${opts.maxTokens}`);
      response = await send();
      if (signal?.aborted) return { aborted: true };
      logAiCall(`read-plan#${attempt + 1}-retry`, model, response, info);
      if (response.choices[0]?.finish_reason === 'length') {
        throw new TryNextModel(`The AI's answer was cut off at ${opts.maxTokens} tokens before the plan was complete (it may have got stuck repeating itself). Try Re-read.`);
      }
    }
    const choice = response.choices[0];
    const text = choice?.message.content ?? '';
    const raw = firstJson(text);
    const parsed = raw ? WireSchema.safeParse(raw) : null;
    if (parsed?.success) {
      const extraction = fromWire(parsed.data, space, width, height);
      return { success: true, summary: extraction.summary || `I can see ${extraction.rooms.length} rooms.`, rooms: toImageRooms(extraction, width, height), extraction, imageWidth: width, imageHeight: height, model };
    }
    const problems = parsed ? formatIssues(parsed.error) : ['the reply was not valid JSON'];
    console.warn(`[ai] read-plan#${attempt + 1}: invalid answer: ${problems.join('; ')}`);
    if (attempt === MAX_RETRIES) throw new TryNextModel(`The AI couldn't read the drawing into a usable plan (${problems.slice(0, 3).join('; ')}). Try Re-read, or a clearer image.`);
    messages.push({ role: 'assistant', content: text || '(empty)' });
    messages.push({ role: 'user', content: `That answer is not valid: ${problems.join('; ')}. Reply with the corrected, complete JSON only.` });
  }
  throw new TryNextModel('The AI could not read the drawing.');
}
