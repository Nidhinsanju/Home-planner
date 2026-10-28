import { withAiStatus, type AiStatus } from './aiClient';

// An AI route's answer as a stream of JSON lines (NDJSON), so the browser hears how the request
// is going while it runs ("the AI is busy, trying the next model…") and can show it as toasts:
//   {"type":"status","level":"warning","message":"..."}   any number, as they happen
//   {"type":"result","result":{...}}                       once, last: what the route returns
// Early refusals (not logged in, bad input, rate limited) stay plain JSON with an HTTP status;
// readAiResponse (aiStreamClient.ts) reads both.
export type AiStreamLine = ({ type: 'status' } & AiStatus) | { type: 'result'; result: unknown };

export function streamAiResult(run: () => Promise<unknown>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (line: AiStreamLine) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(line) + '\n'));
        } catch {
          open = false; // the browser disconnected (e.g. Stop was pressed)
        }
      };
      try {
        const result = await withAiStatus(status => send({ type: 'status', ...status }), run);
        send({ type: 'result', result });
      } catch (error) {
        console.error('[ai] stream error:', error);
        send({ type: 'result', result: { error: 'Something went wrong on the server. Please try again.' } });
      } finally {
        open = false;
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no', // nginx and similar proxies: don't hold the lines back
    },
  });
}
