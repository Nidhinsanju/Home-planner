import React from 'react';
import { shade } from './shade';

// Top-down architectural symbols for furniture on the 2D plan, drawn in the item's own frame:
// centred on (0, 0), width w along x, depth d along y, back at -y. Every part is derived from
// (w, d) so a resized item keeps sensible proportions (a longer sofa gets more cushions, not
// fatter arms). `sw` is the stroke width in plan units, so lines stay crisp at any zoom.

const LINE = '#4a4f57';
const WHITE = '#ffffff';

const evenly = (n: number, span: number) => Array.from({ length: n }, (_, i) => -span / 2 + (span / n) * (i + 0.5));

interface Props { type: string; w: number; d: number; color: string; sw: number }

export function FurnitureSymbol({ type, w, d, color, sw }: Props) {
  const hw = w / 2, hd = d / 2;
  const fine = sw * 0.7;
  const tint = shade(color, 0.55);
  const base = { stroke: LINE, strokeWidth: sw, strokeLinejoin: 'round' as const };
  const thin = { stroke: LINE, strokeWidth: fine };
  const box = (x: number, y: number, bw: number, bd: number, fill: string, r = 0, extra?: object) => (
    <rect x={x} y={y} width={Math.max(0, bw)} height={Math.max(0, bd)} rx={Math.min(r, bw / 2, bd / 2)} fill={fill} {...base} {...extra} />
  );

  switch (type) {
    case 'sofa': {
      const a = Math.min(0.7, w * 0.14), b = Math.min(0.75, d * 0.28);
      const n = Math.max(1, Math.round((w - 2 * a) / 2.4));
      const cw = (w - 2 * a) / n;
      return (
        <g>
          {box(-hw, -hd, w, d, shade(color, 0.35), 0.3)}
          {box(-hw + a, -hd, w - 2 * a, b, shade(color, 0.2), 0.15)}
          {box(-hw, -hd, a, d, shade(color, 0.2), 0.25)}
          {box(hw - a, -hd, a, d, shade(color, 0.2), 0.25)}
          {evenly(n, w - 2 * a).map((x, i) => <g key={i}>{box(x - cw / 2 + 0.04, -hd + b + 0.04, cw - 0.08, d - b - 0.1, tint, 0.2, { strokeWidth: fine })}</g>)}
        </g>
      );
    }
    case 'bed': {
      const hb = Math.min(0.4, d * 0.07);
      const n = w >= 4 ? 2 : 1;
      const gap = 0.3, pd = Math.min(1.3, d * 0.2);
      const pw = (w - 0.6 - gap * (n - 1)) / n;
      const fold = -hd + d * 0.38;
      return (
        <g>
          {box(-hw, -hd, w, d, WHITE, 0.15)}
          {box(-hw, -hd, w, hb, shade(color, -0.25), 0.1)}
          {evenly(n, w - 0.6).map((x, i) => <g key={i}>{box(x - pw / 2, -hd + hb + 0.25, pw, pd, WHITE, 0.3, { strokeWidth: fine })}</g>)}
          {box(-hw, fold, w, hd - fold, tint, 0.12)}
          {box(-hw, fold, w, Math.min(0.6, d * 0.09), shade(color, 0.75), 0, { strokeWidth: fine })}
          <path d={`M ${hw} ${fold + d * 0.22} L ${hw - Math.min(w, d) * 0.28} ${hd} L ${hw} ${hd} Z`} fill={shade(color, 0.3)} {...thin} />
        </g>
      );
    }
    case 'table': {
      const i = Math.min(0.2, w * 0.06, d * 0.06);
      return (
        <g>
          {box(-hw, -hd, w, d, tint, 0.15)}
          {box(-hw + i, -hd + i, w - 2 * i, d - 2 * i, 'none', 0.08, { strokeWidth: fine })}
          {[-0.2, 0.15].map(f => <line key={f} x1={-hw + i * 2} y1={d * f} x2={hw - i * 2} y2={d * f + d * 0.05} {...thin} strokeOpacity={0.4} />)}
        </g>
      );
    }
    case 'dining': {
      const cd = Math.min(1.6, d * 0.28);
      const td = Math.max(1, d - 2 * cd * 0.7);
      const n = Math.max(1, Math.floor(w / 2.2));
      const cs = Math.min(1.5, (w / n) * 0.72, cd);
      const chair = (x: number, side: 1 | -1, key: string) => {
        const y = side * (hd - cs / 2);
        return (
          <g key={key}>
            {box(x - cs / 2, y - cs / 2, cs, cs, shade(color, 0.7), 0.15, { strokeWidth: fine })}
            {box(x - cs / 2, side > 0 ? y + cs / 2 - 0.2 : y - cs / 2, cs, 0.2, shade(color, 0.2), 0.08, { strokeWidth: fine })}
          </g>
        );
      };
      return (
        <g>
          {evenly(n, w).flatMap((x, i) => [chair(x, -1, `a${i}`), chair(x, 1, `b${i}`)])}
          {box(-hw, -td / 2, w, td, tint, 0.15)}
          {box(-hw + 0.15, -td / 2 + 0.15, w - 0.3, td - 0.3, 'none', 0.08, { strokeWidth: fine })}
        </g>
      );
    }
    case 'tv': {
      const n = Math.max(1, Math.round(w / 2));
      return (
        <g>
          {box(-hw, -hd, w, d, tint, 0.08)}
          {evenly(n, w).slice(1).map((x, i) => <line key={i} x1={x - w / n / 2} y1={-hd + d * 0.45} x2={x - w / n / 2} y2={hd} {...thin} />)}
          {box(-w * 0.42, -hd + 0.15, w * 0.84, Math.min(0.25, d * 0.2), '#2b2f36', 0.05)}
        </g>
      );
    }
    case 'wardrobe': {
      const n = Math.max(1, Math.round(w / 1.8));
      const hangers = Math.max(2, Math.round(w / 0.5));
      return (
        <g>
          {box(-hw, -hd, w, d, tint, 0.06)}
          <line x1={-hw + 0.2} y1={0} x2={hw - 0.2} y2={0} {...thin} strokeDasharray={`${fine * 6} ${fine * 3}`} />
          {evenly(hangers, w - 0.6).map((x, i) => <line key={i} x1={x} y1={-d * 0.3} x2={x + 0.05} y2={d * 0.3} {...thin} strokeOpacity={0.45} />)}
          {evenly(n, w).slice(1).map((x, i) => <line key={`s${i}`} x1={x - w / n / 2} y1={hd - 0.12} x2={x - w / n / 2} y2={hd} {...thin} />)}
          <line x1={-hw} y1={hd - 0.12} x2={hw} y2={hd - 0.12} {...thin} />
        </g>
      );
    }
    case 'counter': {
      const sinkW = Math.min(2, w * 0.28), sinkD = d * 0.6;
      const sx = w >= 4 ? -w / 4 : 0;
      const hob = Math.min(2, w * 0.25, d * 0.75);
      return (
        <g>
          {box(-hw, -hd, w, d, tint, 0.05)}
          {box(sx - sinkW / 2, -sinkD / 2 + 0.1, sinkW, sinkD, '#e8ecef', 0.2, { strokeWidth: fine })}
          <circle cx={sx} cy={0.1} r={Math.min(0.08, sinkD * 0.1)} fill={LINE} />
          <circle cx={sx} cy={-sinkD / 2 - 0.05} r={Math.min(0.12, d * 0.06)} fill="none" {...thin} />
          {w >= 4 && (
            <g>
              {box(w / 4 - hob / 2, -hob / 2, hob, hob, '#2b2f36', 0.08, { strokeWidth: fine })}
              {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => (
                <circle key={`${a}${b}`} cx={w / 4 + (a * hob) / 4} cy={(b * hob) / 4} r={hob * 0.15} fill="none" stroke="#9aa1a8" strokeWidth={fine} />
              ))}
            </g>
          )}
        </g>
      );
    }
    case 'toilet': {
      const tank = d * 0.3;
      const cy = -hd + tank + (d - tank) * 0.48;
      return (
        <g>
          {box(-hw, -hd, w, tank, WHITE, 0.1)}
          <ellipse cx={0} cy={cy} rx={w * 0.43} ry={(d - tank) * 0.5} fill={WHITE} {...base} />
          <ellipse cx={0} cy={cy + (d - tank) * 0.04} rx={w * 0.28} ry={(d - tank) * 0.33} fill="#eef2f4" {...thin} />
        </g>
      );
    }
    case 'bench': {
      const n = 4;
      return (
        <g>
          {box(-hw, -hd, w, d, tint, 0.08)}
          {evenly(n, d).slice(1).map((y, i) => <line key={i} x1={-hw} y1={y - d / n / 2} x2={hw} y2={y - d / n / 2} {...thin} />)}
        </g>
      );
    }
    case 'plant': {
      const r = Math.min(w, d) / 2;
      return (
        <g>
          {Array.from({ length: 7 }, (_, i) => {
            const a = (i / 7) * Math.PI * 2;
            return <ellipse key={i} cx={Math.cos(a) * r * 0.45} cy={Math.sin(a) * r * 0.45} rx={r * 0.5} ry={r * 0.22}
              transform={`rotate(${(a * 180) / Math.PI} ${Math.cos(a) * r * 0.45} ${Math.sin(a) * r * 0.45})`} fill={shade(color, 0.25)} {...base} strokeWidth={fine} />;
          })}
          <circle r={r * 0.35} fill="#c98a5c" {...base} strokeWidth={fine} />
        </g>
      );
    }
    case 'tree': {
      const lobes = 9;
      const pts = Array.from({ length: lobes }, (_, i) => (i / lobes) * Math.PI * 2);
      const path = pts.map((a, i) => {
        const b = pts[(i + 1) % lobes];
        const p = (t: number) => `${(Math.cos(t) * w * 0.43).toFixed(3)} ${(Math.sin(t) * d * 0.43).toFixed(3)}`;
        return `${i === 0 ? `M ${p(a)}` : ''} A ${w * 0.12} ${d * 0.12} 0 0 1 ${p(b)}`;
      }).join(' ');
      return (
        <g>
          <path d={`${path} Z`} fill={shade(color, 0.3)} fillOpacity={0.85} {...base} />
          <circle r={Math.min(w, d) * 0.28} fill="none" {...thin} strokeOpacity={0.5} />
          <circle r={Math.min(w, d) * 0.06} fill="#6b4a32" />
        </g>
      );
    }
    case 'car': {
      const r = Math.min(w * 0.3, d * 0.12);
      const cw = w * 0.8;
      return (
        <g>
          {box(-hw, -hd, w, d, shade(color, 0.35), r)}
          {box(-cw / 2, -hd + d * 0.3, cw, d * 0.45, shade(color, 0.15), r * 0.6, { strokeWidth: fine })}
          <path d={`M ${-cw / 2} ${-hd + d * 0.3} L ${-w * 0.36} ${-hd + d * 0.22} L ${w * 0.36} ${-hd + d * 0.22} L ${cw / 2} ${-hd + d * 0.3} Z`} fill="#c7d3de" {...thin} />
          <path d={`M ${-cw / 2} ${-hd + d * 0.75} L ${-w * 0.36} ${-hd + d * 0.8} L ${w * 0.36} ${-hd + d * 0.8} L ${cw / 2} ${-hd + d * 0.75} Z`} fill="#c7d3de" {...thin} />
          {/* side mirrors */}
          {[-hw - 0.35, hw].map(x => <g key={x}>{box(x, -hd + d * 0.29, 0.35, 0.2, shade(color, 0.1), 0.05, { strokeWidth: fine })}</g>)}
        </g>
      );
    }
    default:
      return box(-hw, -hd, w, d, tint, Math.min(w, d) * 0.08);
  }
}
