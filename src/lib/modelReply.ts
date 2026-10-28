import { parseCommands } from './parseCommands';

// Reading what any AI model answers. Models differ: some think out loud first (<think>...),
// some wrap JSON in code fences, some add a sentence before or after it, some return one object,
// an array, or {"commands": [...]}. Every reply is read here, so the rest of the app always
// gets the same shapes, whatever model is configured.

// Reasoning blocks some models write before the answer (DeepSeek, Qwen and others).
const THINKING = /<(think|thinking|reasoning|reflection)>[\s\S]*?<\/\1>/gi;

export function cleanModelText(text: unknown): string {
  let s = typeof text === 'string' ? text : '';
  s = s.replace(THINKING, '');
  // An unclosed thinking block at the start (cut off, or the model forgot to close it): keep
  // only what follows its last line of JSON-looking or plain answer text.
  s = s.replace(/^\s*<(think|thinking|reasoning)>[\s\S]*$/i, m => (m.includes('{') ? m.slice(m.indexOf('{')) : ''));
  return s.replace(/```[a-z]*\s*/gi, '').replace(/```/g, '').trim();
}

// The first JSON object (or array) in a reply that parses, or null.
export function firstJson(text: unknown): unknown {
  const s = cleanModelText(text);
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '{' && s[i] !== '[') continue;
    const end = closing(s, i);
    if (end === -1) continue;
    try {
      return JSON.parse(s.slice(i, end + 1));
    } catch {
      // not this one; keep looking
    }
  }
  return null;
}

function closing(text: string, start: number) {
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// The actions the chat may carry out. Anything else a model invents is dropped.
export const CHAT_ACTIONS = new Set([
  'build', 'add', 'create', 'delete', 'remove', 'deleteAll', 'move', 'update', 'rename', 'resize',
  'openWall', 'closeWall', 'swapRooms', 'setNorth', 'buildFromDrawing', 'askExpert', 'setPlan',
]);

export type Command = Record<string, unknown> & { action: string };

// A command with only sane values: strings cut short, numbers finite, no nested objects except
// the lists some actions take ("between", "rooms") and a "plan" for setPlan.
function sanitizeCommand(raw: Record<string, unknown>): Command | null {
  const action = typeof raw.action === 'string' ? raw.action : '';
  if (!CHAT_ACTIONS.has(action)) return null;
  const out: Record<string, unknown> = { action };
  for (const [k, v] of Object.entries(raw)) {
    if (k === 'action' || k.length > 40) continue;
    if (typeof v === 'string') out[k] = v.slice(0, 200);
    else if (typeof v === 'number') { if (Number.isFinite(v)) out[k] = v; }
    else if (typeof v === 'boolean') out[k] = v;
    else if (Array.isArray(v) && (k === 'between' || k === 'rooms')) out[k] = v.slice(0, 40).map(x => String(x).slice(0, 60));
    else if (k === 'plan' && action === 'setPlan' && v && typeof v === 'object') out[k] = v;
  }
  return out as Command;
}

// A chat reply: the commands to carry out (known actions only), a whole new plan if the model
// sent one ({"action": "setPlan", "plan": {...}}), the text for the user, and what was dropped.
export function parseChatReply(reply: unknown): { commands: Command[]; setPlan?: unknown; text: string; dropped: string[] } {
  const cleaned = cleanModelText(reply);
  const { commands: found, text } = parseCommands(cleaned);
  const commands: Command[] = [];
  const dropped: string[] = [];
  let setPlan: unknown;
  for (const raw of found) {
    const c = sanitizeCommand(raw);
    if (!c) {
      dropped.push(String(raw.action ?? 'unknown'));
      continue;
    }
    if (c.action === 'setPlan') setPlan = c.plan ?? raw;
    else commands.push(c);
  }
  // A bare plan object (rooms, walls...) instead of a setPlan action.
  if (!setPlan && commands.length === 0) {
    const json = firstJson(cleaned) as any;
    if (json && typeof json === 'object' && !Array.isArray(json) && Array.isArray(json.rooms) && !json.action) setPlan = json;
  }
  return { commands, ...(setPlan ? { setPlan } : {}), text: setPlan && commands.length === 0 ? text.replace(/^\s*$/, '') : text, dropped };
}
