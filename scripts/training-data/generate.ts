// Generates a fine-tuning dataset for the app's AI (qwen2.5vl:3b), in chat "messages" JSONL.
//
//   npm run training-data            -> training-data/ (jsonl, images, README, train_kaggle.py) + training-data.zip
//   npm run training-data -- 4000 800 600 7   (text samples, drawing chats, image readings, seed)
//
// Every example uses the app's real prompts (src/lib/aiPrompt.ts) and real plan engine, and
// every command answer is applied with the app's own applyCommands before it is kept, so the
// data can't teach commands the app would reject.

import fs from 'node:fs';
import path from 'node:path';
import { applyCommands, BuildCommand, describePlan } from '../../src/plan/commands';
import * as ops from '../../src/plan/ops';
import { emptyPlan, itemSize, Plan, WALL_DEFAULTS } from '../../src/plan/types';
import { planImagePrompt, systemMessage, userMessageText } from '../../src/lib/aiPrompt';
import { drawHouse, HouseRoom, int, mulberry32, pick, randomHouse, roomD, roomW, sizeLabel } from './house';
import { ROOM_ZONES, TYPE_LABEL, VASTU_QA, Zone } from './vastu';
import { zipFolder } from './zip';

const [nText = 2400, nDrawingChat = 500, nVision = 500, seed = 42] = process.argv.slice(2).map(Number);
const OUT = path.resolve('training-data');
const rng = mulberry32(seed);

type Content = string | ({ type: 'image'; image: string } | { type: 'text'; text: string })[];
type Message = { role: 'system' | 'user' | 'assistant'; content: Content };
const samples: { kind: string; messages: Message[] }[] = [];
const rejected: Record<string, number> = {};

// ---- helpers ----------------------------------------------------------------------------

const json = (cmds: BuildCommand[]) => JSON.stringify(cmds.length === 1 ? cmds[0] : { commands: cmds });
const sqft = (n: number) => `${Math.round(n)} sq ft`;
const cap = (s: string) => s.replace(/\b\w/g, ch => ch.toUpperCase()); // title case, like room names in the app
const maybe = (p: number) => rng() < p;
const sizePhrase = (w: number, d: number) => pick(rng, [`${w}x${d}`, `${w} by ${d}`, `${w} x ${d} feet`, `${w}ft x ${d}ft`, `${w} by ${d} ft`]);
const DEFAULT_SIZE: Record<string, [number, number]> = {
  living: [16, 14], bed: [12, 12], kitchen: [10, 12], dining: [10, 12], toilet: [6, 8], pooja: [6, 6], study: [10, 10],
  utility: [6, 8], store: [6, 6], balcony: [10, 4], parking: [10, 18], staircase: [8, 12], hallway: [4, 12],
};
const FURNITURE_FOR: Record<string, string[]> = {
  living: ['sofa', 'tv', 'table', 'plant'], bed: ['bed', 'wardrobe'], kitchen: ['counter'], dining: ['dining'],
  toilet: ['toilet'], parking: ['car'], study: ['table'], balcony: ['plant', 'bench'],
};
const ITEM_WORD: Record<string, string> = { tv: 'TV unit', counter: 'kitchen counter', dining: 'dining set', table: 'table' };
const itemWord = (t: string) => ITEM_WORD[t] ?? t;

// Builds a plan from house rooms with the app's own operations, optionally furnished.
function buildPlan(rooms: HouseRoom[], furnish: number): Plan {
  let plan = emptyPlan();
  for (const r of rooms) {
    plan = ops.addRectRoom(plan, { x: (r.minX + r.maxX) / 2, y: (r.minY + r.maxY) / 2, width: roomW(r), depth: roomD(r) }, WALL_DEFAULTS, { name: r.name, type: r.type });
    for (const t of FURNITURE_FOR[r.type] ?? []) if (rng() < furnish) plan = ops.addItem(plan, t, { x: (r.minX + r.maxX) / 2 + int(rng, -1, 1), y: (r.minY + r.maxY) / 2 + int(rng, -1, 1) });
  }
  return plan;
}

// Which part of the house a point is in (8 directions or the centre).
function zoneOf(p: { x: number; y: number }, b: { minX: number; minY: number; maxX: number; maxY: number }): Zone {
  const dx = (p.x - (b.minX + b.maxX) / 2) / ((b.maxX - b.minX) / 2 || 1), dy = (p.y - (b.minY + b.maxY) / 2) / ((b.maxY - b.minY) / 2 || 1);
  const ns = dy < -0.33 ? 'north' : dy > 0.33 ? 'south' : '', ew = dx > 0.33 ? 'east' : dx < -0.33 ? 'west' : '';
  return ((ns && ew ? `${ns}-${ew}` : ns || ew) || 'centre') as Zone;
}

// Keeps a command sample only if the app applies it cleanly and it changes the plan.
function valid(kind: string, plan: Plan, cmds: BuildCommand[]) {
  const res = applyCommands(plan, cmds);
  const ok = res.errors.length === 0 && res.plan !== plan;
  if (!ok) rejected[kind] = (rejected[kind] ?? 0) + 1;
  return ok;
}

// Earlier turns as the app stores them: the plain request, and the reply text (or a stock
// line for command replies).
function history(): Message[] {
  if (!maybe(0.25)) return [];
  const pairs: [string, string][] = [
    ['hi', 'Hello! I can help you plan your house, place rooms and furniture, and check it against Vastu. What would you like to do?'],
    ['add a sofa in the living room', 'I have updated the scene.'],
    ['thanks', "You're welcome! Let me know if you'd like any other changes."],
    ['where should the kitchen be?', VASTU_QA[1].a],
    ['make the bedroom bigger', 'I have updated the scene.'],
  ];
  return Array.from({ length: int(rng, 1, 2) }, () => pick(rng, pairs)).flatMap(([u, a]) => [{ role: 'user' as const, content: u }, { role: 'assistant' as const, content: a }]);
}

function push(kind: string, scene: unknown, q: string, answer: string, image?: string) {
  const text = userMessageText(q, scene, !!image);
  samples.push({
    kind,
    messages: [
      { role: 'system', content: systemMessage(scene, !!image) },
      ...history(),
      { role: 'user', content: image ? [{ type: 'image', image }, { type: 'text', text }] : text },
      { role: 'assistant', content: answer },
    ],
  });
}

// ---- text scenarios: each returns [kind, question, answer, commands?] or null ------------

type Ctx = { plan: Plan; scene: any; rooms: any[]; items: any[]; house: HouseRoom[]; bounds: any };
type Scenario = (c: Ctx) => [string, string, string, BuildCommand[]?] | null;

const DIRS: [string, string][] = [['up', 'north'], ['north', 'north'], ['upwards', 'north'], ['down', 'south'], ['south', 'south'], ['left', 'west'], ['west', 'west'], ['right', 'east'], ['east', 'east'], ['to the north-east', 'north-east'], ['towards the south-west', 'south-west']];
const AMOUNTS: [string, number][] = [['a bit', 3], ['a little', 2], ['slightly', 2], ['by 2 feet', 2], ['4 feet', 4], ['5 ft', 5], ['by 6 feet', 6], ['3 feet', 3], ['10 feet', 10]];
const roomRef = (r: any) => (r.name || TYPE_LABEL[r.type] || 'room').toLowerCase();

const scenarios: [number, Scenario][] = [
  // Build a room next to an existing one.
  [14, c => {
    if (!c.rooms.length) return null;
    const r = pick(rng, c.rooms), t = pick(rng, Object.keys(DEFAULT_SIZE)), [w, d] = DEFAULT_SIZE[t].map(v => v + int(rng, -2, 2) * 2);
    const side = pick(rng, ['north', 'south', 'east', 'west']);
    const label = TYPE_LABEL[t];
    const q = pick(rng, [`add a ${sizePhrase(w, d)} ${label} to the ${side} of the ${roomRef(r)}`, `put a ${label} ${sizePhrase(w, d)} on the ${side} side of the ${roomRef(r)}`, `can you build a ${label} next to the ${roomRef(r)}, on its ${side}, ${sizePhrase(w, d)}`, `I need a ${sizePhrase(w, d)} ${label} ${side} of the ${roomRef(r)}`]);
    const cmd = { action: 'build', type: 'room', name: cap(label.replace(' area', '')), roomType: t, width: w, depth: d, nextTo: r.id, side };
    return ['build-next-to', q, json([cmd]), [cmd]];
  }],
  // Build a room on a side/corner of the house (Vastu placements).
  [10, () => {
    const t = pick(rng, Object.keys(ROOM_ZONES).filter(k => DEFAULT_SIZE[k]));
    const zone = pick(rng, ROOM_ZONES[t].best.concat(ROOM_ZONES[t].ok)) as string;
    if (zone === 'centre') return null;
    const [w, d] = DEFAULT_SIZE[t];
    const label = TYPE_LABEL[t];
    const q = pick(rng, [`put a ${label} in the ${zone}`, `add a ${label} in the ${zone} corner as per vastu`, `I want the ${label} on the ${zone} side of the house`, `build a ${label} in the ${zone}`]);
    const cmd = { action: 'build', type: 'room', name: cap(label.replace(' area', '')), roomType: t, width: w, depth: d, position: zone };
    return ['build-position', q, json([cmd]), [cmd]];
  }],
  // Move a room or item in a direction.
  [12, c => {
    const target = maybe(0.6) && c.rooms.length ? pick(rng, c.rooms) : c.items.length ? pick(rng, c.items) : null;
    if (!target) return null;
    const [dirWord, dir] = pick(rng, DIRS), [amtWord, amt] = pick(rng, AMOUNTS);
    const ref = target.type && c.rooms.includes(target) ? roomRef(target) : itemWord(target.type);
    const q = pick(rng, [`move the ${ref} ${dirWord} ${amtWord}`, `shift the ${ref} ${amtWord} ${dirWord}`, `can you push the ${ref} ${dirWord} ${amtWord}?`, `move ${ref} ${amtWord} to the ${dir}`]);
    const cmd = { action: 'move', id: target.id, direction: dir, distance: amt };
    return ['move', q, json([cmd]), [cmd]];
  }],
  // Add furniture inside a room.
  [10, c => {
    const r = c.rooms.find(x => FURNITURE_FOR[x.type] && maybe(0.5)) ?? c.rooms.find(x => FURNITURE_FOR[x.type]);
    if (!r) return null;
    const t = pick(rng, FURNITURE_FOR[r.type]);
    const q = pick(rng, [`add a ${itemWord(t)} in the ${roomRef(r)}`, `put a ${itemWord(t)} in the ${roomRef(r)}`, `place a ${itemWord(t)} inside the ${roomRef(r)}`]);
    const cmd = { action: 'build', type: t, x: r.center.x, y: r.center.y };
    return ['add-furniture', q, json([cmd]), [cmd]];
  }],
  // Resize furniture.
  [8, c => {
    if (!c.items.length) return null;
    const it = pick(rng, c.items), base = itemSize(it as any);
    const w = Math.max(1, Math.round(base.w + int(rng, -1, 3))), d = Math.max(1, Math.round(base.d + int(rng, -1, 2)));
    const both = maybe(0.4);
    const q = both ? pick(rng, [`make the ${itemWord(it.type)} ${w} by ${d} feet`, `resize the ${itemWord(it.type)} to ${w}x${d}`]) : pick(rng, [`make the ${itemWord(it.type)} ${w} feet wide`, `change the ${itemWord(it.type)} width to ${w} ft`, `I want a ${w} foot wide ${itemWord(it.type)}`]);
    const cmd = both ? { action: 'update', id: it.id, width: w, depth: d } : { action: 'update', id: it.id, width: w };
    return ['resize-item', q, json([cmd]), [cmd]];
  }],
  // Rename a room or change its type.
  [6, c => {
    if (!c.rooms.length) return null;
    const r = pick(rng, c.rooms), t = pick(rng, Object.keys(TYPE_LABEL).filter(k => k !== r.type));
    if (maybe(0.5)) {
      const name = pick(rng, ['Master Bedroom', 'Guest Room', 'Kids Room', 'Family Lounge', 'Home Office', 'Prayer Room']);
      const q = pick(rng, [`rename the ${roomRef(r)} to ${name}`, `call the ${roomRef(r)} "${name}"`]);
      const cmd = { action: 'update', id: r.id, name };
      return ['rename', q, json([cmd]), [cmd]];
    }
    const q = pick(rng, [`change the ${roomRef(r)} into a ${TYPE_LABEL[t]}`, `make the ${roomRef(r)} a ${TYPE_LABEL[t]}`, `turn the ${roomRef(r)} into a ${TYPE_LABEL[t]}`]);
    const cmd = { action: 'update', id: r.id, name: cap(TYPE_LABEL[t]), roomType: t };
    return ['retype', q, json([cmd]), [cmd]];
  }],
  // Delete a room or an item.
  [6, c => {
    const target = maybe(0.5) && c.items.length ? pick(rng, c.items) : c.rooms.length ? pick(rng, c.rooms) : null;
    if (!target) return null;
    const ref = c.rooms.includes(target) ? roomRef(target) : itemWord(target.type);
    const q = pick(rng, [`remove the ${ref}`, `delete the ${ref}`, `get rid of the ${ref}`]);
    const cmd = { action: 'delete', id: target.id };
    return ['delete', q, json([cmd]), [cmd]];
  }],
  // Clear everything.
  [2, c => {
    if (!c.rooms.length) return null;
    const q = pick(rng, ['clear everything', 'delete the whole plan', 'start over from scratch', 'remove everything from the plan']);
    return ['delete-all', q, json([{ action: 'deleteAll' }]), [{ action: 'deleteAll' }]];
  }],
  // Doors and windows on a room's wall.
  [6, c => {
    if (!c.rooms.length) return null;
    const r = pick(rng, c.rooms), kind = pick(rng, ['door', 'window']), side = pick(rng, ['north', 'south', 'east', 'west']);
    const b = r.bounds;
    const p = side === 'north' ? { x: r.center.x, y: b.minY } : side === 'south' ? { x: r.center.x, y: b.maxY } : side === 'east' ? { x: b.maxX, y: r.center.y } : { x: b.minX, y: r.center.y };
    const q = pick(rng, [`add a ${kind} on the ${side} wall of the ${roomRef(r)}`, `put a ${kind} in the ${roomRef(r)}'s ${side} wall`, `I need a ${kind} on the ${side} side of the ${roomRef(r)}`]);
    const cmd = { action: 'build', type: kind, x: p.x, y: p.y };
    return ['opening', q, json([cmd]), [cmd]];
  }],
  // Two changes in one request.
  [5, c => {
    if (c.rooms.length < 2) return null;
    const [a, b] = [pick(rng, c.rooms), pick(rng, c.rooms)];
    const side = pick(rng, ['north', 'south', 'east', 'west']), [dirWord, dir] = pick(rng, DIRS);
    const q = `add a 6 by 8 toilet to the ${side} of the ${roomRef(a)} and move the ${roomRef(b)} ${dirWord} a bit`;
    const cmds = [
      { action: 'build', type: 'room', name: 'Toilet', roomType: 'toilet', width: 6, depth: 8, nextTo: a.id, side },
      { action: 'move', id: b.id, direction: dir, distance: 3 },
    ];
    return ['multi', q, json(cmds), cmds];
  }],
  // Plan questions answered from the plan.
  [6, c => {
    if (!c.rooms.length) return null;
    const total = c.rooms.reduce((s: number, r: any) => s + r.area, 0);
    const list = c.rooms.map((r: any) => `${r.name || cap(TYPE_LABEL[r.type] ?? 'room')} (${sqft(r.area)})`).join(', ');
    const q = pick(rng, ['how many rooms do I have?', 'what rooms are in my plan?', 'list my rooms', "what's the total built area?"]);
    return ['plan-question', q, `Your plan has ${c.rooms.length} room${c.rooms.length === 1 ? '' : 's'}: ${list}. The total built area is ${sqft(total)}.`];
  }],
  // Where is a room?
  [5, c => {
    if (c.rooms.length < 2) return null;
    const r = pick(rng, c.rooms), z = zoneOf(r.center, c.bounds);
    const q = pick(rng, [`where is the ${roomRef(r)}?`, `which direction is the ${roomRef(r)} in?`, `in which zone is my ${roomRef(r)}?`]);
    return ['where', q, `The ${roomRef(r)} is in the ${z === 'centre' ? 'centre' : z + ' part'} of the house.`];
  }],
  // Vastu check of a room in the current plan.
  [8, c => {
    const r = c.rooms.find((x: any) => ROOM_ZONES[x.type] && maybe(0.5)) ?? c.rooms.find((x: any) => ROOM_ZONES[x.type]);
    if (!r || c.rooms.length < 2) return null;
    const z = zoneOf(r.center, c.bounds), rule = ROOM_ZONES[r.type], label = TYPE_LABEL[r.type];
    const q = pick(rng, [`is my ${roomRef(r)} placed correctly as per vastu?`, `is the ${roomRef(r)} in a good place for vastu?`, `check the ${roomRef(r)} for vastu`]);
    const where = z === 'centre' ? 'in the centre of the house' : `in the ${z}`;
    const best = rule.best.join(' or ');
    const a = rule.best.includes(z) ? `Yes. Your ${label} is ${where}, which is the ideal zone: ${rule.why}.`
      : rule.ok.includes(z) ? `It's acceptable. Your ${label} is ${where}. The ideal zone is the ${best}, because ${rule.why}, but the ${z} is an accepted alternative.`
      : rule.avoid.includes(z) ? `Not ideal. Your ${label} is ${where}, which Vastu advises against. The best place is the ${best}, because ${rule.why}. If you'd like, I can move it there.`
      : `Your ${label} is ${where}. Vastu prefers the ${best}, because ${rule.why}. It isn't a serious defect, but I can move it if you like.`;
    return ['vastu-check', q, a];
  }],
  // General Vastu questions.
  [10, () => { const qa = pick(rng, VASTU_QA); return ['vastu-qa', pick(rng, qa.q), qa.a]; }],
  // Greetings, thanks, capabilities, off-topic, unclear.
  [8, () => {
    const pairs: [string[], string][] = [
      [['hi', 'hello', 'hey there', 'good morning'], 'Hello! I can help you design your house: add and arrange rooms, doors, windows and furniture, read a floor plan you upload, and check everything against Vastu. What would you like to do?'],
      [['what can you do?', 'how can you help me?', 'what are your features'], 'I can build and change your plan (rooms, walls, doors, windows and furniture), move or resize things, answer Vastu questions and check your rooms against Vastu, and read a floor plan image you upload and build from it.'],
      [['thanks', 'thank you!', 'great, thanks'], "You're welcome! Let me know if you'd like any other changes."],
      [["what's the weather today?", 'tell me a joke', 'who won the match yesterday?'], "I'm your home planning assistant, so I can't help with that. I can help you design your house, place rooms and furniture, or check your plan for Vastu."],
      [['make it better', 'fix it', 'change something'], 'Happy to help! What would you like to change? For example, I can add or move a room, resize furniture, or check a room against Vastu.'],
      [['can you read my floor plan?', 'can I upload a drawing?'], 'Yes! Upload your floor plan image in the Build tab under "Background image". I will read it and can build the rooms for you, or keep it as a reference while you design.'],
    ];
    const [qs, a] = pick(rng, pairs);
    return ['chat', pick(rng, qs), a];
  }],
  // Build on an empty plan (only when the plan is empty: exact centre).
  [4, c => {
    if (c.rooms.length) return null;
    const t = pick(rng, ['living', 'bed', 'kitchen']), [w, d] = DEFAULT_SIZE[t];
    const q = pick(rng, [`start with a ${sizePhrase(w, d)} ${TYPE_LABEL[t]}`, `create a ${TYPE_LABEL[t]} of ${sizePhrase(w, d)}`]);
    const cmd = { action: 'build', type: 'room', name: cap(TYPE_LABEL[t]), roomType: t, x: 0, y: 0, width: w, depth: d };
    return ['build-empty', q, json([cmd]), [cmd]];
  }],
];
const totalWeight = scenarios.reduce((s, [w]) => s + w, 0);
const pickScenario = () => {
  let r = rng() * totalWeight;
  for (const [w, s] of scenarios) if ((r -= w) <= 0) return s;
  return scenarios[0][1];
};

function contextFor(plan: Plan, house: HouseRoom[]): Ctx {
  const scene: any = describePlan(plan);
  return { plan, scene, rooms: scene.rooms, items: scene.items, house, bounds: scene.bounds ?? { minX: -20, minY: -15, maxX: 20, maxY: 15 } };
}

// ---- run --------------------------------------------------------------------------------

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'images'), { recursive: true });

// 1. Text-only chats on random plans (some empty, some partly built).
while (samples.filter(s => !s.kind.startsWith('drawing') && s.kind !== 'read-image').length < nText) {
  const house = randomHouse(rng);
  const built = maybe(0.1) ? [] : house.filter(() => maybe(0.85));
  const c = contextFor(buildPlan(built, 0.6), house);
  for (let k = 0; k < 4; k++) {
    const res = pickScenario()(c);
    if (!res) continue;
    const [kind, q, a, cmds] = res;
    if (cmds && !valid(kind, c.plan, cmds)) continue;
    push(kind, c.scene, q, a);
  }
}

// 2. Floor-plan images: reading them, and chatting about / building from them.
for (let i = 0; i < Math.max(nVision, Math.ceil(nDrawingChat / 2)); i++) {
  const house = randomHouse(rng);
  const drawing = drawHouse(rng, house);
  const file = `images/plan_${String(i).padStart(4, '0')}.png`;
  fs.writeFileSync(path.join(OUT, file), drawing.png);
  const W = Math.max(...house.map(r => r.maxX)) - Math.min(...house.map(r => r.minX));
  const D = Math.max(...house.map(r => r.maxY)) - Math.min(...house.map(r => r.minY));
  const summary = `A ${house.length}-room house about ${W} by ${D} feet with ${house.map(r => r.name).join(', ')}.` +
    (drawing.sizes ? ` Sizes written on the plan: ${house.map(r => `${r.name} ${sizeLabel(r)}`).join(', ')}.` : '');

  if (i < nVision) {
    samples.push({
      kind: 'read-image',
      messages: [
        { role: 'user', content: [{ type: 'image', image: file }, { type: 'text', text: planImagePrompt(drawing.width, drawing.height) }] },
        { role: 'assistant', content: JSON.stringify({ summary, rooms: house.map((r, k) => ({ name: r.name, type: r.type, box: drawing.boxes[k] })) }) },
      ],
    });
  }

  // The image as uploaded to the app: placed on the plan at its true scale.
  for (let k = 0; k < 2 && samples.filter(s => s.kind.startsWith('drawing')).length < nDrawingChat; k++) {
    const minX = Math.min(...house.map(r => r.minX)), minY = Math.min(...house.map(r => r.minY));
    const analysed = maybe(0.75);
    let plan = ops.setBackground(emptyPlan(), {
      src: 'uploaded', x: minX - drawing.margin / drawing.scale, y: minY - drawing.margin / drawing.scale, width: drawing.width / drawing.scale,
      aspect: drawing.height / drawing.width, opacity: 0.5, locked: true, calibrated: true,
      ...(analysed ? { analysis: { summary, rooms: house.map((r, j) => ({ name: r.name, type: r.type, box: [drawing.boxes[j][0] / drawing.width, drawing.boxes[j][1] / drawing.height, drawing.boxes[j][2] / drawing.width, drawing.boxes[j][3] / drawing.height] as [number, number, number, number] })) } } : {}),
    });
    const already = maybe(0.3) ? house.slice(0, int(rng, 1, Math.max(1, house.length - 2))) : [];
    for (const r of already) plan = ops.addRectRoom(plan, { x: (r.minX + r.maxX) / 2, y: (r.minY + r.maxY) / 2, width: roomW(r), depth: roomD(r) }, WALL_DEFAULTS, { name: r.name, type: r.type });
    const scene = describePlan(plan);
    const sized = house.map(r => `${r.name} (${roomW(r)} x ${roomD(r)} ft)`).join(', ');
    const choice = int(rng, 0, analysed ? 5 : 2);
    if (choice === 0) {
      push('drawing-describe', scene, pick(rng, ['what rooms are on my drawing?', 'describe the floor plan I uploaded', 'what do you see in my plan image?', 'tell me about the uploaded plan']),
        `Your drawing shows ${house.length} rooms: ${sized}. The whole house is about ${W} by ${D} feet.`, file);
    } else if (choice === 1) {
      const t = pick(rng, house).type, n = house.filter(r => r.type === t).length;
      push('drawing-count', scene, `how many ${TYPE_LABEL[t]}s are in the drawing?`, `There ${n === 1 ? 'is 1' : `are ${n}`} ${TYPE_LABEL[t]}${n === 1 ? '' : 's'} on the drawing: ${house.filter(r => r.type === t).map(r => r.name).join(', ')}.`, file);
    } else if (choice === 2) {
      const r = pick(rng, house);
      push('drawing-size', scene, `how big is the ${r.name.toLowerCase()} on my drawing?`, `On the drawing, the ${r.name} is ${roomW(r)} by ${roomD(r)} feet (${roomW(r) * roomD(r)} sq ft).`, file);
    } else if (choice === 3 && valid('drawing-build-all', plan, [{ action: 'buildFromDrawing' }])) {
      push('drawing-build-all', scene, pick(rng, ['build my house from the drawing', 'build everything from the uploaded plan', 'create the rooms from my drawing', 'use the image to build the plan']), json([{ action: 'buildFromDrawing' }]), file);
    } else if (choice >= 4) {
      const some = house.filter(() => maybe(0.4)).slice(0, 3);
      if (!some.length) continue;
      const cmd = { action: 'buildFromDrawing', rooms: some.map(r => r.name) };
      if (!valid('drawing-build-some', plan, [cmd])) continue;
      const names = some.map(r => r.name.toLowerCase());
      push('drawing-build-some', scene, pick(rng, [`build the ${names.join(' and ')} from the drawing`, `add the ${names.join(' and ')} from my uploaded plan`, `just make the ${names.join(' and ')} from the image`]), json([cmd]), file);
    }
  }
}

// ---- write ------------------------------------------------------------------------------

const hash = (s: string) => [...s].reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) | 0, 7);
const train: string[] = [], val: string[] = [];
let longest = 0;
for (const s of samples) {
  const line = JSON.stringify({ messages: s.messages });
  longest = Math.max(longest, line.length);
  (Math.abs(hash(line)) % 20 === 0 ? val : train).push(line);
}
fs.writeFileSync(path.join(OUT, 'train.jsonl'), train.join('\n') + '\n');
fs.writeFileSync(path.join(OUT, 'val.jsonl'), val.join('\n') + '\n');
fs.copyFileSync(path.resolve('scripts/training-data/README.md'), path.join(OUT, 'README.md'));
fs.copyFileSync(path.resolve('scripts/training-data/train_kaggle.py'), path.join(OUT, 'train_kaggle.py'));
zipFolder(OUT, path.resolve('training-data.zip'));

const byKind: Record<string, number> = {};
for (const s of samples) byKind[s.kind] = (byKind[s.kind] ?? 0) + 1;
console.log(`Wrote ${train.length} train + ${val.length} val samples to ${OUT}`);
console.log('By kind:', byKind);
console.log('Rejected by the app (not written):', rejected);
console.log(`Longest sample: ${longest} chars (~${Math.round(longest / 3.5)} tokens)`);
console.log(`Zipped for upload: ${path.resolve('training-data.zip')}`);
