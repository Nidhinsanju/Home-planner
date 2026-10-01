import React, { useRef } from 'react';
import { Outlines } from '@react-three/drei';
import * as THREE from 'three';
import { MAT } from './constants';

export const RoomMesh = ({ room, isSelected, onSelect, unit = 'ft', eraserMode, onDeleteRoom }: any) => {
  const groupRef = useRef<THREE.Group>(null);

  const handlePointerDown = (e: any) => {
    e.stopPropagation();
    if (eraserMode) {
      if (onDeleteRoom) onDeleteRoom(room);
    } else {
      if (onSelect) onSelect(room, `${room.name.split('\n')[0]}\n${room.w}x${room.d} ft`);
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
                onPointerDown={handlePointerDown}
              >
                <boxGeometry args={[1, 0.16, 1]} />
                <meshStandardMaterial color={room.mat.color} roughness={room.mat.roughness} />
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
