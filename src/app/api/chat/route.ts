import { runChat } from '../../../lib/aiChat';

// A route (not a server action) so the browser can abort it: when the user presses Stop
// the request disconnects, request.signal fires, and the AI call is cancelled.
export const runtime = 'nodejs';

export async function POST(request: Request) {
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

  const result = await runChat(prompt, token, String(body.planId ?? ''), body.sceneData ?? {}, request.signal);
  return Response.json(result);
}
