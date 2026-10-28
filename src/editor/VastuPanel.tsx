'use client';

import React from 'react';
import { Compass as CompassIcon, CheckCircle2, AlertTriangle, XCircle, MinusCircle, Sparkles, Wand2 } from 'lucide-react';
import { Plan, ROOM_TYPES } from '../plan/types';
import type { Room } from '../plan/rooms';
import * as ops from '../plan/ops';
import { swapRoomUse, ZONE_NAMES, type Status, type VastuReport } from '../plan/vastu';

// The Vastu tab: the plan's score and why, where north is, a one-click fix where a room's use
// can be swapped, a remedy where it can't, and the rooms as read (to correct a wrong type before
// trusting the report). The zones are drawn on the plan while this tab is open.

interface Props {
  plan: Plan;
  rooms: Room[];
  report: VastuReport | null;
  onCommit: (next: Plan) => void;
  readOnly: boolean;
  // Asks the AI to fix the plan's Vastu; resolves with the lines to show (what changed and why).
  onFixWithAI?: () => Promise<string[]>;
}

const DIRECTIONS: { label: string; deg: number; arrow: string }[] = [
  { label: 'Up', deg: 0, arrow: '↑' }, { label: 'Up-right', deg: 45, arrow: '↗' }, { label: 'Right', deg: 90, arrow: '→' }, { label: 'Down-right', deg: 135, arrow: '↘' },
  { label: 'Down', deg: 180, arrow: '↓' }, { label: 'Down-left', deg: 225, arrow: '↙' }, { label: 'Left', deg: 270, arrow: '←' }, { label: 'Up-left', deg: 315, arrow: '↖' },
];

const STATUS: Record<Status, { color: string; label: string; Icon: typeof CheckCircle2 }> = {
  good: { color: '#16a34a', label: 'Good', Icon: CheckCircle2 },
  ok: { color: '#65a30d', label: 'Acceptable', Icon: MinusCircle },
  fair: { color: '#d97706', label: 'Could be better', Icon: AlertTriangle },
  bad: { color: '#dc2626', label: 'Against Vastu', Icon: XCircle },
};

function ScoreRing({ score }: { score: number }) {
  const color = score >= 75 ? '#16a34a' : score >= 50 ? '#d97706' : '#dc2626';
  const verdict = score >= 75 ? 'Well aligned' : score >= 50 ? 'Needs some work' : 'Needs attention';
  const r = 34, c = 2 * Math.PI * r;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
      <svg width="84" height="84" viewBox="0 0 84 84" role="img" aria-label={`Vastu score ${score} out of 100`}>
        <circle cx="42" cy="42" r={r} fill="none" stroke="#e2e8f0" strokeWidth="8" />
        <circle cx="42" cy="42" r={r} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
          strokeDasharray={`${(c * score) / 100} ${c}`} transform="rotate(-90 42 42)" />
        <text x="42" y="47" textAnchor="middle" fontSize="20" fontWeight="700" fill="#0f172a">{score}</text>
      </svg>
      <div>
        <div style={{ fontSize: 15, fontWeight: 700, color }}>{verdict}</div>
        <div className="muted" style={{ fontSize: 12 }}>Vastu score out of 100</div>
      </div>
    </div>
  );
}

export function VastuPanel({ plan, rooms, report, onCommit, readOnly,  onFixWithAI }: Props) {
  const north = plan.northDeg ?? 0;
  const [fixing, setFixing] = React.useState(false);
  const [fixResult, setFixResult] = React.useState<string[]>([]);
  const fixWithAI = async () => {
    if (!onFixWithAI) return;
    setFixing(true);
    setFixResult([]);
    try {
      setFixResult(await onFixWithAI());
    } finally {
      setFixing(false);
    }
  };
  const setNorth = (deg: number) => onCommit({ ...plan, northDeg: ((Math.round(deg) % 360) + 360) % 360 });

  if (!report) {
    return (
      <div className="sidebar-section">
        <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>Vastu Report</h3>
        <p className="muted">Build or draw your rooms first (upload a floor plan in the chat, or use Quick Room), then come back for the Vastu score.</p>
      </div>
    );
  }
  const issues = report.checks.filter(c => c.status === 'bad' || c.status === 'fair');
  const fine = report.checks.filter(c => c.status === 'good' || c.status === 'ok');
  const roomByLabel = (id: string) => rooms.find(r => r.label?.id === id);

  const item = (c: (typeof report.checks)[number]) => {
    const st = STATUS[c.status];
    return (
      <div key={c.id} style={{ borderLeft: `3px solid ${st.color}`, padding: '6px 8px', marginBottom: 8, background: '#f8fafc', borderRadius: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <st.Icon size={14} color={st.color} />
          <strong style={{ fontSize: 13, color: '#0f172a' }}>{c.title}</strong>
          {c.zone && <span style={{ marginLeft: 'auto', fontSize: 11, color: '#475569' }}>{c.zone === 'C' ? 'Centre' : ZONE_NAMES[c.zone]}</span>}
        </div>
        <p style={{ fontSize: 12, color: '#334155', margin: '4px 0 0' }}>{c.reason}</p>
        {c.tip && <p style={{ fontSize: 12, color: '#64748b', margin: '4px 0 0' }}>{c.tip}</p>}
        {c.fix && !readOnly && (
          <button className="secondary-btn" style={{ marginTop: 6, fontSize: 12 }}
            onClick={() => onCommit(swapRoomUse(plan, c.fix!.swap[0], c.fix!.swap[1]))}
            title="Swaps the two rooms' names and types. Undo brings them back.">
            <Wand2 size={13} /> {c.fix.text} (+{c.fix.gain})
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="sidebar-section">
      <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', marginBottom: 10 }}>Vastu Report</h3>
      <ScoreRing score={report.score} />
      {report.entrance && <p className="muted" style={{ marginTop: -4 }}>Main entrance faces {ZONE_NAMES[report.entrance.facing]}.</p>}

      <div className="prop-group" style={{ marginTop: 10 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}><CompassIcon size={14} /> Where is North on your plan?</label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, margin: '6px 0' }}>
          {DIRECTIONS.map(d => (
            <button key={d.deg} disabled={readOnly} onClick={() => setNorth(d.deg)} title={`North points ${d.label.toLowerCase()} on the plan`}
              className={north === d.deg ? 'primary-btn' : 'secondary-btn'} style={{ padding: '4px 0', fontSize: 14 }}>{d.arrow}</button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="range" min={0} max={359} value={north} disabled={readOnly} onChange={e => setNorth(Number(e.target.value))} style={{ flex: 1 }} aria-label="North direction in degrees" />
          <span style={{ fontSize: 12, width: 36, textAlign: 'right' }}>{north}°</span>
        </div>
        <p className="muted" style={{ fontSize: 11 }}>Use the north arrow on your drawing. The compass and the zones on the plan turn with it.</p>
      </div>

      {report.untyped.length > 0 && (
        <p className="notice">These rooms have no type, so they aren't checked: {report.untyped.join(', ')}. Set their type below.</p>
      )}

      {onFixWithAI && !readOnly && (
        <button className="primary-btn" style={{ marginBottom: 12 }} disabled={fixing || report.checks.every(c => c.status === 'good')} onClick={fixWithAI}
          title="The AI proposes changes; they are only applied if the Vastu score really goes up. Undo brings the plan back.">
          <Wand2 size={14} /> {fixing ? 'Fixing… (this can take a minute)' : 'Fix with AI'}
        </button>
      )}
      {fixResult.length > 0 && (
        <div style={{ background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 6, padding: 8, marginBottom: 12 }}>
          {fixResult.map((line, i) => <p key={i} style={{ fontSize: 12, margin: i ? '4px 0 0' : 0, color: '#3b0764', fontWeight: i ? 400 : 600 }}>{line}</p>)}
        </div>
      )}

      {issues.length > 0 && <h4 style={{ fontSize: 13, margin: '8px 0 6px', color: '#0f172a' }}>To improve ({issues.length})</h4>}
      {issues.map(item)}
      {fine.length > 0 && <h4 style={{ fontSize: 13, margin: '12px 0 6px', color: '#0f172a' }}>Already right ({fine.length})</h4>}
      {fine.map(item)}

      <h4 style={{ fontSize: 13, margin: '14px 0 4px', color: '#0f172a' }}>Check your rooms</h4>
      <p className="muted" style={{ fontSize: 11, marginBottom: 6 }}>The report is only as good as the room types. Correct any that were read wrong.</p>
      {report.rooms.map(r => {
        const room = roomByLabel(r.id);
        return (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, fontSize: 12 }}>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.name}>{r.name}</span>
            <span style={{ color: '#64748b', width: 28 }}>{r.zone}</span>
            <select value={r.type} disabled={readOnly || !room} style={{ width: 110, fontSize: 12 }}
              onChange={e => room && onCommit(ops.setRoomLabel(plan, room, { type: e.target.value }))} aria-label={`Type of ${r.name}`}>
              <option value="">No type</option>
              {ROOM_TYPES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        );
      })}
      <p className="muted" style={{ fontSize: 11, marginTop: 10 }}>Based on commonly followed Vastu Shastra guidelines. For major decisions, consult a Vastu expert.</p>
    </div>
  );
}
