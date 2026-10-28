import { runVastuFix } from '../../../lib/vastuFix';

// "Fix with AI" on the Vastu tab. A route (not a server action) so the browser can cancel it.
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
  if (!body?.plan || typeof body.plan !== 'object') return Response.json({ error: 'Invalid request' }, { status: 400 });
  return Response.json(await runVastuFix(token, String(body.planId ?? ''), body.plan, request.signal));
}
