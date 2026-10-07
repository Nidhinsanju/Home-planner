// The plan is modelled in feet (1 grid cell = 1 ft). Metres are a display-only unit.
export type DisplayUnit = 'ft' | 'mt';

export const FT_PER_M = 3.28084;

export const toDisplay = (ft: number, unit: DisplayUnit) => (unit === 'mt' ? ft / FT_PER_M : ft);
export const fromDisplay = (value: number, unit: DisplayUnit) => (unit === 'mt' ? value * FT_PER_M : value);
export const round2 = (n: number) => Math.round(n * 100) / 100;

// Lengths are shown as feet-inches (12'6") or metres (3.81 m).
export function formatLength(ft: number, unit: DisplayUnit) {
  if (unit === 'mt') return `${(ft / FT_PER_M).toFixed(2)} m`;
  const totalIn = Math.round(Math.abs(ft) * 12);
  const f = Math.floor(totalIn / 12);
  const i = totalIn % 12;
  return `${ft < 0 ? '-' : ''}${f}'${i ? `${i}"` : ''}`;
}

// "12'6" × 10'" or "3.81 × 3.05 m".
export function formatDimensions(width: number, depth: number, unit: DisplayUnit) {
  if (unit === 'mt') return `${(width / FT_PER_M).toFixed(2)} × ${(depth / FT_PER_M).toFixed(2)} m`;
  return `${formatLength(width, unit)} × ${formatLength(depth, unit)}`;
}

export function formatArea(sqft: number, unit: DisplayUnit) {
  return unit === 'mt' ? `${(sqft / (FT_PER_M * FT_PER_M)).toFixed(1)} m²` : `${Math.round(sqft)} sq ft`;
}

// Grid/snap step in feet for the current unit.
export const snapStep = (unit: DisplayUnit) => (unit === 'mt' ? FT_PER_M * 0.1 : 0.5);
