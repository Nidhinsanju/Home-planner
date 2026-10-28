"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
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
import { applyCommands, BuildCommand, describeCommand, describePlan } from './plan/commands';
import { applySetPlan, describeCounts, type SetPlanPayload } from './plan/setPlan';
import { buildFromDrawing, describeLayout } from './plan/buildDrawing';
import { loadDrawingMask } from './editor/backgroundImage';
import { importPlanJson } from './plan/importPlan';
import { analyzeVastu, vastuReport } from './plan/vastu';
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
  const [activeNav, setActiveNav] = useState<'plans' | 'rooms' | 'vastu' | 'settings' | 'templates' | 'export'>('plans');
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

  // Bumped when the whole plan is replaced (imported, redrawn by the AI, built from the
  // drawing), so the 2D and 3D views frame the new plan instead of looking at empty space.
  const [fitKey, setFitKey] = useState(0);

  // The Vastu report (with its one-click fixes) while the Vastu tab is open. Worked out from a
  // deferred copy of the plan, so dragging walls stays smooth.
  const deferredPlan = useDeferredValue(plan);
  const vastu = useMemo(() => (activeNav === 'vastu' ? vastuReport(deferredPlan) : null), [activeNav, deferredPlan]);
  // A message for the chat sent from elsewhere (the Vastu tab's Explain with AI).
  const [queuedPrompt, setQueuedPrompt] = useState<{ id: number; text: string }>();
  const askAI = (text: string) => setQueuedPrompt(q => ({ id: (q?.id ?? 0) + 1, text }));
  // "Fix with AI": the AI's changes come back already checked on the server (the score goes up,
  // no room is lost); they are checked again here on the live plan, applied as one undo step,
  // and described in the Vastu tab and the chat.
  const planRef = useRef(plan);
  planRef.current = plan;
  const [chatNote, setChatNote] = useState<{ id: number; lines: string[] }>();
  const handleVastuFix = async (): Promise<string[]> => {
    if (readOnly) return ['The example plan is read-only. Switch to P1 or P2.'];
    const start = plan;
    const before = analyzeVastu(start);
    if (!before) return ['There are no rooms to check yet.'];
    const { background: _image, ...withoutImage } = start; // the image isn't needed and is large
    let res: any;
    try {
      const response = await fetch('/api/vastu-fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
        body: JSON.stringify({ planId: activePlanIndex === 0 ? 'p1' : 'p2', plan: withoutImage }),
      });
      res = await response.json();
    } catch {
      return ['Could not reach the AI. Check your connection and try again.'];
    }
    if (res?.error) return [res.error];
    if (!res?.success) return ['The AI did not answer. Try again.'];
    if (!res.changes.length) return [res.summary || 'The AI found no practical change that improves the Vastu score.'];
    if (planRef.current !== start) return ['The plan changed while the AI was working, so nothing was applied. Press Fix with AI again.'];
    const { plan: next, errors } = applyCommands(start, res.changes.map((c: any) => c.command));
    const after = analyzeVastu(next)?.score ?? 0;
    if (after <= before.score) return [`The AI's changes would not raise the score here (${before.score} → ${after}), so nothing was applied.`];
    const notes = await commitAndSave(next);
    const lines = [
      `Vastu score ${before.score} → ${after}. ${res.summary}`.trim(),
      ...res.changes.map((c: any) => `• ${describeCommand(start, c.command)}: ${c.why}`),
      ...(Array.isArray(res.warnings) ? res.warnings : []),
      'Undo brings back the previous plan.',
      ...errors, ...notes,
    ];
    setChatNote(n => ({ id: (n?.id ?? 0) + 1, lines }));
    return lines;
  };

  // After a whole plan is built: its Vastu score in the chat, and the Vastu tab opened.
  const vastuHook = (built: Plan) => {
    const r = analyzeVastu(built);
    if (!r) return '';
    setActiveNav('vastu');
    const todo = r.checks.filter(c => c.status === 'bad' || c.status === 'fair').length;
    return ` Vastu score: ${r.score}/100${todo ? `, with ${todo} thing${todo === 1 ? '' : 's'} to improve` : ''}. The Vastu tab shows why, and how to fix it (set where North is on your plan first).`;
  };
  const refit = () => setFitKey(k => k + 1);

  // A floor plan given as JSON (pasted in the chat or the Export tab) replaces the plan, as
  // one undo step. Anything in it that can't be used is listed in the notes.
  const handleImportPlan = async (text: string): Promise<{ message: string; notes: string[] }> => {
    if (readOnly) return { message: 'The example plan is read-only. Switch to P1 or P2 to import a plan.', notes: [] };
    const res = importPlanJson(plan, text);
    if ('error' in res) return { message: res.error, notes: [] };
    const notes = await commitAndSave(res.plan);
    refit();
    return { message: `${res.message} Undo brings back the previous plan.${vastuHook(res.plan)}`, notes: [...res.notes, ...notes] };
  };

  // Decode the uploaded drawing's pixels in the background, so building from it can follow
  // the walls drawn on it. Builds wait for it (ensureDrawingMask) in case it isn't ready yet.
  const backgroundSrc = plan.background?.src;
  useEffect(() => {
    if (backgroundSrc) loadDrawingMask(backgroundSrc).catch(() => {});
  }, [backgroundSrc]);
  const ensureDrawingMask = () => (backgroundSrc ? loadDrawingMask(backgroundSrc).catch(() => {}) : Promise.resolve());

  // Applies AI commands as one undo step and saves the result. Returns whether the plan
  // changed, what changed (in words, from comparing the plans) and notes for the chat.
  const handleBuildCommands = async (cmds: BuildCommand[]): Promise<AiChange> => {
    if (readOnly) return { changed: false, summary: '', notes: ['The example plan is read-only.'] };
    if (cmds.some(c => c?.action === 'buildFromDrawing')) await ensureDrawingMask();
    const { plan: next, errors } = applyCommands(plan, cmds);
    const { changed, text } = describeChange(plan, next);
    if (changed) errors.push(...(await commitAndSave(next)));
    return { changed, summary: text, notes: errors };
  };

  // Replaces the plan with a whole new one from the AI (its setPlan answer), as one undo step.
  const handleSetPlan = async (payload: SetPlanPayload): Promise<AiChange> => {
    if (readOnly) return { changed: false, summary: '', notes: ['The example plan is read-only.'] };
    const res = applySetPlan(plan, payload, { replace: true });
    const { changed } = describeChange(plan, res.plan);
    const notes = changed ? await commitAndSave(res.plan) : [];
    if (changed) refit();
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
  // replaced or removed meanwhile. Image first: a plan with no rooms yet is built from the
  // drawing straight away (one undo step), and everything after that is an edit of it. A plan
  // that already has rooms keeps them until the user chooses to build (the card asks).
  const handleImageRead = async (src: string, analysis: NonNullable<Background['analysis']>) => {
    if (readOnly || plan.background?.src !== src) return [];
    const read = ops.updateBackground(plan, { analysis, use: undefined });
    if (detectRooms(plan).length === 0 && analysis.extraction) {
      const built = await buildDrawing(read);
      if (built.plan) {
        const notes = await commitAndSave(built.plan);
        refit();
        return [built.message + vastuHook(built.plan), ...built.notes, ...notes];
      }
    }
    return commitAndSave(read);
  };

  // The plan built from the drawing (marked as built from it), or why it can't be built.
  const buildDrawing = async (base: Plan): Promise<{ plan?: Plan; message: string; notes: string[] }> => {
    await ensureDrawingMask();
    const built = buildFromDrawing(base);
    if (built && 'error' in built) return { message: built.error, notes: [] };
    if (built) {
      return {
        plan: ops.updateBackground(built.plan, { use: 'build' }),
        message: `Built ${describeCounts(built.result.applied)} from your drawing, at the sizes written on it. ${describeLayout(built.layout)} Now ask me for any changes, or drag walls to fine-tune.`,
        notes: built.result.errors,
      };
    }
    // Read by the older reader (room boxes only): building from that would put walls in the
    // wrong places, so nothing is built.
    return { message: 'This drawing was read by an older reader that doesn\'t give room sizes or positions precisely enough to build from. Press Re-read on the image card, then Build it for me.', notes: [] };
  };

  // The user chose what to do with the image: build its rooms, or keep it as reference.
  const handleImageChoice = async (use: 'build' | 'context'): Promise<{ message: string; notes: string[] }> => {
    const bg = plan.background;
    if (readOnly || !bg) return { message: '', notes: [] };
    if (use === 'context') {
      return { message: 'OK, I\'ll keep your drawing as reference. You can ask things like "build the kitchen from the drawing" or "what rooms are on it?".', notes: await commitAndSave(ops.updateBackground(plan, { use })) };
    }
    const built = await buildDrawing(plan);
    if (!built.plan) return { message: built.message, notes: built.notes };
    const notes = await commitAndSave(built.plan);
    refit();
    return { message: built.message + vastuHook(built.plan), notes: [...built.notes, ...notes] };
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
            onImportPlan={handleImportPlan}
            vastu={vastu} onAskAI={askAI} onFixWithAI={handleVastuFix}
          />

          <div className="canvas-container">
            {view === '2d' ? (
              <Editor2D
                key={activePlanIndex}
                plan={plan} spaces={spaces} unit={unit}
                tool={tool} setTool={setTool}
                selection={selection} setSelection={setSelection}
                onCommit={commit} readOnly={readOnly} wallDims={wallDims} fitKey={fitKey} vastu={vastu}
              />
            ) : (
              <>
                {/* Compass turns with the camera; north is -z in the 3D world (-y on the plan). */}
                <Compass rotation={rotation} />
                <DPad onPan={(dir, active) => setPanState(prev => ({ ...prev, [dir]: active }))} />
                <Canvas shadows camera={{ position: [46, 37, 46], fov: 42, near: 1, far: 3000 }}>
                  <CameraController key={`${activePlanIndex}-${fitKey}`} plan={plan} panState={panState} onRotationChange={setRotation} isInteracting={false} />
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
            onImportPlan={handleImportPlan}
            queuedPrompt={queuedPrompt}
            chatNote={chatNote}
          />
        </div>
      </div>
    </div>
  );
}

export default App;
