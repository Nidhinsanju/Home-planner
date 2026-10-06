export type Unit = 'ft' | 'm';

export interface Project {
  id: string;
  name: string;
  unit: Unit;
}

export interface Plot {
  width: number;
  depth: number;
}

export interface Point2D {
  x: number;
  y: number;
}

export interface Room {
  id: string;
  type: string;
  name: string;
  x: number;
  y: number;
  width: number;
  depth: number;
  rotation: number;
}

export interface Wall {
  id: string;
  type: 'exterior' | 'interior' | 'glass';
  start: Point2D;
  end: Point2D;
  thickness: number;
  height: number;
  raise: number;
  style: string;
}

export interface Door {
  id: string;
  wallId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  style: string;
  swingDirection: string;
}

export interface Window {
  id: string;
  wallId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  sillHeight: number;
  style: string;
}

export interface Stair {
  id: string;
  type: 'straight' | 'l-shape' | 'u-shape';
  x: number;
  y: number;
  width: number;
  numberOfSteps: number;
  stepHeight: number;
  stepDepth: number;
  direction: number;
}

export interface Furniture {
  id: string;
  roomId: string;
  type: string;
  x: number;
  y: number;
  rotation: number;
  style: string;
}

export interface BuildingModel {
  project: Project;
  plot: Plot;
  rooms: Room[];
  walls: Wall[];
  doors: Door[];
  windows: Window[];
  stairs: Stair[];
  furniture: Furniture[];
  surfaces?: any[];
}
