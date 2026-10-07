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
  } catch (err) {
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
  } catch (err) {
    return { success: false, error: 'Failed to clear chat' };
  }
}
