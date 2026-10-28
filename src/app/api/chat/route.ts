import { runChat, type ChatMode } from '../../../lib/aiChat';
import { clientAddressOf, requestRateLimit, tooManyRequests } from '../../../lib/rateLimit';
import { streamAiResult } from '../../../lib/aiStream';
import { clientRefOf } from '../../../lib/aiQuota';

// A route (not a server action) so the browser can abort it: when the user presses Stop
// the request disconnects, request.signal fires, and the AI call is cancelled.
export const runtime = 'nodejs';
// AI answers can take a minute or more (busy models are retried); Vercel's limit for one
// request. The AI calls themselves stop before this (AI_TOTAL_SEC in aiClient.ts).
export const maxDuration = 300;

export async function POST(request: Request) {
  // Per network address, before any work: also covers requests without a valid login.
  const limited = requestRateLimit('api', clientAddressOf(request.headers));
  if (!limited.ok) return tooManyRequests(limited);
  const client = clientRefOf(request.headers);
  const byDevice = client.deviceId ? requestRateLimit('apiDevice', client.deviceId) : limited;
  if (!byDevice.ok) return tooManyRequests(byDevice);
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!token) return Response.json({ error: 'Not logged in' }, { status: 401 });

  let body: any;
  try {
    body = await request.json();  
  } catch {
    return Response.json({ error: 'Invalid request' }, { status: 400 });
  }
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) return Response.json({ error: 'Empty message' }, { status: 400 });

  const image = typeof body.image === 'string' ? body.image : undefined;
  const mode: ChatMode = ['auto', 'cloud', 'step'].includes(body.mode) ? body.mode : 'auto';
  return streamAiResult(() => runChat(prompt, token, String(body.planId ?? ''), body.sceneData ?? {}, request.signal, image, mode, client, body.turn));
}
