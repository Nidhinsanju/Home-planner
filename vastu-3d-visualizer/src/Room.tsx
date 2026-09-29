import React, { useState, useRef } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { Html, Outlines } from '@react-three/drei';
import * as THREE from 'three';
import { MAT } from './constants';

const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

export const RoomMesh = ({ room, isSelected, onSelect, rooms, setRooms, unit = 'ft', onDeleteRoom, eraserMode, onRemoveBlock }: any) => {
  const groupRef = useRef<THREE.Group>(null);
  const { camera, raycaster, pointer, controls } = useThree();
  const [isDragging, setIsDragging] = useState(false);
  const dragOffset = useRef(new THREE.Vector3());


  // R3F doesn't have a direct equivalent for global pointer events capturing while dragging outside mesh,
  // so we bind to window via useFrame if dragging.
  useFrame(() => {
    if (isDragging && groupRef.current) {
      raycaster.setFromCamera(pointer, camera);
      const intersection = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(dragPlane, intersection)) {
        groupRef.current.position.copy(intersection.add(dragOffset.current));
        groupRef.current.position.y = 2.0; // Lift up while dragging
      }
    } else if (groupRef.current) {
      groupRef.current.position.set(room.cx, 0.08, room.cz);
    }
  });

  const handlePointerDown = (e: any, key: string) => {
    e.stopPropagation();
    if (eraserMode) {
      if (onRemoveBlock) onRemoveBlock(room.id, key);
      return;
    }
    
    if (controls) (controls as any).enabled = false;
    onSelect(room.id, `<b>${room.name.split('\n')[0]}</b> picked up. Drag and drop onto another room to swap.`);
    setIsDragging(true);

    const intersection = new THREE.Vector3();
    raycaster.ray.intersectPlane(dragPlane, intersection);
    if(groupRef.current) {
      dragOffset.current.copy(groupRef.current.position).sub(intersection);
    }

    if (e.target) {
      e.target.setPointerCapture(e.pointerId);
    }
  };

  const handlePointerUp = (e: any) => {
    if (controls) (controls as any).enabled = true;
    if (!isDragging) return;
    setIsDragging(false);
    if (e.target) {
      e.target.releasePointerCapture(e.pointerId);
    }

    // Check if dropped into recycle bin (bottom left)
    if (e.clientX < 140 && e.clientY > window.innerHeight - 140) {
      if (onDeleteRoom) onDeleteRoom(room);
      return;
    }

    // Evaluate drop position
    if (!groupRef.current) return;
    const droppedX = groupRef.current.position.x;
    const droppedZ = groupRef.current.position.z;

    const distToSelf = Math.hypot(droppedX - room.cx, droppedZ - room.cz);
    let closestId: number | null = null;
    let minD = Infinity;

    rooms.forEach((r: any) => {
      if (r.id !== room.id) {
        const dist = Math.hypot(droppedX - r.cx, droppedZ - r.cz);
        if (dist < minD) {
          minD = dist;
          closestId = r.id;
        }
      }
    });

    if (closestId !== null && minD < distToSelf && minD < 12) {
      const newRooms = [...rooms];
      const aIndex = newRooms.findIndex(r => r.id === room.id);
      const bIndex = newRooms.findIndex(r => r.id === closestId);
      
      const a = { ...newRooms[aIndex] };
      const b = { ...newRooms[bIndex] };

      // Swap properties
      const tmpName = a.name; a.name = b.name; b.name = tmpName;
      const tmpMat = a.mat; a.mat = b.mat; b.mat = tmpMat;
      const tmpType = a.type; a.type = b.type; b.type = tmpType;

      newRooms[aIndex] = a;
      newRooms[bIndex] = b;

      setRooms(newRooms);
      onSelect(null, "Rooms interchanged!");
    } else {
      onSelect(null, "Room returned to original place.");
    }
  };

  return (
    <group>
      <group ref={groupRef} position={[room.cx, 0.08, room.cz]}>
        {Array.from({ length: room.w }).map((_, i) =>
          Array.from({ length: room.d }).map((_, j) => {
            const rx = i - room.w / 2 + 0.5;
            const rz = j - room.d / 2 + 0.5;
            const key = `${rx},${rz}`;
            if (room.removedBlocks?.includes(key)) return null;

            return (
              <mesh
                key={key}
                position={[rx, 0, rz]}
                castShadow
                receiveShadow
                onPointerDown={(e) => handlePointerDown(e, key)}
                onPointerUp={handlePointerUp}
              >
                <boxGeometry args={[1, 0.16, 1]} />
                <meshStandardMaterial color={room.mat.color} roughness={room.mat.roughness} transparent={isDragging} opacity={isDragging ? 0.6 : 1.0} />
                {isSelected && <Outlines thickness={0.15} color="yellow" />}
              </mesh>
            );
          })
        )}
      </group>

      {/* Label */}
      <SpriteLabel 
        text={`${room.name.split('\n')[0]}\n${unit === 'ft' ? `${room.w} × ${room.d} ft` : `${(room.w / 3.28084).toFixed(2)} × ${(room.d / 3.28084).toFixed(2)} mt`}`} 
        x={room.cx} 
        z={room.cz} 
      />


      {/* Furniture */}
      <Furniture room={room} />
    </group>
  );
};

const Furniture = ({ room }: { room: any }) => {
  const { cx, cz, w, type } = room;
  const F = ({ x, y, z, fw, fh, fd, mat }: any) => (
    <mesh position={[x, y, z]} castShadow receiveShadow material={mat}>
      <boxGeometry args={[fw, fh, fd]} />
    </mesh>
  );

  if (type === "bed") {
    return (
      <group>
        <F x={cx} y={0.48} z={cz} fw={5.1} fh={0.25} fd={6.0} mat={MAT.sofa} />
        <F x={cx} y={1.0} z={cz - 2.85} fw={5.1} fh={0.95} fd={0.18} mat={MAT.wood} />
      </group>
    );
  } else if (type === "living") {
    return (
      <group>
        <F x={cx - 3} y={0.62} z={cz} fw={1.1} fh={1.0} fd={6.0} mat={MAT.sofa} />
        <F x={cx} y={0.45} z={cz} fw={2.5} fh={0.35} fd={1.5} mat={MAT.wood} />
      </group>
    );
  } else if (type === "dining") {
    return <F x={cx} y={0.7} z={cz} fw={5.4} fh={0.18} fd={2.9} mat={MAT.wood} />;
  } else if (type === "kitchen") {
    return <F x={cx} y={1.0} z={cz} fw={w - 2} fh={1.8} fd={1.5} mat={MAT.wall2} />;
  } else if (type === "toilet") {
    return <F x={cx - 1} y={0.45} z={cz} fw={1.25} fh={0.85} fd={2.0} mat={new THREE.MeshStandardMaterial({color: 0xf4f3ee})} />;
  } else if (type === "parking") {
    return <F x={cx} y={0.75} z={cz} fw={4.5} fh={1.5} fd={9.0} mat={new THREE.MeshStandardMaterial({color: 0x586d82})} />;
  } else if (type === "staircase") {
    return (
      <group>
        {Array.from({ length: 10 }).map((_, i) => (
          <F key={i} x={cx} y={0.22 + i * 0.18} z={cz - 3 + i * 0.6} fw={w - 1} fh={0.32} fd={0.6} mat={MAT.wall2} />
        ))}
      </group>
    );
  }

  return null;
};

const SpriteLabel = ({ text, x, z }: { text: string, x: number, z: number }) => {
  const texture = React.useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 600;
    c.height = 120;
    const q = c.getContext("2d");
    if (q) {
      q.fillStyle = "rgba(85, 90, 95, 0.9)";
      if (q.roundRect) {
         q.roundRect(8, 8, 584, 104, 18);
      } else {
         q.fillRect(8, 8, 584, 104);
      }
      q.fill();
      q.fillStyle = "#fff";
      q.textAlign = "center";
      q.textBaseline = "middle";
      const lines = text.split('\n');
      if (lines.length === 1) {
        q.font = "bold 30px Arial";
        q.fillText(lines[0], 300, 60);
      } else {
        q.font = "bold 28px Arial";
        q.fillText(lines[0], 300, 45);
        q.font = "normal 22px Arial";
        q.fillStyle = "#cbd0d6";
        q.fillText(lines[1], 300, 80);
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    return tex;
  }, [text]);

  // Reduced scale as requested
  return (
    <sprite position={[x, 3.2, z]} scale={[3.0, 0.6, 1]}>
      <spriteMaterial map={texture} transparent />
    </sprite>
  );
};
