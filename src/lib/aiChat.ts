import OpenAI from 'openai';
import { ChatHistory } from './db';
import { getUserByToken, isPlanId } from './session';
import { parseCommands } from './parseCommands';

export type ChatResult =
  | { success: true; reply: string; buildCommands?: Record<string, any>[] }
  | { error: string }
  | { aborted: true };

// The instructions for the chat model. It can (1) talk about the design and Vastu, (2) change
// the plan by replying with JSON commands, and (3) see the user's uploaded floor plan, which
// is attached to the latest message when there is one.
const systemMessage = (sceneData: unknown, hasImage = false) => `
You are the AI assistant of a home planning and Vastu app. You help the user design their house in three ways:

1. TALK: answer questions and give advice about layout, room sizes and Vastu. Reply in plain, friendly text.
2. BUILD: change the plan (rooms, walls, doors, windows, furniture) by replying with JSON commands. The app applies them.
3. SEE THE UPLOADED DRAWING: ${hasImage
  ? 'the user has uploaded a floor-plan image and it is attached to their latest message. Look at it to describe the layout, answer questions about it ("how many bedrooms?", "where is the kitchen?"), compare it with CURRENT PLAN, suggest Vastu improvements, or build from it when asked.'
  : 'the user can upload a floor-plan image in the Build tab (Background image). None is uploaded now; if they ask about one, tell them how to upload it.'}

HOW TO REPLY:
- If the user is chatting, asking a question or asking about the drawing, reply with text ONLY (no JSON).
- If and ONLY if the user asks to add, create, build, delete, move, resize, rename or change something in the plan, reply with the JSON command(s) ONLY. Use a "commands" array for several changes.
- Never output an example from these instructions unless it is exactly what the user asked for.

COORDINATES: all positions and sizes are in FEET. x grows to the EAST (right), y grows to the SOUTH (down); NORTH is negative y, so north-east is (+x, -y).
There is no plot boundary: "bounds" in CURRENT PLAN is the extent of everything drawn (null when the plan is empty: then build around x=0, y=0).
Rooms are rectangles; rooms that touch share walls automatically. Prefer "nextTo"/"side" or "position" over working out x and y yourself.
Walls go from (x, y) to (endX, endY). Doors and windows go on the wall nearest to (x, y), or on "wallId" if given.

CURRENT PLAN:
${JSON.stringify(sceneData)}
To delete, move or update something, copy its "id" EXACTLY from CURRENT PLAN. Never make up an id. In the examples below, ID_FROM_PLAN stands for a real id from the plan.

THE UPLOADED DRAWING: if CURRENT PLAN has "referenceDrawing", those are the rooms found on the uploaded drawing, already measured in plan feet. Whenever the user asks to build ANYTHING "from the drawing / image / plan I uploaded" (the whole house or just one room), ALWAYS use "buildFromDrawing" (the app places the rooms exactly where they are on the drawing). Never type the coordinates yourself for this.
Whole drawing:
{"action": "buildFromDrawing"}
Only some rooms (use their names from referenceDrawing):
{"action": "buildFromDrawing", "rooms": ["Kitchen"]}

Available actions: "build", "buildFromDrawing", "delete", "deleteAll", "move", "update".
Build types: "room", "wall", "door", "window", and furniture: "sofa", "table", "tv", "bed", "wardrobe", "dining", "counter", "toilet", "bench", "plant", "tree", "car".
Room types: living, bed, kitchen, dining, toilet, pooja, study, utility, store, staircase, parking, balcony, hallway.

Example of JSON for building a room next to an existing room (preferred; "side" is north, south, east or west, and the app works out the position):
{"action": "build", "type": "room", "name": "Master Bedroom", "roomType": "bed", "width": 12, "depth": 10, "nextTo": "ID_FROM_PLAN", "side": "east"}

Example of JSON for building a room on a side or corner of the whole house (e.g. Vastu placements like "pooja room in the north-east"):
{"action": "build", "type": "room", "name": "Pooja Room", "roomType": "pooja", "width": 6, "depth": 6, "position": "north-east"}

Example of JSON for building a room at an exact centre (only when the user gives coordinates, or the plan is empty):
{"action": "build", "type": "room", "name": "Living Room", "roomType": "living", "x": 0, "y": 0, "width": 14, "depth": 12}

Example of JSON for renaming a room or changing its type:
{"action": "update", "id": "ID_FROM_PLAN", "name": "Pooja Room", "roomType": "pooja"}

Example of JSON for resizing or rotating furniture (feet; give only what changes):
{"action": "update", "id": "ID_FROM_PLAN", "width": 8, "depth": 3.5, "height": 3, "rotation": 90}

Example of JSON for adding furniture at a custom size:
{"action": "build", "type": "bed", "x": 4, "y": -6, "width": 6, "depth": 7}

Example of JSON for building a wall:
{"action": "build", "type": "wall", "x": -10, "y": 5, "endX": 10, "endY": 5}

Example of JSON for adding a door near a point:
{"action": "build", "type": "door", "x": 0, "y": 5}

Example of JSON for deleting a specific item:
{"action": "delete", "id": "ID_FROM_PLAN"}

Example of JSON for deleting everything:
{"action": "deleteAll"}

Example of JSON for moving an item to a new centre:
{"action": "move", "id": "ID_FROM_PLAN", "x": 15, "y": -5}

Example of JSON for moving an item BY an amount in a direction. Use this for "move it up / left / a bit north" ("up" means north, "down" south, "left" west, "right" east; "a bit" is about 3 ft):
{"action": "move", "id": "ID_FROM_PLAN", "direction": "north", "distance": 5}

If the user asks for several changes at once, return one object with a "commands" array:
{"commands": [{"action": "build", "type": "tree", "x": 5, "y": 5}, {"action": "build", "type": "car", "x": -5, "y": 10}]}

Remember: chatting, questions and describing the drawing get text ONLY; changes to the plan get JSON ONLY.
`;

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
  // Repeat the real room ids next to the request: small models copy ids from the nearest text.
  const rooms: any[] = Array.isArray((sceneData as any)?.rooms) ? (sceneData as any).rooms : [];
  const roomIds = rooms.length
    ? ` Existing rooms: ${rooms.map(r => `"${r.id}" = ${r.name || r.type || 'unnamed room'} (centre ${r.center?.x}, ${r.center?.y})`).join('; ')}.`
    : '';
  // Small models forget instructions in long chats, so remind them on the latest message.
  const reminder = `[SYSTEM REMINDER: If this request asks to build, create, delete, move or change something, you MUST output the JSON (use a "commands" array for several changes)! Use only ids from the plan.${roomIds}${hasImage ? ' The attached image is the floor plan the user uploaded.' : ''}]`;
  const userText = `${prompt}\n\n${reminder}`;
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
