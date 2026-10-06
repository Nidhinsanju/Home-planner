import { useState } from 'react';
import { RoomMesh } from './Room';
import { StaticWalls, Road } from './Walls';
import { Grid, Line, Outlines } from '@react-three/drei';
import { MAT, LEGO_TYPES } from './constants';
import * as THREE from 'three';
import React, { useRef } from 'react';
import { useThree } from '@react-three/fiber';

function ArrowGizmo({ position, rotation, onPointerDown, onPointerMove, onPointerUp }: any) {
  return (
    <group position={position} rotation={rotation} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
      <mesh position={[0, 0.4, 0]}>
        <coneGeometry args={[0.2, 0.4, 16]} />
        <meshStandardMaterial color="#3b82f6" depthTest={false} transparent />
      </mesh>
      <mesh position={[0, 0, 0]}>
        <cylinderGeometry args={[0.05, 0.05, 0.6, 16]} />
        <meshStandardMaterial color="#3b82f6" depthTest={false} transparent />
      </mesh>
    </group>
  );
}

function RotateGizmo({ position, onClick }: any) {
  return (
    <group position={position} onClick={onClick}>
      <mesh>
        <sphereGeometry args={[0.25, 16, 16]} />
        <meshStandardMaterial color="#ef4444" depthTest={false} transparent opacity={0.9} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.4, 0.05, 16, 32]} />
        <meshStandardMaterial color="#ef4444" depthTest={false} transparent opacity={0.9} />
      </mesh>
    </group>
  );
}

const Draggable = ({ id, type, itemData, onUpdate, allMeshes, children }: any) => {
  const groupRef = React.useRef<THREE.Group>(null);
  const [isColliding, setIsColliding] = React.useState(false);
  const [isDragging, setIsDragging] = React.useState(false);
  const dragOffset = React.useRef(new THREE.Vector3());
  const { camera, pointer, raycaster } = useThree();
  const plane = React.useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);

  const handlePointerDown = (e: any) => {
    e.stopPropagation();
    e.target.setPointerCapture(e.pointerId);
    if (groupRef.current) {
      raycaster.setFromCamera(pointer, camera);
      const intersect = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(plane, intersect)) {
        const currentPos = groupRef.current.position.clone();
        dragOffset.current.copy(currentPos.sub(intersect));
      }
    }
    setIsDragging(true);
  };

  const handlePointerMove = (e: any) => {
    if (isDragging && groupRef.current) {
      e.stopPropagation();
      raycaster.setFromCamera(pointer, camera);
      const intersect = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(plane, intersect)) {
        const newPos = intersect.clone().add(dragOffset.current);
        newPos.y = 0;
        groupRef.current.position.copy(newPos);

        groupRef.current.updateMatrixWorld(true);
        const dragBox = new THREE.Box3().setFromObject(groupRef.current);
        dragBox.expandByScalar(-0.05);

        let colliding = false;
        for (const [otherId, mesh] of allMeshes.current.entries()) {
          if (otherId === id) continue;
          if ((type === 'door' || type === 'window') && otherId === itemData?.wallId) continue;
          
          const otherBox = new THREE.Box3().setFromObject(mesh);
          otherBox.expandByScalar(-0.05);
          if (dragBox.intersectsBox(otherBox)) {
            colliding = true;
            break;
          }
        }
        setIsColliding(colliding);
      }
    }
  };

  const handlePointerUp = (e: any) => {
    if (isDragging) {
      e.stopPropagation();
      setIsDragging(false);
      e.target.releasePointerCapture(e.pointerId);

      if (isColliding) {
        if (groupRef.current) groupRef.current.position.set(0,0,0);
        setIsColliding(false);
      } else {
        if (groupRef.current) {
          const pos = groupRef.current.position.clone();
          onUpdate(id, type, { type: 'translate', delta: pos });
          groupRef.current.position.set(0,0,0);
        }
      }
    }
  };

  const handleRotate = (e: any) => {
    e.stopPropagation();
    onUpdate(id, type, { type: 'rotate' });
  };

  const bbox = React.useMemo(() => new THREE.Box3(), []);
  const [size, setSize] = React.useState(new THREE.Vector3(1, 1, 1));
  const [center, setCenter] = React.useState(new THREE.Vector3(0, 0, 0));
  
  React.useEffect(() => {
    if (groupRef.current) {
       bbox.setFromObject(groupRef.current);
       const sz = new THREE.Vector3();
       bbox.getSize(sz);
       if (sz.x > 0 && sz.x < 10) {
         setSize(sz);
         const ct = new THREE.Vector3();
         bbox.getCenter(ct);
         groupRef.current.worldToLocal(ct);
         setCenter(ct);
       }
    }
  });

  return (
    <group>
      <group ref={groupRef}>
        {children(isColliding)}
        <ArrowGizmo position={[center.x + size.x/2 + 0.3, 0.1, center.z]} rotation={[0, 0, -Math.PI/2]} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} />
        <ArrowGizmo position={[center.x - size.x/2 - 0.3, 0.1, center.z]} rotation={[0, 0, Math.PI/2]} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} />
        <ArrowGizmo position={[center.x, 0.1, center.z + size.z/2 + 0.3]} rotation={[Math.PI/2, 0, 0]} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} />
        <ArrowGizmo position={[center.x, 0.1, center.z - size.z/2 - 0.3]} rotation={[-Math.PI/2, 0, 0]} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} />
        <RotateGizmo position={[center.x, Math.max(size.y + 0.5, 2.0), center.z]} onClick={handleRotate} />
      </group>
    </group>
  );
};

export const Scene = ({ 
  rooms, setRooms, roofOn, onSelect, unit, plotW, plotD, 
  onDeleteRoom, eraserMode, onRemoveBlock, customBlocks = [], 
  buildMode, onAddCustomBlock, onRemoveCustomBlock, activePlanIndex,
  modelWalls = [], modelDoors = [], modelWindows = [],
  onAddWall, onAddOpening, onRemoveOpening,
  wallThickness, wallHeight, wallRaise, onSelectObject,
  selectedItem, onUpdateObject
}: any) => {
  const outlineW = unit === 'mt' ? plotW * 3.28084 : plotW;
  const outlineD = unit === 'mt' ? plotD * 3.28084 : plotD;

  const [drawingWallStart, setDrawingWallStart] = useState<{x: number, y: number} | null>(null);
  const [mousePos, setMousePos] = useState<{x: number, y: number} | null>(null);
  const allMeshes = React.useRef(new Map<string, THREE.Mesh>());

  const registerMesh = (id: string) => (el: any) => {
    if (el) allMeshes.current.set(id, el);
    else allMeshes.current.delete(id);
  };

  const handleDragUpdate = (id: string, type: string, action: any) => {
    if (action.type === 'translate') {
      const delta = action.delta;
      if (type === 'door') {
        const obj = modelDoors.find((d: any) => d.id === id);
        if (obj) onUpdateObject(id, type, { x: obj.x + delta.x, y: obj.y + delta.z });
      } else if (type === 'window') {
        const obj = modelWindows.find((w: any) => w.id === id);
        if (obj) onUpdateObject(id, type, { x: obj.x + delta.x, y: obj.y + delta.z });
      } else if (type === 'custom') {
        const obj = customBlocks.find((c: any) => c.id === id);
        if (obj) onUpdateObject(id, type, { x: obj.x + delta.x, z: obj.z + delta.z });
      } else if (type === 'wall') {
        const obj = modelWalls.find((w: any) => w.id === id);
        if (obj) {
          onUpdateObject(id, type, { 
            start: { x: obj.start.x + delta.x, y: obj.start.y + delta.z },
            end: { x: obj.end.x + delta.x, y: obj.end.y + delta.z }
          });
        }
      }
    } else if (action.type === 'rotate') {
      if (type === 'custom') {
        const obj = customBlocks.find((c: any) => c.id === id);
        if (obj) {
          const currentRot = obj.rotation || 0;
          onUpdateObject(id, type, { rotation: currentRot - Math.PI / 2 });
        }
      }
    }
  };

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
          if (buildMode === 'wall_draw') {
            e.stopPropagation();
            const pt = { x: e.point.x, y: e.point.z };
            if (!drawingWallStart) {
              setDrawingWallStart(pt);
            } else {
              if (onAddWall) onAddWall(drawingWallStart, pt);
              setDrawingWallStart(null);
            }
          } else if (buildMode && onAddCustomBlock) {
            e.stopPropagation();
            if (buildMode === 'door' || buildMode === 'window') {
              alert("Doors and windows can only be placed on a wall.");
              return;
            }
            const x = Math.floor(e.point.x) + 0.5;
            const z = Math.floor(e.point.z) + 0.5;
            onAddCustomBlock(x, z, buildMode);
          } else if (!buildMode && !eraserMode && onSelectObject) {
            onSelectObject(null, 'none');
          }
        }}
        onPointerMove={(e) => {
          if (buildMode === 'wall_draw' && drawingWallStart) {
            setMousePos({ x: e.point.x, y: e.point.z });
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

        const isSelected = selectedItem?.id === block.id && selectedItem?.type === 'custom';
        const renderMesh = (isColliding = false) => (
          <group position={[block.x, legoDef.y, block.z]} rotation={[0, block.rotation || 0, 0]}>
          <mesh 
            ref={registerMesh(block.id)}
            key={block.id}
            castShadow 
            receiveShadow
            material={mat}
            onPointerDown={(e) => {
              if (eraserMode && onRemoveCustomBlock) {
                e.stopPropagation();
                onRemoveCustomBlock(block.id);
              } else if (!buildMode && !eraserMode && onSelectObject) {
                e.stopPropagation();
                onSelectObject(block.id, 'custom');
              }
            }}
          >
            <boxGeometry args={legoDef.args as [number, number, number]} />
            {(eraserMode || isColliding) && <Outlines thickness={isColliding ? 0.1 : 0.05} color="red" />}
          </mesh>
          </group>
        );

        if (isSelected && activePlanIndex !== 2) {
          return (
            <Draggable key={`tc-${block.id}`} id={block.id} type="custom" itemData={block} allMeshes={allMeshes} onUpdate={handleDragUpdate}>
              {renderMesh}
            </Draggable>
          );
        }
        return renderMesh();
      })}

      {modelDoors.map((door: any) => {
        const wall = modelWalls.find((w: any) => w.id === door.wallId);
        if (!wall) return null;
        const angle = Math.atan2(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
        const isSelected = selectedItem?.id === door.id && selectedItem?.type === 'door';
        const renderMesh = (isColliding = false) => (
          <mesh 
            ref={registerMesh(door.id)}
            key={door.id} 
            position={[door.x, 2.1 / 2, door.y]} 
            rotation={[0, angle, 0]} 
            material={MAT.wood} 
            castShadow 
            receiveShadow
            onPointerDown={(e) => {
              if (eraserMode && onRemoveOpening) {
                e.stopPropagation();
                onRemoveOpening(door.id, 'door');
              } else if (!buildMode && !eraserMode && onSelectObject) {
                e.stopPropagation();
                onSelectObject(door.id, 'door');
              }
            }}
          >
            <boxGeometry args={[wall.thickness + 0.1, 2.1, door.width || 1]} />
            {(eraserMode || isColliding) && <Outlines thickness={isColliding ? 0.1 : 0.05} color="red" />}
          </mesh>
        );

        if (isSelected && activePlanIndex !== 2) {
          return (
            <Draggable key={`tc-${door.id}`} id={door.id} type="door" itemData={door} allMeshes={allMeshes} onUpdate={handleDragUpdate}>
              {renderMesh}
            </Draggable>
          );
        }
        return renderMesh();
      })}

      {modelWindows.map((win: any) => {
        const wall = modelWalls.find((w: any) => w.id === win.wallId);
        if (!wall) return null;
        const angle = Math.atan2(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
        const isSelected = selectedItem?.id === win.id && selectedItem?.type === 'window';
        const renderMesh = (isColliding = false) => (
          <mesh 
            ref={registerMesh(win.id)}
            key={win.id} 
            position={[win.x, win.sillHeight + win.height / 2, win.y]} 
            rotation={[0, angle, 0]} 
            material={MAT.glass} 
            castShadow 
            receiveShadow
            onPointerDown={(e) => {
              if (eraserMode && onRemoveOpening) {
                e.stopPropagation();
                onRemoveOpening(win.id, 'window');
              } else if (!buildMode && !eraserMode && onSelectObject) {
                e.stopPropagation();
                onSelectObject(win.id, 'window');
              }
            }}
          >
            <boxGeometry args={[wall.thickness + 0.1, win.height, win.width || 1.5]} />
            {(eraserMode || isColliding) && <Outlines thickness={isColliding ? 0.1 : 0.05} color="red" />}
          </mesh>
        );

        if (isSelected && activePlanIndex !== 2) {
          return (
            <Draggable key={`tc-${win.id}`} id={win.id} type="window" itemData={win} allMeshes={allMeshes} onUpdate={handleDragUpdate}>
              {renderMesh}
            </Draggable>
          );
        }
        return renderMesh();
      })}

      {modelWalls.map((wall: any) => {
        const isSelected = selectedItem?.id === wall.id && selectedItem?.type === 'wall';
        const renderWall = (isColliding = false) => (
          <WallMesh 
            refFn={registerMesh(wall.id)}
            key={wall.id} 
            id={wall.id}
            {...wall} 
            mat={MAT.wall2} 
            eraserMode={eraserMode} 
            buildMode={buildMode}
            onAddOpening={onAddOpening}
            onSelectObject={onSelectObject}
            isColliding={isColliding}
          />
        );

        if (isSelected && activePlanIndex !== 2) {
          return (
            <Draggable key={`tc-${wall.id}`} id={wall.id} type="wall" itemData={wall} allMeshes={allMeshes} onUpdate={handleDragUpdate}>
              {renderWall}
            </Draggable>
          );
        }
        return renderWall();
      })}

      {drawingWallStart && mousePos && buildMode === 'wall_draw' && (
        <WallMesh 
          start={drawingWallStart} 
          end={mousePos} 
          thickness={wallThickness} 
          height={wallHeight} 
          raise={wallRaise} 
          mat={MAT.glass} 
        />
      )}
    </>
  );
};

function WallMesh({ id, start, end, thickness, height, raise, mat, eraserMode, buildMode, onAddOpening, onSelectObject, refFn, isColliding }: any) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy) || 0.01; // Avoid 0 length
  const cx = (start.x + end.x) / 2;
  const cz = (start.y + end.y) / 2;
  const angle = Math.atan2(dx, dy); 
  
  return (
    <mesh 
      ref={refFn}
      position={[cx, raise + height / 2, cz]} 
      rotation={[0, angle, 0]} 
      castShadow 
      receiveShadow 
      material={mat}
      onPointerDown={(e) => {
        if (buildMode === 'door' || buildMode === 'window') {
          e.stopPropagation();
          if (onAddOpening) {
            onAddOpening(id, { x: e.point.x, y: e.point.z }, buildMode);
          }
        } else if (!buildMode && !eraserMode && onSelectObject) {
          e.stopPropagation();
          onSelectObject(id, 'wall');
        } else if (eraserMode && onSelectObject) {
          // let eraser be handled elsewhere if needed or add wall deletion here
        }
      }}
    >
      <boxGeometry args={[thickness, height, length]} />
      {(eraserMode || isColliding) && <Outlines thickness={isColliding ? 0.1 : 0.05} color="red" />}
    </mesh>
  );
}


