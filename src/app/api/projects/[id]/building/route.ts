import { NextRequest, NextResponse } from 'next/server';
import { getBuilding, updateBuilding } from '../../../../../services/buildingService';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const building = await getBuilding(params.id);
    return NextResponse.json({ success: true, data: building });
  } catch (error: any) {
    console.error('Failed to get building:', error);
    return NextResponse.json(
      { success: false, error: { code: 'FETCH_FAILED', message: error.message } },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const updatedBuilding = await updateBuilding(params.id, body);
    return NextResponse.json({ success: true, data: updatedBuilding });
  } catch (error: any) {
    console.error('Failed to update building:', error);
    return NextResponse.json(
      { success: false, error: { code: 'UPDATE_FAILED', message: error.message } },
      { status: 500 }
    );
  }
}
