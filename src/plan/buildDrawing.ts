import type { Plan } from './types';
import { updateBackground } from './ops';
import { layoutFromExtraction, type DrawingLayout } from './fromExtraction';
import { toPixelSpace } from './extraction';
import { applySetPlan, type SetPlanResult } from './setPlan';

// Builds the plan from what the AI read off the uploaded drawing: works out the scale from the
// written room sizes, lines the background image up with it, and replaces the plan with the
// rooms, dividers, doors and windows (see fromExtraction.ts). With `only`, just those rooms
// (by name or type) are added to the existing plan instead.

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// The drawing's layout in feet, or null when the image hasn't been read with the full reader.
export function drawingLayout(plan: Plan): DrawingLayout | { error: string } | null {
  const a = plan.background?.analysis;
  if (!a?.extraction || !a.imageWidth || !a.imageHeight) return null;
  return layoutFromExtraction(toPixelSpace(a.extraction, a.imageWidth, a.imageHeight), { width: a.imageWidth, height: a.imageHeight });
}

export function buildFromDrawing(plan: Plan, only?: string[]): { plan: Plan; result: SetPlanResult; layout: DrawingLayout } | { error: string } | null {
  const layout = drawingLayout(plan);
  if (!layout || 'error' in layout) return layout;
  let payload = layout.payload;
  if (only?.length) {
    const wanted = new Set(only.map(key));
    const rooms = payload.rooms.filter(r => wanted.has(key(r.name)) || wanted.has(key(r.type)));
    if (rooms.length === 0) return { error: `The drawing has no room called ${only.join(', ')}.` };
    payload = { rooms, walls: [], doors: [], windows: [] };
  }
  const scaled = updateBackground(plan, layout.background);
  const result = applySetPlan(scaled, payload, { replace: !only?.length });
  return { plan: result.plan, result, layout };
}

// "Scale 27.9 px/ft (from 11 labelled rooms). 11 of 11 rooms within 6 in of their written size."
export function describeLayout(layout: DrawingLayout) {
  const ok = layout.checks.filter(c => c.offBy <= 0.5).length;
  const worst = [...layout.checks].sort((a, b) => b.offBy - a.offBy)[0];
  const fit = layout.checks.length
    ? ` ${ok} of ${layout.checks.length} labelled rooms are within 6 in of their written size${ok < layout.checks.length && worst ? ` (furthest: ${worst.name}, ${(worst.offBy * 12).toFixed(0)} in off)` : ''}.`
    : '';
  return `Scale ${layout.pxPerFt.toFixed(1)} px/ft, from ${layout.scaleFrom.length} labelled room${layout.scaleFrom.length === 1 ? '' : 's'}; the image is now lined up with the plan.${fit}`;
}
