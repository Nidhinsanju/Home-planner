// Reads an AI route's answer in the browser (see aiStream.ts): calls `onStatus` for each live
// status line as it arrives and returns the final result. A plain JSON answer (an early
// refusal such as "not logged in" or a rate limit) is returned as it is.
export type AiStatusUpdate = { level: 'info' | 'warning' | 'error'; message: string };

export async function readAiResponse(response: Response, onStatus?: (status: AiStatusUpdate) => void): Promise<any> {
  if (!response.body || !(response.headers.get('content-type') ?? '').includes('ndjson')) return response.json();

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  let result: unknown;
  const handle = (line: string) => {
    if (!line.trim()) return;
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg?.type === 'status' && typeof msg.message === 'string') onStatus?.({ level: msg.level === 'error' || msg.level === 'warning' ? msg.level : 'info', message: msg.message });
    else if (msg?.type === 'result') result = msg.result;
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffered.indexOf('\n')) >= 0) {
      handle(buffered.slice(0, nl));
      buffered = buffered.slice(nl + 1);
    }
  }
  handle(buffered + decoder.decode());
  return result ?? { error: 'The server stopped answering before it finished. Please try again.' };
}
