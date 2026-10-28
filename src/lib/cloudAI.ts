import { z } from 'zod';
import { CloudUsage, connectToDatabase } from './db';
import { cloudPlannerSystem, cloudPlannerUser } from './aiPrompt';
import { aiClient, AiConfigError, aiConfig, aiErrorResult, isOptionRejected, logAiCall, markNoJsonSchema, supportsJsonSchema, withModels } from './aiClient';
import { firstJson, CHAT_ACTIONS } from './modelReply';

// The optional planner: a stronger model (AI_PLANNER_MODEL in .env, same provider and key as
// the chat) that plans big requests ("design a 3BHK") as simple steps for the chat model to
// carry out. Off unless AI_PLANNER_MODEL is set; limited per user per day
// (AI_PLANNER_DAILY_LIMIT, default 20).

export const cloudEnabled = () => {
  try {
    return !!aiConfig().plannerModel;
  } catch (e) {
    if (e instanceof AiConfigError) return false;
    throw e;
  }
};
const DAILY_LIMIT = () => (Number(process.env.AI_PLANNER_DAILY_LIMIT) > 0 ? Number(process.env.AI_PLANNER_DAILY_LIMIT) : 20);
const today = () => new Date().toISOString().slice(0, 10);

export async function cloudCallsLeft(userId: unknown) {
  await connectToDatabase();
  const usage = await CloudUsage.findOne({ userId, day: today() }).lean() as any;
  return Math.max(0, DAILY_LIMIT() - (usage?.calls ?? 0));
}

async function recordUsage(userId: unknown, usage: { prompt_tokens?: number; completion_tokens?: number } | null | undefined) {
  await CloudUsage.updateOne(
    { userId, day: today() },
    { $inc: { calls: 1, inputTokens: usage?.prompt_tokens ?? 0, outputTokens: usage?.completion_tokens ?? 0 } },
    { upsert: true },
  );
}

export type CloudResult<T> = { data: T } | { error: string; busy?: true } | { aborted: true };
export type CloudStep = { instruction: string; command: Record<string, any> | null };
export type CloudPlan = { reply: string; steps: CloudStep[] };

const PlanAnswer = z.object({
  reply: z.string().default(''),
  steps: z.array(z.object({ instruction: z.string(), command: z.union([z.string(), z.record(z.string(), z.unknown())]).optional() })).default([]),
});
const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    steps: { type: 'array', items: { type: 'object', properties: { instruction: { type: 'string' }, command: { type: 'string' } }, required: ['instruction', 'command'], additionalProperties: false } },
  },
  required: ['reply', 'steps'],
  additionalProperties: false,
};

// Plans a complex request as simple steps for the chat model to carry out.
export async function planRequest(userId: unknown, prompt: string, sceneData: unknown, recent: { role: string; content: string }[], signal?: AbortSignal): Promise<CloudResult<CloudPlan>> {
  if (!cloudEnabled()) return { error: 'The planner is not set up (AI_PLANNER_MODEL in .env).' };
  if ((await cloudCallsLeft(userId)) <= 0) return { error: `You've used today's ${DAILY_LIMIT()} planner requests. The chat AI is still available.` };
  const messages = [
    { role: 'system' as const, content: cloudPlannerSystem },
    { role: 'user' as const, content: cloudPlannerUser(prompt, sceneData, recent) },
  ];
  try {
    const { result } = await withModels('planner', async model => {
      const ask = (schema: boolean) => aiClient().chat.completions.create({
        model, messages, temperature: 0.2, max_tokens: 16000,
        ...(schema ? { response_format: { type: 'json_schema' as const, json_schema: { name: 'plan', strict: true, schema: PLAN_SCHEMA } } } : {}),
      }, { signal });
      let response;
      try {
        response = await ask(supportsJsonSchema(model));
      } catch (error) {
        if (!supportsJsonSchema(model) || !isOptionRejected(error) || signal?.aborted) throw error;
        markNoJsonSchema(model);
        response = await ask(false);
      }
      logAiCall('planner', model, response);
      await recordUsage(userId, response.usage);
      return response;
    }, signal, 'planner');
    const choice = result.choices[0];
    if (choice?.finish_reason === 'length') return { error: 'The planner ran out of room for its answer. Try a smaller request.' };
    const parsed = PlanAnswer.safeParse(firstJson(choice?.message.content));
    if (!parsed.success) return { error: 'The planner gave an answer the app could not read. Try again.' };
    const toCommand = (c: unknown) => {
      const v = typeof c === 'string' ? firstJson(c) : c;
      return v && typeof v === 'object' && !Array.isArray(v) && CHAT_ACTIONS.has(String((v as any).action)) && (v as any).action !== 'askExpert' ? (v as Record<string, any>) : null;
    };
    return {
      data: {
        reply: parsed.data.reply.trim().slice(0, 2000),
        steps: parsed.data.steps.slice(0, 20)
          .map(s => ({ instruction: s.instruction.trim().slice(0, 500), command: toCommand(s.command) }))
          .filter(s => s.instruction),
      },
    };
  } catch (error: any) {
    if (signal?.aborted) return { aborted: true };
    console.error('[ai] planner error:', error?.status, error?.message);
    return aiErrorResult(error);
  }
}
