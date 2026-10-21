'use client';

import React, { useMemo } from 'react';
import * as THREE from 'three';
import { Grid } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { itemSize, itemSpec, Opening, Plan, roomType, UNNAMED_ROOM_COLOR, Wall } from '../plan/types';
import { insideDimensions, Room, roomInterior } from '../plan/rooms';
import { wallEnds } from '../plan/ops';
import { formatArea, formatDimensions, DisplayUnit } from '../units';
import type { Selection } from './Editor2D';
import { FurnitureModel, SelectionFrame } from './FurnitureModel';

// Renders a Plan in 3D. Plan (x, y) maps to world (x, z); heights are world y. Feet throughout.

const CUTAWAY_HEIGHT = 3.5;
const WALL_COLOR = '#ece8e1';
const SELECT_COLOR = '#3b82f6';

const isClick = (e: ThreeEvent<MouseEvent>) => e.delta < 5;

interface Props {
  plan: Plan;
  rooms: Room[];
  unit: DisplayUnit;
  selection: Selection;
  onSelect: (s: Selection) => void;
  cutaway: boolean;
}

export function View3D({ plan, rooms, unit, selection, onSelect, cutaway }: Props) {
  const isSel = (kind: string, id: string) => selection?.kind === kind && selection.id === id;
  return (
    <>
      {/* Mostly-overhead sun with a strong sky fill keeps wall shadows short and floors readable. */}
      <hemisphereLight args={[0xffffff, 0xb0b4ba, 1.6]} />
      <directionalLight position={[18, 70, 28]} intensity={1.1} castShadow shadow-bias={-0.0004} shadow-mapSize={[2048, 2048]} shadow-camera-left={-60} shadow-camera-right={60} shadow-camera-top={60} shadow-camera-bottom={-60} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.15, 0]} receiveShadow onClick={e => isClick(e) && onSelect(null)}>
        <planeGeometry args={[400, 400]} />
        <meshStandardMaterial color="#f4f4f2" />
      </mesh>
      <Grid position={[0, -0.1, 0]} args={[200, 200]} cellSize={unit === 'mt' ? 3.28084 : 1} cellThickness={0.6} cellColor="#c9ccd1"
        sectionSize={unit === 'mt' ? 3.28084 * 5 : 5} sectionThickness={1} sectionColor="#aeb3ba" fadeDistance={160} fadeStrength={1} />

      {rooms.map(r => (
        <RoomFloor key={r.key} plan={plan} room={r} unit={unit} selected={isSel('room', r.id)} labelHeight={cutaway ? CUTAWAY_HEIGHT + 2 : 2}
          onClick={e => { if (!isClick(e)) return; e.stopPropagation(); onSelect({ kind: 'room', id: r.id }); }} />
      ))}

      {plan.walls.filter(w => !w.divider).map(w => (
        <WallMesh key={w.id} plan={plan} wall={w} openings={plan.openings.filter(o => o.wallId === w.id)} cutaway={cutaway}
          selected={isSel('wall', w.id)} selectedOpening={selection?.kind === 'opening' ? selection.id : undefined}
          onSelect={onSelect} />
      ))}

      {plan.items.map(item => {
        const spec = itemSpec(item.type);
        if (!spec) return null;
        const { w, d, h } = itemSize(item);
        return (
          <group key={item.id} position={[item.x, 0, item.y]} rotation={[0, -item.rotation, 0]}
            onClick={e => { if (!isClick(e)) return; e.stopPropagation(); onSelect({ kind: 'item', id: item.id }); }}>
            <FurnitureModel type={item.type} w={w} d={d} h={h} color={spec.color} />
            {isSel('item', item.id) && <SelectionFrame w={w} d={d} color={SELECT_COLOR} />}
          </group>
        );
      })}
    </>
  );
}

function RoomFloor({ plan, room, unit, selected, labelHeight, onClick }: { plan: Plan; room: Room; unit: DisplayUnit; selected: boolean; labelHeight: number; onClick: (e: ThreeEvent<MouseEvent>) => void }) {
  const geometry = useMemo(() => floorGeometry(room.polygon), [room.polygon]);
  // Pastel plan colours wash out under 3D lighting; deepen them a little for the floor.
  const color = useMemo(() => '#' + new THREE.Color(roomType(room.label?.type)?.color ?? UNNAMED_ROOM_COLOR).offsetHSL(0, 0.2, -0.1).getHexString(), [room.label?.type]);
  const name = room.label?.name || roomType(room.label?.type)?.name || 'Room';
  return (
    <group>
      <mesh geometry={geometry} position={[0, 0.05, 0]} receiveShadow onClick={onClick}>
        <meshStandardMaterial color={selected ? '#9cc0fa' : color} roughness={1} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} />
      </mesh>
      <SpriteLabel text={`${name}\n${roomSize(plan, room, unit)}`} x={room.center.x} y={labelHeight} z={room.center.y} />
    </group>
  );
}

// Inside sizes: rectangular rooms show "a × b"; irregular (L-shaped, angled) rooms their area.
function roomSize(plan: Plan, room: Room, unit: DisplayUnit) {
  const dims = insideDimensions(plan, room);
  return dims ? formatDimensions(dims.width, dims.depth, unit) : formatArea(roomInterior(plan, room).area, unit);
}

// Floor polygon directly in world XZ. Every triangle is wound to face up (+y) with explicit
// normals, so no triangle ends up back-facing (which renders dark).
function floorGeometry(polygon: { x: number; y: number }[]) {
  const contour = polygon.map(p => new THREE.Vector2(p.x, p.y));
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  const pos: number[] = [];
  for (const [i, j, k] of tris) {
    const a = contour[i];
    let b = contour[j];
    let c = contour[k];
    // y-component of (b - a) x (c - a) for points (x, 0, z=plan y); must be positive to face up.
    if ((b.y - a.y) * (c.x - a.x) - (b.x - a.x) * (c.y - a.y) < 0) [b, c] = [c, b];
    pos.push(a.x, 0, a.y, b.x, 0, b.y, c.x, 0, c.y);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, n) => (n % 3 === 1 ? 1 : 0)), 3));
  return g;
}

type Piece = { u0: number; u1: number; y0: number; y1: number };

// Splits a wall into solid boxes around its openings (left/right of each opening, below
// windows and above doors/windows), so doors and windows are real holes.
function wallPieces(L: number, thickness: number, H: number, openings: Opening[]): Piece[] {
  const pieces: Piece[] = [];
  const push = (u0: number, u1: number, y0: number, y1: number) => {
    if (u1 - u0 > 0.01 && y1 - y0 > 0.01) pieces.push({ u0, u1, y0, y1 });
  };
  let cur = -thickness / 2; // extend into the corner so joints look solid
  const sorted = [...openings].sort((a, b) => a.t - b.t);
  for (const o of sorted) {
    const s = Math.max(0, o.t * L - o.width / 2);
    const e = Math.min(L, o.t * L + o.width / 2);
    push(cur, s, 0, H);
    push(s, e, 0, Math.min(o.sill, H));
    push(s, e, Math.min(o.sill + o.height, H), H);
    cur = Math.max(cur, e);
  }
  push(cur, L + thickness / 2, 0, H);
  return pieces;
}

function WallMesh({ plan, wall, openings, cutaway, selected, selectedOpening, onSelect }: {
  plan: Plan; wall: Wall; openings: Opening[]; cutaway: boolean; selected: boolean; selectedOpening?: string; onSelect: (s: Selection) => void;
}) {
  const { a, b } = wallEnds(plan, wall);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const L = Math.hypot(dx, dy);
  if (L < 0.01) return null;
  const H = cutaway ? Math.min(wall.height, CUTAWAY_HEIGHT) : wall.height;
  const angle = -Math.atan2(dy, dx);
  const pieces = wallPieces(L, wall.thickness, H, openings);

  return (
    <group position={[a.x, 0, a.y]} rotation={[0, angle, 0]}>
      {pieces.map((p, i) => (
        <mesh key={i} position={[(p.u0 + p.u1) / 2, (p.y0 + p.y1) / 2, 0]} castShadow receiveShadow
          onClick={e => { if (!isClick(e)) return; e.stopPropagation(); onSelect({ kind: 'wall', id: wall.id }); }}>
          <boxGeometry args={[p.u1 - p.u0, p.y1 - p.y0, wall.thickness]} />
          <meshStandardMaterial color={selected ? SELECT_COLOR : WALL_COLOR} roughness={0.92} />
        </mesh>
      ))}
      {openings.map(o => {
        const top = Math.min(o.sill + o.height, H);
        if (top - o.sill < 0.05) return null;
        const sel = o.id === selectedOpening;
        const onClick = (e: ThreeEvent<MouseEvent>) => { if (!isClick(e)) return; e.stopPropagation(); onSelect({ kind: 'opening', id: o.id }); };
        return o.kind === 'door' ? (
          <mesh key={o.id} position={[o.t * L, (o.sill + top) / 2, 0]} castShadow onClick={onClick}>
            <boxGeometry args={[o.width * 0.96, top - o.sill, 0.15]} />
            <meshStandardMaterial color={sel ? SELECT_COLOR : '#8a5a3c'} />
          </mesh>
        ) : (
          <mesh key={o.id} position={[o.t * L, (o.sill + top) / 2, 0]} onClick={onClick}>
            <boxGeometry args={[o.width, top - o.sill, 0.08]} />
            <meshStandardMaterial color={sel ? SELECT_COLOR : '#7fb6cf'} transparent opacity={0.55} />
          </mesh>
        );
      })}
    </group>
  );
}

function SpriteLabel({ text, x, y, z }: { text: string; x: number; y: number; z: number }) {
  const texture = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 600;
    c.height = 120;
    const q = c.getContext('2d');
    if (q) {
      q.fillStyle = 'rgba(55, 60, 66, 0.85)';
      if (q.roundRect) q.roundRect(8, 8, 584, 104, 18);
      else q.rect(8, 8, 584, 104);
      q.fill();
      q.textAlign = 'center';
      q.textBaseline = 'middle';
      const [first, second] = text.split('\n');
      q.fillStyle = '#fff';
      q.font = 'bold 34px Arial';
      q.fillText(first, 300, second ? 45 : 60);
      if (second) {
        q.font = 'normal 26px Arial';
        q.fillStyle = '#cbd0d6';
        q.fillText(second, 300, 85);
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    return tex;
  }, [text]);
  return (
    <sprite position={[x, y, z]} scale={[6, 1.2, 1]}>
      <spriteMaterial map={texture} transparent opacity={0.85} depthTest={false} />
    </sprite>
  );
}
