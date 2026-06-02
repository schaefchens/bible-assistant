/** Clamp a value into [0, 1]; non-finite input (NaN, Infinity) becomes 0.
 * Used for volume settings (0..1). */
export function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}
