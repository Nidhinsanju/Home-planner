"use server";

import OpenAI from "openai";
import jwt from 'jsonwebtoken';
import { connectToDatabase, User, ChatHistory } from '../lib/db';

const JWT_SECRET = process.env.SUPER_KEY || 'default_fallback_secret';

export async function getChatHistory(token: string, planId: string) {
  if (!token) return { messages: [] };
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    await connectToDatabase();
    const user = await User.findOne({ email: decoded.email }).lean() as any;
    if (!user) return { messages: [] };

    let history = await ChatHistory.findOne({ userId: user._id, planId }).lean() as any;
    return { messages: history?.messages || [] };
  } catch (err) {
    return { messages: [] };
  }
}

export async function processChat(prompt: string, token: string, planId: string, sceneData: any = {}) {
  const apiKey = process.env.HF_TOKEN;


  if (!apiKey) {
    return { error: "HF_TOKEN is missing" };
  }

const client = new OpenAI({
  baseURL: "https://router.huggingface.co/v1",
  apiKey: apiKey,
});

  const systemMessage = `
You are an AI assistant for a 3D home planning and Vastu visualizer app.

CRITICAL INSTRUCTION:
If the user says hello, asks a general question, or says anything that IS NOT a command to build/create/delete/move an object, you MUST reply with a normal conversational sentence and NO JSON.

If and ONLY if the user explicitly asks to add, create, delete, move, or modify an item in the 3D scene (e.g. room, door, window, wall, tree, car), you must return a JSON object describing the action.
Do NOT return the example JSON unless it matches the user's request.

Available actions: "build", "delete", "deleteAll", "move".
Types: "room", "door", "window", "wall", "tree", "car", "sofa", "bed", "table", "plant", "bench"

CURRENT SCENE DATA:
${JSON.stringify(sceneData)}
Use the IDs from the scene data to delete or move existing items. If the user asks to delete everything or clear the floor, use the "deleteAll" action.

Example of JSON for building a room:
{"action": "build", "type": "room", "x": 0, "y": 0, "width": 10, "depth": 10}

Example of JSON for deleting a specific item:
{"action": "delete", "type": "room", "id": "room-123"}

Example of JSON for deleting everything:
{"action": "deleteAll"}

Example of JSON for moving/updating an item:
{"action": "move", "type": "tree", "id": "tree-123", "x": 15, "y": -5}

Remember: If it's just a conversation, reply with text ONLY.
`;

  let historyDoc: any = null;
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      await connectToDatabase();
      const user = await User.findOne({ email: decoded.email }).lean() as any;
      if (user) {
        historyDoc = await ChatHistory.findOne({ userId: user._id, planId });
        if (!historyDoc) {
          historyDoc = new ChatHistory({ userId: user._id, planId, messages: [] });
        }
      }
    } catch (e) {}
  }

  if (historyDoc) {
    historyDoc.messages.push({ role: "user", content: prompt });
  }

  const cleanHistory = (historyDoc ? historyDoc.messages : [{ role: "user", content: prompt }])
    .slice(-10)
    .map((msg: any) => {
      return { role: msg.role, content: msg.content };
    });

  const apiMessages = [
    { role: "system", content: systemMessage },
    ...cleanHistory
  ];

  // For small 3B models, they often forget instructions if the history is long.
  // We strictly append a reminder to the very last user message.
  const lastMsg = apiMessages[apiMessages.length - 1];
  if (lastMsg && lastMsg.role === 'user') {
    lastMsg.content += "\n\n[SYSTEM REMINDER: If this request asks to build, create, delete, or move an item, you MUST output the JSON object block!]";
  }

  try {
    const response = await client.chat.completions.create({
      model: "Qwen/Qwen2.5-3B-Instruct:featherless-ai",
      messages: apiMessages as any,
      temperature: 0.2,
    });

    const reply = response.choices[0].message.content?.trim() || "";

    let buildCommand = null;
    let conversationalReply = reply;

    // Try to find a JSON block in the reply
    const jsonMatch = reply.match(/{[\s\S]*}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.action) {
          buildCommand = parsed;
          // Remove the json block from the reply
          conversationalReply = reply.replace(/{[\s\S]*}/, '').replace(/```json|```/g, '').trim();
        }
      } catch (e) {
        // Not valid JSON
      }
    }

    if (historyDoc) {
      historyDoc.messages.push({ role: "assistant", content: buildCommand ? (conversationalReply || "I have updated the scene.") : conversationalReply });
      await historyDoc.save();
    }

    if (buildCommand) {
      return {
        success: true,
        buildCommand,
        reply: conversationalReply || "I've processed your command and updated the 3D scene!",
      };
    }

    return {
      success: true,
      reply: conversationalReply,
    };
  } catch (error) {
    console.error("OpenAI error:", error);

    return {
      error: "An error occurred while contacting AI",
    };
  }
}