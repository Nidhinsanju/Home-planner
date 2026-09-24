import React, { useState, useRef } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { Text, Outlines } from '@react-three/drei';
import * as THREE from 'three';
import { MAT, checkVastu } from './constants';

const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

export const RoomMesh = ({ room, isSelected, onSelect, rooms, setRooms }: any) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const { camera, raycaster, pointer } = useThree();
  const [isDragging, setIsDragging] = useState(false);
  const dragOffset = useRef(new THREE.Vector3());

  const vError = checkVastu(room);

  // R3F doesn't have a direct equivalent for global pointer events capturing while dragging outside mesh,
  // so we bind to window via useFrame if dragging.
  useFrame(() => {
    if (isDragging && meshRef.current) {
      raycaster.setFromCamera(pointer, camera);
      const intersection = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(dragPlane, intersection)) {
        meshRef.current.position.copy(intersection.add(dragOffset.current));
        meshRef.current.position.y = 2.0; // Lift up while dragging
      }
    } else if (meshRef.current) {
      meshRef.current.position.set(room.cx, 0.08, room.cz);
    }
  });

  const handlePointerDown = (e: any) => {
    e.stopPropagation();
    onSelect(room.id, `<b>${room.name.split('\n')[0]}</b> picked up. Drag and drop onto another room to swap.`);
    setIsDragging(true);

    const intersection = new THREE.Vector3();
    raycaster.ray.intersectPlane(dragPlane, intersection);
    if(meshRef.current) {
      dragOffset.current.copy(meshRef.current.position).sub(intersection);
    }

    if (e.target) {
      e.target.setPointerCapture(e.pointerId);
    }
  };

  const handlePointerUp = (e: any) => {
    if (!isDragging) return;
    setIsDragging(false);
    if (e.target) {
      e.target.releasePointerCapture(e.pointerId);
    }

    // Evaluate drop position
    if (!meshRef.current) return;
    const droppedX = meshRef.current.position.x;
    const droppedZ = meshRef.current.position.z;

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
      onSelect(null, "Rooms interchanged! Red borders show Vastu violations.");
    } else {
      onSelect(null, "Room returned to original place.");
    }
  };

  return (
    <group>
      <mesh
        ref={meshRef}
        position={[room.cx, 0.08, room.cz]}
        material={room.mat}
        castShadow
        receiveShadow
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
      >
        <boxGeometry args={[room.w, 0.16, room.d]} />
        <meshStandardMaterial color={room.mat.color} roughness={room.mat.roughness} transparent={isDragging} opacity={isDragging ? 0.6 : 1.0} />
        {vError && <Outlines thickness={0.15} color="red" />}
        {isSelected && !vError && <Outlines thickness={0.15} color="yellow" />}
      </mesh>

      {/* Label */}
      <group position={[room.cx, 3.2, room.cz]}>
         <Text
            color="#fff"
            fontSize={1.2}
            maxWidth={room.w}
            lineHeight={1.2}
            textAlign="center"
            anchorX="center"
            anchorY="middle"
            outlineWidth={0.1}
            outlineColor="#000"
         >
            {room.name}
         </Text>
      </group>

      {/* Vastu Error Label */}
      {vError && (
         <group position={[room.cx, 7.2, room.cz]}>
            <mesh>
               <planeGeometry args={[12, 2.5]} />
               <meshBasicMaterial color="#dc1e1e" transparent opacity={0.9} />
            </mesh>
            <Text position={[0, 0, 0.01]} color="#fff" fontSize={0.9} fontWeight="bold">
               {vError}
            </Text>
         </group>
      )}

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
