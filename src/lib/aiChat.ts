import { ChatHistory } from './db';
import { getUserByToken, isPlanId } from './session';
import { parseCommands } from './parseCommands';
import { systemMessage, userMessageText } from './aiPrompt';
import { cloudCallsLeft, cloudEnabled, planRequest, type CloudStep } from './cloudAI';
import { aiClient, aiErrorResult, CHAT_MAX_TOKENS, imageInfo, logAiCall, withModels } from './aiClient';
import { parseChatReply } from './modelReply';
import { cleanUserText, gateCommands } from './promptSafety';
import { aiRateLimit } from './rateLimit';
import { gateDeletes, missingPlanRef } from './planRefs';
import { AiCharge, isAdmin, type ClientRef } from './aiQuota';
import { applySetPlan, type SetPlanPayload } from '../plan/setPlan';
import { normalizePlanPayload } from '../plan/importPlan';
import { emptyPlan } from '../plan/types';

// How a chat message is handled:
// - "auto": the chat model answers. With a planner model set (AI_PLANNER_MODEL) it can reply
//   {"action": "askExpert"} for a request too complex for it, and the planner plans it as
//   simple steps instead, which the browser then has the chat model carry out ("step" mode).
// - "cloud": straight to the planner. The browser uses this when the chat model's commands
//   for a request could not be applied.
// - "step": one step of a plan, run on the chat model without touching the chat history.
//
// The model is asked for plain text or JSON only (no tool calling), so any chat model works;
// its reply is read by parseChatReply, and only known, sane commands come out of here.
export type ChatMode = 'auto' | 'cloud' | 'step';

export type ChatResult =
  | { success: true; reply: string; buildCommands?: Record<string, any>[]; setPlan?: SetPlanPayload; steps?: CloudStep[]; cloud?: boolean; turn?: string }
  | { error: string; busy?: true; limit?: true }
  | { aborted: true };

const SET_PLAN_RETRIES = 2;
const MAX_SCENE_CHARS = 300_000; // a described plan is far smaller; anything bigger is refused
const MAX_IMAGE_CHARS = 8_000_000; // the browser sends at most ~2000 px JPEGs
// Requests for a whole new layout (the only time a plan built from a drawing may be replaced).
const REDESIGN = /\b(redesign|re-design|redo|redraw|start (over|again|from scratch)|from scratch|new (plan|design|layout|house)|design (a|an|me|my|the whole)|whole (plan|house|layout))\b/i;

// Runs one chat turn. When `signal` aborts (the user pressed Stop), the AI request is
// cancelled and nothing is written to the chat history, so a stopped turn leaves no trace.
// `image` is the user's uploaded floor plan (a data URL), sent along so the model can look at
// it; it is attached to the latest message only and not stored in the history.
// Turns that change the plan are saved to the history by the browser (saveChatTurn) once it
// knows what was actually applied, so the history never claims changes that didn't happen.
// Each message the user sends ("auto") uses one of their AI prompts (see aiQuota.ts), given
// back if the AI didn't answer. The planner ("cloud") and its steps ("step") are part of that
// message: they show its `turn` and are free.
export async function runChat(rawPrompt: unknown, token: string, planId: string, sceneData: unknown, signal?: AbortSignal, image?: string, mode: ChatMode = 'auto', client: ClientRef = { fingerprint: '' }, turn?: unknown): Promise<ChatResult> {
  const charge = new AiCharge(client);
  const result = await chatTurn(rawPrompt, token, planId, sceneData, signal, image, mode, charge, turn);
  if (!('success' in result)) await charge.refund();
  else if (charge.turn) return { ...result, turn: charge.turn };
  return result;
}

async function chatTurn(rawPrompt: unknown, token: string, planId: string, sceneData: unknown, signal: AbortSignal | undefined, image: string | undefined, mode: ChatMode, charge: AiCharge, turn: unknown): Promise<ChatResult> {
  if (!isPlanId(planId)) return { error: 'The AI assistant is only available on your own plans.' };
  const prompt = cleanUserText(rawPrompt);
  if (!prompt) return { error: 'Empty message.' };

  // Only signed-in users may use the AI, and only so often.
  const user = await getUserByToken(token);
  if (!user) return { error: 'Your session has expired. Please log in again.' };
  // "Replace the balcony" with no balcony on the plan: said so, without asking the model.
  const missing = mode === 'step' ? null : missingPlanRef(prompt, sceneData);
  if (missing) return { success: true, reply: missing };
  const limited = aiRateLimit(user._id, isAdmin(user));
  if (!limited.ok) return { error: limited.error };
  const paid = mode === 'auto' ? await charge.take(user) : charge.join(user, turn);
  if (!paid.ok) return { error: paid.error, limit: true };

  if (JSON.stringify(sceneData ?? {}).length > MAX_SCENE_CHARS) return { error: 'This plan is too large to send to the AI.' };
  const hasImage = typeof image === 'string' && image.length <= MAX_IMAGE_CHARS && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(image);
  const hasDrawing = hasImage || !!(sceneData as any)?.referenceDrawing;

  let historyDoc: any = null;
  if (mode !== 'step') {
    try {
      historyDoc = (await ChatHistory.findOne({ userId: user._id, planId })) ?? new ChatHistory({ userId: user._id, planId, messages: [] });
    } catch {
      // chat still works without history
    }
  }
  const previous = (historyDoc?.messages ?? []).slice(-9)
    .filter((m: any) => m.role === 'user' || m.role === 'assistant')
    .map((m: any) => ({ role: m.role, content: String(m.content ?? '').slice(0, 4000) }));
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
  const mayReplace = !(sceneData as any)?.builtFromDrawing || REDESIGN.test(prompt);
  const info = hasImage ? imageInfo(image!) : undefined;
  const userText = (canAskExpert: boolean) => userMessageText(prompt, sceneData, hasImage, canAskExpert);
  // Commands from the prompt's own examples, pasted into a chatty answer, are not run.
  const examples = new Set(parseCommands(systemMessage({})).commands.map(c => JSON.stringify(c)));

  // One answer from the chat model: JSON commands in its text, or a whole new plan
  // ({"action": "setPlan"}). An invalid plan is returned to the model with the exact problems.
  const askModel = async (canAskExpert: boolean): Promise<{ commands: Record<string, any>[]; text: string; setPlan?: SetPlanPayload; notes: string[] } | { error: string }> => {
    const apiMessages: any[] = [
      { role: 'system', content: systemMessage(sceneData, hasDrawing, canAskExpert) },
      ...previous,
      { role: 'user', content: hasImage ? [{ type: 'image_url', image_url: { url: image } }, { type: 'text', text: userText(canAskExpert) }] : userText(canAskExpert) },
    ];
    for (let attempt = 0; ; attempt++) {
      // Each configured model is tried in turn until one answers (see aiClient.ts).
      const { result: response, model } = await withModels('chat', m => aiClient().chat.completions.create(
        { model: m, messages: apiMessages, temperature: 0.2, max_tokens: maxTokens },
        { signal },
      ), signal, hasImage ? 'vision' : 'chat');
      logAiCall(`chat#${attempt + 1}`, model, response, info);
      const choice = response.choices[0];
      if (choice?.finish_reason === 'length') {
        return { error: `My answer was cut off at ${maxTokens} tokens, so nothing was changed. Try a smaller request, or raise AI_MAX_TOKENS in .env.` };
      }
      const content = choice?.message.content ?? '';
      const reply = parseChatReply(content);
      const notes = reply.dropped.length ? [`I ignored ${reply.dropped.length} change(s) the app doesn't support.`] : [];

      if (reply.setPlan) {
        if (!mayReplace) {
          return { commands: [], text: reply.text, notes: [...notes, 'This plan was built from your drawing, so I keep it and only edit it. Ask me to "redesign the whole plan" if you want a new one.'] };
        }
        // Read as tolerantly as a pasted plan, then a dry run: rooms that don't close, doors off any wall...
        const parsed = normalizePlanPayload(reply.setPlan);
        const problems = 'payload' in parsed ? applySetPlan(emptyPlan(), parsed.payload, { replace: true }).errors : parsed.errors;
        if ('payload' in parsed && problems.length === 0) return { commands: [], text: reply.text, setPlan: parsed.payload, notes };
        console.warn(`[ai] setPlan#${attempt + 1} rejected: ${problems.join('; ')}`);
        if (attempt >= SET_PLAN_RETRIES) return { error: `I couldn't produce a valid plan, so nothing was changed. Problems: ${problems.slice(0, 4).join('; ')}` };
        apiMessages.push({ role: 'assistant', content });
        apiMessages.push({ role: 'user', content: `That plan was NOT applied. Fix these problems and reply again with the complete {"action": "setPlan", "plan": {...}} JSON only:\n${problems.join('\n')}` });
        continue;
      }
      // An example from the instructions pasted into a chatty explanation ("For example: {...}")
      // is not run; a real command comes back as (nearly) bare JSON.
      const commands = reply.text.length > 40 ? reply.commands.filter(c => !examples.has(JSON.stringify(c))) : reply.commands;
      return { commands, text: reply.text, notes };
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
    // Destructive commands only run when the user's own words asked for them, and a delete
    // only removes what the user named (not the car in the parking, nor the room next to it).
    const gated = gateCommands(answer.commands.filter(c => c.action !== 'askExpert'), prompt);
    const deletes = gateDeletes(gated.allowed, prompt, sceneData);
    const allowed = deletes.allowed, blocked = [...gated.blocked, ...deletes.blocked];
    // What the model asked for (actions and targets only), to see why a change happened.
    if (answer.commands.length) console.info(`[ai] chat commands: ${answer.commands.map(c => [c.action, c.type, c.id ?? c.name].filter(Boolean).join(' ')).join('; ').slice(0, 500)}${blocked.length ? ` (${blocked.length} blocked)` : ''}`);
    const text = [answer.text, ...answer.notes, ...blocked].filter(Boolean).join('\n');

    if (answer.setPlan) return { success: true, setPlan: answer.setPlan, reply: text };
    if (allowed.length > 0) {
      return { success: true, buildCommands: allowed, reply: text, cloud: mode === 'auto' && (await cloudReady()) };
    }
    if (!text) return { error: 'The AI returned an empty answer. Please try rephrasing.' };
    await saveTurn(text);
    return { success: true, reply: text };
  } catch (error: any) {
    if (signal?.aborted) return { aborted: true };
    console.error('[ai] chat error:', error?.status, error?.message);
    return aiErrorResult(error);
  }
}
