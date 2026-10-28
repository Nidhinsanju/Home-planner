import { z } from 'zod';
import { getUserByToken, isPlanId } from './session';
import { vastuFixSystem, vastuFixUser } from './aiPrompt';
import { aiClient, aiErrorResult, CHAT_MAX_TOKENS, isOptionRejected, logAiCall, markNoJsonSchema, supportsJsonSchema, TryNextModel, withModels } from './aiClient';
import { firstJson } from './modelReply';
import { aiRateLimit } from './rateLimit';
import { applyCommands, describePlan, type BuildCommand } from '../plan/commands';
import { importPlanJson } from '../plan/importPlan';
import { emptyPlan, normalizeRoomType, roomType, type Plan } from '../plan/types';
import { detectRooms } from '../plan/rooms';
import { analyzeVastu, vastuReport, vastuSummary } from '../plan/vastu';

// "Fix with AI" on the Vastu tab. The model proposes changes to the plan as commands, with a
// reason for each. They are applied to a copy and the copy is scored with the app's own Vastu
// rules; the model is told the result and tries again (twice at most) until the score really
// goes up without losing rooms. Only a verified improvement is returned; the browser applies
// the same commands (the same code) to the live plan.

export type VastuFixResult =
  | { success: true; summary: string; changes: { command: BuildCommand; why: string }[]; before: number; after: number; model: string; warnings: string[] }
  | { error: string; busy?: true }
  | { aborted: true };

// The only actions a fix may use: no deleting, no redrawing, no moving north.
const ALLOWED = new Set(['swapRooms', 'update', 'rename', 'move', 'resize', 'build', 'openWall', 'closeWall']);
const BUILD_TYPES = new Set(['door', 'window']);
const MAX_ROUNDS = 3;

const AnswerSchema = z.object({
  summary: z.string().default(''),
  changes: z.array(z.object({ command: z.union([z.string(), z.record(z.string(), z.unknown())]), why: z.string().default('') })).max(12).default([]),
});
const ANSWER_JSON_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    changes: { type: 'array', items: { type: 'object', properties: { command: { type: 'string' }, why: { type: 'string' } }, required: ['command', 'why'], additionalProperties: false } },
  },
  required: ['summary', 'changes'],
  additionalProperties: false,
};


// The model's changes as commands, keeping only the allowed ones (and saying which weren't).
function toCommands(changes: z.infer<typeof AnswerSchema>['changes']) {
  const ok: { command: BuildCommand; why: string }[] = [];
  const rejected: string[] = [];
  for (const c of changes) {
    const cmd = (typeof c.command === 'string' ? firstJson(c.command) : c.command) as Record<string, any> | null;
    const action = String(cmd?.action ?? '');
    const allowed = cmd && ALLOWED.has(action) && (action !== 'build' || BUILD_TYPES.has(String(cmd.type ?? '').toLowerCase()));
    if (allowed) ok.push({ command: cmd as BuildCommand, why: c.why });
    else rejected.push(`${action || 'unreadable command'} is not allowed in a Vastu fix`);
  }
  return { ok, rejected };
}

export async function runVastuFix(token: string, planId: string, rawPlan: unknown, signal?: AbortSignal): Promise<VastuFixResult> {
  if (!isPlanId(planId)) return { error: 'The AI assistant is only available on your own plans.' };
  const user = await getUserByToken(token);
  if (!user) return { error: 'Your session has expired. Please log in again.' };
  const limited = aiRateLimit(user._id);
  if (!limited.ok) return { error: limited.error };
  if (JSON.stringify(rawPlan ?? null).length > 500_000) return { error: 'This plan is too large to send to the AI.' };

  // The plan as the browser has it (its own saved format), cleaned the same way as an import.
  const loaded = importPlanJson(emptyPlan(), rawPlan);
  if ('error' in loaded) return { error: 'The plan could not be read.' };
  const base: Plan = { ...loaded.plan, ...(Number.isFinite(Number((rawPlan as any)?.northDeg)) ? { northDeg: Number((rawPlan as any).northDeg) } : {}) };
  const before = analyzeVastu(base);
  if (!before) return { error: 'There are no rooms to check yet.' };
  // Rooms by identity (their label), and the mix of room kinds: renaming is fine, losing a room
  // or changing what the house has (no dining room any more) is not.
  const roomsOf = (p: Plan) => detectRooms(p).filter(r => r.label).map(r => ({ id: r.label!.id, name: r.label!.name, type: normalizeRoomType(r.label!.type) || normalizeRoomType(r.label!.name) }));
  const startRooms = roomsOf(base);
  const mixOf = (rooms: ReturnType<typeof roomsOf>) => {
    const m = new Map<string, number>();
    for (const r of rooms) if (r.type) m.set(r.type, (m.get(r.type) ?? 0) + 1);
    return m;
  };
  const startMix = mixOf(startRooms);
  const mixChange = (rooms: ReturnType<typeof roomsOf>) => {
    const m = mixOf(rooms);
    const kinds = new Set([...startMix.keys(), ...m.keys()]);
    const diffs = [...kinds].filter(k => (startMix.get(k) ?? 0) !== (m.get(k) ?? 0))
      .map(k => `${roomType(k)?.name ?? k}: ${startMix.get(k) ?? 0} before, ${m.get(k) ?? 0} after`);
    return diffs.join('; ');
  };
  // Kitchens and toilets that end up in a different space: new plumbing.
  const plumbing = (rooms: ReturnType<typeof roomsOf>) => {
    const wet = new Set(['kitchen', 'toilet']);
    const moved = rooms.filter(r => {
      const was = startRooms.find(s => s.id === r.id);
      return was && was.type !== r.type && (wet.has(r.type) || wet.has(was.type));
    });
    return moved.length ? [`Note: this moves a kitchen or toilet into a different space (${moved.map(r => r.name).join(', ')}), which needs new plumbing${moved.some(r => r.type === 'kitchen') ? ' and gas lines' : ''}.`] : [];
  };

  // What the model sees: the plan description, with the full report and its suggested swaps.
  const scene = { ...describePlan(base), vastu: vastuSummary(vastuReport(base)!) };

  try {
    const { result } = await withModels('vastu-fix', async model => {
      const messages: any[] = [
        { role: 'system', content: vastuFixSystem },
        { role: 'user', content: vastuFixUser(scene) },
      ];
      let best: Extract<VastuFixResult, { success: true }> | null = null;
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const ask = (schema: boolean) => aiClient().chat.completions.create({
          model, messages, temperature: 0.2, max_tokens: CHAT_MAX_TOKENS(),
          ...(schema ? { response_format: { type: 'json_schema' as const, json_schema: { name: 'vastu_fix', strict: true, schema: ANSWER_JSON_SCHEMA } } } : {}),
        }, { signal });
        let response;
        try {
          response = await ask(supportsJsonSchema(model));
        } catch (error: any) {
          if (!isOptionRejected(error) || !supportsJsonSchema(model) || signal?.aborted) throw error;
          markNoJsonSchema(model);
          response = await ask(false);
        }
        logAiCall(`vastu-fix#${round + 1}`, model, response);
        const text = response.choices[0]?.message.content ?? '';
        const parsed = AnswerSchema.safeParse(firstJson(text));
        if (!parsed.success) {
          messages.push({ role: 'assistant', content: text || '(empty)' }, { role: 'user', content: 'That was not the JSON asked for. Reply with {"summary": "...", "changes": [{"command": "...", "why": "..."}]} only.' });
          continue;
        }
        const { ok, rejected } = toCommands(parsed.data.changes);
        if (ok.length === 0) {
          // Nothing proposed: the model's explanation is the answer (no score change).
          if (!best) best = { success: true, summary: parsed.data.summary || 'I could not find a practical change that improves the Vastu score.', changes: [], before: before.score, after: before.score, model, warnings: [] };
          break;
        }
        const applied = applyCommands(base, ok.map(c => c.command));
        const after = analyzeVastu(applied.plan);
        const now = roomsOf(applied.plan);
        const lost = startRooms.filter(r => !now.some(n => n.id === r.id)).map(r => r.name);
        const mix = mixChange(now);
        const score = after?.score ?? 0;
        if (lost.length === 0 && !mix && score > before.score && (!best || score > best.after)) {
          best = { success: true, summary: parsed.data.summary, changes: ok, before: before.score, after: score, model, warnings: plumbing(now) };
        }
        // Good enough: improved, nothing failed. Otherwise show the model what happened.
        if (best && best.after === score && applied.errors.length === 0 && rejected.length === 0) break;
        messages.push(
          { role: 'assistant', content: text },
          { role: 'user', content: vastuFixUser(scene, { score: before.score, after: score, errors: [...applied.errors, ...rejected], lost, mix }) },
        );
      }
      if (!best) throw new TryNextModel('The AI could not find changes that improve the Vastu score. Try the suggested fixes on the Vastu tab, or ask in the chat.');
      return best;
    }, signal);
    return result;
  } catch (error: any) {
    if (signal?.aborted) return { aborted: true };
    console.error('[ai] vastu-fix error:', error?.status, error?.message);
    return aiErrorResult(error);
  }
}
