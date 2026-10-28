import type { Plan } from './types';
import { detectRooms } from './rooms';

// What an edit actually did to the plan, in words, for the AI assistant's replies. Compares the
// plan before and after, so a reply never claims a change that didn't happen.

function counts(plan: Plan) {
  return {
    room: detectRooms(plan).length,
    wall: plan.walls.filter(w => !w.divider).length,
    divider: plan.walls.filter(w => w.divider).length,
    door: plan.openings.filter(o => o.kind === 'door').length,
    window: plan.openings.filter(o => o.kind === 'window').length,
    'piece of furniture': plan.items.length,
  };
}

const plural = (n: number, word: string) => (n === 1 ? `1 ${word}` : `${n} ${word === 'piece of furniture' ? 'pieces of furniture' : `${word}s`}`);
const list = (parts: string[]) => (parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`);
const geometry = (p: Plan) => JSON.stringify([p.corners, p.walls, p.openings, p.labels, p.items]);

export function describeChange(before: Plan, after: Plan): { changed: boolean; text: string } {
  if (before === after || geometry(before) === geometry(after)) return { changed: false, text: 'Nothing on the plan changed.' };
  const a = counts(before), b = counts(after);
  const added: string[] = [], removed: string[] = [];
  for (const k of Object.keys(a) as (keyof typeof a)[]) {
    const d = b[k] - a[k];
    if (d > 0) added.push(plural(d, k));
    if (d < 0) removed.push(plural(-d, k));
  }
  const parts = [added.length ? `added ${list(added)}` : '', removed.length ? `removed ${list(removed)}` : ''].filter(Boolean);
  const text = parts.length ? parts.join('; ') : 'moved, resized or renamed things (nothing added or removed)';
  return { changed: true, text: text[0].toUpperCase() + text.slice(1) + '.' };
}
