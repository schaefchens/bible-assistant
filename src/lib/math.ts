/**
 * The app's clamps. **Both of them live here** — a second `clamp` in a feature
 * module is how you end up importing the wrong one, so `freeformLayout` and
 * `dispatch` take theirs from this file.
 *
 * `lib/color.ts` keeps a private copy on purpose: it is documented as importing
 * nothing so it can be reasoned about (and reused) as pure arithmetic.
 */

/** Clamp a value into [lo, hi]. */
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Clamp a value into [0, 1]; non-finite input (NaN, Infinity) becomes 0.
 * Used for volumes and for the corkboard's fractional layout. */
export function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return clamp(v, 0, 1);
}
