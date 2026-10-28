"use server";

import { connectToDatabase, ChatHistory } from '../lib/db';
import { getUserByToken, isPlanId } from '../lib/session';

export async function getChatHistory(token: string, planId: string) {
  if (!token || !isPlanId(planId)) return { messages: [] };
  try {
    const user = await getUserByToken(token);
    if (!user) return { messages: [] };

    await connectToDatabase();
    const history = await ChatHistory.findOne({ userId: user._id, planId }).lean() as any;
    const messages = (history?.messages || []).map((msg: any) => ({
      role: msg.role,
      content: msg.content
    }));
    return { messages };
  } catch {
    return { messages: [] };
  }
}

export async function clearChatHistory(token: string, planId: string) {
  if (!token) return { success: false, error: 'Unauthorized' };
  if (!isPlanId(planId)) return { success: false, error: 'Invalid plan' };
  try {
    const user = await getUserByToken(token);
    if (!user) return { success: false, error: 'User not found' };

    await connectToDatabase();
    await ChatHistory.updateOne({ userId: user._id, planId }, { $set: { messages: [] } });
    return { success: true };
  } catch {
    return { success: false, error: 'Failed to clear chat' };
  }
}

// Saves a turn that changed the plan, with the reply describing what was actually applied.
// The browser calls this after applying the AI's changes (see runChat).
export async function saveChatTurn(token: string, planId: string, prompt: string, reply: string) {
  if (!token || !isPlanId(planId)) return { success: false };
  try {
    const user = await getUserByToken(token);
    if (!user) return { success: false };
    await connectToDatabase();
    await ChatHistory.updateOne(
      { userId: user._id, planId },
      { $push: { messages: { $each: [{ role: 'user', content: String(prompt).slice(0, 4000) }, { role: 'assistant', content: String(reply).slice(0, 4000) }] } } },
      { upsert: true },
    );
    return { success: true };
  } catch {
    return { success: false };
  }
}
