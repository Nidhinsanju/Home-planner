import * as THREE from "three";
import type { BuildingModel } from './types';

export const MAT = {
  living: new THREE.MeshStandardMaterial({ color: 0xd7c4aa, roughness: 0.9 }),
  bed: new THREE.MeshStandardMaterial({ color: 0xc9b8a3, roughness: 0.9 }),
  service: new THREE.MeshStandardMaterial({ color: 0xb7c5ca, roughness: 0.85 }),
  wet: new THREE.MeshStandardMaterial({ color: 0xd0c2d7, roughness: 0.9 }),
  parking: new THREE.MeshStandardMaterial({ color: 0x858b91, roughness: 0.95 }),
  wall: new THREE.MeshStandardMaterial({ color: 0xe8e4dc, roughness: 0.92 }),
  wall2: new THREE.MeshStandardMaterial({ color: 0xb5b0a7, roughness: 0.9 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x6f9eb0, transparent: true, opacity: 0.62 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x74503a }),
  sofa: new THREE.MeshStandardMaterial({ color: 0xb89f87 }),
  road: new THREE.MeshStandardMaterial({ color: 0x303338 }),
};

export const initialRoomState = [
  { id: 1, name: "PARKING\n8 × 9 ft", cx: -10, cz: -4.5, w: 8, d: 9, mat: MAT.parking, type: "parking" },
  { id: 2, name: "STAIRCASE\n6 × 9 ft", cx: -17, cz: -9.5, w: 6, d: 9, mat: MAT.wall2, type: "staircase" },
  { id: 3, name: "LIVING ROOM\n10 × 17 ft", cx: -1, cz: -8.5, w: 10, d: 17, mat: MAT.living, type: "living" },
  { id: 4, name: "DINING\n12 × 11 ft", cx: 0, cz: 5.5, w: 12, d: 11, mat: MAT.living, type: "dining" },
  { id: 5, name: "MASTER BEDROOM\n16 × 11 ft", cx: -14, cz: 5.5, w: 16, d: 11, mat: MAT.bed, type: "bed" },
  { id: 6, name: "MASTER TOILET\n8 × 5 ft", cx: -18, cz: -2.5, w: 8, d: 5, mat: MAT.wet, type: "toilet" },
  { id: 7, name: "COMMON TOILET\n5 × 6 ft", cx: -2.5, cz: 14, w: 5, d: 6, mat: MAT.wet, type: "toilet" },
  { id: 8, name: "POOJA\n6 × 6 ft", cx: 3, cz: 14, w: 6, d: 6, mat: MAT.wet, type: "pooja" },
  { id: 9, name: "UTILITY\n14 × 5 ft", cx: 13, cz: 13.5, w: 14, d: 5, mat: MAT.service, type: "utility" },
  { id: 10, name: "KITCHEN\n14 × 11 ft", cx: 13, cz: 5.5, w: 14, d: 11, mat: MAT.service, type: "kitchen" },
  { id: 11, name: "BEDROOM 2\n9 × 8 ft", cx: 10.5, cz: -4, w: 9, d: 8, mat: MAT.bed, type: "bed" },
  { id: 12, name: "BED 2 TOILET\n5 × 8 ft", cx: 17.5, cz: -4, w: 5, d: 8, mat: MAT.wet, type: "toilet" },
  { id: 13, name: "ELDER BEDROOM\n10 × 8 ft", cx: 9, cz: -12, w: 10, d: 8, mat: MAT.bed, type: "bed" },
  { id: 14, name: "ELDER TOILET\n8 × 5 ft", cx: 18, cz: -10.5, w: 8, d: 5, mat: MAT.wet, type: "toilet" },
];

export const LEGO_TYPES = [
  { id: 'floor', name: 'Floor', category: 'Floors', args: [1, 0.16, 1], mat: 'living', y: 0.08 },
  { id: 'wall_block', name: 'Wall Block', category: 'Walls', args: [1, 2.7, 1], mat: 'wall', y: 1.35 },
  { id: 'wall_draw', name: 'Wall', category: 'Walls', args: [0,0,0], mat: 'wall2', y: 0 },
  { id: 'door', name: 'Door', category: 'Openings', args: [0,0,0], mat: 'wood', y: 0 },
  { id: 'window', name: 'Window', category: 'Openings', args: [0,0,0], mat: 'glass', y: 0 },
];

export const exampleBuildingModel: BuildingModel = {
  project: {
    id: "proj-1",
    name: "My Home",
    unit: "ft"
  },
  plot: {
    width: 40,
    depth: 30
  },
  rooms: initialRoomState.map((r, i) => ({
    id: `room-${i}`,
    type: r.type,
    name: r.name.split('\n')[0],
    x: r.cx,
    y: r.cz, // We map cz to y for the 2D model
    width: r.w,
    depth: r.d,
    rotation: 0
  })),
  walls: [],
  doors: [],
  windows: [],
  stairs: [],
  furniture: []
};

export const emptyBuildingModel: BuildingModel = {
  project: {
    id: "proj-empty",
    name: "New Project",
    unit: "ft"
  },
  plot: {
    width: 40,
    depth: 30
  },
  rooms: [],
  walls: [],
  doors: [],
  windows: [],
  stairs: [],
  furniture: []
};
