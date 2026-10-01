import { getBuilding, updateBuilding } from './buildingService';

export async function executeOperations(projectId: string, operations: any[]) {
  // Load current authoritative state
  const building = await getBuilding(projectId);
  
  if (!building) {
    throw new Error("Building not found");
  }

  // Clone to avoid mutating mongoose document directly
  let updatedBuilding = JSON.parse(JSON.stringify(building));
  
  for (const op of operations) {
    // This is the beginning of the Validation Engine
    if (op.type === 'RESIZE_ROOM') {
      const roomIndex = updatedBuilding.rooms.findIndex((r: any) => r.id === op.payload.roomId);
      if (roomIndex !== -1) {
        updatedBuilding.rooms[roomIndex].width = op.payload.width;
        updatedBuilding.rooms[roomIndex].depth = op.payload.depth;
      }
    } else if (op.type === 'CREATE_ROOM') {
      updatedBuilding.rooms.push({
        id: op.payload.id || `room_${Date.now()}`,
        type: op.payload.type,
        name: op.payload.name,
        x: op.payload.x,
        y: op.payload.y,
        width: op.payload.width,
        depth: op.payload.depth,
        rotation: 0
      });
    } else if (op.type === 'MOVE_ROOM') {
      const roomIndex = updatedBuilding.rooms.findIndex((r: any) => r.id === op.payload.roomId);
      if (roomIndex !== -1) {
        updatedBuilding.rooms[roomIndex].x = op.payload.x;
        updatedBuilding.rooms[roomIndex].y = op.payload.y;
      }
    }
    // Further validation rules (e.g. out of plot bounds) would go here
  }

  // Save state
  return await updateBuilding(projectId, updatedBuilding);
}
