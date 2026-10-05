"use client";

import { useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { emptyBuildingModel, exampleBuildingModel, MAT } from './constants';
import type { BuildingModel } from './types';
import { TopBar, ComponentsSidebar, PropertiesSidebar, Compass } from './UI';
import { DPad } from './DPad';
import { Scene } from './Scene';
import * as THREE from 'three';
import './index.css';

const CameraController = ({ view, panState, onRotationChange }: any) => {
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

  return <OrbitControls makeDefault enableDamping target={[0, 2, 0]} maxPolarAngle={Math.PI / 2.03} />;
};

function App() {
  const [activePlanIndex, setActivePlanIndex] = useState<0|1|2>(0);
  const [savedPlans, setSavedPlans] = useState([
    { model: emptyBuildingModel, customBlocks: [] as any[] },
    { model: emptyBuildingModel, customBlocks: [] as any[] }
  ]);
  const [history, setHistory] = useState([{ model: emptyBuildingModel, customBlocks: [] as any[] }]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const { model, customBlocks } = history[historyIndex];

  const handleSwitchPlan = (newIndex: 0|1|2) => {
    if (activePlanIndex === newIndex) return;
    
    let currentSaved = savedPlans;
    if (activePlanIndex < 2) {
      currentSaved = [...savedPlans];
      currentSaved[activePlanIndex] = { model, customBlocks };
      setSavedPlans(currentSaved);
    }

    setActivePlanIndex(newIndex);
    if (newIndex === 2) {
      setHistory([{ model: exampleBuildingModel, customBlocks: [] }]);
      setHistoryIndex(0);
    } else {
      setHistory([currentSaved[newIndex]]);
      setHistoryIndex(0);
    }
    setEraserMode(false);
    setBuildMode(null);
  };

  // Temporarily map the new unified model back to the old rooms array so Scene.tsx doesn't break yet
  const legacyRooms = model.rooms.map(r => ({
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
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  };

  const handleSetModel = (newModel: BuildingModel) => handleUpdateState(newModel, customBlocks);
  const handleSetCustomBlocks = (newCustomBlocks: any) => handleUpdateState(model, newCustomBlocks);

  const handleUndo = () => {
    if (historyIndex > 0) setHistoryIndex(historyIndex - 1);
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) setHistoryIndex(historyIndex + 1);
  };
  const [roofOn] = useState(true);
  const [labelsOn] = useState(true);
  const [selectedText, setSelectedText] = useState('Click a room to identify it.');
  const [view, setView] = useState<'3d' | 'top'>('3d');
  const [rotation, setRotation] = useState(0);
  const [unit, setUnit] = useState<'ft' | 'mt'>('ft');
  
  const [plotW, setPlotW] = useState<number | ''>(40);
  const [plotD, setPlotD] = useState<number | ''>(30);
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
    handleSetCustomBlocks(customBlocks.filter(b => b.id !== id));
  };

  return (
    <div className="app-container">
      <TopBar 
        view={view} setView={setView} 
        onUndo={handleUndo} canUndo={historyIndex > 0} 
        onRedo={handleRedo} canRedo={historyIndex < history.length - 1} 
        unit={unit} setUnit={setUnit} 
      />
      
      <div className="main-content">
        <ComponentsSidebar 
          plotW={plotW} setPlotW={setPlotW}
          plotD={plotD} setPlotD={setPlotD}
          unit={unit}
          buildMode={buildMode} setBuildMode={setBuildMode}
          eraserMode={eraserMode} setEraserMode={setEraserMode}
          activePlanIndex={activePlanIndex}
          onSwitchPlan={handleSwitchPlan}
        />

        <div className="canvas-container">
          <Compass rotation={rotation + Math.PI} />
          {view === '3d' && <DPad onPan={handlePan} />}
          
          <Canvas shadows camera={{ position: [46, 37, 46], fov: 42 }}>
            <CameraController view={view} panState={panState} onRotationChange={setRotation} />
            <Scene 
              rooms={legacyRooms} 
              setRooms={() => {}} 
              roofOn={roofOn} 
              labelsOn={labelsOn} 
              onSelect={(_: any, text: string) => setSelectedText(text)}
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
            />
          </Canvas>
        </div>

        <PropertiesSidebar selectedText={selectedText} />
      </div>
    </div>
  );
}

export default App;
