// Pulls build commands out of a free-form LLM reply. Accepts a single command object,
// an array of commands, or {"commands": [...]}, possibly several blocks, inside code fences
// or surrounded by prose. Returns the commands and the remaining conversational text.

type Command = Record<string, any>;

function findClosing(text: string, start: number) {
  let depth = 0;
  let inString = false;
  let escaped = false;
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

function toCommands(value: unknown): Command[] {
  if (Array.isArray(value)) return value.flatMap(toCommands);
  if (value && typeof value === 'object') {
    const obj = value as Command;
    if (Array.isArray(obj.commands)) return obj.commands.flatMap(toCommands);
    if (typeof obj.action === 'string') return [obj];
  }
  return [];
}

export function parseCommands(reply: string): { commands: Command[]; text: string } {
  const commands: Command[] = [];
  let text = '';
  let i = 0;
  while (i < reply.length) {
    const c = reply[i];
    if (c === '{' || c === '[') {
      const end = findClosing(reply, i);
      if (end !== -1) {
        let found: Command[] = [];
        try {
          found = toCommands(JSON.parse(reply.slice(i, end + 1)));
        } catch {
          // not JSON, keep as text
        }
        if (found.length > 0) {
          commands.push(...found);
          i = end + 1;
          continue;
        }
      }
    }
    text += c;
    i++;
  }
  const cleaned = text
    .replace(/```(?:json)?/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { commands, text: cleaned };
}
