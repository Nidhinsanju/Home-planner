import prisma from '../lib/db';
import { emptyBuildingModel } from '../constants';

export async function getBuilding(projectId: string) {
  let building = await prisma.building.findUnique({
    where: { projectId }
  });
  
  if (!building) {
    // Return a default empty building if it doesn't exist yet
    // In a real app we'd create it when the project is created
    return {
      projectId,
      unit: 'ft',
      plot: { width: 40, depth: 30 },
      rooms: [],
      walls: [],
      doors: [],
      windows: [],
      stairs: [],
      furniture: [],
      version: 1
    };
  }
  
  // Cast JSON arrays back to regular arrays if needed, Prisma returns JsonValue
  return {
    ...building,
    plot: building.plot as any,
    rooms: building.rooms as any,
    walls: building.walls as any,
    doors: building.doors as any,
    windows: building.windows as any,
    stairs: building.stairs as any,
    furniture: building.furniture as any,
  };
}

export async function updateBuilding(projectId: string, buildingData: any) {
  // Increment version
  const nextVersion = (buildingData.version || 1) + 1;
  
  // Upsert using Prisma
  const building = await prisma.building.upsert({
    where: { projectId },
    update: {
      unit: buildingData.unit,
      plot: buildingData.plot ? (buildingData.plot as any) : undefined,
      rooms: buildingData.rooms ? (buildingData.rooms as any) : undefined,
      walls: buildingData.walls ? (buildingData.walls as any) : undefined,
      doors: buildingData.doors ? (buildingData.doors as any) : undefined,
      windows: buildingData.windows ? (buildingData.windows as any) : undefined,
      stairs: buildingData.stairs ? (buildingData.stairs as any) : undefined,
      furniture: buildingData.furniture ? (buildingData.furniture as any) : undefined,
      version: nextVersion
    },
    create: {
      unit: buildingData.unit || 'ft',
      plot: buildingData.plot ? (buildingData.plot as any) : { width: 40, depth: 30 },
      rooms: buildingData.rooms ? (buildingData.rooms as any) : [],
      walls: buildingData.walls ? (buildingData.walls as any) : [],
      doors: buildingData.doors ? (buildingData.doors as any) : [],
      windows: buildingData.windows ? (buildingData.windows as any) : [],
      stairs: buildingData.stairs ? (buildingData.stairs as any) : [],
      furniture: buildingData.furniture ? (buildingData.furniture as any) : [],
      version: nextVersion,
      project: {
        connectOrCreate: {
          where: { id: projectId },
          create: {
            id: projectId,
            name: "Default Project",
            ownerId: "default_user",
            unit: buildingData.unit || 'ft'
          }
        }
      }
    }
  });
  
  return {
    ...building,
    plot: building.plot as any,
    rooms: building.rooms as any,
    walls: building.walls as any,
    doors: building.doors as any,
    windows: building.windows as any,
    stairs: building.stairs as any,
    furniture: building.furniture as any,
  };
}
