import type { Extraction } from './extraction';

// The building model. Everything is in feet on a 2D plan: x grows to the right (east),
// y grows downwards on screen (south) and maps to world Z in 3D. North is -y.
//
// Like Floorplanner, walls form a graph: corners are shared between walls, so dragging a
// corner moves every wall attached to it. Rooms are not stored; they are derived from the
// areas enclosed by walls (see rooms.ts). Only room *labels* (name/type) are stored, pinned
// to a point inside the room they describe.

export type Vec = { x: number; y: number };

export interface Corner extends Vec {
  id: string;
}

export interface Wall {
  id: string;
  a: string; // corner id
  b: string; // corner id
  thickness: number;
  height: number;
  // A room divider: splits an open-plan area into rooms on the plan (e.g. kitchen | living)
  // but is not built in 3D and holds no doors or windows.
  divider?: boolean;
}

export interface Opening {
  id: string;
  wallId: string;
  kind: 'door' | 'window';
  t: number; // position of the opening's centre along the wall, 0 = corner a, 1 = corner b
  width: number;
  height: number;
  sill: number; // raise from floor (0 for doors)
  flip?: boolean; // door hinge side / swing direction
}

export interface RoomLabel extends Vec {
  id: string;
  name: string;
  type: string;
}

// Furniture is drawn in its own frame: width along local x, depth along local y, with the
// back (headboard, sofa back, tank, car bonnet) at -y. Rotation turns that frame clockwise.
export interface Item extends Vec {
  id: string;
  type: string;
  rotation: number; // radians
  // Size in feet when resized; otherwise the catalog size applies.
  w?: number;
  d?: number;
  h?: number;
}

// A room the vision model found on an uploaded plan. `box` is [left, top, right, bottom] as
// fractions of the image (0..1), so it stays valid when the image is moved or rescaled.
export interface ImageRoom {
  name: string;
  type: string;
  box: [number, number, number, number];
}

// An uploaded floor-plan image shown faded behind the 2D plan, for tracing over.
export interface Background {
  src: string; // image data URL
  x: number; // top-left corner on the plan, feet
  y: number;
  width: number; // feet; the height follows from `aspect`
  aspect: number; // image height / width
  opacity: number; // 0..1
  locked: boolean; // when unlocked, dragging the image moves it
  calibrated?: boolean; // the scale was set by measuring a known length
  // What the AI read from the image: rooms as image fractions, plus (from newer reads) the full
  // extraction in pixels of an imageWidth x imageHeight copy, which builds the plan to scale.
  analysis?: { summary: string; rooms: ImageRoom[]; extraction?: Extraction; imageWidth?: number; imageHeight?: number };
  use?: 'build' | 'context'; // the user's choice after the AI read it
}

export interface Plan {
  version: 2;
  corners: Corner[];
  walls: Wall[];
  openings: Opening[];
  labels: RoomLabel[];
  items: Item[];
  background?: Background;
  // Where true north is: degrees clockwise from "up" on the plan (0 = up). Used by the Vastu
  // analysis; unset means north is up.
  northDeg?: number;
}

export const WALL_DEFAULTS = { thickness: 0.5, height: 9 };
export const DOOR_DEFAULTS = { width: 3, height: 7, sill: 0 };
export const WINDOW_DEFAULTS = { width: 4, height: 4, sill: 3 };

export const emptyPlan = (): Plan => ({
  version: 2,
  corners: [],
  walls: [],
  openings: [],
  labels: [],
  items: [],
});

// Room types, including the ones that matter for Vastu placement.
export const ROOM_TYPES: { id: string; name: string; color: string }[] = [
  { id: 'living', name: 'Living Room', color: '#fef9c3' },
  { id: 'bed', name: 'Bedroom', color: '#ffe4e6' },
  { id: 'kitchen', name: 'Kitchen', color: '#e0f2fe' },
  { id: 'dining', name: 'Dining', color: '#fef3c7' },
  { id: 'toilet', name: 'Toilet / Bath', color: '#ede9fe' },
  { id: 'pooja', name: 'Pooja Room', color: '#fef08a' },
  { id: 'study', name: 'Study', color: '#dcfce7' },
  { id: 'utility', name: 'Utility', color: '#ccfbf1' },
  { id: 'store', name: 'Store', color: '#fef3c7' },
  { id: 'staircase', name: 'Staircase', color: '#f1f5f9' },
  { id: 'parking', name: 'Parking', color: '#f1f5f9' },
  { id: 'balcony', name: 'Balcony', color: '#dcfce7' },
  { id: 'hallway', name: 'Hallway', color: '#fef9c3' },
];
export const UNNAMED_ROOM_COLOR = '#f8fafc';
export const roomType = (id?: string) => ROOM_TYPES.find(t => t.id === id);

export function getRoomColor(name?: string, type?: string): string {
  const n = (name || '').toLowerCase();
  const t = (type || '').toLowerCase();
  if (n.includes('living') || t === 'living') return '#fef9c3';
  if (n.includes('kitchen') || t === 'kitchen') return '#e0f2fe';
  if (n.includes('parking') || n.includes('garage') || t === 'parking') return '#f1f5f9';
  if (n.includes('bedroom 1') || n === 'bed 1') return '#ffe4e6';
  if (n.includes('bedroom 2') || n === 'bed 2') return '#ffedd5';
  if (n.includes('bedroom 3') || n === 'bed 3') return '#ffe4e6';
  if (n.includes('bed') || t === 'bed') return '#ffe4e6';
  if (n.includes('walk-in closet 1')) return '#fef08a';
  if (n.includes('walk-in closet 2')) return '#fed7aa';
  if (n.includes('walk-in closet 3')) return '#fef08a';
  if (n.includes('closet 1')) return '#e2e8f0';
  if (n.includes('closet') || t === 'store') return '#fef3c7';
  if (n.includes('bath 1') || n.includes('toilet 1')) return '#ede9fe';
  if (n.includes('bath 2') || n.includes('toilet 2')) return '#e0e7ff';
  if (n.includes('bath') || n.includes('toilet') || t === 'toilet') return '#ede9fe';
  if (n.includes('laundry') || t === 'utility') return '#ccfbf1';
  if (n.includes('mech')) return '#e2e8f0';
  if (n.includes('balcony') || t === 'balcony') return '#dcfce7';
  if (n.includes('hallway') || t === 'hallway') return '#fef9c3';
  return roomType(type)?.color ?? '#f8fafc';
}

// Maps the words people (and AI models) use for a room to a room type id, or '' if unknown.
const ROOM_ALIASES: Record<string, string> = {
  bedroom: 'bed', bathroom: 'toilet', bath: 'toilet', puja: 'pooja', prayer: 'pooja', hall: 'living', garage: 'parking', stairs: 'staircase',
  storage: 'store', office: 'study', closet: 'store', 'walk-in closet': 'store', laundry: 'utility', mech: 'utility', mechanical: 'utility', hallway: 'hallway', corridor: 'hallway',
};
export const normalizeRoomType = (t: unknown) => {
  const s = String(t || '').toLowerCase().trim();
  const id = ROOM_ALIASES[s] || s;
  return ROOM_TYPES.some(r => r.id === id) ? id : '';
};

// Furniture / fixtures. Default sizes in feet (width along x, depth along y, height); `color`
// is the main material (fabric, wood, paint). Heights: bed = headboard, TV unit = cabinet.
export const ITEM_CATALOG: { id: string; name: string; category: string; w: number; d: number; h: number; color: string }[] = [
  { id: 'sofa', name: 'Sofa', category: 'Living', w: 7, d: 3, h: 2.8, color: '#9c8f80' },
  { id: 'table', name: 'Table', category: 'Living', w: 4, d: 2.5, h: 1.5, color: '#8a6446' },
  { id: 'tv', name: 'TV Unit', category: 'Living', w: 6, d: 1.5, h: 1.6, color: '#7a5c45' },
  { id: 'bed', name: 'Bed', category: 'Bedroom', w: 5, d: 6.5, h: 3.5, color: '#7d93a8' },
  { id: 'wardrobe', name: 'Wardrobe', category: 'Bedroom', w: 5, d: 2, h: 7, color: '#a07d5e' },
  { id: 'dining', name: 'Dining Set', category: 'Dining', w: 6, d: 6, h: 2.5, color: '#8a6446' },
  { id: 'counter', name: 'Kitchen Counter', category: 'Kitchen', w: 8, d: 2, h: 3, color: '#dfe3e6' },
  { id: 'toilet', name: 'Toilet', category: 'Bathroom', w: 1.5, d: 2.3, h: 2.5, color: '#f7f7f4' },
  { id: 'bench', name: 'Bench', category: 'Outdoor', w: 4, d: 1.5, h: 1.5, color: '#8a6446' },
  { id: 'plant', name: 'Plant', category: 'Outdoor', w: 1.5, d: 1.5, h: 3, color: '#4f8a3c' },
  { id: 'tree', name: 'Tree', category: 'Outdoor', w: 5, d: 5, h: 14, color: '#4f8a3c' },
  { id: 'car', name: 'Car', category: 'Outdoor', w: 6, d: 15, h: 5, color: '#4d6a8a' },
];
export const itemSpec = (type: string) => ITEM_CATALOG.find(i => i.id === type);

export const MIN_ITEM_SIZE = 0.5; // feet

// The size an item is drawn at: its own size if resized, else the catalog default.
export function itemSize(item: Pick<Item, 'type' | 'w' | 'd' | 'h'>) {
  const spec = itemSpec(item.type);
  return { w: item.w ?? spec?.w ?? 2, d: item.d ?? spec?.d ?? 2, h: item.h ?? spec?.h ?? 2 };
}
