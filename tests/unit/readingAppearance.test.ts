import { describe, expect, it } from 'vitest';
import {
  CONTRAST_MAX,
  CONTRAST_MIN,
  DEFAULT_READING_APPEARANCE,
  READING_PAPERS,
  isDefaultPalette,
  paintsOwnPaper,
  resolveReadingPalette,
  type ReadingAppearance,
  type ReadingPaperId,
} from '@/lib/readingAppearance';
import {
  contrastRatio,
  maxChromaFor,
  oklchToSrgb,
  relativeLuminance,
  srgbToOklch,
} from '@/lib/color';

/**
 * The reading palette is *derived*, not stored, and three `fix(reader)` commits
 * live in this arithmetic. CLAUDE.md records the recurring mistake in as many
 * words: "This one mistake has now been made three times in this feature (the
 * ink tint floor, the swatch levels, and the first hue sliders); absolute chroma
 * is the trap."
 *
 * Note on environment: this runs in the `node` project, where `document` is
 * undefined and `basePalette()` returns its hard-coded fallback rather than
 * reading the cascade. That is deliberate — it makes the derivation a pure
 * function of its inputs here. The five non-`theme` chips never consult the
 * cascade for their own lightnesses anyway, which is why the plan scopes this
 * spec to them.
 */

const CHIPS = Object.keys(READING_PAPERS) as Exclude<ReadingPaperId, 'theme'>[];
const at = (paper: ReadingPaperId, contrast: number): ReadingAppearance => ({
  ...DEFAULT_READING_APPEARANCE,
  paper,
  contrast,
});

describe('lib/color — the arithmetic underneath', () => {
  it('round-trips sRGB through OKLCH', () => {
    for (const rgb of [
      { r: 0, g: 0, b: 0 },
      { r: 255, g: 255, b: 255 },
      { r: 140, g: 130, b: 110 },
      { r: 26, g: 26, b: 46 },
    ]) {
      expect(oklchToSrgb(srgbToOklch(rgb))).toEqual(rgb);
    }
  });

  it('agrees with WCAG on the extremes', () => {
    expect(contrastRatio({ r: 255, g: 255, b: 255 }, { r: 0, g: 0, b: 0 })).toBeCloseTo(21, 3);
    expect(contrastRatio({ r: 120, g: 120, b: 120 }, { r: 120, g: 120, b: 120 })).toBeCloseTo(1, 6);
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 6);
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBeCloseTo(0, 6);
  });

  it('is symmetric — order of the pair does not matter', () => {
    const a = { r: 200, g: 169, b: 110 };
    const b = { r: 26, g: 26, b: 46 };
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 9);
  });

  /**
   * **The trap, asserted directly.** sRGB holds materially more chroma at a
   * dark lightness than at a near-white one, so any single *absolute* chroma is
   * invisible at one end or clipped at the other. Saturation must therefore
   * always be carried as a fraction of what is available at that lightness.
   */
  it('offers very different chroma at the paper’s lightness and the ink’s', () => {
    const atPaper = maxChromaFor(0.97, 80);
    const atInk = maxChromaFor(0.26, 80);
    expect(atInk).toBeGreaterThan(atPaper * 1.5);
    // And a mid lightness has more room than either end.
    expect(maxChromaFor(0.6, 80)).toBeGreaterThan(atInk);
  });
});

describe('the default appearance is a true no-op', () => {
  it('asks for nothing the app theme does not already do', () => {
    expect(isDefaultPalette(DEFAULT_READING_APPEARANCE)).toBe(true);
    expect(paintsOwnPaper(DEFAULT_READING_APPEARANCE)).toBe(false);
  });

  /** A fresh install must render byte-identically to the build before this
   * feature existed — hence no vars and no `data-theme` at all. */
  it('emits no variables and no theme attribute', () => {
    const p = resolveReadingPalette(DEFAULT_READING_APPEARANCE, 'dark');
    expect(p.mode).toBeNull();
    expect(Object.keys(p.vars)).toHaveLength(0);
  });

  it.each([
    { over: { paper: 'sepia' as const }, why: 'a chosen paper' },
    { over: { contrast: 0.8 }, why: 'a moved contrast slider' },
    { over: { paperColors: { theme: '#8e866e' } }, why: 'a recoloured theme chip' },
  ])('stops being the default once there is $why', ({ over }) => {
    const a = { ...DEFAULT_READING_APPEARANCE, ...over };
    expect(isDefaultPalette(a)).toBe(false);
    expect(paintsOwnPaper(a)).toBe(true);
    expect(Object.keys(resolveReadingPalette(a, 'dark').vars).length).toBeGreaterThan(0);
  });

  it('does not depend on font settings — those are not colours', () => {
    expect(isDefaultPalette({ ...DEFAULT_READING_APPEARANCE, fontSize: 24, dualColumn: true })).toBe(true);
  });
});

describe('every chip starts past AAA', () => {
  /** READING_PAPERS' docblock claims "every pair sits between 9.9:1 and 14.6:1
   * at contrast 1, so all of them start past AAA with room to move either
   * way". Recomputed here rather than trusted. */
  it.each(CHIPS)('%s is comfortably legible at contrast 1', (chip) => {
    const { ratio } = resolveReadingPalette(at(chip, 1), 'dark');
    expect(ratio).toBeGreaterThanOrEqual(9.9);
    expect(ratio).toBeLessThanOrEqual(14.6);
  });

  it('is still past AA at the top of the slider', () => {
    for (const chip of CHIPS) {
      expect(resolveReadingPalette(at(chip, CONTRAST_MAX), 'dark').ratio).toBeGreaterThan(4.5);
    }
  });
});

describe('the paper is pinned; only the ink travels', () => {
  /**
   * The fix this encodes: moving both around their midpoint made every contrast
   * change a change of page brightness too, and on a tinted preset it went
   * muddy on the way down. Now you set the light you read by once.
   */
  it.each(CHIPS)('%s keeps exactly one paper colour at every contrast', (chip) => {
    const papers = [0, 0.25, 0.5, 1, CONTRAST_MAX].map((k) =>
      JSON.stringify(resolveReadingPalette(at(chip, k), 'dark').paper),
    );
    expect(new Set(papers).size).toBe(1);
  });

  it('turning contrast down monotonically reduces the ratio', () => {
    for (const chip of CHIPS) {
      const ratios = [0, 0.25, 0.5, 0.75, 1].map((k) => resolveReadingPalette(at(chip, k), 'dark').ratio);
      for (let i = 1; i < ratios.length; i++) {
        expect(ratios[i]).toBeGreaterThanOrEqual(ratios[i - 1]);
      }
    }
  });

  /**
   * At k = 0 chroma and hue converge on the paper's along with the lightness,
   * so the ink lands *on* the paper rather than merely at its luminance —
   * without that the text survives its own contrast as a colour. The residue is
   * the INK_L clamp (0.12..0.93), which keeps the extreme chips from pinning
   * ink to a pure black or white paper; that leaves a whisper of contrast on
   * `paper` and `black` rather than exactly 1.
   */
  it('lands the ink on the paper at contrast 0', () => {
    for (const chip of CHIPS) {
      expect(resolveReadingPalette(at(chip, 0), 'dark').ratio).toBeLessThan(1.2);
    }
    expect(resolveReadingPalette(at('sepia', 0), 'dark').ratio).toBeCloseTo(1, 1);
  });

  it('clamps a contrast persisted outside the slider’s range', () => {
    // "Clamped on read, not on write": a value saved before CONTRAST_MAX came
    // down must not stay past the end of its own slider.
    const beyond = resolveReadingPalette(at('sepia', 99), 'dark');
    expect(beyond.ratio).toBeCloseTo(resolveReadingPalette(at('sepia', CONTRAST_MAX), 'dark').ratio, 6);
    const below = resolveReadingPalette(at('sepia', -5), 'dark');
    expect(below.ratio).toBeCloseTo(resolveReadingPalette(at('sepia', CONTRAST_MIN), 'dark').ratio, 6);
  });
});

describe('the surface picks its data-theme from the resolved paper', () => {
  /** The surface carries a `[data-theme]` chosen by the paper's *lightness*,
   * which is what brings in the rest of index.css — `--verse-tint-alpha` above
   * all, so a bright paper under the dark app theme still highlights legibly. */
  it.each([
    { chip: 'paper' as const, mode: 'light' },
    { chip: 'sepia' as const, mode: 'light' },
    { chip: 'grey' as const, mode: 'light' },
    { chip: 'night' as const, mode: 'dark' },
    { chip: 'black' as const, mode: 'dark' },
  ])('$chip resolves to the $mode palette', ({ chip, mode }) => {
    expect(resolveReadingPalette(at(chip, 1), 'dark').mode).toBe(mode);
    // And it does not follow the *app*'s mode, which is the whole point.
    expect(resolveReadingPalette(at(chip, 1), 'light').mode).toBe(mode);
  });
});

describe('the variables the surface writes', () => {
  const vars = resolveReadingPalette(at('sepia', 1), 'dark').vars;

  it('writes a bounded token set, not the whole palette', () => {
    // If this count changes, index.css is no longer supplying the rest and the
    // "only the tokens that must be derived" claim needs revisiting.
    expect(Object.keys(vars).sort()).toEqual([
      'brand', 'brand-bright', 'brand-muted',
      'card-none-bg', 'card-none-fg',
      'ink', 'ink-muted',
      'on-brand',
      'surface', 'surface-raised', 'surface-sunken',
    ]);
  });

  it('emits space-separated RGB channels, never hex', () => {
    // Tailwind alpha modifiers compile to `rgb(var(--token) / .4)`, and this
    // codebase has ~173 of them. A hex makes every one of them invalid.
    for (const [token, value] of Object.entries(vars)) {
      expect(value, token).toMatch(/^\d{1,3} \d{1,3} \d{1,3}$/);
    }
  });

  it('lifts the raised surface off the paper and sinks the sunken one', () => {
    const l = (v: string) => {
      const [r, g, b] = v.split(' ').map(Number);
      return srgbToOklch({ r, g, b }).l;
    };
    expect(l(vars['surface-raised']!)).toBeGreaterThan(l(vars.surface!));
    expect(l(vars['surface-sunken']!)).toBeLessThan(l(vars.surface!));
  });

  it('falls ink-muted back toward the paper, never past it', () => {
    const rgb = (v: string) => {
      const [r, g, b] = v.split(' ').map(Number);
      return { r, g, b };
    };
    const paperR = contrastRatio(rgb(vars.surface!), rgb(vars.ink!));
    const mutedR = contrastRatio(rgb(vars.surface!), rgb(vars['ink-muted']!));
    expect(mutedR).toBeLessThan(paperR);
    expect(mutedR).toBeGreaterThan(1);
  });

  it('picks on-brand as whichever of paper or ink reads better on the gold', () => {
    for (const chip of CHIPS) {
      const p = resolveReadingPalette(at(chip, 1), 'dark');
      const rgb = (v: string) => {
        const [r, g, b] = v.split(' ').map(Number);
        return { r, g, b };
      };
      const brand = rgb(p.vars.brand!);
      const onBrand = rgb(p.vars['on-brand']!);
      const best = Math.max(contrastRatio(brand, p.paper), contrastRatio(brand, p.ink));
      expect(contrastRatio(brand, onBrand)).toBeCloseTo(best, 6);
    }
  });

  /** The brand distance is scaled by k too: left at full strength, collapsing
   * the contrast left a page whose verses had vanished while its chapter
   * heading and drop cap still shouted. */
  it('softens the gold along with the body text', () => {
    const rgb = (v: string) => {
      const [r, g, b] = v.split(' ').map(Number);
      return { r, g, b };
    };
    const full = resolveReadingPalette(at('sepia', 1), 'dark');
    const soft = resolveReadingPalette(at('sepia', 0.3), 'dark');
    expect(contrastRatio(rgb(soft.vars.brand!), soft.paper))
      .toBeLessThan(contrastRatio(rgb(full.vars.brand!), full.paper));
  });
});

describe('resolveReadingPalette is a pure function of its arguments', () => {
  it('gives the same answer twice', () => {
    const a = at('night', 0.7);
    expect(resolveReadingPalette(a, 'dark')).toEqual(resolveReadingPalette(a, 'dark'));
  });

  // Deliberately no test that `appMode` is an argument rather than a DOM read:
  // that is the function's signature, which `tsc -b` already proves. And the
  // `theme` chip's two modes are indistinguishable in this environment anyway,
  // since `basePalette()` returns its fallback when `document` is undefined —
  // covering it needs the reader's own surface, which is a journey's job.
});
