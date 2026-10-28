// Mixes a hex colour towards white (t > 0) or black (t < 0).
export function shade(hex: string, t: number) {
  const n = parseInt(hex.slice(1), 16);
  const target = t > 0 ? 255 : 0;
  const k = Math.abs(t);
  const ch = (s: number) => Math.round(((n >> s) & 255) + (target - ((n >> s) & 255)) * k);
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}
