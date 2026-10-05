import { RoomMesh } from './Room';
import { StaticWalls, Road } from './Walls';
import { Grid, Line, Outlines } from '@react-three/drei';
import { MAT, LEGO_TYPES } from './constants';

export const Scene = ({ rooms, setRooms, roofOn, onSelect, unit, plotW, plotD, onDeleteRoom, eraserMode, onRemoveBlock, customBlocks = [], buildMode, onAddCustomBlock, onRemoveCustomBlock, activePlanIndex }: any) => {
  const outlineW = unit === 'mt' ? plotW * 3.28084 : plotW;
  const outlineD = unit === 'mt' ? plotD * 3.28084 : plotD;

  return (
    <>
      <hemisphereLight args={[0xffffff, 0x45484e, 2.1]} />
      <directionalLight position={[25, 42, 25]} intensity={2.0} castShadow />



      {/* Ground plane */}
      <mesh 
        position={[0, -0.02, 0]} 
        rotation={[-Math.PI / 2, 0, 0]} 
        receiveShadow
        onPointerDown={(e) => {
          if (buildMode && onAddCustomBlock) {
            e.stopPropagation();
            const x = Math.floor(e.point.x) + 0.5;
            const z = Math.floor(e.point.z) + 0.5;
            onAddCustomBlock(x, z, buildMode);
          }
        }}
      >
        <planeGeometry args={[100, 100]} />
        <meshStandardMaterial color="#ffffff" />
      </mesh>

      {/* Grid to replicate sq ft or sq mt */}
      <Grid 
        position={[0, -0.01, 0]} 
        args={[100, 100]} 
        cellSize={unit === 'mt' ? 3.28084 : 1} 
        cellThickness={1.5} 
        cellColor="#000000" 
        sectionSize={unit === 'mt' ? 3.28084 : 1} 
        sectionThickness={1.5} 
        sectionColor="#000000" 
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

      {activePlanIndex === 2 && (
        <group visible={roofOn}>
          <StaticWalls />
        </group>
      )}

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

      {customBlocks.map((block: any) => {
        const legoDef = LEGO_TYPES.find(t => t.id === block.type);
        if (!legoDef) return null;
        const mat = (MAT as any)[legoDef.mat];

        return (
          <mesh 
            key={block.id}
            position={[block.x, legoDef.y, block.z]} 
            castShadow 
            receiveShadow
            material={mat}
            onPointerDown={(e) => {
              if (eraserMode && onRemoveCustomBlock) {
                e.stopPropagation();
                onRemoveCustomBlock(block.id);
              }
            }}
          >
            <boxGeometry args={legoDef.args as [number, number, number]} />
            {eraserMode && <Outlines thickness={0.05} color="red" />}
          </mesh>
        );
      })}
    </>
  );
};


