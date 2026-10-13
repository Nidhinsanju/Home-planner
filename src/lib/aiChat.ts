import OpenAI from 'openai';
import { ChatHistory } from './db';
import { getUserByToken, isPlanId } from './session';
import { parseCommands } from './parseCommands';
import { systemMessage, userMessageText } from './aiPrompt';
import { cloudCallsLeft, cloudEnabled, planRequest, type CloudStep } from './cloudAI';

// How a chat message is handled:
// - "auto": the local model answers. It decides itself whether the request is too complex for
//   it; if so it replies {"action": "askExpert"} and the cloud model plans the request as simple
//   steps instead, which the browser then has the local model carry out ("step" mode).
// - "cloud": straight to the cloud model. The browser uses this when the local model's commands
//   for a request could not be applied.
// - "step": one step of a cloud plan, run on the local model without touching the chat history.
export type ChatMode = 'auto' | 'cloud' | 'step';

export type ChatResult =
  | { success: true; reply: string; buildCommands?: Record<string, any>[]; steps?: CloudStep[]; cloud?: boolean }
  | { error: string }
  | { aborted: true };

// Runs one chat turn. When `signal` aborts (the user pressed Stop), the AI request is
// cancelled and nothing is written to the chat history, so a stopped turn leaves no trace.
// `image` is the user's uploaded floor plan (a small JPEG data URL), sent along so the model
// can look at it; it is attached to the latest message only and not stored in the history.
export async function runChat(prompt: string, token: string, planId: string, sceneData: unknown, signal?: AbortSignal, image?: string, mode: ChatMode = 'auto'): Promise<ChatResult> {
  if (!isPlanId(planId)) return { error: 'The AI assistant is only available on your own plans.' };
  const hasImage = typeof image === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(image);
  const hasDrawing = hasImage || !!(sceneData as any)?.referenceDrawing;

  // Only signed-in users may use the AI.
  const user = await getUserByToken(token);
  if (!user) return { error: 'Your session has expired. Please log in again.' };

  let historyDoc: any = null;
  if (mode !== 'step') {
    try {
      historyDoc = (await ChatHistory.findOne({ userId: user._id, planId })) ?? new ChatHistory({ userId: user._id, planId, messages: [] });
    } catch {
      // chat still works without history
    }
  }
  const previous = (historyDoc?.messages ?? []).slice(-9).map((m: any) => ({ role: m.role, content: m.content }));
  const saveTurn = async (reply: string) => {
    if (!historyDoc) return;
    historyDoc.messages.push({ role: 'user', content: prompt });
    historyDoc.messages.push({ role: 'assistant', content: reply });
    await historyDoc.save();
  };
  const cloudReady = async () => cloudEnabled() && (await cloudCallsLeft(user._id)) > 0;

  // The cloud model plans the request; the browser carries out the steps.
  const askCloud = async (): Promise<ChatResult> => {
    const res = await planRequest(user._id, prompt, sceneData, previous.slice(-4), signal);
    if (!('data' in res)) return res;
    const { reply, steps } = res.data;
    const text = reply || (steps.length ? `Here's the plan: ${steps.length} steps.` : 'I have nothing to change.');
    await saveTurn(text);
    return { success: true, reply: text, steps };
  };
  if (mode === 'cloud') return askCloud();

  // Defaults to a local Ollama server (OpenAI-compatible API); it ignores the key but the client needs one.
  const client = new OpenAI({
    baseURL: process.env.AI_BASE_URL || 'http://localhost:11434/v1',
    apiKey: process.env.AI_API_KEY || 'ollama',
  });
  const userText = (canAskExpert: boolean) => userMessageText(prompt, sceneData, hasImage, canAskExpert);
  const askLocal = async (canAskExpert: boolean) => {
    const apiMessages = [
      { role: 'system', content: systemMessage(sceneData, hasDrawing, canAskExpert) },
      ...previous,
      { role: 'user', content: hasImage ? [{ type: 'image_url', image_url: { url: image } }, { type: 'text', text: userText(canAskExpert) }] : userText(canAskExpert) },
    ];
    const response = await client.chat.completions.create(
      { model: process.env.AI_MODEL || 'qwen2.5vl:3b', messages: apiMessages as any, temperature: 0.2 },
      { signal },
    );
    const reply = response.choices[0].message.content?.trim() || '';
    // Small models sometimes paste a prompt example into a chatty explanation ("For example:
    // {...}"); don't run those. A real command comes back as (nearly) bare JSON, so an example
    // is only dropped when it is wrapped in a sentence or more of prose.
    const examples = new Set(parseCommands(systemMessage({})).commands.map(c => JSON.stringify(c)));
    const { commands: found, text } = parseCommands(reply);
    const commands = text.length > 40 ? found.filter(c => !examples.has(JSON.stringify(c))) : found;
    return { commands, text };
  };

  try {
    const canAskExpert = mode === 'auto' && (await cloudReady());
    let { commands, text } = await askLocal(canAskExpert);
    if (signal?.aborted) return { aborted: true };

    if (commands.some(c => c.action === 'askExpert')) {
      const planned = await askCloud();
      if (!('error' in planned)) return planned;
      // The cloud model failed or today's limit was reached meanwhile: the local model does its best.
      console.error('Cloud planning failed, using the local model:', planned.error);
      ({ commands, text } = await askLocal(false));
      if (signal?.aborted) return { aborted: true };
    }
    commands = commands.filter(c => c.action !== 'askExpert');

    await saveTurn(text || (commands.length ? 'I have updated the scene.' : '(no response)'));

    if (commands.length > 0) {
      return { success: true, buildCommands: commands, reply: text, cloud: mode === 'auto' && (await cloudReady()) };
    }
    return { success: true, reply: text || "I'm sorry, I couldn't generate a response for that. Could you please rephrase?" };
  } catch (error) {
    if (signal?.aborted) return { aborted: true };
    console.error('OpenAI error:', error);
    return { error: 'An error occurred while contacting AI' };
  }
}
