import { runVastuFix } from '../../../lib/vastuFix';
import { clientAddressOf, requestRateLimit, tooManyRequests } from '../../../lib/rateLimit';
import { streamAiResult } from '../../../lib/aiStream';
import { clientRefOf } from '../../../lib/aiQuota';

// "Fix with AI" on the Vastu tab. A route (not a server action) so the browser can cancel it.
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
  if (!body?.plan || typeof body.plan !== 'object') return Response.json({ error: 'Invalid request' }, { status: 400 });
  return streamAiResult(() => runVastuFix(token, String(body.planId ?? ''), body.plan, request.signal, client));
}
