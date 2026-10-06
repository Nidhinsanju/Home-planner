"use client";

import { useState, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { BuildingModel } from './types';
import { saveBuild } from './actions/build';
import { emptyBuildingModel, exampleBuildingModel, MAT } from './constants';
import { TopBar, Sidebar, Compass, ChatSidebar } from './UI';
import { DPad } from './DPad';
import { Scene } from './Scene';
import * as THREE from 'three';
import './index.css';

const CameraController = ({ view, panState, onRotationChange, isInteracting }: any) => {
  const { camera, controls } = useThree();
  const [lastView, setLastView] = useState(view);

  useFrame(() => {
    if (view !== lastView) {
      if (view === '3d') {
        camera.position.set(46, 37, 46);
        if(controls && (controls as any).target) (controls as any).target.set(0, 2, 0);
      } else {
        camera.position.set(0, 67, 0.01);
        if(controls && (controls as any).target) (controls as any).target.set(0, 0, 0);
      }
      setLastView(view);
    }

    if (controls) {
      onRotationChange((controls as any).getAzimuthalAngle());
      
      let mx = 0, mz = 0;
      if (panState.up) mz -= 1;
      if (panState.down) mz += 1;
      if (panState.left) mx -= 1;
      if (panState.right) mx += 1;

      if (mx !== 0 || mz !== 0) {
        const angle = (controls as any).getAzimuthalAngle();
        const v = new THREE.Vector3(mx, 0, mz).applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
        const speed = 0.5;
        camera.position.addScaledVector(v, speed);
        (controls as any).target.addScaledVector(v, speed);
      }
    }
  });

  return <OrbitControls makeDefault enableDamping enableRotate={!isInteracting} target={[0, 2, 0]} maxPolarAngle={Math.PI / 2.03} />;
};

function App({ initialUser }: any) {
  const [activePlanIndex, setActivePlanIndex] = useState<0|1|2>(0);
  
  const parseBuild = (build: any) => {
    if (!build) return { model: emptyBuildingModel, customBlocks: [] as any[] };
    return {
      model: {
        ...emptyBuildingModel,
        rooms: build.rooms || [],
        walls: build.walls || [],
        surfaces: build.surfaces || [],
        doors: build.doors || [],
        windows: build.windows || []
      },
      customBlocks: build.assets || []
    };
  };

  const [p1State, setP1State] = useState({ history: [parseBuild(initialUser?.builds?.p1)], historyIndex: 0 });
  const [p2State, setP2State] = useState({ history: [parseBuild(initialUser?.builds?.p2)], historyIndex: 0 });
  const [exampleState] = useState({ history: [{ model: exampleBuildingModel, customBlocks: [] as any[] }], historyIndex: 0 });

  const currentState = activePlanIndex === 0 ? p1State : activePlanIndex === 1 ? p2State : exampleState;
  const setCurrentState = activePlanIndex === 0 ? setP1State : activePlanIndex === 1 ? setP2State : () => {};

  const history = currentState.history;
  const historyIndex = currentState.historyIndex;
  const { model, customBlocks } = history[historyIndex];

  const handleSwitchPlan = (newIndex: 0|1|2) => {
    setActivePlanIndex(newIndex);
    setEraserMode(false);
    setBuildMode(null);
    setSelectedItem(null);
  };

  // Temporarily map the new unified model back to the old rooms array so Scene.tsx doesn't break yet
  const legacyRooms = model.rooms.map((r:any) => ({
    id: r.id,
    name: r.name,
    cx: r.x,
    cz: r.y,
    w: r.width,
    d: r.depth,
    type: r.type,
    // Provide a default material for the old renderer
    mat: r.type === 'bed' ? MAT.bed : MAT.living, 
  }));

  const handleUpdateState = (newModel: BuildingModel, newCustomBlocks: any) => {
    if (activePlanIndex === 2) return;
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push({ model: newModel, customBlocks: newCustomBlocks });
    setCurrentState({ history: newHistory, historyIndex: newHistory.length - 1 });
  };

  const handleSetModel = (newModel: BuildingModel) => handleUpdateState(newModel, customBlocks);
  const handleSetCustomBlocks = (newCustomBlocks: any) => handleUpdateState(model, newCustomBlocks);

  const handleUndo = () => {
    if (historyIndex > 0) setCurrentState({ history, historyIndex: historyIndex - 1 });
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) setCurrentState({ history, historyIndex: historyIndex + 1 });
  };
  const [roofOn] = useState(true);
  const [labelsOn] = useState(true);
  const [selectedItem, setSelectedItem] = useState<{ id: string, type: string } | null>(null);
  const [view, setView] = useState<'3d' | 'top'>('3d');
  const [rotation, setRotation] = useState(0);
  const [unit, setUnit] = useState<'ft' | 'mt'>('ft');
  
  const [p1Plot, setP1Plot] = useState({ w: 40, d: 30 });
  const [p2Plot, setP2Plot] = useState({ w: 40, d: 30 });

  const handleSave = async () => {
    if (activePlanIndex === 2) return;
    const planId = activePlanIndex === 0 ? 'p1' : 'p2';
    const buildData = {
      rooms: model.rooms,
      walls: model.walls,
      surfaces: model.surfaces,
      doors: model.doors,
      windows: model.windows,
      assets: customBlocks
    };
    const token = localStorage.getItem('token') || '';
    const res = await saveBuild(planId, buildData, token);
    if (res.error) alert(res.error);
    else alert('Plan saved successfully!');
  };

  const handleLogout = async () => {
    localStorage.removeItem('token');
    window.location.href = '/';
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedItem(null);
        setBuildMode(null);
        setEraserMode(false);
      }
      
      if (e.ctrlKey || e.metaKey) {
        if (e.key.toLowerCase() === 'z') {
          e.preventDefault();
          if (e.shiftKey) handleRedo();
          else handleUndo();
        } else if (e.key.toLowerCase() === 'y') {
          e.preventDefault();
          handleRedo();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [history, historyIndex]);

  const plotW = activePlanIndex === 0 ? p1Plot.w : activePlanIndex === 1 ? p2Plot.w : 40;
  const plotD = activePlanIndex === 0 ? p1Plot.d : activePlanIndex === 1 ? p2Plot.d : 30;

  const setPlotW = (w: any) => activePlanIndex === 0 ? setP1Plot({...p1Plot, w}) : activePlanIndex === 1 ? setP2Plot({...p2Plot, w}) : null;
  const setPlotD = (d: any) => activePlanIndex === 0 ? setP1Plot({...p1Plot, d}) : activePlanIndex === 1 ? setP2Plot({...p2Plot, d}) : null;

  const [wallThickness, setWallThickness] = useState(0.15);
  const [wallHeight, setWallHeight] = useState(2.8);
  const [wallRaise, setWallRaise] = useState(0);

  const [, setBin] = useState<any[]>([]);
  const [eraserMode, setEraserMode] = useState(false);
  const [buildMode, setBuildMode] = useState<string | null>(null);
  
  const [panState, setPanState] = useState({ up: false, down: false, left: false, right: false });

  const handlePan = (dir: string, active: boolean) => {
    setPanState(prev => ({ ...prev, [dir]: active }));
  };

  const handleDeleteRoom = (room: any) => {
    if (activePlanIndex === 2) return;
    const newRooms = model.rooms.filter((r: any) => r.id !== room.id);
    handleSetModel({ ...model, rooms: newRooms });
    setBin(prev => [...prev, room]);
  };



  const handleRemoveBlock = () => {
    // Left empty for now since room mesh logic will change
  };

  const handleAddCustomBlock = (x: number, z: number, type: string) => {
    if (activePlanIndex === 2) return;
    handleSetCustomBlocks([...customBlocks, { id: Date.now(), x, z, type }]);
  };

  const handleRemoveCustomBlock = (id: number) => {
    if (activePlanIndex === 2) return;
    handleSetCustomBlocks(customBlocks.filter((b: any) => b.id !== id));
  };

  const handleAddWall = (start: any, end: any) => {
    if (activePlanIndex === 2) return;
    const newWall = {
      id: `wall-${Date.now()}`,
      type: 'interior' as const,
      start,
      end,
      thickness: wallThickness,
      height: wallHeight,
      raise: wallRaise,
      style: 'default'
    };
    handleSetModel({ ...model, walls: [...(model.walls || []), newWall] });
  };

  const handleAddOpening = (wallId: string, pt: any, type: string) => {
    if (activePlanIndex === 2) return;
    if (type === 'door') {
      const newDoor = {
        id: `door-${Date.now()}`,
        wallId,
        x: pt.x,
        y: pt.y,
        width: 1,
        height: 2.1,
        style: 'default',
        swingDirection: 'in'
      };
      handleSetModel({ ...model, doors: [...(model.doors || []), newDoor] });
    } else if (type === 'window') {
      const newWindow = {
        id: `window-${Date.now()}`,
        wallId,
        x: pt.x,
        y: pt.y,
        width: 1.5,
        height: 1.2,
        sillHeight: 0.9,
        style: 'default'
      };
      handleSetModel({ ...model, windows: [...(model.windows || []), newWindow] });
    }
  };

  const handleRemoveOpening = (id: string, type: string) => {
    if (activePlanIndex === 2) return;
    if (type === 'door') {
      handleSetModel({ ...model, doors: model.doors?.filter((d: any) => d.id !== id) });
    } else if (type === 'window') {
      handleSetModel({ ...model, windows: model.windows?.filter((w: any) => w.id !== id) });
    }
  };

  const handleUpdateObject = (id: string, type: string, newData: any) => {
    if (activePlanIndex === 2) return;
    if (type === 'door') handleSetModel({ ...model, doors: (model.doors||[]).map((d: any) => d.id === id ? { ...d, ...newData } : d) });
    else if (type === 'window') handleSetModel({ ...model, windows: (model.windows||[]).map((w: any) => w.id === id ? { ...w, ...newData } : w) });
    else if (type === 'wall') handleSetModel({ ...model, walls: (model.walls||[]).map((w: any) => w.id === id ? { ...w, ...newData } : w) });
    else if (type === 'room') handleSetModel({ ...model, rooms: (model.rooms||[]).map((r: any) => r.id === id ? { ...r, ...newData } : r) });
    else if (type === 'custom') handleSetCustomBlocks(customBlocks.map((c: any) => c.id === id ? { ...c, ...newData } : c));
  };

  const sceneData = {
    rooms: model.rooms?.map((r: any) => ({ id: r.id, name: r.name, x: r.x, y: r.y, width: r.width, depth: r.depth })) || [],
    walls: model.walls?.map((w: any) => ({ id: w.id, start: w.start, end: w.end })) || [],
    doors: model.doors?.map((d: any) => ({ id: d.id, x: d.x, y: d.y })) || [],
    windows: model.windows?.map((w: any) => ({ id: w.id, x: w.x, y: w.y })) || [],
    assets: customBlocks.map((c: any) => ({ id: c.id, type: c.type, x: c.x, z: c.z })) || []
  };

  const handleBuildCommand = (cmd: any) => {
    if (activePlanIndex === 2) return;
    
    if (cmd.action === 'build' || cmd.action === 'addAsset') {
      if (cmd.type === 'room') {
        const newRoom = {
          id: `room-${Date.now()}`,
          name: 'AI Room',
          x: cmd.x || 0,
          y: cmd.y || 0,
          width: cmd.width || 5,
          depth: cmd.depth || 5,
          type: cmd.roomType || 'living'
        };
        handleSetModel({ ...model, rooms: [...(model.rooms || []), newRoom] });
      } else if (cmd.type === 'wall') {
        handleAddWall({ x: cmd.x || -2, y: cmd.y || 0 }, { x: cmd.endX || 2, y: cmd.endY || 0 }); 
      } else if (cmd.type === 'door') {
        if (model.walls && model.walls.length > 0) {
          handleAddOpening(model.walls[0].id, { x: 0, y: 0 }, 'door');
        }
      } else if (cmd.type === 'window') {
        if (model.walls && model.walls.length > 0) {
          handleAddOpening(model.walls[0].id, { x: 0, y: 0 }, 'window');
        }
      } else if (['tree', 'car', 'sofa', 'bed', 'table', 'plant', 'bench'].includes(cmd.type)) {
        handleAddCustomBlock(cmd.x || 0, cmd.y || 0, cmd.type);
      }
    } else if (cmd.action === 'delete') {
      if (cmd.type === 'door' || cmd.type === 'window') handleRemoveOpening(cmd.id, cmd.type);
      else if (cmd.type === 'wall') handleSetModel({ ...model, walls: (model.walls||[]).filter((w: any) => w.id !== cmd.id) });
      else if (cmd.type === 'custom' || ['tree', 'car', 'sofa', 'bed', 'table', 'plant', 'bench'].includes(cmd.type)) handleRemoveCustomBlock(cmd.id);
      else if (cmd.type === 'room') handleDeleteRoom({ id: cmd.id });
    } else if (cmd.action === 'deleteAll') {
      handleSetModel({
        rooms: [],
        walls: [],
        surfaces: [],
        doors: [],
        windows: []
      });
      handleSetCustomBlocks([]);
    } else if (cmd.action === 'move') {
      handleUpdateObject(cmd.id, ['tree', 'car', 'sofa', 'bed', 'table', 'plant', 'bench'].includes(cmd.type) ? 'custom' : cmd.type, { x: cmd.x, y: cmd.y, z: cmd.y });
    }
  };

  return (
    <div className="app-container">
      <TopBar 
        view={view} setView={setView} 
        onUndo={handleUndo} canUndo={historyIndex > 0} 
        onRedo={handleRedo} canRedo={historyIndex < history.length - 1} 
        unit={unit} setUnit={setUnit} 
        onSave={handleSave}
        onLogout={handleLogout}
        username={initialUser?.name}
      />
      
      <div className="main-content">
        <Sidebar 
          plotW={plotW} setPlotW={setPlotW}
          plotD={plotD} setPlotD={setPlotD}
          unit={unit}
          buildMode={buildMode} setBuildMode={setBuildMode}
          eraserMode={eraserMode} setEraserMode={setEraserMode}
          activePlanIndex={activePlanIndex}
          onSwitchPlan={handleSwitchPlan}
          selectedItem={selectedItem}
          model={model}
          customBlocks={customBlocks}
          onUpdateObject={handleUpdateObject}
          onDeleteObject={(id: string, type: string) => {
            if (activePlanIndex === 2) return;
            if (type === 'door' || type === 'window') handleRemoveOpening(id, type);
            else if (type === 'wall') handleSetModel({ ...model, walls: (model.walls||[]).filter((w: any) => w.id !== id) });
            else if (type === 'custom') handleRemoveCustomBlock(id as any);
            else if (type === 'room') handleDeleteRoom({ id });
            setSelectedItem(null);
          }}
          onClearSelection={() => setSelectedItem(null)}
          wallThickness={wallThickness} setWallThickness={setWallThickness}
          wallHeight={wallHeight} setWallHeight={setWallHeight}
          wallRaise={wallRaise} setWallRaise={setWallRaise}
        />

        <div className="canvas-container">
          <Compass rotation={rotation + Math.PI} />
          {view === '3d' && <DPad onPan={handlePan} />}
          
          <Canvas shadows camera={{ position: [46, 37, 46], fov: 42 }}>
            <CameraController view={view} panState={panState} onRotationChange={setRotation} isInteracting={!!buildMode || eraserMode} />
            <Scene 
              rooms={legacyRooms} 
              setRooms={() => {}} 
              roofOn={roofOn} 
              labelsOn={labelsOn} 
              onSelect={(room: any) => setSelectedItem({ id: room.id, type: 'room' })}
              onSelectObject={(id: string, type: string) => setSelectedItem({ id, type })}
              unit={unit}
              plotW={plotW || 0}
              plotD={plotD || 0}
              onDeleteRoom={handleDeleteRoom}
              eraserMode={eraserMode}
              onRemoveBlock={handleRemoveBlock}
              customBlocks={customBlocks}
              buildMode={buildMode}
              onAddCustomBlock={handleAddCustomBlock}
              onRemoveCustomBlock={handleRemoveCustomBlock}
              activePlanIndex={activePlanIndex}
              selectedItem={selectedItem}
              onUpdateObject={handleUpdateObject}
              modelWalls={model.walls || []}
              modelDoors={model.doors || []}
              modelWindows={model.windows || []}
              onAddWall={handleAddWall}
              onAddOpening={handleAddOpening}
              onRemoveOpening={handleRemoveOpening}
              wallThickness={wallThickness}
              wallHeight={wallHeight}
              wallRaise={wallRaise}
            />
          </Canvas>
        </div>
        <ChatSidebar onBuildCommand={handleBuildCommand} activePlanIndex={activePlanIndex} sceneData={sceneData} />
      </div>
    </div>
  );
}

export default App;
