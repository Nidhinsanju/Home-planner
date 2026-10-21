'use client';

import React, { useEffect, useState } from 'react';
import {
  AppWindow, Armchair, ChevronLeft, DoorOpen, FlipHorizontal2, Hammer, LayoutDashboard, MousePointer2, PenLine,
  Image as ImageIcon, Lock, Move, RotateCw, Ruler, Scissors, Square, Trash2, Upload,
  Search, Eye, MoreVertical, Plus
} from 'lucide-react';
import { ITEM_CATALOG, itemSize, itemSpec, MIN_ITEM_SIZE, Plan, ROOM_TYPES, roomType, getRoomColor } from '../plan/types';
import { roomInterior, type Room } from '../plan/rooms';
import * as ops from '../plan/ops';
import { lerp } from '../plan/geometry';
import { DisplayUnit, formatArea, formatLength, fromDisplay, round2, toDisplay } from '../units';
import type { Selection, Tool } from './Editor2D';
import { FurnitureSymbol } from './FurnitureSymbol';
import { loadBackgroundImage } from './backgroundImage';

interface Props {
  plan: Plan;
  rooms: Room[];
  spaces: Room[]; // every enclosed area, rooms included
  unit: DisplayUnit;
  tool: Tool;
  setTool: (t: Tool) => void;
  selection: Selection;
  setSelection: (s: Selection) => void;
  onCommit: (next: Plan) => void;
  readOnly: boolean;
  activePlanIndex: 0 | 1 | 2;
  onSwitchPlan: (i: 0 | 1 | 2) => void;
  wallDims: { thickness: number; height: number };
  setWallDims: (d: { thickness: number; height: number }) => void;
  activeNav?: 'plans' | 'rooms' | 'settings' | 'templates' | 'export';
  setActiveNav?: (nav: 'plans' | 'rooms' | 'settings' | 'templates' | 'export') => void;
}

// Number input that commits on Enter/blur (one undo step per edit, no rounding fights while typing).
function NumField({ label, value, onChange, min, suffix }: { label: string; value: number; onChange: (v: number) => void; min?: number; suffix?: string }) {
  const [text, setText] = useState(String(round2(value)));
  useEffect(() => setText(String(round2(value))), [value]);
  const commit = () => {
    const n = parseFloat(text);
    if (Number.isFinite(n) && (min === undefined || n >= min) && round2(n) !== round2(value)) onChange(n);
    else setText(String(round2(value)));
  };
  return (
    <div className="prop-group">
      <label>{label}{suffix ? ` (${suffix})` : ''}</label>
      <input type="number" value={text} onChange={e => setText(e.target.value)} onBlur={commit} onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
    </div>
  );
}

// A length field: value in feet, shown and edited in the display unit.
function LenField({ label, value, unit, onChange, min = 0 }: { label: string; value: number; unit: DisplayUnit; onChange: (ft: number) => void; min?: number }) {
  return <NumField label={label} suffix={unit === 'mt' ? 'm' : 'ft'} value={toDisplay(value, unit)} min={min} onChange={v => onChange(fromDisplay(v, unit))} />;
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <div className="prop-group">
      <label>{label}</label>
      <input type="text" value={text} onChange={e => setText(e.target.value)} onBlur={() => text !== value && onChange(text)}
        onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
    </div>
  );
}

// The item's plan symbol, scaled to fit a small square.
function ItemThumb({ type, w, d, color }: { type: string; w: number; d: number; color: string }) {
  const s = Math.max(w, d) * 1.15;
  return (
    <svg className="item-thumb" viewBox={`${-s / 2} ${-s / 2} ${s} ${s}`} aria-hidden>
      <FurnitureSymbol type={type} w={w} d={d} color={color} sw={s / 40} />
    </svg>
  );
}

const ToolButton = ({ active, onClick, icon, label, shortcut, disabled }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; shortcut?: string; disabled?: boolean }) => (
  <button className={`tool-btn ${active ? 'active' : ''}`} onClick={onClick} disabled={disabled} title={shortcut ? `${label} (${shortcut})` : label}>
    {icon}
    <span>{label}</span>
    {shortcut && <kbd>{shortcut}</kbd>}
  </button>
);

const DangerButton = ({ onClick, children }: { onClick: () => void; children: React.ReactNode }) => (
  <button className="danger-btn" onClick={onClick}><Trash2 size={14} /> {children}</button>
);

export function Sidebar(props: Props) {
  const { plan, rooms, unit, tool, setTool, selection, setSelection, onCommit, readOnly, activePlanIndex, onSwitchPlan, wallDims, setWallDims, activeNav = 'plans' } = props;

  return (
    <div className="sidebar-panel-container">
      {selection ? (
        <div style={{ padding: 16 }}>
          <Inspector {...props} />
        </div>
      ) : activeNav === 'settings' ? (
        <div style={{ padding: 16 }}>
          <div className="sidebar-section">
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', marginBottom: 16 }}>Wall Settings</h3>
            <div className="grid-2">
              <LenField label="Thickness" unit={unit} value={wallDims.thickness} min={0.05} onChange={thickness => setWallDims({ ...wallDims, thickness })} />
              <LenField label="Height" unit={unit} value={wallDims.height} min={1} onChange={height => setWallDims({ ...wallDims, height })} />
            </div>
          </div>
          <BackgroundSection plan={plan} unit={unit} tool={tool} setTool={setTool} onCommit={onCommit} />
        </div>
      ) : activeNav === 'templates' ? (
        <div style={{ padding: 16 }}>
          <QuickRoom plan={plan} unit={unit} wallDims={wallDims} onCommit={onCommit} />
        </div>
      ) : activeNav === 'export' ? (
        <div style={{ padding: 16 }}>
          <div className="sidebar-section">
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', marginBottom: 12 }}>Export & Plans</h3>
            <p className="muted">Export your floor plan layout or backup your project.</p>
            <button
              className="primary-btn"
              style={{ marginBottom: 10 }}
              onClick={() => {
                const data = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(plan, null, 2));
                const a = document.createElement('a');
                a.href = data;
                a.download = `plan-${activePlanIndex === 0 ? 'P1' : activePlanIndex === 1 ? 'P2' : 'Example'}.json`;
                a.click();
              }}
            >
              <Upload size={14} /> Download Plan JSON
            </button>
          </div>
        </div>
      ) : (
        <ProjectPanel
          plan={plan}
          rooms={rooms}
          unit={unit}
          readOnly={readOnly}
          activePlanIndex={activePlanIndex}
          onSwitchPlan={onSwitchPlan}
          setSelection={setSelection}
          selection={selection}
        />
      )}
    </div>
  );
}

// Upload a floor-plan image to trace over, set its scale, fade, move or remove it.
function BackgroundSection({ plan, unit, tool, setTool, onCommit }: { plan: Plan; unit: DisplayUnit; tool: Tool; setTool: (t: Tool) => void; onCommit: (p: Plan) => void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const bg = plan.background;

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    setBusy(true);
    try {
      const { src, aspect } = await loadBackgroundImage(file);
      const width = 50; // feet, until the user sets the scale
      onCommit(ops.setBackground(plan, { src, aspect, width, x: -width / 2, y: (-width * aspect) / 2, opacity: 0.5, locked: true }));
      setTool('calibrate');
    } catch (e: any) {
      setError(e?.message || 'Upload failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sidebar-section">
      <h3 style={{ fontSize: 14, fontWeight: 600, color: '#0f172a', marginBottom: 12 }}>
        <ImageIcon size={14} style={{ verticalAlign: -2 }} /> Reference Drawing
      </h3>
      {!bg ? (
        <>
          <label className={`primary-btn upload-btn ${busy ? 'disabled' : ''}`}>
            <Upload size={14} /> {busy ? 'Loading…' : 'Upload floor plan'}
            <input type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={busy}
              onChange={e => { upload(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          <p className="muted">Trace over an architectural drawing or scan (PNG or JPG).</p>
        </>
      ) : (
        <>
          <div className="prop-group">
            <label>Opacity ({Math.round(bg.opacity * 100)}%)</label>
            <input type="range" min={10} max={100} step={5} value={Math.round(bg.opacity * 100)}
              onChange={e => onCommit(ops.updateBackground(plan, { opacity: Number(e.target.value) / 100 }))} />
          </div>
          <p className="muted">Image width {formatLength(bg.width, unit)}</p>
          <div className="grid-2">
            <button className={`secondary-btn ${tool === 'calibrate' ? 'active' : ''}`} onClick={() => setTool(tool === 'calibrate' ? 'select' : 'calibrate')}>
              <Ruler size={14} /> Set scale
            </button>
            <button className={`secondary-btn ${!bg.locked ? 'active' : ''}`} onClick={() => { onCommit(ops.updateBackground(plan, { locked: !bg.locked })); setTool('select'); }}
              title={bg.locked ? 'Unlock, then drag empty space on the plan to move the image' : 'Lock the image in place'}>
              {bg.locked ? <><Move size={14} /> Move</> : <><Lock size={14} /> Lock</>}
            </button>
          </div>
          {!bg.locked && <p className="muted">Drag on the plan to move the image. Hold Space to pan instead.</p>}
          <DangerButton onClick={() => { onCommit(ops.setBackground(plan, undefined)); if (tool === 'calibrate') setTool('select'); }}>Remove image</DangerButton>
        </>
      )}
      {error && <p className="notice">{error}</p>}
    </div>
  );
}

function ProjectPanel({ plan, rooms, unit, readOnly, activePlanIndex, onSwitchPlan, setSelection, selection }: {
  plan: Plan; rooms: Room[]; unit: DisplayUnit; readOnly: boolean; activePlanIndex: 0 | 1 | 2; onSwitchPlan: (i: 0 | 1 | 2) => void; setSelection: (s: Selection) => void; selection?: Selection;
}) {
  const [search, setSearch] = useState('');
  // Areas inside the walls, like the sizes written on plans.
  const areas = new Map(rooms.map(r => [r.key, roomInterior(plan, r).area]));
  const total = [...areas.values()].reduce((s, a) => s + a, 0);
  const filtered = rooms.filter(r => (r.label?.name || roomType(r.label?.type)?.name || 'Unnamed room').toLowerCase().includes(search.toLowerCase()));

  return (
    <>
      <div className="sidebar-header-row">
        <h2 className="sidebar-title">Plans</h2>
        <button
          className="new-plan-btn"
          onClick={() => {
            if (activePlanIndex === 0) onSwitchPlan(1);
            else onSwitchPlan(0);
          }}
          title="Switch / Create Plan"
        >
          + New Plan
        </button>
      </div>

      <div className="plan-pills-row">
        {(['P1', 'P2', 'Example'] as const).map((label, i) => (
          <button
            key={label}
            className={`plan-pill-btn ${activePlanIndex === i ? 'active' : ''}`}
            onClick={() => onSwitchPlan(i as 0 | 1 | 2)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="rooms-header-block">
        <h3 className="rooms-header-title">Rooms ({rooms.length})</h3>
        <p className="rooms-header-sub">Room area {formatArea(total, unit)}</p>
        <div className="search-rooms-box">
          <Search size={14} color="#94a3b8" />
          <input
            type="text"
            placeholder="Search rooms..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="rooms-scroll-list">
        {filtered.map(r => (
          <div
            key={r.key}
            className={`room-list-item ${selection?.kind === 'room' && selection.id === r.id ? 'selected' : ''}`}
            onClick={() => setSelection({ kind: 'room', id: r.id })}
          >
            <span
              className="room-color-swatch"
              style={{ background: getRoomColor(r.label?.name, r.label?.type) }}
            />
            <span className="room-item-name">
              {r.label?.name || roomType(r.label?.type)?.name || 'Unnamed room'}
            </span>
            <span className="room-item-area">{formatArea(areas.get(r.key) ?? r.area, unit)}</span>
            <div className="room-item-actions">
              <button
                className="room-item-btn"
                onClick={e => { e.stopPropagation(); setSelection({ kind: 'room', id: r.id }); }}
                title="View room"
              >
                <Eye size={15} />
              </button>
              <button
                className="room-item-btn"
                onClick={e => { e.stopPropagation(); setSelection({ kind: 'room', id: r.id }); }}
                title="More options"
              >
                <MoreVertical size={15} />
              </button>
            </div>
          </div>
        ))}
        {rooms.length === 0 && (
          <p className="muted" style={{ padding: '0 8px' }}>
            No rooms yet. Use Wall or Room tool to create rooms.
          </p>
        )}
      </div>
    </>
  );
}

// Adds a rectangular room of an exact size next to what's already drawn.
function QuickRoom({ plan, unit, wallDims, onCommit }: { plan: Plan; unit: DisplayUnit; wallDims: { thickness: number; height: number }; onCommit: (p: Plan) => void }) {
  const [type, setType] = useState('bed');
  const [width, setWidth] = useState(12);
  const [depth, setDepth] = useState(10);
  const add = () => {
    let x = 0;
    let y = 0;
    if (plan.corners.length) {
      const maxX = Math.max(...plan.corners.map(c => c.x));
      const minY = Math.min(...plan.corners.map(c => c.y));
      x = maxX + (width + wallDims.thickness) / 2;
      y = minY + (depth + wallDims.thickness) / 2;
    }
    // The size typed is the inside size; walls are drawn on their centre-lines.
    onCommit(ops.addRectRoom(plan, { x, y, width: width + wallDims.thickness, depth: depth + wallDims.thickness }, wallDims, { name: roomType(type)?.name ?? 'Room', type }));
  };
  return (
    <div className="sidebar-section">
      <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', marginBottom: 12 }}>Quick room</h3>
      <div className="prop-group">
        <label>Type</label>
        <select value={type} onChange={e => setType(e.target.value)}>
          {ROOM_TYPES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>
      <div className="grid-2">
        <LenField label="Width" unit={unit} value={width} min={2} onChange={setWidth} />
        <LenField label="Depth" unit={unit} value={depth} min={2} onChange={setDepth} />
      </div>
      <button className="primary-btn" onClick={add}>Add room</button>
      <p className="muted">Placed next to your existing rooms, sharing walls. Drag its walls to adjust.</p>
    </div>
  );
}

function Inspector({ plan, rooms, spaces, unit, selection, setSelection, onCommit, readOnly }: Props) {
  if (!selection) return null;
  const back = (
    <button className="back-btn" onClick={() => setSelection(null)}>
      <ChevronLeft size={16} /> Back to Rooms
    </button>
  );
  const ro = readOnly ? <p className="notice">Read-only example.</p> : null;

  if (selection.kind === 'room') {
    const room = rooms.find(r => r.id === selection.id);
    if (!room) return <>{back}<p className="muted">Room not found.</p></>;
    const inside = roomInterior(plan, room);
    const perimeter = inside.sides.reduce((s, sd) => s + sd.length, 0);
    return (
      <div className="sidebar-section">
        {back}
        <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: '8px 0 12px 0' }}>Room Properties</h3>
        {ro}
        <fieldset disabled={readOnly} className="plain">
          <TextField label="Name" value={room.label?.name ?? ''} onChange={name => onCommit(ops.setRoomLabel(plan, room, { name }))} />
          <div className="prop-group">
            <label>Room type</label>
            <select value={room.label?.type ?? ''} onChange={e => onCommit(ops.setRoomLabel(plan, room, { type: e.target.value, ...(!room.label?.name ? { name: roomType(e.target.value)?.name ?? '' } : {}) }))}>
              <option value="">Unassigned</option>
              {ROOM_TYPES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <p className="muted">Area {formatArea(inside.area, unit)} · Perimeter {formatLength(perimeter, unit)} · {room.wallIds.length} walls</p>
          <p className="muted">Resize a room by dragging its walls or corners on the plan.</p>
          <button className="secondary-btn" onClick={() => { onCommit(ops.unmarkRoom(plan, room)); setSelection(null); }}>Keep walls, remove room</button>
          <DangerButton onClick={() => { onCommit(ops.deleteRoom(plan, room)); setSelection(null); }}>Delete room & walls</DangerButton>
        </fieldset>
      </div>
    );
  }

  if (selection.kind === 'space') {
    const space = spaces.find(s => s.id === selection.id && !s.label);
    if (!space) return <>{back}<p className="muted">This area is no longer enclosed.</p></>;
    const makeRoom = (type: string) => {
      const next = ops.setRoomLabel(plan, space, { type, name: roomType(type)?.name ?? '' });
      onCommit(next);
      const label = next.labels[next.labels.length - 1];
      setSelection({ kind: 'room', id: label.id });
    };
    return (
      <div className="sidebar-section">
        {back}
        <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: '8px 0 12px 0' }}>Enclosed space</h3>
        {ro}
        <p className="muted">These walls enclose {formatArea(space.area, unit)}, but it isn't a room yet. Rooms get a floor, a name and a type, show in 3D, and count towards built area.</p>
        <fieldset disabled={readOnly} className="plain">
          <div className="prop-group">
            <label>Make it a…</label>
            <select defaultValue="" onChange={e => e.target.value !== '' && makeRoom(e.target.value === '-' ? '' : e.target.value)}>
              <option value="" disabled>Choose room type</option>
              {ROOM_TYPES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              <option value="-">Room (no type yet)</option>
            </select>
          </div>
          <button className="primary-btn" onClick={() => makeRoom('')}>Make this a room</button>
        </fieldset>
      </div>
    );
  }

  if (selection.kind === 'wall') {
    const wall = plan.walls.find(w => w.id === selection.id);
    if (!wall) return <>{back}<p className="muted">Wall not found.</p></>;
    const { a, b } = ops.wallEnds(plan, wall);
    const mid = lerp(a, b, 0.5);
    return (
      <div className="sidebar-section">
        {back}
        <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: '8px 0 12px 0' }}>Wall Properties</h3>
        {ro}
        <fieldset disabled={readOnly} className="plain">
          <LenField label="Length" unit={unit} value={ops.wallLength(plan, wall)} min={0.5} onChange={L => onCommit(ops.setWallLength(plan, wall.id, L))} />
          <div className="grid-2">
            <LenField label="Thickness" unit={unit} value={wall.thickness} min={0.05} onChange={thickness => onCommit(ops.updateWall(plan, wall.id, { thickness }))} />
            <LenField label="Height" unit={unit} value={wall.height} min={1} onChange={height => onCommit(ops.updateWall(plan, wall.id, { height }))} />
          </div>
          <div className="btn-row">
            <button className="secondary-btn" onClick={() => { const r = ops.splitWall(plan, wall.id, mid); onCommit(r.plan); setSelection({ kind: 'corner', id: r.cornerId }); }}><Scissors size={14} /> Split</button>
            <button className="secondary-btn" onClick={() => onCommit(ops.addOpening(plan, wall.id, mid, 'door'))}><DoorOpen size={14} /> Door</button>
            <button className="secondary-btn" onClick={() => onCommit(ops.addOpening(plan, wall.id, mid, 'window'))}><AppWindow size={14} /> Window</button>
          </div>
          <label className="check-row">
            <input type="checkbox" checked={!!wall.divider} onChange={e => onCommit(ops.updateWall(plan, wall.id, { divider: e.target.checked }))} />
            Room divider (splits an open area into rooms; not built in 3D, no doors or windows)
          </label>
          <p className="muted">Drag the wall on the plan to move it; connected walls follow. Split it to make an alcove.</p>
          <DangerButton onClick={() => { onCommit(ops.deleteWalls(plan, [wall.id])); setSelection(null); }}>Delete wall</DangerButton>
        </fieldset>
      </div>
    );
  }

  if (selection.kind === 'corner') {
    const corner = ops.cornerOf(plan, selection.id);
    if (!corner) return <>{back}<p className="muted">Corner not found.</p></>;
    const attached = plan.walls.filter(w => w.a === corner.id || w.b === corner.id);
    const move = (p: { x: number; y: number }) => onCommit(ops.settleCorner(ops.moveCorner(plan, corner.id, p), corner.id));
    return (
      <div className="sidebar-section">
        {back}
        <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: '8px 0 12px 0' }}>Corner Properties</h3>
        {ro}
        <fieldset disabled={readOnly} className="plain">
          <div className="grid-2">
            <LenField label="X" unit={unit} value={corner.x} min={-1e6} onChange={x => move({ x, y: corner.y })} />
            <LenField label="Y" unit={unit} value={corner.y} min={-1e6} onChange={y => move({ x: corner.x, y })} />
          </div>
          <p className="muted">Joins {attached.length} wall{attached.length === 1 ? '' : 's'}. Drag it on the plan to reshape rooms.</p>
          <DangerButton onClick={() => { onCommit(ops.deleteWalls(plan, attached.map(w => w.id))); setSelection(null); }}>Delete corner & its walls</DangerButton>
        </fieldset>
      </div>
    );
  }

  if (selection.kind === 'opening') {
    const o = plan.openings.find(x => x.id === selection.id);
    const wall = o && plan.walls.find(w => w.id === o.wallId);
    if (!o || !wall) return <>{back}<p className="muted">Not found.</p></>;
    const L = ops.wallLength(plan, wall);
    const set = (data: Partial<typeof o>) => onCommit(ops.updateOpening(plan, o.id, data));
    return (
      <div className="sidebar-section">
        {back}
        <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: '8px 0 12px 0' }}>{o.kind === 'door' ? 'Door' : 'Window'}</h3>
        {ro}
        <fieldset disabled={readOnly} className="plain">
          <div className="grid-2">
            <LenField label="Width" unit={unit} value={o.width} min={0.5} onChange={width => set({ width })} />
            <LenField label="Height" unit={unit} value={o.height} min={0.5} onChange={height => set({ height })} />
          </div>
          {o.kind === 'window' && <LenField label="Sill height" unit={unit} value={o.sill} onChange={sill => set({ sill })} />}
          <LenField label="Distance from wall start" unit={unit} value={o.t * L - o.width / 2} onChange={d => set({ t: (d + o.width / 2) / L })} />
          {o.kind === 'door' && (
            <button className="secondary-btn" onClick={() => set({ flip: !o.flip })}><FlipHorizontal2 size={14} /> Flip swing</button>
          )}
          <p className="muted">Drag it along the wall on the plan to reposition.</p>
          <DangerButton onClick={() => { onCommit(ops.deleteOpening(plan, o.id)); setSelection(null); }}>Delete {o.kind}</DangerButton>
        </fieldset>
      </div>
    );
  }

  const item = plan.items.find(i => i.id === selection.id);
  if (!item) return <>{back}<p className="muted">Item not found.</p></>;
  const spec = itemSpec(item.type);
  const deg = Math.round(((item.rotation * 180) / Math.PI) % 360);
  const size = itemSize(item);
  const resized = item.w != null || item.d != null || item.h != null;
  return (
    <div className="sidebar-section">
      {back}
      <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: '8px 0 12px 0' }}>{spec?.name ?? item.type}</h3>
      {ro}
      <fieldset disabled={readOnly} className="plain">
        <div className="grid-3">
          <LenField label="Width" unit={unit} value={size.w} min={MIN_ITEM_SIZE} onChange={w => onCommit(ops.resizeItem(plan, item.id, { w }))} />
          <LenField label="Depth" unit={unit} value={size.d} min={MIN_ITEM_SIZE} onChange={d => onCommit(ops.resizeItem(plan, item.id, { d }))} />
          <LenField label="Height" unit={unit} value={size.h} min={MIN_ITEM_SIZE} onChange={h => onCommit(ops.resizeItem(plan, item.id, { h }))} />
        </div>
        {resized && spec && (
          <button className="secondary-btn" onClick={() => onCommit(ops.resizeItem(plan, item.id, { w: null, d: null, h: null }))}>
            Reset to default size ({formatLength(spec.w, unit)} × {formatLength(spec.d, unit)})
          </button>
        )}
        <p className="muted">Drag the handles on the plan to resize. Hold Shift on a corner to keep proportions.</p>
        <div className="grid-2">
          <LenField label="X" unit={unit} value={item.x} min={-1e6} onChange={x => onCommit(ops.updateItem(plan, item.id, { x }))} />
          <LenField label="Y" unit={unit} value={item.y} min={-1e6} onChange={y => onCommit(ops.updateItem(plan, item.id, { y }))} />
        </div>
        <NumField label="Rotation" suffix="°" value={deg} min={-3600} onChange={v => onCommit(ops.updateItem(plan, item.id, { rotation: (v * Math.PI) / 180 }))} />
        <button className="secondary-btn" onClick={() => onCommit(ops.updateItem(plan, item.id, { rotation: item.rotation + Math.PI / 2 }))}><RotateCw size={14} /> Rotate 90°</button>
        <DangerButton onClick={() => { onCommit(ops.deleteItem(plan, item.id)); setSelection(null); }}>Delete</DangerButton>
      </fieldset>
    </div>
  );
}
