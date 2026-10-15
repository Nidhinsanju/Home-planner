"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { saveBuild } from './actions/build';
import { TopBar, Compass, ChatSidebar, NavRail } from './UI';
import { DPad } from './DPad';
import { Editor2D, Selection, Tool } from './editor/Editor2D';
import { View3D } from './editor/View3D';
import { Sidebar } from './editor/Sidebar';
import { Background, emptyPlan, Plan, WALL_DEFAULTS } from './plan/types';
import { detectRooms, detectSpaces, roomAt } from './plan/rooms';
import * as ops from './plan/ops';
import { examplePlan, planFromBuild } from './plan/migrate';
import { applyCommands, BuildCommand, describePlan } from './plan/commands';
import { applySetPlan, describeCounts, type SetPlanPayload } from './plan/setPlan';
import { buildFromDrawing, describeLayout } from './plan/buildDrawing';
import { describeChange } from './plan/summary';
import type { AiChange } from './UI';
import { DisplayUnit } from './units';
import './index.css';

// Frames the plan on first render, then handles D-pad panning and compass rotation.
const CameraController = ({ plan, panState, onRotationChange, isInteracting }: any) => {
  const { camera, controls } = useThree();
  const framed = useRef(false);
  useFrame(() => {
    if (!controls) return;
    const c = controls as any;
    if (!framed.current) {
      framed.current = true;
      const pts: { x: number; y: number }[] = [...plan.corners, ...plan.items];
      if (pts.length === 0) pts.push({ x: -20, y: -15 }, { x: 20, y: 15 });
      const xs = pts.map(p => p.x);
      const ys = pts.map(p => p.y);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const cz = (Math.min(...ys) + Math.max(...ys)) / 2;
      const size = Math.max(20, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
      c.target.set(cx, 0, cz);
      camera.position.set(cx + size * 0.75, size * 0.85, cz + size * 0.95);
      c.update();
    }
    onRotationChange(c.getAzimuthalAngle());
    let mx = 0, mz = 0;
    if (panState.up) mz -= 1;
    if (panState.down) mz += 1;
    if (panState.left) mx -= 1;
    if (panState.right) mx += 1;
    if (mx !== 0 || mz !== 0) {
      const v = new THREE.Vector3(mx, 0, mz).applyAxisAngle(new THREE.Vector3(0, 1, 0), c.getAzimuthalAngle());
      camera.position.addScaledVector(v, 0.5);
      c.target.addScaledVector(v, 0.5);
    }
  });
  return <OrbitControls makeDefault enableDamping enableRotate={!isInteracting} target={[0, 2, 0]} maxPolarAngle={Math.PI / 2.03} />;
};

type PlanState = { history: Plan[]; index: number };
const initState = (plan: Plan): PlanState => ({ history: [plan], index: 0 });

function App({ initialUser }: any) {
  const [activePlanIndex, setActivePlanIndex] = useState<0 | 1 | 2>(0);
  const [p1, setP1] = useState(() => initState(planFromBuild(initialUser?.builds?.p1)));
  const [p2, setP2] = useState(() => initState(planFromBuild(initialUser?.builds?.p2)));
  const [example] = useState(() => initState(examplePlan()));
  // Last saved plan per editable slot, to show unsaved changes.
  const saved = useRef<{ p1: Plan; p2: Plan }>({ p1: p1.history[0], p2: p2.history[0] });

  const current = activePlanIndex === 0 ? p1 : activePlanIndex === 1 ? p2 : example;
  const setCurrent = activePlanIndex === 0 ? setP1 : activePlanIndex === 1 ? setP2 : () => {};
  const readOnly = activePlanIndex === 2;
  const planKey = activePlanIndex === 0 ? 'p1' : 'p2';
  const plan = current.history[current.index];
  const spaces = useMemo(() => detectSpaces(plan), [plan]); // every enclosed area
  const rooms = useMemo(() => spaces.filter(s => s.label), [spaces]); // the ones marked as rooms

  const [view, setView] = useState<'2d' | '3d'>('2d');
  const [unit, setUnit] = useState<DisplayUnit>('ft');
  const [tool, setTool] = useState<Tool>('select');
  const [selection, setSelection] = useState<Selection>(null);
  const [wallDims, setWallDims] = useState({ ...WALL_DEFAULTS });
  const [cutaway, setCutaway] = useState(true);
  const [rotation, setRotation] = useState(0);
  const [activeNav, setActiveNav] = useState<'plans' | 'rooms' | 'settings' | 'templates' | 'export'>('plans');
  const [panState, setPanState] = useState({ up: false, down: false, left: false, right: false });
  const [, forceRender] = useState(0);

  const dirty = !readOnly && plan !== saved.current[planKey];

  // Every edit goes through here: one undo step, labels re-attached to their rooms.
  const commit = (next: Plan) => {
    if (readOnly || next === plan) return;
    const reconciled = ops.reconcileLabels(plan, next);
    const history = [...current.history.slice(0, current.index + 1), reconciled];
    setCurrent({ history, index: history.length - 1 });
    // A room's id changes when it gets its first label; keep it selected.
    if (selection?.kind === 'room') {
      const before = rooms.find(r => r.id === selection.id);
      const after = detectRooms(reconciled);
      if (before && !after.some(r => r.id === selection.id)) {
        const r = roomAt(after, before.center);
        setSelection(r ? { kind: 'room', id: r.id } : null);
      }
    }
    return reconciled;
  };

  const undo = () => current.index > 0 && setCurrent({ ...current, index: current.index - 1 });
  const redo = () => current.index < current.history.length - 1 && setCurrent({ ...current, index: current.index + 1 });

  const persist = async (p: Plan) => {
    const token = localStorage.getItem('token') || '';
    const res = await saveBuild(planKey, { plan: p }, token);
    if (!res.error) {
      saved.current[planKey] = p;
      forceRender(n => n + 1);
    }
    return res;
  };

  const handleSave = async () => {
    if (readOnly) return;
    const res = await persist(plan);
    if (res.error) alert(res.error);
  };

  // Empties the current plan (walls, rooms, furniture and background image) and saves it.
  // Kept as one undo step, so Undo + Save brings it back.
  const handleRemovePlan = async () => {
    if (readOnly) return;
    if (!window.confirm(`Remove Plan ${activePlanIndex + 1}? Everything on it, including the background image, will be deleted and saved. You can still Undo until you leave the page.`)) return;
    const next = commit(emptyPlan());
    setSelection(null);
    setTool('select');
    if (!next) return;
    const res = await persist(next);
    if (res.error) alert(res.error);
  };

  const handleSwitchPlan = (i: 0 | 1 | 2) => {
    setActivePlanIndex(i);
    setSelection(null);
    setTool('select');
  };

  const handleLogout = () => {
    if (dirty && !window.confirm('You have unsaved changes. Log out anyway?')) return;
    localStorage.removeItem('token');
    window.location.href = '/';
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if (k === 'y') { e.preventDefault(); redo(); }
      else if (k === 's') { e.preventDefault(); handleSave(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (p1.history[p1.index] !== saved.current.p1 || p2.history[p2.index] !== saved.current.p2) e.preventDefault();
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [p1, p2]);

  const sceneData = useMemo(() => describePlan(plan), [plan]);

  // Applies AI commands as one undo step and saves the result. Returns whether the plan
  // changed, what changed (in words, from comparing the plans) and notes for the chat.
  const handleBuildCommands = async (cmds: BuildCommand[]): Promise<AiChange> => {
    if (readOnly) return { changed: false, summary: '', notes: ['The example plan is read-only.'] };
    const { plan: next, errors } = applyCommands(plan, cmds);
    const { changed, text } = describeChange(plan, next);
    if (changed) errors.push(...(await commitAndSave(next)));
    return { changed, summary: text, notes: errors };
  };

  // Replaces the plan with one from the AI's set_plan tool, as one undo step.
  const handleSetPlan = async (payload: SetPlanPayload): Promise<AiChange> => {
    if (readOnly) return { changed: false, summary: '', notes: ['The example plan is read-only.'] };
    const res = applySetPlan(plan, payload, { replace: true });
    const { changed } = describeChange(plan, res.plan);
    const notes = changed ? await commitAndSave(res.plan) : [];
    return { changed, summary: changed ? `Replaced the plan: ${describeCounts(res.applied)}.` : 'Nothing on the plan changed.', notes: [...res.errors, ...notes] };
  };

  // Commits an AI-made change as one undo step and saves it. Returns notes for the chat.
  const commitAndSave = async (next: Plan): Promise<string[]> => {
    const reconciled = commit(next);
    setSelection(null);
    if (!reconciled) return [];
    const res = await persist(reconciled);
    return res.error ? [`The plan was updated but could not be saved: ${res.error}`] : [];
  };

  // The vision model finished reading the background image. Ignored if the image was
  // replaced or removed meanwhile.
  const handleImageRead = async (src: string, analysis: NonNullable<Background['analysis']>) => {
    if (readOnly || plan.background?.src !== src) return [];
    return commitAndSave(ops.updateBackground(plan, { analysis, use: undefined }));
  };

  // The user chose what to do with the image: build its rooms, or keep it as reference.
  const handleImageChoice = async (use: 'build' | 'context'): Promise<{ message: string; notes: string[] }> => {
    const bg = plan.background;
    if (readOnly || !bg) return { message: '', notes: [] };
    if (use === 'context') {
      return { message: 'OK, I\'ll keep your drawing as reference. You can ask things like "build the kitchen from the drawing" or "what rooms are on it?".', notes: await commitAndSave(ops.updateBackground(plan, { use })) };
    }
    const built = buildFromDrawing(plan);
    if (built && 'error' in built) return { message: built.error, notes: [] };
    if (built) {
      const notes = await commitAndSave(ops.updateBackground(built.plan, { use }));
      return { message: `Built ${describeCounts(built.result.applied)} from your drawing. ${describeLayout(built.layout)} Drag walls to fine-tune, or ask me for changes.`, notes: [...built.result.errors, ...notes] };
    }
    // Read by the older reader (room boxes only): building from that would put walls in the
    // wrong places, so nothing is built.
    return { message: 'This drawing was read by an older reader that doesn\'t give room sizes or positions precisely enough to build from. Press Re-read on the image card, then Build it for me.', notes: [] };
  };

  return (
    <div className="app-layout">
      <NavRail activeNav={activeNav} onSelectNav={setActiveNav} />
      <div className="app-main">
        <TopBar
          view={view} setView={setView}
          onUndo={undo} canUndo={current.index > 0}
          onRedo={redo} canRedo={current.index < current.history.length - 1}
          unit={unit} setUnit={setUnit}
          onSave={readOnly ? undefined : handleSave} dirty={dirty}
          onRemovePlan={readOnly ? undefined : handleRemovePlan}
          onLogout={handleLogout}
          username={initialUser?.name}
          cutaway={cutaway} setCutaway={setCutaway}
        />

        <div className="main-content">
          <Sidebar
            plan={plan} rooms={rooms} spaces={spaces} unit={unit}
            tool={tool} setTool={t => { setTool(t); if (t !== 'select') setView('2d'); }}
            selection={selection} setSelection={setSelection}
            onCommit={commit} readOnly={readOnly}
            activePlanIndex={activePlanIndex} onSwitchPlan={handleSwitchPlan}
            wallDims={wallDims} setWallDims={setWallDims}
            activeNav={activeNav} setActiveNav={setActiveNav}
          />

          <div className="canvas-container">
            {view === '2d' ? (
              <Editor2D
                key={activePlanIndex}
                plan={plan} spaces={spaces} unit={unit}
                tool={tool} setTool={setTool}
                selection={selection} setSelection={setSelection}
                onCommit={commit} readOnly={readOnly} wallDims={wallDims}
              />
            ) : (
              <>
                {/* Compass turns with the camera; north is -z in the 3D world (-y on the plan). */}
                <Compass rotation={rotation} />
                <DPad onPan={(dir, active) => setPanState(prev => ({ ...prev, [dir]: active }))} />
                <Canvas shadows camera={{ position: [46, 37, 46], fov: 42, near: 1, far: 3000 }}>
                  <CameraController key={activePlanIndex} plan={plan} panState={panState} onRotationChange={setRotation} isInteracting={false} />
                  <View3D plan={plan} rooms={rooms} unit={unit} selection={selection} onSelect={setSelection} cutaway={cutaway} />
                </Canvas>
              </>
            )}
          </div>
          <ChatSidebar
            onBuildCommands={handleBuildCommands}
            onSetPlan={handleSetPlan}
            activePlanIndex={activePlanIndex}
            sceneData={sceneData}
            background={readOnly ? undefined : plan.background}
            onImageRead={handleImageRead}
            onImageChoice={handleImageChoice}
            onSwitchView={setView}
            setTool={setTool}
          />
        </div>
      </div>
    </div>
  );
}

export default App;
