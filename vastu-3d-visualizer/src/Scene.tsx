import React from 'react';
import { RoomMesh } from './Room';
import { StaticWalls, Road } from './Walls';
import { Text, Grid, Line } from '@react-three/drei';

export const Scene = ({ rooms, setRooms, roofOn, labelsOn, onSelect, unit, plotW, plotD, onDeleteRoom, eraserMode, onRemoveBlock }: any) => {
  const outlineW = unit === 'mt' ? plotW * 3.28084 : plotW;
  const outlineD = unit === 'mt' ? plotD * 3.28084 : plotD;

  return (
    <>
      <hemisphereLight args={[0xffffff, 0x45484e, 2.1]} />
      <directionalLight position={[25, 42, 25]} intensity={2.0} castShadow />



      {/* Ground plane */}
      <mesh position={[0, -0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[100, 100]} />
        <meshStandardMaterial color="#f0f0f0" />
      </mesh>

      {/* Grid to replicate sq ft or sq mt */}
      <Grid 
        position={[0, -0.01, 0]} 
        args={[100, 100]} 
        cellSize={unit === 'mt' ? 3.28084 : 1} 
        cellThickness={1.5} 
        cellColor="#999999" 
        sectionSize={unit === 'mt' ? 3.28084 : 1} 
        sectionThickness={1.5} 
        sectionColor="#999999" 
        fadeDistance={50} 
        fadeStrength={1} 
      />

      {/* Plot Area Outline */}
      {outlineW > 0 && outlineD > 0 && (
        <Line 
          points={[
            [-outlineW / 2, 0.02, -outlineD / 2], 
            [outlineW / 2, 0.02, -outlineD / 2], 
            [outlineW / 2, 0.02, outlineD / 2], 
            [-outlineW / 2, 0.02, outlineD / 2], 
            [-outlineW / 2, 0.02, -outlineD / 2]
          ]} 
          color="#ef4444" 
          lineWidth={4} 
        />
      )}

      <group visible={roofOn}>
        <StaticWalls />
      </group>

      <Road />

      {rooms.map((room: any) => (
        <RoomMesh
          key={room.id}
          room={room}
          rooms={rooms}
          setRooms={setRooms}
          isSelected={false}
          onSelect={onSelect}
          unit={unit}
          onDeleteRoom={onDeleteRoom}
          eraserMode={eraserMode}
          onRemoveBlock={onRemoveBlock}
        />
      ))}
    </>
  );
};


