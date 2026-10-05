import * as THREE from "three";

export const MAT = {
  living: new THREE.MeshStandardMaterial({ color: 0xd7c4aa, roughness: 0.9 }),
  bed: new THREE.MeshStandardMaterial({ color: 0xc9b8a3, roughness: 0.9 }),
  service: new THREE.MeshStandardMaterial({ color: 0xb7c5ca, roughness: 0.85 }),
  wet: new THREE.MeshStandardMaterial({ color: 0xd0c2d7, roughness: 0.9 }),
  parking: new THREE.MeshStandardMaterial({ color: 0x858b91, roughness: 0.95 }),
  wall: new THREE.MeshStandardMaterial({ color: 0xe8e4dc, roughness: 0.92 }),
  wall2: new THREE.MeshStandardMaterial({ color: 0xb5b0a7, roughness: 0.9 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x6f9eb0, transparent: true, opacity: 0.62 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x74503a }),
  sofa: new THREE.MeshStandardMaterial({ color: 0xb89f87 }),
  road: new THREE.MeshStandardMaterial({ color: 0x303338 }),
};

export const initialRoomState = [
  { id: 0, name: "PARKING", cx: -13, cz: -13, w: 14, d: 4, mat: MAT.parking, type: "parking" },
  { id: 1, name: "PARKING", cx: -10, cz: -6.5, w: 8, d: 9, mat: MAT.parking, type: "parking" },
  { id: 2, name: "STAIRCASE", cx: -17, cz: -6.5, w: 6, d: 9, mat: MAT.wall2, type: "staircase" },
  { id: 3, name: "LIVING ROOM\n10 × 17 ft", cx: 0, cz: -8.5, w: 12, d: 13, mat: MAT.living, type: "living" },
  { id: 4, name: "DINING", cx: 0, cz: 3.5, w: 12, d: 11, mat: MAT.living, type: "dining" },
  { id: 5, name: "MASTER BEDROOM\n16 × 11 ft", cx: -13, cz: 9.5, w: 14, d: 11, mat: MAT.bed, type: "bed" },
  { id: 6, name: "MASTER TOILET\n8 × 5 ft", cx: -16, cz: 1.0, w: 8, d: 6, mat: MAT.wet, type: "toilet" },
  { id: 7, name: "COMMON TOILET\n5 × 6 ft", cx: -3, cz: 12, w: 6, d: 6, mat: MAT.wet, type: "toilet" },
  { id: 8, name: "POOJA", cx: 3, cz: 12, w: 6, d: 6, mat: MAT.wet, type: "pooja" },
  { id: 9, name: "UTILITY", cx: 13, cz: 12.5, w: 14, d: 5, mat: MAT.service, type: "utility" },
  { id: 10, name: "KITCHEN", cx: 13, cz: 4.5, w: 14, d: 11, mat: MAT.service, type: "kitchen" },
  { id: 11, name: "BEDROOM 2", cx: 10.5, cz: -5, w: 9, d: 8, mat: MAT.bed, type: "bed" },
  { id: 12, name: "BED 2 TOILET", cx: 17.5, cz: -5, w: 5, d: 8, mat: MAT.wet, type: "toilet" },
  { id: 13, name: "ELDER BEDROOM\n10 × 8 ft", cx: 10.5, cz: -12, w: 9, d: 6, mat: MAT.bed, type: "bed" },
  { id: 14, name: "ELDER TOILET\n8 × 5 ft", cx: 17.5, cz: -12, w: 5, d: 6, mat: MAT.wet, type: "toilet" },
];

export const checkVastu = (r: any) => {
  const isSW = r.cx < 0 && r.cz < 0;
  const isSE = r.cx > 0 && r.cz < 0;
  const isNE = r.cx > 0 && r.cz > 0;
  const isNW = r.cx < 0 && r.cz > 0;

  if (r.name.includes("MASTER BEDROOM") && !isSW) return "Vastu: Move to South-West";
  if (r.name.includes("KITCHEN") && !isSE) return "Vastu: Move to South-East";
  if (r.name.includes("POOJA") && !isNE) return "Vastu: Move to North-East";
  if (r.name.includes("TOILET") && (isNE || isSW)) return "Vastu: Avoid NE or SW";
  if (r.name.includes("BEDROOM") && !r.name.includes("MASTER") && isSE) return "Vastu: Avoid Bedroom in SE";
  return null;
};
