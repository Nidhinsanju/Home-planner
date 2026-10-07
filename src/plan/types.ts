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

export interface Item extends Vec {
  id: string;
  type: string;
  rotation: number; // radians
}

export interface Plan {
  version: 2;
  plot: { width: number; depth: number };
  corners: Corner[];
  walls: Wall[];
  openings: Opening[];
  labels: RoomLabel[];
  items: Item[];
}

export const WALL_DEFAULTS = { thickness: 0.5, height: 9 };
export const DOOR_DEFAULTS = { width: 3, height: 7, sill: 0 };
export const WINDOW_DEFAULTS = { width: 4, height: 4, sill: 3 };

export const emptyPlan = (): Plan => ({
  version: 2,
  plot: { width: 40, depth: 30 },
  corners: [],
  walls: [],
  openings: [],
  labels: [],
  items: [],
});

// Room types, including the ones that matter for Vastu placement.
export const ROOM_TYPES: { id: string; name: string; color: string }[] = [
  { id: 'living', name: 'Living Room', color: '#f6d7b0' },
  { id: 'bed', name: 'Bedroom', color: '#f8c9c4' },
  { id: 'kitchen', name: 'Kitchen', color: '#cfe8f3' },
  { id: 'dining', name: 'Dining', color: '#f3dfa2' },
  { id: 'toilet', name: 'Toilet / Bath', color: '#d9d4ec' },
  { id: 'pooja', name: 'Pooja Room', color: '#fbe3a1' },
  { id: 'study', name: 'Study', color: '#d4ecd0' },
  { id: 'utility', name: 'Utility', color: '#d5dbe0' },
  { id: 'store', name: 'Store', color: '#cfc8bd' },
  { id: 'staircase', name: 'Staircase', color: '#c9c9c9' },
  { id: 'parking', name: 'Parking', color: '#b9bec4' },
  { id: 'balcony', name: 'Balcony', color: '#d6efe6' },
  { id: 'hallway', name: 'Hallway', color: '#efe6c8' },
];
export const UNNAMED_ROOM_COLOR = '#e9e4da';
export const roomType = (id?: string) => ROOM_TYPES.find(t => t.id === id);

// Furniture / fixtures. Sizes in feet (width along x, depth along y, height).
export const ITEM_CATALOG: { id: string; name: string; category: string; w: number; d: number; h: number; color: string }[] = [
  { id: 'sofa', name: 'Sofa', category: 'Living', w: 7, d: 3, h: 2.8, color: '#b89f87' },
  { id: 'table', name: 'Table', category: 'Living', w: 4, d: 3, h: 2.5, color: '#74503a' },
  { id: 'tv', name: 'TV Unit', category: 'Living', w: 6, d: 1.5, h: 2, color: '#4a4f57' },
  { id: 'bed', name: 'Bed', category: 'Bedroom', w: 5, d: 6.5, h: 2, color: '#e9e4da' },
  { id: 'wardrobe', name: 'Wardrobe', category: 'Bedroom', w: 5, d: 2, h: 7, color: '#8a6a50' },
  { id: 'dining', name: 'Dining Set', category: 'Dining', w: 6, d: 3.5, h: 2.5, color: '#74503a' },
  { id: 'counter', name: 'Kitchen Counter', category: 'Kitchen', w: 8, d: 2, h: 3, color: '#b7c5ca' },
  { id: 'toilet', name: 'Toilet', category: 'Bathroom', w: 1.5, d: 2.3, h: 2.5, color: '#f4f3ee' },
  { id: 'bench', name: 'Bench', category: 'Outdoor', w: 4, d: 1.5, h: 1.5, color: '#74503a' },
  { id: 'plant', name: 'Plant', category: 'Outdoor', w: 1.5, d: 1.5, h: 3, color: '#4f8a3c' },
  { id: 'tree', name: 'Tree', category: 'Outdoor', w: 5, d: 5, h: 14, color: '#4f8a3c' },
  { id: 'car', name: 'Car', category: 'Outdoor', w: 6, d: 15, h: 5, color: '#586d82' },
];
export const itemSpec = (type: string) => ITEM_CATALOG.find(i => i.id === type);
