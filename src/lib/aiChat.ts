import { z } from 'zod';
import { ChatHistory } from './db';
import { getUserByToken, isPlanId } from './session';
import { parseCommands } from './parseCommands';
import { systemMessage, userMessageText } from './aiPrompt';
import { cloudCallsLeft, cloudEnabled, planRequest, type CloudStep } from './cloudAI';
import { aiClient, aiErrorMessage, CHAT_MAX_TOKENS, imageInfo, logAiCall, withModels } from './aiClient';
import { applySetPlan, parseSetPlan, SetPlanSchema, type SetPlanPayload } from '../plan/setPlan';
import { emptyPlan } from '../plan/types';

// How a chat message is handled:
// - "auto": the chat model answers. With the optional planner enabled (cloudAI.ts) it can reply
//   {"action": "askExpert"} for a request too complex for it, and the planner plans it as
//   simple steps instead, which the browser then has the chat model carry out ("step" mode).
// - "cloud": straight to the planner. The browser uses this when the chat model's commands
//   for a request could not be applied.
// - "step": one step of a plan, run on the chat model without touching the chat history.
export type ChatMode = 'auto' | 'cloud' | 'step';

export type ChatResult =
  | { success: true; reply: string; buildCommands?: Record<string, any>[]; setPlan?: SetPlanPayload; steps?: CloudStep[]; cloud?: boolean }
  | { error: string }
  | { aborted: true };

const SET_PLAN_RETRIES = 2;

// The set_plan tool: replaces the whole plan with one given in absolute coordinates.
const SET_PLAN_TOOL = {
  type: 'function' as const,
  function: {
    name: 'set_plan',
    description: 'Replace the WHOLE plan with this one (the uploaded background image is kept). All coordinates in feet: x grows east, y grows south. '
      + 'Each room is a polygon along its wall centre-lines; rooms that touch must share the exact same edge coordinates, and their walls are created automatically. '
      + 'Add "walls" only for extra walls, and for open-plan boundaries with divider: true. Doors and windows: "at" = a point on any wall, or wallId (from "walls") + offsetFt.',
    parameters: z.toJSONSchema(SetPlanSchema, { io: 'input' }) as Record<string, unknown>,
  },
};

// Runs one chat turn. When `signal` aborts (the user pressed Stop), the AI request is
// cancelled and nothing is written to the chat history, so a stopped turn leaves no trace.
// `image` is the user's uploaded floor plan (a data URL), sent along so the model can look at
// it; it is attached to the latest message only and not stored in the history.
// Turns that change the plan are saved to the history by the browser (saveChatTurn) once it
// knows what was actually applied, so the history never claims changes that didn't happen.
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

  // The planner plans the request; the browser carries out the steps.
  const askCloud = async (): Promise<ChatResult> => {
    const res = await planRequest(user._id, prompt, sceneData, previous.slice(-4), signal);
    if (!('data' in res)) return res;
    const { reply, steps } = res.data;
    const text = reply || (steps.length ? `Here's the plan: ${steps.length} steps.` : 'I have nothing to change.');
    await saveTurn(text);
    return { success: true, reply: text, steps };
  };
  if (mode === 'cloud') return askCloud();

  const maxTokens = CHAT_MAX_TOKENS();
  const info = hasImage ? imageInfo(image!) : undefined;
  const userText = (canAskExpert: boolean) => userMessageText(prompt, sceneData, hasImage, canAskExpert);

  // One answer from the chat model: JSON commands in its text, or a set_plan tool call. An
  // invalid set_plan is returned to the model with the exact problems, up to twice.
  const askModel = async (canAskExpert: boolean): Promise<{ commands: Record<string, any>[]; text: string; setPlan?: SetPlanPayload } | { error: string }> => {
    const apiMessages: any[] = [
      { role: 'system', content: systemMessage(sceneData, hasDrawing, canAskExpert) },
      ...previous,
      { role: 'user', content: hasImage ? [{ type: 'image_url', image_url: { url: image } }, { type: 'text', text: userText(canAskExpert) }] : userText(canAskExpert) },
    ];
    for (let attempt = 0; ; attempt++) {
      // Each model in AI_MODELS is tried in turn until one answers (see aiClient.ts).
      const { result: response, model } = await withModels('chat', m => aiClient().chat.completions.create(
        { model: m, messages: apiMessages, temperature: 0.2, max_tokens: maxTokens, tools: [SET_PLAN_TOOL] },
        { signal },
      ), signal);
      logAiCall(`chat#${attempt + 1}`, model, response, info);
      const choice = response.choices[0];
      if (choice?.finish_reason === 'length') {
        return { error: `My answer was cut off at ${maxTokens} tokens, so nothing was changed. Try a smaller request, or raise AI_MAX_TOKENS in .env.` };
      }
      const text = choice?.message.content?.trim() || '';
      const call = choice?.message.tool_calls?.find(c => c.type === 'function' && c.function.name === 'set_plan');
      if (call && call.type === 'function') {
        let problems: string[];
        let raw: unknown = null;
        try {
          raw = JSON.parse(call.function.arguments || '{}');
        } catch {
          raw = undefined;
        }
        const parsed = raw === undefined ? { errors: ['arguments are not valid JSON'] } : parseSetPlan(raw);
        if ('payload' in parsed) {
          // Dry run on an empty plan: rooms that don't close, doors off any wall...
          problems = applySetPlan(emptyPlan(), parsed.payload, { replace: true }).errors;
          if (problems.length === 0) return { commands: [], text, setPlan: parsed.payload };
        } else {
          problems = parsed.errors;
        }
        console.warn(`[ai] set_plan#${attempt + 1} rejected: ${problems.join('; ')}`);
        if (attempt >= SET_PLAN_RETRIES) return { error: `I couldn't produce a valid plan, so nothing was changed. Problems: ${problems.slice(0, 4).join('; ')}` };
        apiMessages.push({ role: 'assistant', content: text || null, tool_calls: [call] });
        apiMessages.push({ role: 'tool', tool_call_id: call.id, content: `set_plan was NOT applied. Fix these problems and call set_plan again with the complete plan:\n${problems.join('\n')}` });
        continue;
      }
      // The model sometimes pastes a prompt example into a chatty explanation ("For example:
      // {...}"); don't run those. A real command comes back as (nearly) bare JSON, so an example
      // is only dropped when it is wrapped in a sentence or more of prose.
      const examples = new Set(parseCommands(systemMessage({})).commands.map(c => JSON.stringify(c)));
      const { commands: found, text: rest } = parseCommands(text);
      const commands = rest.length > 40 ? found.filter(c => !examples.has(JSON.stringify(c))) : found;
      return { commands, text: rest };
    }
  };

  try {
    const canAskExpert = mode === 'auto' && (await cloudReady());
    let answer = await askModel(canAskExpert);
    if (signal?.aborted) return { aborted: true };
    if ('error' in answer) return answer;

    if (answer.commands.some(c => c.action === 'askExpert')) {
      const planned = await askCloud();
      if (!('error' in planned)) return planned;
      // The planner failed or today's limit was reached meanwhile: the chat model does its best.
      console.error('Planning failed, using the chat model:', planned.error);
      answer = await askModel(false);
      if (signal?.aborted) return { aborted: true };
      if ('error' in answer) return answer;
    }
    const { text, setPlan } = answer;
    const commands = answer.commands.filter(c => c.action !== 'askExpert');

    if (setPlan) return { success: true, setPlan, reply: text };
    if (commands.length > 0) {
      return { success: true, buildCommands: commands, reply: text, cloud: mode === 'auto' && (await cloudReady()) };
    }
    if (!text) return { error: "The AI returned an empty answer. Please try rephrasing." };
    await saveTurn(text);
    return { success: true, reply: text };
  } catch (error: any) {
    if (signal?.aborted) return { aborted: true };
    console.error('[ai] chat error:', error?.status, error?.message);
    return { error: aiErrorMessage(error) };
  }
}
