import { describe, expect, it } from 'vitest';
import { clamp, clamp01 } from '@/lib/math';

/**
 * The smallest real test in the suite, and it earns its place twice: it pins
 * `clamp01`'s non-finite rule, and it is the toolchain's own smoke test — if
 * the `@` alias or the vite `define`s ever stop resolving, this fails first and
 * unambiguously rather than as a confusing import error in a bigger spec.
 *
 * CLAUDE.md names these two as the canonical "used to be two copies" case
 * (a `clamp` each in `freeformLayout` and `color`, plus eight inline
 * `Math.max(0, Math.min(1, …))`).
 */
describe('clamp', () => {
  it.each([
    { v: 5, lo: 0, hi: 10, want: 5, why: 'inside the range is untouched' },
    { v: -1, lo: 0, hi: 10, want: 0, why: 'below the floor clamps up' },
    { v: 11, lo: 0, hi: 10, want: 10, why: 'above the ceiling clamps down' },
    { v: 0, lo: 0, hi: 10, want: 0, why: 'the bounds are inclusive' },
    { v: 10, lo: 0, hi: 10, want: 10, why: 'both of them' },
    { v: -5, lo: -10, hi: -1, want: -5, why: 'a negative range works' },
  ])('$why', ({ v, lo, hi, want }) => {
    expect(clamp(v, lo, hi)).toBe(want);
  });
});

describe('clamp01', () => {
  it('passes a fraction through', () => {
    expect(clamp01(0.4)).toBe(0.4);
  });

  it('clamps to the unit range', () => {
    expect(clamp01(-0.2)).toBe(0);
    expect(clamp01(1.5)).toBe(1);
  });

  // The one behaviour worth writing down: volumes and the corkboard's
  // fractional layout both feed this, and NaN reaching a gain node is silence
  // with no error anywhere.
  it.each([NaN, Infinity, -Infinity])('turns non-finite %p into 0', (v) => {
    expect(clamp01(v)).toBe(0);
  });
});
