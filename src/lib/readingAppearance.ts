import {
  channels,
  clamp,
  contrastRatio,
  cssColor,
  mixOklch,
  oklchToSrgb,
  parseChannels,
  srgbToOklch,
  type Oklch,
  type Rgb,
} from '@/lib/color';
import type { ThemeMode, ThemeToken } from '@/lib/theme';

/**
 * The reading surface's appearance: what the Bible text is printed on, in what
 * ink, at what size.
 *
 * The colour part is a *derivation*, not a stored palette. A preset supplies a
 * paper and an ink in OKLCH; the two tint sliders override their hues; the
 * contrast slider then slides the ink toward the paper and past it, with the
 * paper held where the preset put it:
 *
 *     ink' = paper + (ink - paper) * k
 *
 * `k = 1` is the preset as designed, `k = 0` puts the ink exactly on the paper
 * (the text vanishes — deliberately reachable), and `k` above 1 drives it
 * further until it clamps. The paper never moves, so the page keeps the
 * brightness the chosen paper asked for at every setting.
 *
 * OKLCH rather than sRGB because "distance" has to mean *perceptual* distance,
 * or the slider does nothing for its first half and everything in its last
 * quarter.
 *
 * Only nine of the eleven THEME_TOKENS are written. The rest of the palette —
 * `--verse-tint-alpha` and `color-scheme` above all — comes from the `[data-theme]`
 * block the surface carries, chosen by the resolved paper's lightness. That is
 * why a bright paper under the app's dark theme still gets a legible reading
 * tint: the tint follows the paper, not the app.
 */

export type ReadingPaperId = 'theme' | 'paper' | 'sepia' | 'grey' | 'night' | 'black';
export type ReadingFontFamily = 'serif' | 'sans';

export type ReadingAppearance = {
  paper: ReadingPaperId;
  /** Hue override in degrees, or null for the preset's own. */
  paperHue: number | null;
  inkHue: number | null;
  /** 0 … CONTRAST_MAX; 1 is the preset untouched. */
  contrast: number;
  /** px */
  fontSize: number;
  /** unitless ratio */
  lineHeight: number;
  fontFamily: ReadingFontFamily;
  /** Characters per line the column is capped at. MEASURE_MAX means "no cap". */
  measure: number;
  /** Two columns — only ever honoured above the CSS width gate. */
  dualColumn: boolean;
};

export const CONTRAST_MIN = 0;
export const CONTRAST_MAX = 1.5;
export const FONT_SIZE_MIN = 14;
export const FONT_SIZE_MAX = 30;
export const LINE_HEIGHT_MIN = 1.3;
export const LINE_HEIGHT_MAX = 2.4;
export const MEASURE_MIN = 32;
/** The top of the range is "no cap" rather than a very wide one. */
export const MEASURE_MAX = 90;

/**
 * Defaults reproduce today's reader exactly: the app theme's own colours, 17px
 * over a 32px line (`text-[17px] leading-8`), Georgia, uncapped width.
 * `paper: 'theme'` additionally short-circuits colour derivation entirely — see
 * `isDefaultPalette`.
 */
export const DEFAULT_READING_APPEARANCE: ReadingAppearance = {
  paper: 'theme',
  paperHue: null,
  inkHue: null,
  contrast: 1,
  fontSize: 17,
  lineHeight: 1.88,
  fontFamily: 'serif',
  measure: MEASURE_MAX,
  dualColumn: false,
};

type PaperPreset = { paper: Oklch; ink: Oklch };

/**
 * The built-in papers. Each pair sits between 9.9:1 and 14.6:1 at contrast 1, so
 * every preset starts comfortably past AAA and the slider has room in both
 * directions. `theme` has no entry — it resolves from the live cascade.
 */
export const READING_PAPERS: Record<Exclude<ReadingPaperId, 'theme'>, PaperPreset> = {
  paper: { paper: { l: 0.972, c: 0.01, h: 90 }, ink: { l: 0.255, c: 0.012, h: 70 } },
  sepia: { paper: { l: 0.925, c: 0.035, h: 80 }, ink: { l: 0.31, c: 0.038, h: 50 } },
  grey: { paper: { l: 0.86, c: 0, h: 0 }, ink: { l: 0.27, c: 0, h: 0 } },
  night: { paper: { l: 0.216, c: 0.045, h: 290 }, ink: { l: 0.905, c: 0.022, h: 88 } },
  black: { paper: { l: 0.05, c: 0, h: 0 }, ink: { l: 0.82, c: 0, h: 0 } },
};

export const READING_PAPER_IDS: ReadingPaperId[] = [
  'theme',
  'paper',
  'sepia',
  'grey',
  'night',
  'black',
];

/**
 * Chroma forced on when a tint slider is used. Without a floor, tinting the
 * neutral grey paper (c = 0) would do nothing at all — hue is meaningless
 * without chroma to carry it — and the slider would look broken.
 *
 * The two differ because the sRGB gamut does. Measured headroom (largest
 * in-gamut chroma, min/median across hues) is 0.013/0.019 at the light paper's
 * L 0.97 but 0.044/0.074 at the ink's L 0.26 — a light surface simply cannot
 * hold much colour, while dark text can hold three times as much. The ink's
 * floor started at the paper's and was invisible for it: not clipped, just far
 * too timid for the room available. Anything above the *minimum* clips
 * gracefully on the least accommodating hues (oklchToSrgb gives up chroma, not
 * hue), which is the right trade for a control whose whole job is to be seen.
 */
const TINT_CHROMA_PAPER = 0.026;
const TINT_CHROMA_INK = 0.06;

/** How far the gold sits from the paper, in OKLab L. Measured off the two
 *  hand-tuned palettes in index.css, which agree to within 0.05. */
const BRAND_DL = 0.5;
const BRAND_MUTED_DL = 0.41;
const BRAND_BRIGHT_DL = 0.59;
/** Keep the gold a gold: below this it is mud, above it it is white. */
const BRAND_L_MIN = 0.18;
const BRAND_L_MAX = 0.92;

const RAISED_DL = 0.045;
const SUNKEN_DL = 0.052;
/** How far `ink-muted` falls back toward the paper. */
const INK_MUTED_MIX = 0.25;

/**
 * True when the appearance asks for nothing the app theme doesn't already do.
 * The surface then emits **no** colour variables and no `data-theme` at all, so
 * a fresh install renders byte-identically to the build before this feature.
 */
export function isDefaultPalette(a: ReadingAppearance): boolean {
  return a.paper === 'theme' && a.contrast === 1 && a.paperHue === null && a.inkHue === null;
}

/**
 * Whether a surface paints a paper of its own, as opposed to inheriting the
 * app's. Chat verse panels keep their translucent bubble until it does.
 */
export function paintsOwnPaper(a: ReadingAppearance): boolean {
  return !isDefaultPalette(a);
}

/** The app's own palette for a mode, read out of a detached probe.
 *
 * A probe rather than the live surface element, deliberately: the surface writes
 * its derived tokens as inline styles onto the same element that carries
 * `data-theme`, so reading the base back off it would return what we last wrote
 * and the derivation would chase its own tail. Cached — it can only change if
 * index.css does. */
const baseCache = new Map<ThemeMode, { surface: Rgb; ink: Rgb; brand: Rgb }>();

function basePalette(mode: ThemeMode): { surface: Rgb; ink: Rgb; brand: Rgb } {
  const fallback = {
    surface: { r: 26, g: 26, b: 46 },
    ink: { r: 232, g: 224, b: 208 },
    brand: { r: 200, g: 169, b: 110 },
  };
  const cached = baseCache.get(mode);
  if (cached) return cached;
  if (typeof document === 'undefined') return fallback;

  const probe = document.createElement('div');
  probe.dataset.theme = mode;
  probe.style.display = 'none';
  document.body.appendChild(probe);
  const read = (token: ThemeToken) =>
    parseChannels(getComputedStyle(probe).getPropertyValue(`--${token}`));
  const found = {
    surface: read('surface') ?? fallback.surface,
    ink: read('ink') ?? fallback.ink,
    brand: read('brand') ?? fallback.brand,
  };
  probe.remove();
  baseCache.set(mode, found);
  return found;
}

function withHue(base: Oklch, hue: number | null, tintChroma: number): Oklch {
  if (hue === null) return base;
  return { l: base.l, c: Math.max(base.c, tintChroma), h: ((hue % 360) + 360) % 360 };
}

export type ReadingPalette = {
  /** Which `[data-theme]` block the surface should carry, or null when the
   *  appearance is the default and should simply inherit. */
  mode: ThemeMode | null;
  vars: Partial<Record<ThemeToken, string>>;
  paper: Rgb;
  ink: Rgb;
  /** WCAG 2.1 ratio between the resolved paper and ink. */
  ratio: number;
};

/**
 * The paper/ink pair a given appearance starts from, before contrast.
 *
 * `appMode` is passed in rather than read off `<html>` so the derivation is a
 * function of its inputs: the attribute is written from an effect, so sampling
 * it here would be a render behind every theme switch, and would never notice
 * the OS flipping appearance at all. `useDocumentThemeMode()` supplies it.
 */
export function basePaperInk(a: ReadingAppearance, appMode: ThemeMode): PaperPreset {
  if (a.paper !== 'theme') return READING_PAPERS[a.paper];
  const base = basePalette(appMode);
  return { paper: srgbToOklch(base.surface), ink: srgbToOklch(base.ink) };
}

export function resolveReadingPalette(
  a: ReadingAppearance,
  appMode: ThemeMode,
): ReadingPalette {
  const base = basePaperInk(a, appMode);

  const paperHue = withHue(base.paper, a.paperHue, TINT_CHROMA_PAPER);
  const inkHue = withHue(base.ink, a.inkHue, TINT_CHROMA_INK);

  // The paper is fixed; only the ink travels, toward it and past it.
  //
  // The page's brightness is therefore whatever the chosen paper says, at every
  // contrast — you set the light you are reading by once, and the slider only
  // decides how strongly the text is printed on it. Moving both around their
  // midpoint (which this used to do) made every contrast change a change of
  // paper as well, which is a lot to have happen under one control.
  const k = a.contrast;
  const paperOk: Oklch = paperHue;
  // Chroma and hue converge on the paper's along with the lightness, so k = 0
  // lands the ink *exactly* on the paper rather than merely at its luminance —
  // otherwise the text stays visible as a colour after its contrast is gone.
  // Capped at 1 so pushing past the preset only drives lightness apart; it must
  // not start over-saturating the text.
  const inkOk: Oklch = {
    ...mixOklch(paperOk, inkHue, Math.min(k, 1)),
    l: clamp(paperOk.l + (inkHue.l - paperOk.l) * k, 0, 1),
  };

  const paper = oklchToSrgb(paperOk);
  const ink = oklchToSrgb(inkOk);
  const mode: ThemeMode = paperOk.l > 0.5 ? 'light' : 'dark';
  const ratio = contrastRatio(paper, ink);

  if (isDefaultPalette(a)) {
    return { mode: null, vars: {}, paper, ink, ratio };
  }

  // The gold keeps the app's own hue and chroma — index.css stays the only place
  // a colour is written down — but its lightness is re-placed relative to *this*
  // paper, so headings and verse numbers stay legible on a paper whoever tuned
  // that palette never saw.
  const goldSrc = srgbToOklch(basePalette(mode).brand);
  const dir = paperOk.l < 0.5 ? 1 : -1;
  // Scaled by the contrast too, so the *page* softens rather than just the body
  // text. Left at full strength, collapsing the contrast produced a page whose
  // verses had vanished while its chapter heading, drop cap and verse numbers
  // still shouted — which is not what "turn the contrast down" means.
  const gold = (dl: number): Rgb =>
    oklchToSrgb({
      l: clamp(paperOk.l + dir * dl * k, BRAND_L_MIN, BRAND_L_MAX),
      c: goldSrc.c,
      h: goldSrc.h,
    });

  const brand = gold(BRAND_DL);
  const onBrand = contrastRatio(brand, paper) >= contrastRatio(brand, ink) ? paper : ink;

  const inkMuted = oklchToSrgb({
    ...inkOk,
    l: inkOk.l + (paperOk.l - inkOk.l) * INK_MUTED_MIX,
  });

  return {
    mode,
    paper,
    ink,
    ratio,
    vars: {
      surface: channels(paper),
      // "Raised" lifts off the paper in both palettes — lighter, not "toward
      // the ink" (in the light theme the raised surface is white, away from it).
      'surface-raised': channels(oklchToSrgb({ ...paperOk, l: clamp(paperOk.l + RAISED_DL, 0, 1) })),
      'surface-sunken': channels(oklchToSrgb({ ...paperOk, l: clamp(paperOk.l - SUNKEN_DL, 0, 1) })),
      ink: channels(ink),
      'ink-muted': channels(inkMuted),
      brand: channels(brand),
      'brand-muted': channels(gold(BRAND_MUTED_DL)),
      'brand-bright': channels(gold(BRAND_BRIGHT_DL)),
      'on-brand': channels(onBrand),
      'card-none-bg': channels(
        oklchToSrgb({ ...paperOk, l: clamp(paperOk.l + RAISED_DL, 0, 1) }),
      ),
      'card-none-fg': channels(ink),
    },
  };
}

/**
 * The non-colour half: size, leading and measure, as custom properties so
 * changing them never re-renders the verse tree. `THEME_TOKENS` deliberately
 * doesn't cover these — they aren't colours — so they can't go through
 * `setPaletteVars`.
 */
export function setReadingVars(el: HTMLElement, a: ReadingAppearance): void {
  el.style.setProperty('--reading-font-size', `${a.fontSize}px`);
  el.style.setProperty('--reading-line-height', String(a.lineHeight));
  el.style.setProperty(
    '--reading-measure',
    a.measure >= MEASURE_MAX ? 'none' : `${a.measure}ch`,
  );
}

/** The two colours a preset chip shows, as CSS colours. */
export function paperSwatch(
  id: ReadingPaperId,
  appMode: ThemeMode,
): { paper: string; ink: string } {
  const base = basePaperInk({ ...DEFAULT_READING_APPEARANCE, paper: id }, appMode);
  return { paper: cssColor(oklchToSrgb(base.paper)), ink: cssColor(oklchToSrgb(base.ink)) };
}

/** Stops for a hue slider's track, previewing what each position does. */
export function hueTrackGradient(base: Oklch, tintChroma: number): string {
  const stops: string[] = [];
  for (let h = 0; h <= 360; h += 30) {
    stops.push(cssColor(oklchToSrgb({ l: base.l, c: Math.max(base.c, tintChroma), h })));
  }
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

export const PAPER_TINT_CHROMA = TINT_CHROMA_PAPER;
export const INK_TINT_CHROMA = TINT_CHROMA_INK;
