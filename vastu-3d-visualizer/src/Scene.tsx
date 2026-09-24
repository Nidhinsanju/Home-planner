import React from 'react';
import { RoomMesh } from './Room';
import { StaticWalls, Road } from './Walls';
import { Text } from '@react-three/drei';

export const Scene = ({ rooms, setRooms, roofOn, labelsOn, onSelect }: any) => {
  return (
    <>
      <hemisphereLight args={[0xffffff, 0x45484e, 2.1]} />
      <directionalLight position={[25, 42, 25]} intensity={2.0} castShadow />



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


