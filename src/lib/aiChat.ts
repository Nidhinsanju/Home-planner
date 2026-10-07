import OpenAI from 'openai';
import { ChatHistory } from './db';
import { getUserByToken, isPlanId } from './session';
import { parseCommands } from './parseCommands';

export type ChatResult =
  | { success: true; reply: string; buildCommands?: Record<string, any>[] }
  | { error: string }
  | { aborted: true };

const systemMessage = (sceneData: unknown) => `
You are an AI assistant for a 3D home planning and Vastu visualizer app.

CRITICAL INSTRUCTION:
If the user says hello, asks a general question, or says anything that IS NOT a command to build/create/delete/move an object, you MUST reply with a normal conversational sentence and NO JSON.

If and ONLY if the user explicitly asks to add, create, delete, move, or modify an item in the 3D scene (e.g. room, door, window, wall, tree, car), you must return JSON describing the action.
Do NOT return the example JSON unless it matches the user's request.

Available actions: "build", "delete", "deleteAll", "move", "update".
Build types: "room", "wall", "door", "window", and furniture: "sofa", "table", "tv", "bed", "wardrobe", "dining", "counter", "toilet", "bench", "plant", "tree", "car".
Room types: living, bed, kitchen, dining, toilet, pooja, study, utility, store, staircase, parking, balcony, hallway.

COORDINATES: all positions and sizes are in FEET on a 2D floor plan. The plot is centred at x=0, y=0.
x grows to the EAST (right), y grows to the SOUTH (down). NORTH is negative y. So north-east is (+x, -y).
Rooms are rectangles positioned by their centre; rooms that touch share walls automatically.
To put a room next to another, use the existing room's "bounds" (e.g. a room east of it starts at its maxX).
Walls go from (x, y) to (endX, endY). Doors and windows go on the wall nearest to (x, y), or on "wallId" if given.

CURRENT PLAN:
${JSON.stringify(sceneData)}
Use the IDs from the plan to delete, move or update existing rooms, walls, openings and items. If the user asks to delete everything, use "deleteAll".

Example of JSON for building a room:
{"action": "build", "type": "room", "name": "Master Bedroom", "roomType": "bed", "x": 0, "y": 0, "width": 12, "depth": 10}

Example of JSON for renaming a room or changing its type:
{"action": "update", "id": "room-123", "name": "Pooja Room", "roomType": "pooja"}

Example of JSON for building a wall:
{"action": "build", "type": "wall", "x": -10, "y": 5, "endX": 10, "endY": 5}

Example of JSON for adding a door near a point:
{"action": "build", "type": "door", "x": 0, "y": 5}

Example of JSON for deleting a specific item:
{"action": "delete", "id": "room-123"}

Example of JSON for deleting everything:
{"action": "deleteAll"}

Example of JSON for moving an item:
{"action": "move", "id": "tree-123", "x": 15, "y": -5}

If the user asks for several changes at once, return one object with a "commands" array:
{"commands": [{"action": "build", "type": "tree", "x": 5, "y": 5}, {"action": "build", "type": "car", "x": -5, "y": 10}]}

Remember: If it's just a conversation, reply with text ONLY.
`;

// Runs one chat turn. When `signal` aborts (the user pressed Stop), the AI request is
// cancelled and nothing is written to the chat history, so a stopped turn leaves no trace.
export async function runChat(prompt: string, token: string, planId: string, sceneData: unknown, signal?: AbortSignal): Promise<ChatResult> {
  const apiKey = process.env.HF_TOKEN;
  if (!apiKey) return { error: 'HF_TOKEN is missing' };
  if (!isPlanId(planId)) return { error: 'The AI assistant is only available on your own plans.' };

  const client = new OpenAI({ baseURL: 'https://router.huggingface.co/v1', apiKey });

  // Only signed-in users may use (and spend credits on) the AI.
  const user = await getUserByToken(token);
  if (!user) return { error: 'Your session has expired. Please log in again.' };

  let historyDoc: any = null;
  try {
    historyDoc = (await ChatHistory.findOne({ userId: user._id, planId })) ?? new ChatHistory({ userId: user._id, planId, messages: [] });
  } catch {
    // chat still works without history
  }

  const previous = (historyDoc?.messages ?? []).slice(-9).map((m: any) => ({ role: m.role, content: m.content }));
  // Small models forget instructions in long chats, so remind them on the latest message.
  const apiMessages = [
    { role: 'system', content: systemMessage(sceneData) },
    ...previous,
    { role: 'user', content: `${prompt}\n\n[SYSTEM REMINDER: If this request asks to build, create, delete, or move an item, you MUST output the JSON (use a "commands" array for several changes)!]` },
  ];

  try {
    const response = await client.chat.completions.create(
      { model: 'Qwen/Qwen2.5-3B-Instruct:featherless-ai', messages: apiMessages as any, temperature: 0.2 },
      { signal },
    );
    if (signal?.aborted) return { aborted: true };

    const reply = response.choices[0].message.content?.trim() || '';
    const { commands, text } = parseCommands(reply);

    if (historyDoc) {
      historyDoc.messages.push({ role: 'user', content: prompt });
      historyDoc.messages.push({ role: 'assistant', content: text || (commands.length ? 'I have updated the scene.' : '(no response)') });
      await historyDoc.save();
    }

    if (commands.length > 0) {
      return { success: true, buildCommands: commands, reply: text || "I've processed your command and updated the 3D scene!" };
    }
    return { success: true, reply: text || "I'm sorry, I couldn't generate a response for that. Could you please rephrase?" };
  } catch (error) {
    if (signal?.aborted) return { aborted: true };
    console.error('OpenAI error:', error);
    return { error: 'An error occurred while contacting AI' };
  }
}
