import { NextRequest, NextResponse } from 'next/server';
import { getBuilding } from '../../../../services/buildingService';
import { executeOperations } from '../../../../services/operationService';
import { HuggingFaceProvider } from '../../../../ai/planner';

export async function POST(request: NextRequest) {
  try {
    const { projectId, message } = await request.json();

    if (!projectId || !message) {
      return NextResponse.json(
        { success: false, error: { message: "projectId and message are required" } },
        { status: 400 }
      );
    }

    // 1. Get current building state
    const building = await getBuilding(projectId);

    // 2. Build AI Context (strip unnecessary mongoose fields for token efficiency)
    const context = {
      unit: building.unit,
      plot: building.plot,
      rooms: building.rooms.map((r: any) => ({
        id: r.id, name: r.name, type: r.type, x: r.x, y: r.y, width: r.width, depth: r.depth
      }))
    };

    // 3. Initialize Provider and request operations
    const aiProvider = new HuggingFaceProvider();
    const aiResponse = await aiProvider.generateResponse({
      projectId,
      message,
      context
    });

    if (!aiResponse.success) {
      return NextResponse.json(
        { success: false, error: { message: aiResponse.message } },
        { status: 500 }
      );
    }

    // 4. Validate and Execute Operations on the backend
    if (aiResponse.operations.length > 0) {
      const updatedBuilding = await executeOperations(projectId, aiResponse.operations);
      return NextResponse.json({
        success: true,
        message: aiResponse.message,
        operations: aiResponse.operations,
        building: updatedBuilding
      });
    }

    return NextResponse.json({
      success: true,
      message: aiResponse.message,
      operations: [],
      building
    });

  } catch (error: any) {
    console.error('AI Planner Error:', error);
    return NextResponse.json(
      { success: false, error: { message: error.message } },
      { status: 500 }
    );
  }
}
