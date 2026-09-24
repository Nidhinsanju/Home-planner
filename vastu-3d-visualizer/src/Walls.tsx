import React from 'react';
import { MAT } from './constants';

export const StaticWalls = () => {
  return (
    <group>
      {/* Outer walls */}
      <mesh position={[0, 1.35, -14.625]} castShadow receiveShadow material={MAT.wall}>
        <boxGeometry args={[40, 2.7, 0.75]} />
      </mesh>
      <mesh position={[0, 1.35, 14.625]} castShadow receiveShadow material={MAT.wall}>
        <boxGeometry args={[40, 2.7, 0.75]} />
      </mesh>
      <mesh position={[-19.625, 1.35, 0]} castShadow receiveShadow material={MAT.wall}>
        <boxGeometry args={[0.75, 2.7, 30]} />
      </mesh>
      <mesh position={[19.625, 1.35, 0]} castShadow receiveShadow material={MAT.wall}>
        <boxGeometry args={[0.75, 2.7, 30]} />
      </mesh>

      {/* Main partitions */}
      <Partition x={-6} z={0} w={0.5} d={30} />
      <Partition x={6} z={0} w={0.5} d={30} />
      <Partition x={-13} z={4} w={14} d={0.5} />
      <Partition x={-13} z={-2} w={14} d={0.5} />
      <Partition x={-17} z={-11} w={6} d={0.5} />
      <Partition x={-14} z={-6.5} w={0.5} d={9} />
      <Partition x={0} z={9} w={12} d={0.5} />
      <Partition x={0} z={12} w={0.5} d={6} />
      <Partition x={13} z={10} w={14} d={0.5} />
      <Partition x={13} z={-1} w={14} d={0.5} />
      <Partition x={13} z={-9} w={14} d={0.5} />
      <Partition x={15} z={-5} w={0.5} d={8} />
      <Partition x={15} z={-12} w={0.5} d={6} />

      {/* Doors */}
      <Door x={0} z={-14.625} w={2.0} d={0.75} />
      <Door x={-6} z={7} w={0.5} d={1.2} />
      <Door x={-16} z={4} w={1.0} d={0.5} />
      <Door x={-3} z={9} w={1.0} d={0.5} />
      <Door x={3} z={9} w={1.0} d={0.5} />
      <Door x={13} z={10} w={1.0} d={0.5} />
      <Door x={6} z={4} w={0.5} d={1.2} />
      <Door x={6} z={-5} w={0.5} d={1.0} />
      <Door x={15} z={-3} w={0.5} d={0.9} />
      <Door x={6} z={-12} w={0.5} d={1.0} />
      <Door x={15} z={-11} w={0.5} d={0.9} />

      {/* Windows */}
      <Window x={-13} z={14.625} w={4.0} d={0.75} />
      <Window x={-19.625} z={9.5} w={0.75} d={4.0} />
      <Window x={-19.625} z={1.0} w={0.75} d={2.0} />
      <Window x={-19.625} z={-6.5} w={0.75} d={3.0} />
      <Window x={-3} z={14.625} w={2.0} d={0.75} />
      <Window x={3} z={14.625} w={2.0} d={0.75} />
      <Window x={13} z={14.625} w={4.0} d={0.75} />
      <Window x={19.625} z={4.5} w={0.75} d={4.0} />
      <Window x={10.5} z={-9} w={4.0} d={0.75} />
      <Window x={19.625} z={-5.0} w={0.75} d={2.0} />
      <Window x={10.5} z={-14.625} w={4.0} d={0.75} />
      <Window x={19.625} z={-12.0} w={0.75} d={2.0} />
    </group>
  );
};

const Partition = ({ x, z, w, d }: any) => (
  <mesh position={[x, 1.35, z]} castShadow receiveShadow material={MAT.wall}>
    <boxGeometry args={[w, 2.7, d]} />
  </mesh>
);

const Door = ({ x, z, w, d }: any) => (
  <mesh position={[x, 0.9, z]} castShadow receiveShadow material={MAT.wood}>
    <boxGeometry args={[w, 1.8, d]} />
  </mesh>
);

const Window = ({ x, z, w, d }: any) => (
  <mesh position={[x, 1.55, z]} castShadow receiveShadow material={MAT.glass}>
    <boxGeometry args={[w, 1.35, d]} />
  </mesh>
);

export const Road = () => {
  const markings = [];
  for(let x=-36; x<=36; x+=8) {
    markings.push(<mesh key={x} position={[x, -0.08, -22]}>
      <boxGeometry args={[4, 0.03, 0.14]} />
      <meshBasicMaterial color={0xf1df76} />
    </mesh>);
  }

  return (
    <group>
      <mesh position={[0, -0.2, -22]} receiveShadow material={MAT.road}>
        <boxGeometry args={[80, 0.15, 14]} />
      </mesh>
      {markings}
    </group>
  );
};
