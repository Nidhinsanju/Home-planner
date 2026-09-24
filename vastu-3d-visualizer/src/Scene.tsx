import React from 'react';
import { RoomMesh } from './Room';
import { StaticWalls, Road } from './Walls';
import { Text } from '@react-three/drei';

export const Scene = ({ rooms, setRooms, roofOn, labelsOn, onSelect }: any) => {
  return (
    <>
      <hemisphereLight args={[0xffffff, 0x45484e, 2.1]} />
      <directionalLight position={[25, 42, 25]} intensity={2.0} castShadow />

      <group visible={labelsOn}>
        <DirectionLabel text="SOUTH (ROAD)" x={0} z={-25} />
        <DirectionLabel text="NORTH" x={0} z={19} />
        <DirectionLabel text="EAST" x={26} z={-3} />
        <DirectionLabel text="WEST" x={-26} z={-3} />
      </group>

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
        />
      ))}
    </>
  );
};

const DirectionLabel = ({ text, x, z }: { text: string, x: number, z: number }) => (
  <Text
    position={[x, 3.2, z]}
    color="#fff"
    fontSize={2}
    anchorX="center"
    anchorY="middle"
    outlineWidth={0.1}
    outlineColor="#000"
  >
    {text}
  </Text>
);
