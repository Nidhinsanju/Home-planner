'use client';

import React, { useMemo } from 'react';
import * as THREE from 'three';
import { RoundedBox } from '@react-three/drei';
import { shade } from './shade';

// Procedural 3D furniture, built from rounded parts in the item's own frame: centred on the
// origin, width w along x, depth d along z (back at -z), height h up from the floor. Parts are
// derived from (w, d, h) like the 2D symbols, so resizing keeps believable proportions.

type V3 = [number, number, number];

interface MatProps { color: string; rough?: number; metal?: number; emissive?: string }

const Mat = ({ color, rough = 0.8, metal = 0, emissive }: MatProps) => (
  <meshStandardMaterial color={color} roughness={rough} metalness={metal} emissive={emissive ?? '#000000'} emissiveIntensity={emissive ? 0.6 : 0} />
);

// A rounded box given its size and centre.
function Part({ size, at, r = 0.06, ...mat }: { size: V3; at: V3; r?: number } & MatProps) {
  const [x, y, z] = size.map(v => Math.max(0.01, v)) as V3;
  const radius = Math.max(0.001, Math.min(r, x / 2, y / 2, z / 2) * 0.95);
  return (
    <RoundedBox args={[x, y, z]} radius={radius} smoothness={3} position={at} castShadow receiveShadow>
      <Mat {...mat} />
    </RoundedBox>
  );
}

function Cyl({ r, h, at, rot, rTop, seg = 20, ...mat }: { r: number; h: number; at: V3; rot?: V3; rTop?: number; seg?: number } & MatProps) {
  return (
    <mesh position={at} rotation={rot} castShadow receiveShadow>
      <cylinderGeometry args={[rTop ?? r, r, h, seg]} />
      <Mat {...mat} />
    </mesh>
  );
}

const evenly = (n: number, span: number) => Array.from({ length: n }, (_, i) => -span / 2 + (span / n) * (i + 0.5));
const legsAt = (w: number, d: number, inset: number): [number, number][] =>
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => [a * (w / 2 - inset), b * (d / 2 - inset)]);

const WOOD_DARK = '#4a3a2e';
const METAL = '#b4bac0';

export function FurnitureModel({ type, w, d, h, color }: { type: string; w: number; d: number; h: number; color: string }) {
  const hw = w / 2, hd = d / 2;

  switch (type) {
    case 'sofa': {
      const leg = 0.3, a = Math.min(0.7, w * 0.14), b = Math.min(0.75, d * 0.28);
      const seatTop = h * 0.5, baseTop = seatTop - 0.45;
      const n = Math.max(1, Math.round((w - 2 * a) / 2.4));
      const cw = (w - 2 * a) / n;
      const cushion = shade(color, 0.12);
      return (
        <group>
          <Part size={[w, baseTop - leg, d]} at={[0, leg + (baseTop - leg) / 2, 0]} color={color} rough={0.95} r={0.1} />
          <Part size={[w - 2 * a + 0.02, h - leg, b]} at={[0, leg + (h - leg) / 2, -hd + b / 2]} color={color} rough={0.95} r={0.18} />
          {[-1, 1].map(s => <Part key={s} size={[a, h * 0.68 - leg, d]} at={[s * (hw - a / 2), leg + (h * 0.68 - leg) / 2, 0]} color={color} rough={0.95} r={0.22} />)}
          {evenly(n, w - 2 * a).map((x, i) => (
            <group key={i}>
              <Part size={[cw - 0.06, 0.45, d - b - 0.06]} at={[x, baseTop + 0.225, -hd + b + (d - b) / 2]} color={cushion} rough={1} r={0.15} />
              <group position={[x, seatTop + h * 0.2, -hd + b + 0.2]} rotation={[-0.14, 0, 0]}>
                <Part size={[cw - 0.08, h * 0.4, 0.42]} at={[0, 0, 0]} color={cushion} rough={1} r={0.15} />
              </group>
            </group>
          ))}
          {legsAt(w, d, 0.25).map(([x, z], i) => <Cyl key={i} r={0.07} rTop={0.09} h={leg} at={[x, leg / 2, z]} color={WOOD_DARK} rough={0.5} seg={10} />)}
        </group>
      );
    }

    case 'bed': {
      const leg = 0.25, frameTop = Math.min(1.1, h * 0.32), mat = 0.7, hb = Math.min(0.35, d * 0.06);
      const top = frameTop + mat;
      const n = w >= 4 ? 2 : 1;
      const pd = Math.min(1.2, d * 0.18), pw = (w - 0.6 - 0.3 * (n - 1)) / n;
      const blanketD = (d - hb) * 0.62;
      const frame = '#cdbfae';
      return (
        <group>
          <Part size={[w, frameTop - leg, d]} at={[0, leg + (frameTop - leg) / 2, 0]} color={frame} rough={0.9} r={0.08} />
          <Part size={[w + 0.1, h, hb]} at={[0, h / 2, -hd + hb / 2]} color={frame} rough={0.95} r={0.12} />
          <Part size={[w - 0.15, mat, d - hb - 0.1]} at={[0, frameTop + mat / 2, hb / 2]} color="#f4f1ec" rough={1} r={0.15} />
          {evenly(n, w - 0.6).map((x, i) => (
            <Part key={i} size={[pw, 0.32, pd]} at={[x, top + 0.14, -hd + hb + 0.25 + pd / 2]} color="#fbfbf8" rough={1} r={0.14} />
          ))}
          <Part size={[w - 0.05, 0.14, blanketD]} at={[0, top - 0.02, hd - blanketD / 2 - 0.03]} color={color} rough={1} r={0.06} />
          <Part size={[w - 0.03, 0.16, Math.min(0.6, d * 0.09)]} at={[0, top, hd - blanketD + Math.min(0.3, d * 0.045)]} color={shade(color, 0.6)} rough={1} r={0.06} />
          {legsAt(w, d, 0.2).map(([x, z], i) => <Cyl key={i} r={0.08} h={leg} at={[x, leg / 2, z]} color={WOOD_DARK} seg={10} />)}
        </group>
      );
    }

    case 'table': {
      const t = 0.12;
      return (
        <group>
          <Part size={[w, t, d]} at={[0, h - t / 2, 0]} color={color} rough={0.55} r={0.04} />
          {legsAt(w, d, 0.22).map(([x, z], i) => <Part key={i} size={[0.16, h - t, 0.16]} at={[x, (h - t) / 2, z]} color={shade(color, -0.25)} rough={0.6} r={0.03} />)}
        </group>
      );
    }

    case 'dining': {
      const cd = Math.min(1.6, d * 0.28), td = Math.max(1, d - 2 * cd * 0.7), t = 0.12;
      const n = Math.max(1, Math.floor(w / 2.2));
      const cs = Math.min(1.5, (w / n) * 0.72, cd);
      const seat = 1.5;
      const fabric = shade(color, 0.65);
      return (
        <group>
          <Part size={[w, t, td]} at={[0, h - t / 2, 0]} color={color} rough={0.5} r={0.04} />
          {legsAt(w, td, 0.25).map(([x, z], i) => <Part key={i} size={[0.18, h - t, 0.18]} at={[x, (h - t) / 2, z]} color={shade(color, -0.25)} rough={0.6} r={0.03} />)}
          {evenly(n, w).flatMap((x, i) => [-1, 1].map(side => {
            const z = side * (hd - cs / 2);
            return (
              <group key={`${i}${side}`} position={[x, 0, z]}>
                <Part size={[cs, 0.14, cs]} at={[0, seat, 0]} color={fabric} rough={0.95} r={0.06} />
                <Part size={[cs, 1.4, 0.12]} at={[0, seat + 0.7, side * (cs / 2 - 0.06)]} color={color} rough={0.55} r={0.04} />
                {legsAt(cs, cs, 0.1).map(([lx, lz], j) => <Part key={j} size={[0.1, seat, 0.1]} at={[lx, seat / 2, lz]} color={color} rough={0.6} r={0.02} />)}
              </group>
            );
          }))}
        </group>
      );
    }

    case 'tv': {
      const n = Math.max(1, Math.round(w / 2));
      const sw = Math.min(w * 0.85, 6.5), sh = sw * (9 / 16);
      return (
        <group>
          <Part size={[w, h - 0.15, d]} at={[0, 0.15 + (h - 0.15) / 2, 0]} color={color} rough={0.55} r={0.05} />
          <Part size={[w - 0.1, 0.15, d - 0.1]} at={[0, 0.075, 0]} color={WOOD_DARK} r={0.02} />
          {evenly(n, w).map((x, i) => (
            <Part key={i} size={[w / n - 0.06, h * 0.7, 0.03]} at={[x, 0.15 + (h - 0.15) / 2, hd + 0.005]} color={shade(color, 0.08)} rough={0.5} r={0.01} />
          ))}
          <Part size={[0.7, 0.3, 0.35]} at={[0, h + 0.15, -hd + 0.4]} color="#2b2f36" metal={0.4} rough={0.4} r={0.04} />
          <Part size={[sw, sh, 0.12]} at={[0, h + 0.35 + sh / 2, -hd + 0.4]} color="#15171a" metal={0.3} rough={0.25} r={0.04} />
        </group>
      );
    }

    case 'wardrobe': {
      const n = Math.max(1, Math.round(w / 1.8)), plinth = 0.25;
      return (
        <group>
          <Part size={[w - 0.1, plinth, d - 0.1]} at={[0, plinth / 2, -0.05]} color={WOOD_DARK} r={0.02} />
          <Part size={[w, h - plinth, d]} at={[0, plinth + (h - plinth) / 2, 0]} color={color} rough={0.6} r={0.04} />
          {evenly(n, w).map((x, i) => (
            <group key={i}>
              <Part size={[w / n - 0.06, h - plinth - 0.12, 0.04]} at={[x, plinth + (h - plinth) / 2, hd + 0.01]} color={shade(color, 0.06)} rough={0.55} r={0.015} />
              <Part size={[0.05, 1.2, 0.08]} at={[x + (i % 2 ? -1 : 1) * (w / n / 2 - 0.2), plinth + (h - plinth) / 2, hd + 0.06]} color={METAL} metal={0.35} rough={0.3} r={0.02} />
            </group>
          ))}
        </group>
      );
    }

    case 'counter': {
      const kick = 0.35, top = 0.15, cab = h - top - kick;
      const n = Math.max(1, Math.round(w / 2));
      const sinkW = Math.min(2, w * 0.28), sinkD = d * 0.6, sx = w >= 4 ? -w / 4 : 0;
      const hob = Math.min(2, w * 0.25, d * 0.75);
      return (
        <group>
          <Part size={[w - 0.05, kick, d - 0.3]} at={[0, kick / 2, -0.15]} color="#3a3d42" r={0.02} />
          <Part size={[w, cab, d - 0.08]} at={[0, kick + cab / 2, -0.04]} color={color} rough={0.5} r={0.03} />
          {evenly(n, w).map((x, i) => (
            <Part key={i} size={[w / n - 0.05, cab - 0.08, 0.03]} at={[x, kick + cab / 2, hd - 0.06]} color={shade(color, 0.1)} rough={0.45} r={0.01} />
          ))}
          <Part size={[w + 0.04, top, d + 0.04]} at={[0, h - top / 2, 0]} color="#3d4247" rough={0.25} metal={0.1} r={0.02} />
          <Part size={[sinkW, 0.02, sinkD]} at={[sx, h + 0.005, 0.1]} color="#b9c0c6" metal={0.35} rough={0.25} r={0.01} />
          <Cyl r={0.06} h={0.9} at={[sx, h + 0.45, -sinkD / 2 - 0.05]} color={METAL} metal={0.35} rough={0.2} seg={10} />
          {w >= 4 && (
            <group>
              <Part size={[hob, 0.03, hob]} at={[w / 4, h + 0.01, 0]} color="#111317" metal={0.3} rough={0.15} r={0.01} />
              {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => (
                <Cyl key={`${a}${b}`} r={hob * 0.14} h={0.03} at={[w / 4 + (a * hob) / 4, h + 0.03, (b * hob) / 4]} color="#5d636a" rough={0.5} seg={18} />
              ))}
            </group>
          )}
        </group>
      );
    }

    case 'toilet': {
      const tank = d * 0.3, bowlD = d - tank, bowlZ = -hd + tank + bowlD * 0.48;
      const rim = Math.min(1.4, h * 0.56);
      const ceramic = { color, rough: 0.2, metal: 0.05 };
      return (
        <group>
          <group position={[0, 0, bowlZ]} scale={[w * 0.32, 1, bowlD * 0.34]}>
            <Cyl r={0.85} rTop={1} h={rim - 0.15} at={[0, (rim - 0.15) / 2, 0]} seg={28} {...ceramic} />
            <Cyl r={1.25} h={0.15} at={[0, rim - 0.075, 0]} seg={28} {...ceramic} />
            <Cyl r={1.27} h={0.06} at={[0, rim + 0.03, 0]} seg={28} color="#ffffff" rough={0.3} />
          </group>
          {/* rear pedestal joining the bowl to the wall-side tank */}
          <Part size={[w * 0.55, rim, bowlZ + hd]} at={[0, rim / 2, (bowlZ - hd) / 2]} r={0.12} {...ceramic} />
          <Part size={[w * 0.9, h - rim + 0.15, tank]} at={[0, rim + (h - rim) / 2 - 0.075, -hd + tank / 2]} r={0.08} {...ceramic} />
          <Cyl r={0.06} h={0.05} at={[w * 0.25, h + 0.02, -hd + tank / 2]} color={METAL} metal={0.35} rough={0.2} seg={10} />
        </group>
      );
    }

    case 'bench': {
      const n = 3, slat = d / n;
      return (
        <group>
          {evenly(n, d).map((z, i) => <Part key={i} size={[w, 0.1, slat - 0.06]} at={[0, h - 0.05, z]} color={color} rough={0.7} r={0.03} />)}
          {[-1, 1].map(s => <Part key={s} size={[0.14, h - 0.1, d * 0.9]} at={[s * (hw - 0.4), (h - 0.1) / 2, 0]} color="#3a3d42" metal={0.5} rough={0.4} r={0.03} />)}
        </group>
      );
    }

    case 'plant': {
      const r = Math.min(w, d) / 2, pot = h * 0.3;
      const leaves = [[0, 0.55, 0, 0.55], [0.35, 0.4, 0.15, 0.42], [-0.3, 0.42, -0.2, 0.44], [-0.1, 0.38, 0.35, 0.4], [0.15, 0.75, -0.2, 0.38]];
      return (
        <group>
          <Cyl r={r * 0.5} rTop={r * 0.68} h={pot} at={[0, pot / 2, 0]} color="#c98a5c" rough={0.85} seg={20} />
          <Cyl r={r * 0.62} h={0.04} at={[0, pot - 0.02, 0]} color="#4a3a2e" seg={20} />
          {leaves.map(([x, y, z, s], i) => (
            <mesh key={i} position={[x * r, pot + y * (h - pot), z * r]} scale={[r * s * 1.6, (h - pot) * s * 0.9, r * s * 1.6]} castShadow>
              <icosahedronGeometry args={[1, 1]} />
              <meshStandardMaterial color={i % 2 ? shade(color, 0.12) : color} roughness={0.9} flatShading />
            </mesh>
          ))}
        </group>
      );
    }

    case 'tree': {
      const trunk = h * 0.38, crown = h - trunk;
      const blobs = [[0, 0.5, 0, 0.5], [0.3, 0.38, 0.12, 0.36], [-0.28, 0.4, -0.1, 0.38], [0.05, 0.35, -0.3, 0.34], [-0.05, 0.72, 0.1, 0.32]];
      return (
        <group>
          <Cyl r={Math.min(0.5, w * 0.08)} rTop={Math.min(0.32, w * 0.05)} h={trunk + crown * 0.3} at={[0, (trunk + crown * 0.3) / 2, 0]} color="#6b4a32" rough={0.95} seg={10} />
          {blobs.map(([x, y, z, s], i) => (
            <mesh key={i} position={[x * w, trunk + y * crown, z * d]} scale={[w * s, crown * s * 0.85, d * s]} castShadow>
              <icosahedronGeometry args={[1, 1]} />
              <meshStandardMaterial color={i % 2 ? shade(color, 0.1) : shade(color, -0.08)} roughness={0.9} flatShading />
            </mesh>
          ))}
        </group>
      );
    }

    case 'car':
      return <CarModel w={w} d={d} h={h} color={color} />;

    default:
      return <Part size={[w, h, d]} at={[0, h / 2, 0]} color={color} r={0.08} />;
  }
}

// The car's cabin is a side profile (sloped windscreen and rear glass) extruded across its width.
function CarModel({ w, d, h, color }: { w: number; d: number; h: number; color: string }) {
  const hw = w / 2, hd = d / 2;
  const wheelR = Math.min(1.1, h * 0.22), body = h * 0.4, bodyY = wheelR * 0.75;
  const cabinH = h - bodyY - body - 0.15;
  const cabW = w * 0.78;
  const axle = d / 2 - Math.min(2.8, d * 0.19);
  const paint = { color, metal: 0.15, rough: 0.4 };
  const cabin = useMemo(() => {
    const zf = -d * 0.17, zr = d * 0.3; // cabin base, front (-z) to rear
    const s = new THREE.Shape();
    s.moveTo(zf, 0);
    s.lineTo(zr, 0);
    s.lineTo(zr - d * 0.07, cabinH);
    s.lineTo(zf + d * 0.14, cabinH);
    s.closePath();
    return new THREE.ExtrudeGeometry(s, { depth: cabW, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.12, bevelSegments: 3 });
  }, [d, cabinH, cabW]);
  const roofLen = d * 0.47 - d * 0.21;
  return (
    <group>
      <Part size={[w, body, d]} at={[0, bodyY + body / 2, 0]} r={Math.min(0.6, body / 2)} {...paint} />
      <mesh geometry={cabin} position={[cabW / 2, bodyY + body, 0]} rotation={[0, -Math.PI / 2, 0]} castShadow>
        <meshStandardMaterial color="#2c3a4a" metalness={0.3} roughness={0.15} />
      </mesh>
      <Part size={[cabW + 0.26, 0.1, roofLen]} at={[0, bodyY + body + cabinH + 0.12, -d * 0.17 + d * 0.14 + roofLen / 2]} r={0.04} {...paint} />
      <Part size={[cabW + 0.27, cabinH * 0.95, 0.35]} at={[0, bodyY + body + cabinH * 0.48, d * 0.06]} r={0.04} {...paint} />
          {[-1, 1].flatMap(sx => [-1, 1].map(sz => (
            <group key={`${sx}${sz}`} position={[sx * (hw - 0.35), wheelR, sz * axle]}>
              <Cyl r={wheelR} h={0.7} at={[0, 0, 0]} rot={[0, 0, Math.PI / 2]} color="#1c1d20" rough={0.9} seg={24} />
              <Cyl r={wheelR * 0.55} h={0.72} at={[0, 0, 0]} rot={[0, 0, Math.PI / 2]} color="#b7bcc2" metal={0.35} rough={0.3} seg={16} />
            </group>
          )))}
          {[-1, 1].map(s => (
            <group key={s}>
              <Part size={[w * 0.22, body * 0.22, 0.08]} at={[s * w * 0.3, bodyY + body * 0.7, -hd + 0.02]} color="#f4f1e0" emissive="#f4f1e0" r={0.04} />
              <Part size={[w * 0.22, body * 0.18, 0.08]} at={[s * w * 0.3, bodyY + body * 0.72, hd - 0.02]} color="#b3261e" emissive="#7a1410" r={0.04} />
            </group>
          ))}
    </group>
  );
}

// Floor outline shown under a selected item.
export function SelectionFrame({ w, d, color }: { w: number; d: number; color: string }) {
  const t = 0.12, y = 0.04;
  return (
    <group>
      <mesh position={[0, y - 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[w + 0.3, d + 0.3]} />
        <meshBasicMaterial color={color} transparent opacity={0.15} depthWrite={false} />
      </mesh>
      {[[0, -(d / 2 + 0.15), w + 0.3 + t, t], [0, d / 2 + 0.15, w + 0.3 + t, t], [-(w / 2 + 0.15), 0, t, d + 0.3], [w / 2 + 0.15, 0, t, d + 0.3]].map(([x, z, sx, sz], i) => (
        <mesh key={i} position={[x, y, z]}>
          <boxGeometry args={[sx, 0.02, sz]} />
          <meshBasicMaterial color={color} />
        </mesh>
      ))}
    </group>
  );
}
