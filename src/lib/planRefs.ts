import { ITEM_CATALOG, normalizeRoomType, roomType } from '../plan/types';

// A request to change "the balcony" (or the kitchen, the bed...) when the plan has none is
// answered here, before any model is asked: a model told to change the plan tends to carry out
// whatever part it can ("make it parking") instead of saying the room isn't there.
const EDIT = /\b(remove|delete|replace|convert|change|turn|make|demolish|get rid of|take out|move|shift|resize|enlarge|extend|shrink|rename|swap|open|close)\b/i;
const REF = /\b(?:the|my|that|this|existing)\s+([a-z][a-z-]*)/gi;

const itemType = (word: string) => ITEM_CATALOG.find(i => i.id === word || i.name.toLowerCase() === word)?.id ?? '';

// Plain words for the user's reply, or null when everything the request refers to is there
// (or it refers to nothing this check knows about).
export function missingPlanRef(prompt: string, sceneData: unknown): string | null {
  if (!EDIT.test(prompt)) return null;
  const scene = (sceneData ?? {}) as { rooms?: { name?: string; type?: string }[]; items?: { type?: string }[] };
  const rooms = Array.isArray(scene.rooms) ? scene.rooms : [];
  const items = Array.isArray(scene.items) ? scene.items : [];
  const roomTypes = new Set(rooms.flatMap(r => [normalizeRoomType(r.type), ...String(r.name ?? '').toLowerCase().split(/[^a-z-]+/).map(normalizeRoomType)]));
  const itemTypes = new Set(items.map(i => String(i.type ?? '')));

  for (const [, raw] of prompt.toLowerCase().matchAll(REF)) {
    const word = [raw, raw.replace(/s$/, '')].find(w => normalizeRoomType(w) || itemType(w));
    if (!word) continue;
    const room = normalizeRoomType(word), item = itemType(word);
    if ((room && roomTypes.has(room)) || (item && itemTypes.has(item))) continue;
    const label = room ? (roomType(room)?.name ?? word).toLowerCase() : word;
    return rooms.length || items.length
      ? `There's no ${label} in this plan, so I didn't change anything.`
      : `The plan is empty, so there's no ${label} to change. Add rooms first, or upload a floor plan.`;
  }
  return null;
}

// Deletes the model added on its own: "remove the parking" must not also delete the car parked
// in it or the room next to it. A delete runs only when the user's request names what it
// deletes (its name, its room type or its kind of furniture), or asks for all/everything.
const EVERYTHING = /\b(all|everything|every|whole|entire)\b/i;
const ROOM_WORDS: Record<string, string[]> = {
  bed: ['bedroom', 'bed room'], toilet: ['bathroom', 'bath', 'washroom', 'restroom'], living: ['hall', 'lounge'],
  parking: ['garage', 'car porch', 'porch'], staircase: ['stairs', 'stair'], pooja: ['puja', 'prayer'],
  store: ['storage', 'closet'], study: ['office'], utility: ['laundry'], hallway: ['corridor', 'passage'],
};

type SceneRefs = { rooms?: { id?: string; name?: string; type?: string }[]; items?: { id?: string; type?: string }[]; walls?: { id?: string }[]; openings?: { id?: string; kind?: string }[] };

// The words that name what a delete would remove, or null if it isn't on the plan.
function targetWords(cmd: Record<string, any>, scene: SceneRefs): { label: string; words: string[] } | null {
  const ref = String(cmd.id ?? cmd.name ?? '').toLowerCase().trim();
  const rooms = scene.rooms ?? [];
  const room = rooms.find(r => String(r.id).toLowerCase() === ref)
    ?? rooms.find(r => String(r.name ?? '').toLowerCase() === ref)
    ?? rooms.find(r => r.type && (r.type === ref || normalizeRoomType(ref) === r.type));
  if (room) {
    const type = normalizeRoomType(room.type) || normalizeRoomType(room.name);
    const name = String(room.name ?? '').toLowerCase();
    return {
      label: room.name || roomType(type)?.name || 'a room',
      words: [name, ...name.split(/\s+/).filter(w => w.length > 2 && w !== 'room'), type, (roomType(type)?.name ?? '').toLowerCase(), ...(ROOM_WORDS[type] ?? [])].filter(Boolean),
    };
  }
  const item = (scene.items ?? []).find(i => String(i.id).toLowerCase() === ref);
  if (item) {
    const spec = ITEM_CATALOG.find(c => c.id === item.type);
    return { label: spec?.name ?? String(item.type), words: [String(item.type), ...(spec ? [spec.name.toLowerCase(), ...spec.name.toLowerCase().split(/\s+/)] : []), 'furniture'] };
  }
  const opening = (scene.openings ?? []).find(o => String(o.id).toLowerCase() === ref);
  if (opening) return { label: `a ${opening.kind}`, words: [String(opening.kind)] };
  if ((scene.walls ?? []).some(w => String(w.id).toLowerCase() === ref)) return { label: 'a wall', words: ['wall'] };
  return null;
}

export function gateDeletes<T extends Record<string, any>>(commands: T[], prompt: string, sceneData: unknown): { allowed: T[]; blocked: string[] } {
  const text = prompt.toLowerCase();
  if (EVERYTHING.test(text)) return { allowed: commands, blocked: [] };
  const scene = (sceneData ?? {}) as SceneRefs;
  const escape = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const named = (w: string) => new RegExp(`\\b${escape(w)}s?\\b`).test(text);
  const allowed: T[] = [], blocked: string[] = [];
  for (const c of commands) {
    const action = String(c?.action ?? '');
    if (action !== 'delete' && action !== 'remove') { allowed.push(c); continue; }
    const target = targetWords(c, scene);
    // Not on the plan: left to the all-or-nothing check in the browser, which reports it.
    if (!target || target.words.some(named)) allowed.push(c);
    else blocked.push(`I didn't delete ${target.label}: your message didn't ask for it.`);
  }
  return { allowed, blocked };
}
