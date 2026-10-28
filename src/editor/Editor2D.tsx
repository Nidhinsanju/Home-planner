'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Item, itemSize, itemSpec, Plan, roomType, UNNAMED_ROOM_COLOR, Vec, Wall, getRoomColor } from '../plan/types';
import { FurnitureSymbol } from './FurnitureSymbol';
import { detectRooms, detectSpaces, Room, roomAt, roomInterior } from '../plan/rooms';
import * as ops from '../plan/ops';
import { add, closestOnSegment, dist, dot, sub } from '../plan/geometry';
import { DisplayUnit, formatArea, formatLength, fromDisplay, snapStep } from '../units';
import { Compass } from '../UI';
import { ZONE_NAMES, type VastuReport } from '../plan/vastu';
import {
  MousePointer2, Square, DoorOpen, AppWindow, Box, Type,
  MoveHorizontal, Trash2, Maximize2, Crosshair, Layers, Lightbulb
} from 'lucide-react';

export type Tool = 'select' | 'wall' | 'room' | 'door' | 'window' | 'calibrate' | `item:${string}`;
// 'space' is an area enclosed by walls that hasn't been made a room.
export type Selection = { kind: 'room' | 'space' | 'wall' | 'corner' | 'opening' | 'item'; id: string } | null;

interface Props {
  plan: Plan;
  spaces: Room[]; // every enclosed area; the ones with a label are rooms
  unit: DisplayUnit;
  tool: Tool;
  setTool: (t: Tool) => void;
  selection: Selection;
  setSelection: (s: Selection) => void;
  onCommit: (next: Plan) => void;
  readOnly: boolean;
  wallDims: { thickness: number; height: number };
  fitKey?: number; // changes when the whole plan was replaced: frame it again
  vastu?: VastuReport | null; // drawn as the Vastu grid over the plan (while the Vastu tab is open)
}

type Drag =
  | { mode: 'pan'; startPx: Vec; startView: View; target?: Selection }
  | { mode: 'corner' | 'wall' | 'opening' | 'item'; id: string; startPx: Vec; startWorld: Vec; moved: boolean }
  | { mode: 'resize'; id: string; sx: number; sy: number; startPx: Vec; moved: boolean }
  | { mode: 'background'; startPx: Vec; startWorld: Vec; moved: boolean }
  | { mode: 'room'; start: Vec };

// Resize handles of a selected item, in its own frame: corners and edge midpoints.
const HANDLES: [number, number][] = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];
const RESIZE_CURSORS = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'];
// Picks the resize cursor for a handle once the item's rotation is applied.
const handleCursor = (sx: number, sy: number, rotation: number) => {
  const a = Math.atan2(sy, sx) + rotation;
  return RESIZE_CURSORS[((Math.round(a / (Math.PI / 4)) % 4) + 4) % 4];
};
const itemToWorld = (item: Item, p: Vec): Vec => {
  const c = Math.cos(item.rotation), s = Math.sin(item.rotation);
  return { x: item.x + p.x * c - p.y * s, y: item.y + p.x * s + p.y * c };
};

type View = { cx: number; cy: number; scale: number }; // scale = pixels per foot

const HINTS: Record<string, string> = {
  select: 'Click to select. Drag corners, walls, doors and furniture to move them; drag a selected item\'s handles to resize (Shift keeps proportions). Drag empty space to pan, scroll to zoom.',
  wall: 'Click to start a wall, click again for each corner. Type a length + Enter for exact size. Double-click or Esc to finish. Closed walls make a space: click inside it to make it a room.',
  room: 'Drag a rectangle to draw a room. It connects to walls it touches.',
  door: 'Click on a wall to place a door.',
  window: 'Click on a wall to place a window.',
  item: 'Click to place. Press Esc to stop.',
  calibrate: 'Set scale: click both ends of something on the image whose real length you know (e.g. a wall), then type that length.',
};

export function Editor2D({ plan, spaces, unit, tool, setTool, selection, setSelection, onCommit, readOnly, wallDims, fitKey, vastu }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState<View>({ cx: 0, cy: 0, scale: 14 });
  const [draft, setDraftState] = useState<Plan | null>(null);
  // Mirrors draft synchronously: a fast release can fire pointerup before the last move re-renders.
  const draftRef = useRef<Plan | null>(null);
  const setDraft = (p: Plan | null) => { draftRef.current = p; setDraftState(p); };
  const [cursor, setCursor] = useState<Vec | null>(null);
  const [chain, setChain] = useState<Vec[]>([]); // wall tool: points placed so far
  const [typed, setTyped] = useState(''); // wall tool: typed length
  const [roomRect, setRoomRect] = useState<{ a: Vec; b: Vec } | null>(null);
  const [guides, setGuides] = useState<{ x?: number; y?: number }>({});
  const [hover, setHover] = useState<Selection>(null);
  const [showDims, setShowDims] = useState(true);
  const [calib, setCalib] = useState<Vec[]>([]); // calibrate tool: the two picked points
  const [calibLen, setCalibLen] = useState('');
  const drag = useRef<Drag | null>(null);
  const spaceDown = useRef(false);
  const altDown = useRef(false);

  const shown = draft ?? plan;
  const shownSpaces = useMemo(() => (draft ? detectSpaces(draft) : spaces), [draft, spaces]);
  const shownRooms = shownSpaces.filter(r => r.label);
  // Rooms measured inside their walls: the sizes and areas shown, like those written on plans.
  const interiors = useMemo(() => new Map(shownSpaces.filter(r => r.label).map(r => [r.key, roomInterior(shown, r)])), [shownSpaces, shown]);
  const bg = shown.background;
  const emptySpaces = shownSpaces.filter(r => !r.label);
  const px = (n: number) => n / view.scale;
  const step = snapStep(unit);

  // ---- view -----------------------------------------------------------------------------

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth || 800, h: el.clientHeight || 600 }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fitView = useCallback(() => {
    const pts: Vec[] = [...plan.corners, ...plan.items];
    const bgr = plan.background;
    if (bgr) pts.push({ x: bgr.x, y: bgr.y }, { x: bgr.x + bgr.width, y: bgr.y + bgr.width * bgr.aspect });
    if (pts.length === 0) pts.push({ x: -20, y: -15 }, { x: 20, y: 15 }); // empty plan: a 40 x 30 ft area
    const xs = pts.map(p => p.x);
    const ys = pts.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    // Never zoom in closer than a 20 ft area, so a single item doesn't fill the screen.
    const scale = Math.min(size.w / Math.max(20, maxX - minX + 10), size.h / Math.max(20, maxY - minY + 10));
    setView({ cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, scale: Math.max(3, Math.min(60, scale)) });
  }, [plan, size]);

  // Fit once the container has its real size, and again whenever the whole plan is replaced.
  const fitted = useRef(false);
  const lastFitKey = useRef(fitKey);
  useEffect(() => {
    if (!fitted.current && size.w !== 800) {
      fitted.current = true;
      fitView();
    } else if (fitKey !== lastFitKey.current) {
      fitView();
    }
    lastFitKey.current = fitKey;
  }, [size, fitView, fitKey]);

  const toWorld = (clientX: number, clientY: number): Vec => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const w = toWorld(e.clientX, e.clientY);
      setView(v => {
        const scale = Math.max(2, Math.min(200, v.scale * Math.exp(-e.deltaY * 0.0015)));
        return { scale, cx: w.x - ((w.x - v.cx) * v.scale) / scale, cy: w.y - ((w.y - v.cy) * v.scale) / scale };
      });
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  });

  // ---- snapping -------------------------------------------------------------------------

  const snap = (p: Vec, opts: { from?: Vec; exclude?: string } = {}) => {
    const g: { x?: number; y?: number } = {};
    if (altDown.current) return { point: p, guides: g };
    const corner = shown.corners.find(c => c.id !== opts.exclude && dist(c, p) < px(10));
    if (corner) return { point: { x: corner.x, y: corner.y }, cornerId: corner.id, guides: g };
    for (const w of shown.walls) {
      if (opts.exclude && (w.a === opts.exclude || w.b === opts.exclude)) continue;
      const { a, b } = ops.wallEnds(shown, w);
      const hit = closestOnSegment(p, a, b);
      if (hit.distance < px(8)) return { point: hit.point, wallId: w.id, guides: g };
    }
    const q = { x: Math.round(p.x / step) * step, y: Math.round(p.y / step) * step };
    const refs = opts.from ? [opts.from, ...shown.corners] : shown.corners;
    for (const r of refs) {
      if (g.x === undefined && Math.abs(q.x - r.x) < px(8)) { q.x = r.x; g.x = r.x; }
      if (g.y === undefined && Math.abs(q.y - r.y) < px(8)) { q.y = r.y; g.y = r.y; }
    }
    return { point: q, guides: g };
  };

  const wallUnder = (p: Vec) => {
    let best: { wall: Wall; point: Vec; d: number } | null = null;
    for (const w of shown.walls) {
      const { a, b } = ops.wallEnds(shown, w);
      const hit = closestOnSegment(p, a, b);
      if (hit.distance < Math.max(w.thickness, px(14)) && (!best || hit.distance < best.d)) best = { wall: w, point: hit.point, d: hit.distance };
    }
    return best;
  };

  // ---- wall tool helpers ----------------------------------------------------------------

  const placeWallPoint = (p: Vec, closesChain: boolean) => {
    const last = chain[chain.length - 1];
    if (!last) {
      setChain([p]);
      return;
    }
    if (dist(last, p) < 0.05) {
      setChain([]); // double click on the same point finishes
      return;
    }
    onCommit(ops.addWall(plan, last, p, wallDims).plan);
    setChain(closesChain ? [] : [...chain, p]);
    setTyped('');
  };

  const finishTool = useCallback(() => {
    setChain([]);
    setTyped('');
    setRoomRect(null);
    setCalib([]);
    setCalibLen('');
    setDraft(null);
    drag.current = null;
  }, []);

  const applyCalibration = () => {
    const L = fromDisplay(parseFloat(calibLen), unit);
    if (calib.length !== 2 || !(L > 0)) return;
    onCommit(ops.calibrateBackground(plan, calib[0], calib[1], L));
    setTool('select');
  };

  useEffect(() => finishTool(), [tool, finishTool]);

  // ---- keyboard -------------------------------------------------------------------------

  useEffect(() => {
    const isField = (t: EventTarget | null) => t instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Alt') altDown.current = true;
      if (isField(e.target)) return;
      if (e.key === ' ') { spaceDown.current = true; e.preventDefault(); }
      if (e.ctrlKey || e.metaKey) return;

      if (tool === 'wall' && chain.length > 0) {
        if (/^[0-9.]$/.test(e.key)) { setTyped(t => t + e.key); return; }
        if (e.key === 'Backspace') { setTyped(t => t.slice(0, -1)); e.preventDefault(); return; }
        if (e.key === 'Enter' && typed && cursor) {
          const L = fromDisplay(parseFloat(typed), unit);
          const last = chain[chain.length - 1];
          const d = sub(cursor, last);
          const l = Math.hypot(d.x, d.y);
          if (L > 0 && l > 0) placeWallPoint({ x: last.x + (d.x / l) * L, y: last.y + (d.y / l) * L }, false);
          return;
        }
      }
      if (e.key === 'Escape') {
        if (chain.length || roomRect) finishTool();
        else if (tool !== 'select') setTool('select');
        else setSelection(null);
        return;
      }
      if (readOnly) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selection) {
        e.preventDefault();
        deleteSelection();
        return;
      }
      if (selection?.kind === 'item' && (e.key === 'r' || e.key === 'R')) {
        const item = plan.items.find(i => i.id === selection.id);
        if (item) onCommit(ops.updateItem(plan, item.id, { rotation: item.rotation + (Math.PI / 12) * (e.shiftKey ? -1 : 1) }));
        return;
      }
      if (selection?.kind === 'item' && e.key.startsWith('Arrow')) {
        e.preventDefault();
        const item = plan.items.find(i => i.id === selection.id);
        const d = { ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 }, ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step } }[e.key];
        if (item && d) onCommit(ops.updateItem(plan, item.id, add(item, d)));
        return;
      }
      if (e.key === 'w' || e.key === 'W') setTool('wall');
      else if (e.key === 'r' || e.key === 'R') setTool('room');
      else if (e.key === '.') fitView();
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === ' ') spaceDown.current = false;
      if (e.key === 'Alt') altDown.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  });

  const deleteSelection = () => {
    if (!selection) return;
    const { kind, id } = selection;
    if (kind === 'wall') onCommit(ops.deleteWalls(plan, [id]));
    else if (kind === 'opening') onCommit(ops.deleteOpening(plan, id));
    else if (kind === 'item') onCommit(ops.deleteItem(plan, id));
    else if (kind === 'corner') onCommit(ops.deleteWalls(plan, plan.walls.filter(w => w.a === id || w.b === id).map(w => w.id)));
    else if (kind === 'room') {
      const room = spaces.find(r => r.id === id && r.label);
      if (room) onCommit(ops.deleteRoom(plan, room));
    }
    setSelection(null);
  };

  // ---- pointer --------------------------------------------------------------------------

  const targetOf = (e: React.PointerEvent): Selection => {
    const el = (e.target as Element).closest('[data-kind]');
    if (!el) return null;
    return { kind: el.getAttribute('data-kind') as any, id: el.getAttribute('data-id')! };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const world = toWorld(e.clientX, e.clientY);
    const startPx = { x: e.clientX, y: e.clientY };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    if (e.button === 1 || (e.button === 0 && spaceDown.current)) {
      drag.current = { mode: 'pan', startPx, startView: view };
      return;
    }
    if (e.button !== 0) return;

    if (!readOnly && tool === 'wall') {
      const s = snap(world, { from: chain[chain.length - 1] });
      const hitsExisting = chain.length > 0 && (!!s.cornerId || !!s.wallId);
      placeWallPoint(s.point, hitsExisting);
      return;
    }
    if (!readOnly && tool === 'room') {
      drag.current = { mode: 'room', start: snap(world).point };
      return;
    }
    if (!readOnly && tool === 'calibrate') {
      // Points are picked on the image itself, so no snapping to the plan.
      setCalib(c => (c.length >= 2 ? [world] : [...c, world]));
      return;
    }
    if (!readOnly && (tool === 'door' || tool === 'window')) {
      const hit = wallUnder(world);
      if (hit) onCommit(ops.addOpening(plan, hit.wall.id, hit.point, tool));
      return;
    }
    if (!readOnly && tool.startsWith('item:')) {
      const type = tool.slice(5);
      const next = ops.addItem(plan, type, snap(world).point);
      onCommit(next);
      setSelection({ kind: 'item', id: next.items[next.items.length - 1].id });
      setTool('select');
      return;
    }

    const handle = (e.target as Element).closest('[data-handle]');
    if (handle && !readOnly && selection?.kind === 'item') {
      const [sx, sy] = handle.getAttribute('data-handle')!.split(',').map(Number);
      drag.current = { mode: 'resize', id: selection.id, sx, sy, startPx, moved: false };
      return;
    }

    const target = targetOf(e);
    if (target && target.kind !== 'room' && target.kind !== 'space' && !readOnly) {
      setSelection(target.kind === 'corner' ? selection : target);
      drag.current = { mode: target.kind as 'corner', id: target.id, startPx, startWorld: world, moved: false };
      return;
    }
    // An unlocked background image is moved by dragging empty space (Space + drag still pans).
    if (!readOnly && plan.background && !plan.background.locked && (!target || target.kind === 'space')) {
      drag.current = { mode: 'background', startPx, startWorld: world, moved: false };
      return;
    }
    drag.current = { mode: 'pan', startPx, startView: view, target };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const world = toWorld(e.clientX, e.clientY);
    setCursor(world);
    const d = drag.current;

    if (!d) {
      if (tool === 'wall') setGuides(snap(world, { from: chain[chain.length - 1] }).guides);
      if (tool === 'select') setHover(targetOf(e));
      return;
    }
    if (d.mode === 'pan') {
      const v = d.startView;
      setView({ ...v, cx: v.cx - (e.clientX - d.startPx.x) / v.scale, cy: v.cy - (e.clientY - d.startPx.y) / v.scale });
      return;
    }
    if (d.mode === 'room') {
      const s = snap(world);
      setGuides(s.guides);
      setRoomRect({ a: d.start, b: s.point });
      return;
    }
    if (!d.moved && Math.hypot(e.clientX - d.startPx.x, e.clientY - d.startPx.y) < 4) return;
    d.moved = true;
    if (d.mode === 'resize') {
      setDraft(ops.resizeItemByHandle(plan, d.id, d.sx, d.sy, world, altDown.current ? 0 : step / 2, e.shiftKey));
      return;
    }
    const delta = sub(world, d.startWorld);

    if (d.mode === 'corner') {
      const s = snap(world, { exclude: d.id });
      setGuides(s.guides);
      setDraft(ops.moveCorner(plan, d.id, s.point));
    } else if (d.mode === 'wall') {
      const wall = plan.walls.find(w => w.id === d.id);
      if (!wall) return;
      const along = Math.round(dot(delta, ops.wallNormal(plan, wall)) / step) * step;
      setDraft(ops.offsetWall(plan, d.id, along));
    } else if (d.mode === 'opening') {
      setDraft(ops.moveOpeningTo(plan, d.id, world));
    } else if (d.mode === 'item') {
      const item = plan.items.find(i => i.id === d.id);
      if (!item) return;
      const p = add(item, delta);
      setDraft(ops.updateItem(plan, d.id, { x: Math.round(p.x / step) * step, y: Math.round(p.y / step) * step }));
    } else if (d.mode === 'background' && plan.background) {
      setDraft(ops.updateBackground(plan, { x: plan.background.x + delta.x, y: plan.background.y + delta.y }));
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    setGuides({});
    if (!d) return;

    if (d.mode === 'pan') {
      const clicked = Math.hypot(e.clientX - d.startPx.x, e.clientY - d.startPx.y) < 4;
      if (clicked && tool === 'select') setSelection(d.target ?? null);
      return;
    }
    if (d.mode === 'room') {
      const rect = roomRect;
      setRoomRect(null);
      if (!rect) return;
      const width = Math.abs(rect.b.x - rect.a.x);
      const depth = Math.abs(rect.b.y - rect.a.y);
      if (width < 2 || depth < 2) return;
      const center = { x: (rect.a.x + rect.b.x) / 2, y: (rect.a.y + rect.b.y) / 2 };
      const next = ops.addRectRoom(plan, { ...center, width, depth }, wallDims);
      onCommit(next);
      const room = roomAt(detectRooms(next), center);
      setSelection(room ? { kind: 'room', id: room.id } : null);
      setTool('select');
      return;
    }
    if (!d.moved) {
      if (d.mode === 'corner') setSelection({ kind: 'corner', id: d.id });
      if (d.mode === 'background') setSelection(null);
      return;
    }
    const final = draftRef.current;
    if (final) {
      let next = final;
      if (d.mode === 'corner') next = ops.settleCorner(final, d.id);
      if (d.mode === 'wall') {
        const wall = final.walls.find(w => w.id === d.id);
        if (wall) next = ops.settleCorner(ops.settleCorner(final, wall.a), wall.b);
      }
      onCommit(next);
    }
    setDraft(null);
  };

  // ---- rendering ------------------------------------------------------------------------

  const vb = `${view.cx - size.w / 2 / view.scale} ${view.cy - size.h / 2 / view.scale} ${size.w / view.scale} ${size.h / view.scale}`;
  const selRoom = selection?.kind === 'room' ? shownRooms.find(r => r.id === selection.id) : undefined;
  // Dimensions: each room's inside sides (all rooms, or the selected one), and the length of
  // walls that belong to no room and of the selected or hovered wall.
  const roomWalls = new Set(shownRooms.flatMap(r => r.wallIds));
  const dimWalls = new Set<string>([
    ...(showDims ? shown.walls.filter(w => !roomWalls.has(w.id) && ops.wallLength(shown, w) * view.scale > 40).map(w => w.id) : []),
    ...(selection?.kind === 'wall' ? [selection.id] : []),
    ...(hover?.kind === 'wall' ? [hover.id] : []),
  ]);
  const dimRooms = showDims ? shownRooms : selRoom ? [selRoom] : [];
  const gridStep = unit === 'mt' ? 3.28084 : 1;
  const major = gridStep * 5;
  const fs = px(12);
  const last = chain[chain.length - 1];
  const preview = tool === 'wall' && last && cursor ? snap(cursor, { from: last }).point : null;
  const hoverWall = (tool === 'door' || tool === 'window') && cursor ? wallUnder(cursor) : null;
  const hoverItem = tool.startsWith('item:') && cursor ? itemSpec(tool.slice(5)) : undefined;

  const totalRoomArea = [...interiors.values()].reduce((sum, r) => sum + r.area, 0);

  const lengthLabel = (a: Vec, b: Vec, offset: number, key: string, color = '#1e293b') => {
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    let ang = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    if (ang > 90 || ang < -90) ang += 180;
    const l = dist(a, b) || 1;
    const n = { x: -(b.y - a.y) / l, y: (b.x - a.x) / l };
    const p = { x: mid.x + n.x * offset, y: mid.y + n.y * offset };
    return (
      <text key={key} x={p.x} y={p.y} fontSize={fs * 0.85} fontWeight={600} fill={color} textAnchor="middle" dominantBaseline="middle"
        transform={`rotate(${ang} ${p.x} ${p.y})`} style={{ pointerEvents: 'none', userSelect: 'none' }}>
        {formatLength(dist(a, b), unit)}
      </text>
    );
  };

  // A room's inside side length, written just inside the room along that side.
  const insideLabel = (side: { a: Vec; b: Vec; inward: Vec }, key: string) => {
    const mid = { x: (side.a.x + side.b.x) / 2, y: (side.a.y + side.b.y) / 2 };
    const p = { x: mid.x + side.inward.x * px(9), y: mid.y + side.inward.y * px(9) };
    let ang = (Math.atan2(side.b.y - side.a.y, side.b.x - side.a.x) * 180) / Math.PI;
    if (ang > 90 || ang < -90) ang += 180;
    return (
      <text key={key} x={p.x} y={p.y} fontSize={fs * 0.8} fontWeight={600} fill="#334155" textAnchor="middle" dominantBaseline="middle"
        transform={`rotate(${ang} ${p.x} ${p.y})`} style={{ pointerEvents: 'none', userSelect: 'none' }}>
        {formatLength(dist(side.a, side.b), unit)}
      </text>
    );
  };

  return (
    <div ref={boxRef} className="editor2d">
      <svg
        ref={svgRef}
        viewBox={vb}
        width="100%"
        height="100%"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setCursor(null)}
        style={{ cursor: tool === 'select' ? (drag.current?.mode === 'pan' ? 'grabbing' : bg && !bg.locked && !readOnly ? 'move' : 'default') : 'crosshair', display: 'block' }}
      >
        <defs>
          <pattern id="grid-minor" width={gridStep} height={gridStep} patternUnits="userSpaceOnUse">
            <path d={`M ${gridStep} 0 L 0 0 0 ${gridStep}`} fill="none" stroke="#e6e8eb" strokeWidth={px(1)} />
          </pattern>
          <pattern id="grid-major" width={major} height={major} patternUnits="userSpaceOnUse">
            <rect width={major} height={major} fill="url(#grid-minor)" />
            <path d={`M ${major} 0 L 0 0 0 ${major}`} fill="none" stroke="#cfd3d8" strokeWidth={px(1)} />
          </pattern>
        </defs>
        <rect x={view.cx - size.w / view.scale} y={view.cy - size.h / view.scale} width={(size.w / view.scale) * 2} height={(size.h / view.scale) * 2} fill="#fafafa" />
        {view.scale > 4 && <rect x={-500} y={-500} width={1000} height={1000} fill="url(#grid-major)" style={{ pointerEvents: 'none' }} />}

        {/* Uploaded floor plan to trace over */}
        {bg && (
          <g style={{ pointerEvents: 'none' }}>
            <image href={bg.src} x={bg.x} y={bg.y} width={bg.width} height={bg.width * bg.aspect} opacity={bg.opacity} preserveAspectRatio="none" />
            {!bg.locked && <rect x={bg.x} y={bg.y} width={bg.width} height={bg.width * bg.aspect} fill="none" stroke="#2563eb" strokeWidth={px(1.5)} strokeDasharray={`${px(6)} ${px(4)}`} />}
          </g>
        )}

        {/* Enclosed spaces that aren't rooms yet: clickable, highlighted on hover/selection */}
        {emptySpaces.map(sp => {
          const sel = selection?.kind === 'space' && selection.id === sp.id;
          const hov = hover?.kind === 'space' && hover.id === sp.id;
          return (
            <polygon key={sp.key} data-kind="space" data-id={sp.id} points={sp.polygon.map(p => `${p.x},${p.y}`).join(' ')}
              fill={sel ? 'rgba(37,99,235,0.14)' : hov ? 'rgba(37,99,235,0.06)' : 'transparent'}
              stroke={sel ? '#2563eb' : 'none'} strokeWidth={px(2)} strokeDasharray={`${px(6)} ${px(4)}`} />
          );
        })}

        {/* Rooms */}
        {shownRooms.map(r => (
          <polygon key={r.key} data-kind="room" data-id={r.id} points={r.polygon.map(p => `${p.x},${p.y}`).join(' ')}
            fill={getRoomColor(r.label?.name, r.label?.type)} fillOpacity={bg ? 0.6 : 1}
            stroke={selRoom?.key === r.key ? '#2563eb' : 'none'} strokeWidth={px(3)} />
        ))}

        {/* Furniture */}
        {shown.items.map(item => {
          const spec = itemSpec(item.type);
          if (!spec) return null;
          const { w, d } = itemSize(item);
          const hov = hover?.kind === 'item' && hover.id === item.id;
          return (
            <g key={item.id} data-kind="item" data-id={item.id} transform={`translate(${item.x} ${item.y}) rotate(${(item.rotation * 180) / Math.PI})`} style={{ cursor: readOnly ? 'default' : 'move' }}>
              <title>{spec.name}</title>
              <FurnitureSymbol type={item.type} w={w} d={d} color={spec.color} sw={px(1)} />
              {hov && <rect x={-w / 2} y={-d / 2} width={w} height={d} fill="#2563eb" fillOpacity={0.08} stroke="#2563eb" strokeOpacity={0.5} strokeWidth={px(1)} />}
            </g>
          );
        })}

        {/* Walls */}
        {shown.walls.map(w => {
          const { a, b } = ops.wallEnds(shown, w);
          const sel = selection?.kind === 'wall' && selection.id === w.id;
          const hov = hover?.kind === 'wall' && hover.id === w.id;
          return (
            <g key={w.id} data-kind="wall" data-id={w.id} style={{ cursor: readOnly ? 'default' : 'move' }}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={Math.max(w.thickness, px(12))} />
              {w.divider
                ? <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={sel ? '#2563eb' : hov ? '#475569' : '#94a3b8'} strokeWidth={px(sel || hov ? 2.5 : 1.5)} strokeDasharray={`${px(6)} ${px(4)}`} />
                : <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={sel ? '#2563eb' : hov ? '#1e293b' : '#000000'} strokeWidth={Math.max(w.thickness, px(2.5))} strokeLinecap="square" />}
            </g>
          );
        })}

        {/* Doors & windows */}
        {shown.openings.map(o => {
          const wall = shown.walls.find(w => w.id === o.wallId);
          if (!wall) return null;
          const { a, b } = ops.wallEnds(shown, wall);
          const c = ops.openingCenter(shown, o);
          const ang = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
          const sel = selection?.kind === 'opening' && selection.id === o.id;
          const w = o.width;
          const th = wall.thickness + px(1);
          const s = o.flip ? -1 : 1;
          return (
            <g key={o.id} data-kind="opening" data-id={o.id} transform={`translate(${c.x} ${c.y}) rotate(${ang})`} style={{ cursor: readOnly ? 'default' : 'ew-resize' }}>
              <rect x={-w / 2} y={-th / 2} width={w} height={th} fill={o.kind === 'window' ? '#bfe3f5' : '#fafafa'} stroke={sel ? '#2563eb' : '#23262b'} strokeWidth={px(sel ? 2 : 1)} />
              {o.kind === 'window' && <line x1={-w / 2} y1={0} x2={w / 2} y2={0} stroke="#23262b" strokeWidth={px(1)} />}
              {o.kind === 'door' && (
                <>
                  <line x1={-w / 2} y1={0} x2={-w / 2} y2={s * w} stroke={sel ? '#2563eb' : '#23262b'} strokeWidth={px(1.5)} />
                  <path d={`M ${w / 2} 0 A ${w} ${w} 0 0 ${s > 0 ? 1 : 0} ${-w / 2} ${s * w}`} fill="none" stroke="#8a9199" strokeWidth={px(1)} strokeDasharray={`${px(3)} ${px(2)}`} />
                </>
              )}
            </g>
          );
        })}

        {/* Vastu grid: the 3 x 3 zones along the compass, the centre, and north */}
        {vastu && (
          <g style={{ pointerEvents: 'none' }}>
            {vastu.grid.lines.map(([a, b], i) => (
              <line key={`vg-${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#7c3aed" strokeWidth={px(1.2)} strokeDasharray={`${px(6)} ${px(4)}`} opacity={0.55} />
            ))}
            {vastu.grid.labels.map(l => (
              <text key={`vz-${l.zone}`} x={l.at.x} y={l.at.y} fontSize={fs * 1.6} fontWeight={800} fill="#7c3aed" opacity={0.18} textAnchor="middle" dominantBaseline="middle">
                {l.zone === 'C' ? 'BRAHMA' : l.zone}
              </text>
            ))}
            <circle cx={vastu.grid.centre.x} cy={vastu.grid.centre.y} r={px(5)} fill="#7c3aed" opacity={0.6}>
              <title>{ZONE_NAMES.C}</title>
            </circle>
          </g>
        )}

        {/* Room names */}
        {shownRooms.map(r => (
          <g key={`label-${r.key}`} style={{ pointerEvents: 'none', userSelect: 'none' }}>
            <text x={r.center.x} y={r.center.y - fs * 0.45} fontSize={fs * 0.95} fontWeight={700} fill="#0f172a" textAnchor="middle">
              {r.label?.name || roomType(r.label?.type)?.name || 'Room'}
            </text>
            <text x={r.center.x} y={r.center.y + fs * 0.75} fontSize={fs * 0.8} fontWeight={500} fill="#475569" textAnchor="middle">
              {formatArea(interiors.get(r.key)?.area ?? r.area, unit)}
            </text>
          </g>
        ))}

        {emptySpaces.filter(sp => (selection?.kind === 'space' && selection.id === sp.id) || (hover?.kind === 'space' && hover.id === sp.id)).map(sp => (
          <text key={`space-${sp.key}`} x={sp.center.x} y={sp.center.y} fontSize={fs * 0.9} fill="#2563eb" textAnchor="middle" style={{ pointerEvents: 'none', userSelect: 'none' }}>
            Empty space
          </text>
        ))}

        {/* Dimensions */}
        {dimRooms.flatMap(r => (interiors.get(r.key)?.sides ?? [])
          .filter(sd => sd.length * view.scale > 40)
          .map((sd, i) => insideLabel(sd, `rdim-${r.key}-${i}`)))}
        {shown.walls.filter(w => dimWalls.has(w.id)).map(w => {
          const { a, b } = ops.wallEnds(shown, w);
          return lengthLabel(a, b, w.thickness / 2 + px(10), `dim-${w.id}`);
        })}

        {/* Corners */}
        {!readOnly && tool === 'select' && shown.corners.map(c => {
          const sel = selection?.kind === 'corner' && selection.id === c.id;
          const hov = hover?.kind === 'corner' && hover.id === c.id;
          const sz = px(sel || hov ? 8 : 6);
          return (
            <rect key={c.id} data-kind="corner" data-id={c.id} x={c.x - sz / 2} y={c.y - sz / 2} width={sz} height={sz}
              fill="#2563eb" stroke="#1e3a8a" strokeWidth={px(1)} style={{ cursor: 'grab' }} />
          );
        })}

        {/* Selected item: outline, size labels and resize handles */}
        {selection?.kind === 'item' && tool === 'select' && (() => {
          const item = shown.items.find(i => i.id === selection.id);
          if (!item) return null;
          const { w, d } = itemSize(item);
          const hs = px(9);
          const corner = (sx: number, sy: number) => itemToWorld(item, { x: (sx * w) / 2, y: (sy * d) / 2 });
          return (
            <g>
              <g transform={`translate(${item.x} ${item.y}) rotate(${(item.rotation * 180) / Math.PI})`}>
                <rect x={-w / 2} y={-d / 2} width={w} height={d} fill="none" stroke="#2563eb" strokeWidth={px(1.5)} style={{ pointerEvents: 'none' }} />
                {!readOnly && HANDLES.map(([sx, sy]) => (
                  <rect key={`${sx},${sy}`} data-handle={`${sx},${sy}`} x={(sx * w) / 2 - hs / 2} y={(sy * d) / 2 - hs / 2} width={hs} height={hs} rx={px(2)}
                    fill="#fff" stroke="#2563eb" strokeWidth={px(1.5)} style={{ cursor: handleCursor(sx, sy, item.rotation) }} />
                ))}
              </g>
              {lengthLabel(corner(-1, -1), corner(1, -1), -px(14), 'item-w', '#1d4ed8')}
              {lengthLabel(corner(1, -1), corner(1, 1), -px(14), 'item-d', '#1d4ed8')}
            </g>
          );
        })()}

        {/* Calibrate tool: the measured line */}
        {tool === 'calibrate' && calib.length > 0 && (() => {
          const end = calib[1] ?? cursor ?? calib[0];
          return (
            <g style={{ pointerEvents: 'none' }}>
              <line x1={calib[0].x} y1={calib[0].y} x2={end.x} y2={end.y} stroke="#ef4444" strokeWidth={px(2)} />
              {[calib[0], end].map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={px(5)} fill="#fff" stroke="#ef4444" strokeWidth={px(2)} />)}
            </g>
          );
        })()}

        {/* Snap guides */}
        {guides.x !== undefined && <line x1={guides.x} y1={-500} x2={guides.x} y2={500} stroke="#38bdf8" strokeWidth={px(1)} style={{ pointerEvents: 'none' }} />}
        {guides.y !== undefined && <line x1={-500} y1={guides.y} x2={500} y2={guides.y} stroke="#38bdf8" strokeWidth={px(1)} style={{ pointerEvents: 'none' }} />}

        {/* Wall tool preview */}
        {chain.length > 0 && (
          <polyline points={chain.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#2563eb" strokeWidth={wallDims.thickness} style={{ pointerEvents: 'none' }} />
        )}
        {preview && last && (
          <g style={{ pointerEvents: 'none' }}>
            <line x1={last.x} y1={last.y} x2={preview.x} y2={preview.y} stroke="#2563eb" strokeOpacity={0.6} strokeWidth={wallDims.thickness} />
            {lengthLabel(last, preview, wallDims.thickness / 2 + px(12), 'preview-dim', '#1d4ed8')}
          </g>
        )}
        {tool === 'wall' && cursor && !last && (
          <circle cx={snap(cursor).point.x} cy={snap(cursor).point.y} r={px(5)} fill="#2563eb" style={{ pointerEvents: 'none' }} />
        )}

        {/* Room tool preview */}
        {roomRect && (() => {
          const x = Math.min(roomRect.a.x, roomRect.b.x);
          const y = Math.min(roomRect.a.y, roomRect.b.y);
          const w = Math.abs(roomRect.b.x - roomRect.a.x);
          const h = Math.abs(roomRect.b.y - roomRect.a.y);
          return (
            <g style={{ pointerEvents: 'none' }}>
              <rect x={x} y={y} width={w} height={h} fill="#2563eb" fillOpacity={0.12} stroke="#2563eb" strokeWidth={wallDims.thickness} />
              {lengthLabel({ x, y }, { x: x + w, y }, -px(14), 'rw', '#1d4ed8')}
              {lengthLabel({ x: x + w, y }, { x: x + w, y: y + h }, -px(14), 'rh', '#1d4ed8')}
            </g>
          );
        })()}

        {/* Door / window placement preview */}
        {hoverWall && (() => {
          const { a, b } = ops.wallEnds(shown, hoverWall.wall);
          const ang = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
          const w = tool === 'door' ? 3 : 4;
          return (
            <rect x={-w / 2} y={-hoverWall.wall.thickness} width={w} height={hoverWall.wall.thickness * 2} fill="#2563eb" fillOpacity={0.5}
              transform={`translate(${hoverWall.point.x} ${hoverWall.point.y}) rotate(${ang})`} style={{ pointerEvents: 'none' }} />
          );
        })()}

        {/* Furniture placement preview */}
        {hoverItem && cursor && (
          <g transform={`translate(${snap(cursor).point.x} ${snap(cursor).point.y})`} opacity={0.6} style={{ pointerEvents: 'none' }}>
            <FurnitureSymbol type={hoverItem.id} w={hoverItem.w} d={hoverItem.d} color={hoverItem.color} sw={px(1)} />
          </g>
        )}
      </svg>

      {tool === 'calibrate' && calib.length === 2 && (
        <form className="editor2d-calibrate" onSubmit={e => { e.preventDefault(); applyCalibration(); }}>
          <span>Real length of this line</span>
          <input autoFocus type="number" min={0} step="any" value={calibLen} onChange={e => setCalibLen(e.target.value)} placeholder="e.g. 12" />
          <span>{unit === 'mt' ? 'm' : 'ft'}</span>
          <button type="submit" className="primary" disabled={!(parseFloat(calibLen) > 0)}>Set scale</button>
          <button type="button" onClick={() => { setCalib([]); setCalibLen(''); }}>Redo</button>
        </form>
      )}

      {/* Floating Canvas Overlays matching the screenshot */}
      <div className="canvas-zoom-toolbar">
        <button onClick={() => setView(v => ({ ...v, scale: Math.min(200, v.scale * 1.25) }))} title="Zoom in">+</button>
        <button onClick={() => setView(v => ({ ...v, scale: Math.max(2, v.scale / 1.25) }))} title="Zoom out">−</button>
        <button onClick={fitView} title="Fit to screen">
          <Maximize2 size={16} />
        </button>
        <button onClick={() => setView(v => ({ ...v, cx: 0, cy: 0 }))} title="Recenter">
          <Crosshair size={16} />
        </button>
      </div>

      <div className="canvas-tools-bar">
        <button
          className={`canvas-tool-btn ${tool === 'select' ? 'active' : ''}`}
          onClick={() => setTool('select')}
          title="Select (Esc)"
        >
          <MousePointer2 size={18} />
          <span>Select</span>
        </button>
        <button
          className={`canvas-tool-btn ${tool === 'wall' ? 'active' : ''}`}
          onClick={() => setTool('wall')}
          disabled={readOnly}
          title="Wall (W)"
        >
          <Square size={18} />
          <span>Wall</span>
        </button>
        <button
          className={`canvas-tool-btn ${tool === 'door' ? 'active' : ''}`}
          onClick={() => setTool('door')}
          disabled={readOnly}
          title="Door"
        >
          <DoorOpen size={18} />
          <span>Door</span>
        </button>
        <button
          className={`canvas-tool-btn ${tool === 'window' ? 'active' : ''}`}
          onClick={() => setTool('window')}
          disabled={readOnly}
          title="Window"
        >
          <AppWindow size={18} />
          <span>Window</span>
        </button>
        <button
          className={`canvas-tool-btn ${tool === 'room' ? 'active' : ''}`}
          onClick={() => setTool('room')}
          disabled={readOnly}
          title="Room (R)"
        >
          <Box size={18} />
          <span>Room</span>
        </button>
        <button
          className="canvas-tool-btn"
          onClick={() => {
            // Text tool - allows renaming or setting label
            if (selection?.kind === 'room') {
              const r = shownRooms.find(rm => rm.id === selection.id);
              const newName = window.prompt("Edit room name:", r?.label?.name || '');
              if (newName !== null) onCommit(ops.setRoomLabel(plan, r!, { name: newName }));
            }
          }}
          title="Text / Label"
        >
          <Type size={18} />
          <span>Text</span>
        </button>
        <button
          className={`canvas-tool-btn ${showDims ? 'active-dim' : ''}`}
          onClick={() => setShowDims(s => !s)}
          title="Toggle Dimensions"
        >
          <MoveHorizontal size={18} />
          <span>Dimension</span>
        </button>
        <button
          className="canvas-tool-btn delete-tool-btn"
          onClick={deleteSelection}
          disabled={!selection || readOnly}
          title="Delete selected item (Del)"
        >
          <Trash2 size={18} />
          <span>Delete</span>
        </button>
      </div>

      <Compass rotation={((plan.northDeg ?? 0) * Math.PI) / 180} />

      <div className="canvas-bottom-area-card">
        <div className="area-card-badge">
          <Layers size={18} />
        </div>
        <div className="area-card-text">
          <span className="area-card-label">Total Room Area</span>
          <span className="area-card-value">{formatArea(totalRoomArea, unit)}</span>
        </div>
      </div>

      <div className="canvas-bottom-tip">
        <Lightbulb size={16} className="tip-bulb-icon" />
        <span>
          {readOnly
            ? 'Example plan is read-only. Switch to P1 or P2 to edit.'
            : 'Click to select. Drag corners, walls, doors and furniture to move them. Drag empty space to pan, scroll to zoom. (Shift keeps proportions)'}
        </span>
        {typed && (
          <strong style={{ marginLeft: 8, color: '#2563eb' }}>
            Length: {typed} {unit === 'mt' ? 'm' : 'ft'} ↵
          </strong>
        )}
      </div>

      <div className="canvas-zoom-pill">
        <button onClick={() => setView(v => ({ ...v, scale: Math.max(2, v.scale / 1.25) }))} title="Zoom out">−</button>
        <span className="zoom-percentage-text">{Math.round((view.scale / 14) * 100)}% <span className="caret">▾</span></span>
        <button onClick={() => setView(v => ({ ...v, scale: Math.min(200, v.scale * 1.25) }))} title="Zoom in">+</button>
        <button onClick={fitView} title="Fit to screen">
          <Maximize2 size={14} />
        </button>
      </div>
    </div>
  );
}
