import React, { useState, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { initialRoomState } from './constants';
import { UI, Compass } from './UI';
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
  const [history, setHistory] = useState([initialRoomState]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const rooms = history[historyIndex];

  const handleSetRooms = (newRooms: any) => {
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(newRooms);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  };

  const handleUndo = () => {
    if (historyIndex > 0) setHistoryIndex(historyIndex - 1);
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) setHistoryIndex(historyIndex + 1);
  };
  const [roofOn, setRoofOn] = useState(true);
  const [labelsOn, setLabelsOn] = useState(true);
  const [selectedText, setSelectedText] = useState('Click a room to identify it.');
  const [view, setView] = useState<'3d' | 'top'>('3d');
  const [rotation, setRotation] = useState(0);
  const [unit, setUnit] = useState<'ft' | 'mt'>('ft');
  
  const [plotW, setPlotW] = useState<number | ''>(40);
  const [plotD, setPlotD] = useState<number | ''>(30);
  const [bin, setBin] = useState<any[]>([]);
  const [eraserMode, setEraserMode] = useState(false);
  
  const [panState, setPanState] = useState({ up: false, down: false, left: false, right: false });

  const handlePan = (dir: string, active: boolean) => {
    setPanState(prev => ({ ...prev, [dir]: active }));
  };

  const handleDeleteRoom = (room: any) => {
    const newRooms = rooms.filter((r: any) => r.id !== room.id);
    handleSetRooms(newRooms);
    setBin(prev => [...prev, room]);
  };

  const handleRestoreRoom = (room: any) => {
    setBin(prev => prev.filter(r => r.id !== room.id));
    handleSetRooms([...rooms, room]);
  };

  const handleRemoveBlock = (roomId: number, blockKey: string) => {
    const newRooms = rooms.map((r: any) => {
      if (r.id === roomId) {
        return { ...r, removedBlocks: [...(r.removedBlocks || []), blockKey] };
      }
      return r;
    });
    handleSetRooms(newRooms);
  };

  return (
    <>
      <UI 
        roofOn={roofOn} setRoofOn={setRoofOn} 
        labelsOn={labelsOn} setLabelsOn={setLabelsOn} 
        selectedText={selectedText} setView={setView} 
        onUndo={handleUndo} canUndo={historyIndex > 0}
        onRedo={handleRedo} canRedo={historyIndex < history.length - 1}
        plotW={plotW} setPlotW={setPlotW}
        plotD={plotD} setPlotD={setPlotD}
        unit={unit}
        bin={bin}
        onEmptyBin={() => setBin([])}
        onRestore={handleRestoreRoom}
        eraserMode={eraserMode}
        setEraserMode={setEraserMode}
      />
      <Compass rotation={rotation + Math.PI} unit={unit} setUnit={setUnit} />
      <DPad onPan={handlePan} />
      
      <Canvas shadows camera={{ position: [46, 37, 46], fov: 42 }}>
        <CameraController view={view} panState={panState} onRotationChange={setRotation} />
        <Scene 
          rooms={rooms} 
          setRooms={handleSetRooms} 
          roofOn={roofOn} 
          labelsOn={labelsOn} 
          onSelect={(id: any, text: string) => setSelectedText(text)}
          unit={unit}
          plotW={plotW || 0}
          plotD={plotD || 0}
          onDeleteRoom={handleDeleteRoom}
          eraserMode={eraserMode}
          onRemoveBlock={handleRemoveBlock}
        />
      </Canvas>
    </>
  );
}

export default App;
