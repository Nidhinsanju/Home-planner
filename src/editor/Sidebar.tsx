'use client';

import React, { useEffect, useState } from 'react';
import {
  AppWindow, Armchair, ChevronLeft, DoorOpen, FlipHorizontal2, Hammer, LayoutDashboard, MousePointer2, PenLine,
  Image as ImageIcon, Lock, Move, RotateCw, Ruler, Scissors, Square, Trash2, Upload,
} from 'lucide-react';
import { ITEM_CATALOG, itemSize, itemSpec, MIN_ITEM_SIZE, Plan, ROOM_TYPES, roomType } from '../plan/types';
import type { Room } from '../plan/rooms';
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
  const { plan, rooms, unit, tool, setTool, selection, setSelection, onCommit, readOnly, activePlanIndex, onSwitchPlan, wallDims, setWallDims } = props;
  const [tab, setTab] = useState<'project' | 'build' | 'furniture'>('build');

  return (
    <div className="sidebar-container">
      <div className="sidebar-icons">
        <button className={`sidebar-icon-btn ${tab === 'project' && !selection ? 'active' : ''}`} onClick={() => { setTab('project'); setSelection(null); }} title="Project & Plans"><LayoutDashboard size={20} /></button>
        <button className={`sidebar-icon-btn ${tab === 'build' && !selection ? 'active' : ''}`} onClick={() => { setTab('build'); setSelection(null); }} title="Build"><Hammer size={20} /></button>
        <button className={`sidebar-icon-btn ${tab === 'furniture' && !selection ? 'active' : ''}`} onClick={() => { setTab('furniture'); setSelection(null); }} title="Furniture"><Armchair size={20} /></button>
      </div>

      <div className="sidebar-panel">
        {selection ? (
          <Inspector {...props} />
        ) : tab === 'project' ? (
          <ProjectPanel rooms={rooms} unit={unit} readOnly={readOnly} activePlanIndex={activePlanIndex} onSwitchPlan={onSwitchPlan} setSelection={setSelection} />
        ) : tab === 'build' ? (
          <>
            <div className="sidebar-section">
              <h3>Tools</h3>
              <div className="tool-grid">
                <ToolButton active={tool === 'select'} onClick={() => setTool('select')} icon={<MousePointer2 size={18} />} label="Select" shortcut="Esc" />
                <ToolButton active={tool === 'room'} onClick={() => setTool('room')} icon={<Square size={18} />} label="Draw Room" shortcut="R" disabled={readOnly} />
                <ToolButton active={tool === 'wall'} onClick={() => setTool('wall')} icon={<PenLine size={18} />} label="Draw Wall" shortcut="W" disabled={readOnly} />
                <ToolButton active={tool === 'door'} onClick={() => setTool('door')} icon={<DoorOpen size={18} />} label="Door" disabled={readOnly} />
                <ToolButton active={tool === 'window'} onClick={() => setTool('window')} icon={<AppWindow size={18} />} label="Window" disabled={readOnly} />
              </div>
            </div>
            {!readOnly && (
              <>
                <div className="sidebar-section">
                  <h3>New walls</h3>
                  <div className="grid-2">
                    <LenField label="Thickness" unit={unit} value={wallDims.thickness} min={0.05} onChange={thickness => setWallDims({ ...wallDims, thickness })} />
                    <LenField label="Height" unit={unit} value={wallDims.height} min={1} onChange={height => setWallDims({ ...wallDims, height })} />
                  </div>
                </div>
                <QuickRoom plan={plan} unit={unit} wallDims={wallDims} onCommit={onCommit} />
                <BackgroundSection plan={plan} unit={unit} tool={tool} setTool={setTool} onCommit={onCommit} />
              </>
            )}
          </>
        ) : (
          <div className="sidebar-section">
            <h3>Furniture</h3>
            {readOnly && <p className="muted">Switch to P1 or P2 to add furniture.</p>}
            {Array.from(new Set(ITEM_CATALOG.map(i => i.category))).map(cat => (
              <div key={cat} style={{ marginBottom: 12 }}>
                <div className="muted" style={{ marginBottom: 6 }}>{cat}</div>
                <div className="tool-grid">
                  {ITEM_CATALOG.filter(i => i.category === cat).map(i => (
                    <button key={i.id} className={`tool-btn ${tool === `item:${i.id}` ? 'active' : ''}`} disabled={readOnly} onClick={() => setTool(`item:${i.id}`)}>
                      <ItemThumb type={i.id} w={i.w} d={i.d} color={i.color} />
                      <span>{i.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <p className="muted">Pick an item, then click on the plan to place it. Select it and press R to rotate.</p>
          </div>
        )}
      </div>
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
      <h3><ImageIcon size={14} style={{ verticalAlign: -2 }} /> Background image</h3>
      {!bg ? (
        <>
          <label className={`secondary-btn upload-btn ${busy ? 'disabled' : ''}`}>
            <Upload size={14} /> {busy ? 'Loading…' : 'Upload floor plan'}
            <input type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={busy}
              onChange={e => { upload(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          <p className="muted">Trace over a drawing or scan (PNG or JPG). You'll set its scale by measuring one known length.</p>
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

function ProjectPanel({ rooms, unit, readOnly, activePlanIndex, onSwitchPlan, setSelection }: {
  rooms: Room[]; unit: DisplayUnit; readOnly: boolean; activePlanIndex: 0 | 1 | 2; onSwitchPlan: (i: 0 | 1 | 2) => void; setSelection: (s: Selection) => void;
}) {
  const total = rooms.reduce((s, r) => s + r.area, 0);
  return (
    <>
      <div className="sidebar-section">
        <h3>Plans</h3>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['P1', 'P2', 'Example'] as const).map((label, i) => (
            <button key={label} className={`seg-btn ${activePlanIndex === i ? 'active' : ''}`} onClick={() => onSwitchPlan(i as 0 | 1 | 2)}>{label}</button>
          ))}
        </div>
        {readOnly && <p className="notice">This example is read-only. Switch to P1 or P2 to edit.</p>}
      </div>
      <div className="sidebar-section">
        <h3>Rooms ({rooms.length})</h3>
        {rooms.length > 0 && <p className="muted">Built area {formatArea(total, unit)}</p>}
        {rooms.length === 0 && <p className="muted">No rooms yet. Use Draw Room or Quick room, or click inside closed walls and choose Make this a room.</p>}
        {rooms.map(r => (
          <button key={r.key} className="room-row" onClick={() => setSelection({ kind: 'room', id: r.id })}>
            <span className="swatch" style={{ background: roomType(r.label?.type)?.color ?? '#e9e4da' }} />
            <span style={{ flex: 1, textAlign: 'left' }}>{r.label?.name || roomType(r.label?.type)?.name || 'Unnamed room'}</span>
            <span className="muted">{formatArea(r.area, unit)}</span>
          </button>
        ))}
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
      x = maxX + width / 2;
      y = minY + depth / 2;
    }
    onCommit(ops.addRectRoom(plan, { x, y, width, depth }, wallDims, { name: roomType(type)?.name ?? 'Room', type }));
  };
  return (
    <div className="sidebar-section">
      <h3>Quick room</h3>
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
      <ChevronLeft size={16} /> Back
    </button>
  );
  const ro = readOnly ? <p className="notice">Read-only example.</p> : null;

  if (selection.kind === 'room') {
    const room = rooms.find(r => r.id === selection.id);
    if (!room) return <>{back}<p className="muted">Room not found.</p></>;
    const perimeter = room.polygon.reduce((s, p, i) => s + Math.hypot(room.polygon[(i + 1) % room.polygon.length].x - p.x, room.polygon[(i + 1) % room.polygon.length].y - p.y), 0);
    return (
      <div className="sidebar-section">
        {back}
        <h3>Room</h3>
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
          <p className="muted">Area {formatArea(room.area, unit)} · Perimeter {formatLength(perimeter, unit)} · {room.wallIds.length} walls</p>
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
    // Marking a space creates a room label; select the new room afterwards.
    const makeRoom = (type: string) => {
      const next = ops.setRoomLabel(plan, space, { type, name: roomType(type)?.name ?? '' });
      onCommit(next);
      const label = next.labels[next.labels.length - 1];
      setSelection({ kind: 'room', id: label.id });
    };
    return (
      <div className="sidebar-section">
        {back}
        <h3>Enclosed space</h3>
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
        <h3>Wall</h3>
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
        <h3>Corner</h3>
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
        <h3>{o.kind === 'door' ? 'Door' : 'Window'}</h3>
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
      <h3>{spec?.name ?? item.type}</h3>
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
