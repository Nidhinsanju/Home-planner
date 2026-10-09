import OpenAI from 'openai';
import { getUserByToken, isPlanId } from './session';
import type { ImageRoom } from '../plan/types';

// Reads an uploaded floor-plan image with a local vision model (Ollama, OpenAI-compatible
// API) and returns a short description plus the rooms it can see, as boxes in fractions of
// the image. The chat model is text-only, so this is how it learns what the drawing shows.

export type PlanImageResult =
  | { success: true; summary: string; rooms: ImageRoom[] }
  | { error: string }
  | { aborted: true };

const VISION_MODEL = () => process.env.AI_VISION_MODEL || 'qwen2.5vl:3b';

const prompt = (w: number, h: number) => `
This image is an architectural floor plan (${w} x ${h} pixels). Identify every room or space drawn on it.

Return ONLY JSON, no other text, in exactly this shape:
{"summary": "one or two sentences describing the layout", "rooms": [{"name": "Living Room", "type": "living", "box": [x1, y1, x2, y2]}]}

- "box" is the room's rectangle in PIXELS: x1,y1 = top-left corner, x2,y2 = bottom-right corner, inside the walls.
- "name" is the label written on the plan if there is one (e.g. "Master Bedroom"), otherwise a sensible name.
- "type" is one of: living, bed, kitchen, dining, toilet, pooja, study, utility, store, staircase, parking, balcony, hallway.
- If sizes are written on the plan (e.g. 12'x10'), mention them in the summary.
`;

// The first {...} block in the reply, parsed.
function extractJson(text: string): any {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

// Normalises a box to fractions of the image. Models sometimes answer in fractions already.
function toBox(b: unknown, w: number, h: number): ImageRoom['box'] | null {
  if (!Array.isArray(b) || b.length !== 4 || !b.every(v => Number.isFinite(Number(v)))) return null;
  let [x1, y1, x2, y2] = b.map(Number);
  if (Math.max(x1, y1, x2, y2) > 1.5) {
    x1 /= w; x2 /= w; y1 /= h; y2 /= h;
  }
  const box: ImageRoom['box'] = [clamp01(Math.min(x1, x2)), clamp01(Math.min(y1, y2)), clamp01(Math.max(x1, x2)), clamp01(Math.max(y1, y2))];
  return box[2] - box[0] > 0.02 && box[3] - box[1] > 0.02 ? box : null;
}

export async function readPlanImage(token: string, planId: string, image: string, w: number, h: number, signal?: AbortSignal): Promise<PlanImageResult> {
  if (!isPlanId(planId)) return { error: 'The AI assistant is only available on your own plans.' };
  if (!/^data:image\/(png|jpeg|webp);base64,/.test(image)) return { error: 'Invalid image.' };
  const user = await getUserByToken(token);
  if (!user) return { error: 'Your session has expired. Please log in again.' };

  const client = new OpenAI({
    baseURL: process.env.AI_BASE_URL || 'http://localhost:11434/v1',
    apiKey: process.env.AI_API_KEY || 'ollama',
  });

  try {
    const response = await client.chat.completions.create(
      {
        model: VISION_MODEL(),
        temperature: 0.1,
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: image } },
            { type: 'text', text: prompt(w, h) },
          ],
        }],
      },
      { signal },
    );
    if (signal?.aborted) return { aborted: true };

    const data = extractJson(response.choices[0].message.content || '');
    if (!data) return { error: "I couldn't make sense of that drawing. Try a clearer image, or trace it by hand." };
    const rooms: ImageRoom[] = (Array.isArray(data.rooms) ? data.rooms : [])
      .slice(0, 40)
      .map((r: any) => ({ name: String(r?.name ?? '').slice(0, 60), type: String(r?.type ?? '').toLowerCase().slice(0, 20), box: toBox(r?.box, w, h) }))
      .filter((r: any): r is ImageRoom => !!r.box);
    const summary = String(data.summary ?? '').trim().slice(0, 1000);
    return { success: true, summary: summary || `I can see ${rooms.length} rooms.`, rooms };
  } catch (error: any) {
    if (signal?.aborted) return { aborted: true };
    console.error('Vision model error:', error);
    if (error?.status === 404 || /not found/i.test(String(error?.message))) {
      return { error: `The vision model "${VISION_MODEL()}" isn't installed. Run: ollama pull ${VISION_MODEL()}` };
    }
    return { error: 'Could not reach the AI to read the image. Is Ollama running?' };
  }
}
