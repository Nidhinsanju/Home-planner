import { readPlanImage } from '../../../lib/planImage';

// Reads an uploaded floor plan with the vision model. A route (not a server action) so the
// browser can cancel it and so large images aren't limited by the server-action body size.
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
  const w = Number(body?.width), h = Number(body?.height);
  if (typeof body?.image !== 'string' || !(w > 0) || !(h > 0)) return Response.json({ error: 'Invalid request' }, { status: 400 });

  const result = await readPlanImage(token, String(body.planId ?? ''), body.image, w, h, request.signal, body.force === true);
  return Response.json(result);
}
