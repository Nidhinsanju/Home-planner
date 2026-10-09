import OpenAI from 'openai';
import { ChatHistory } from './db';
import { getUserByToken, isPlanId } from './session';
import { parseCommands } from './parseCommands';
import { systemMessage, userMessageText } from './aiPrompt';

export type ChatResult =
  | { success: true; reply: string; buildCommands?: Record<string, any>[] }
  | { error: string }
  | { aborted: true };

// Runs one chat turn. When `signal` aborts (the user pressed Stop), the AI request is
// cancelled and nothing is written to the chat history, so a stopped turn leaves no trace.
// `image` is the user's uploaded floor plan (a small JPEG data URL), sent along so the model
// can look at it; it is attached to the latest message only and not stored in the history.
export async function runChat(prompt: string, token: string, planId: string, sceneData: unknown, signal?: AbortSignal, image?: string): Promise<ChatResult> {
  if (!isPlanId(planId)) return { error: 'The AI assistant is only available on your own plans.' };
  const hasImage = typeof image === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(image);

  // Defaults to a local Ollama server (OpenAI-compatible API); it ignores the key but the client needs one.
  const client = new OpenAI({
    baseURL: process.env.AI_BASE_URL || 'http://localhost:11434/v1',
    apiKey: process.env.AI_API_KEY || 'ollama',
  });

  // Only signed-in users may use the AI.
  const user = await getUserByToken(token);
  if (!user) return { error: 'Your session has expired. Please log in again.' };

  let historyDoc: any = null;
  try {
    historyDoc = (await ChatHistory.findOne({ userId: user._id, planId })) ?? new ChatHistory({ userId: user._id, planId, messages: [] });
  } catch {
    // chat still works without history
  }

  const previous = (historyDoc?.messages ?? []).slice(-9).map((m: any) => ({ role: m.role, content: m.content }));
  const userText = userMessageText(prompt, sceneData, hasImage);
  const apiMessages = [
    { role: 'system', content: systemMessage(sceneData, hasImage) },
    ...previous,
    { role: 'user', content: hasImage ? [{ type: 'image_url', image_url: { url: image } }, { type: 'text', text: userText }] : userText },
  ];

  try {
    const response = await client.chat.completions.create(
      { model: process.env.AI_MODEL || 'qwen2.5vl:3b', messages: apiMessages as any, temperature: 0.2 },
      { signal },
    );
    if (signal?.aborted) return { aborted: true };

    const reply = response.choices[0].message.content?.trim() || '';
    // Small models sometimes paste a prompt example into a chatty explanation ("For example:
    // {...}"); don't run those. A real command comes back as (nearly) bare JSON, so an example
    // is only dropped when it is wrapped in a sentence or more of prose.
    const examples = new Set(parseCommands(systemMessage({})).commands.map(c => JSON.stringify(c)));
    const { commands: found, text } = parseCommands(reply);
    const commands = text.length > 40 ? found.filter(c => !examples.has(JSON.stringify(c))) : found;

    if (historyDoc) {
      historyDoc.messages.push({ role: 'user', content: prompt });
      historyDoc.messages.push({ role: 'assistant', content: text || (commands.length ? 'I have updated the scene.' : '(no response)') });
      await historyDoc.save();
    }

    if (commands.length > 0) {
      return { success: true, buildCommands: commands, reply: text };
    }
    return { success: true, reply: text || "I'm sorry, I couldn't generate a response for that. Could you please rephrase?" };
  } catch (error) {
    if (signal?.aborted) return { aborted: true };
    console.error('OpenAI error:', error);
    return { error: 'An error occurred while contacting AI' };
  }
}
