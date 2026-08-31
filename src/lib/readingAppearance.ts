import {
  channels,
  clamp,
  contrastRatio,
  cssColor,
  maxChromaFor,
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
 * The colour part is a *derivation*, not a stored palette, and it derives from
 * **one** colour. A chip supplies the lightness pair — which end is paper, which
 * is ink, and how far apart — while the colour picked for that chip supplies the
 * hue and how saturated the page is. So one brown gives a cream page with
 * brown-black text on the light chips and a dark-brown page with cream text on
 * the dark ones; a chip always keeps its character, and the colour is what
 * changes.
 *
 * Chroma is scaled by `maxChromaFor()` at each end's lightness rather than being
 * a fixed number, because sRGB has ~4× more room at the ink's lightness than at
 * a near-white paper's. An earlier version used one absolute floor for both and
 * was invisible on paper while overshooting in ink.
 *
 * The contrast slider then slides the ink toward the paper and past it, with the
 * paper held where the chip put it:
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
  /**
   * The colour picked *for each chip*, as `#rrggbb`; absent means that chip's
   * own default. Per chip rather than shared so a chip keeps its name honest —
   * recolouring Night must not turn Sepia blue — and so switching between them
   * is switching between two finished looks, not re-picking a colour.
   *
   * Only the hue and chroma are used; the lightness comes from the chip.
   */
  paperColors: Partial<Record<ReadingPaperId, string>>;
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
  paperColors: {},
  contrast: 1,
  fontSize: 17,
  lineHeight: 1.88,
  fontFamily: 'serif',
  measure: MEASURE_MAX,
  dualColumn: false,
};

/** A chip: where the paper and the ink sit on the lightness axis, and the colour
 *  it wears until the user picks another. */
type PaperChip = { paperL: number; inkL: number; defaultColor: string };

/**
 * The built-in chips. The lightness pairs are what give each its character —
 * three light steps, two dark — and every pair sits between 9.9:1 and 14.6:1 at
 * contrast 1, so all of them start past AAA with room to move either way.
 *
 * `defaultColor` only contributes hue and chroma; its own lightness is ignored.
 * Grey and Black default to a true neutral, which is the point of them.
 * `theme` has no entry — its lightnesses and its colour come from the live
 * cascade, so it follows whatever the app palette is.
 */
export const READING_PAPERS: Record<Exclude<ReadingPaperId, 'theme'>, PaperChip> = {
  paper: { paperL: 0.972, inkL: 0.255, defaultColor: '#8a7a52' },
  sepia: { paperL: 0.925, inkL: 0.31, defaultColor: '#8a6a3a' },
  grey: { paperL: 0.86, inkL: 0.27, defaultColor: '#808080' },
  night: { paperL: 0.216, inkL: 0.905, defaultColor: '#5a5a8c' },
  black: { paperL: 0.05, inkL: 0.82, defaultColor: '#808080' },
};

/**
 * The hues the swatch grid offers, and how saturated each row is — **as a
 * fraction of the chroma available at that lightness**, never as an absolute.
 *
 * This is the same lesson as the tint floors, one layer up. Absolute chroma
 * levels (0.045 / 0.09 / 0.16) exceeded the headroom at every lightness except
 * the middle, so `min(request, headroom)` clamped them together: all three rows
 * produced an *identical* page on Paper, Night and Black, and only Grey used the
 * full set. Two thirds of the grid was dead on four chips out of five.
 *
 * As fractions, every chip gets three genuinely distinct steps scaled to what it
 * can hold, and a row is equally saturated across hues — an absolute 0.09 is
 * near the limit for yellow and unremarkable for blue.
 *
 * The top stops short of 1: sitting exactly on the gamut boundary is where
 * `oklchToSrgb`'s chroma reduction starts fighting the hue, and a page is a
 * background rather than a highlight.
 */
const SWATCH_HUES = [30, 60, 90, 150, 200, 250, 290, 340];
const SWATCH_LEVELS = [0.3, 0.6, 0.9];

/** Rendered at a mid lightness so every hue reads clearly whichever chip is
 *  selected — the swatch shows the *colour*, the preview above shows the page. */
const SWATCH_L = 0.62;

/** "No colour": a page tinted by nothing, whatever its chip's lightness. */
export const TINT_NEUTRAL: string = hexOf({ l: SWATCH_L, c: 0, h: 0 });

/** A swatch at `level` of the chroma its hue can hold at the swatch lightness. */
function swatchHex(h: number, level: number): string {
  return hexOf({ l: SWATCH_L, c: maxChromaFor(SWATCH_L, h) * level, h });
}

/**
 * The hue × saturation matrix, in row-major order: one row per level in
 * SWATCH_LEVELS, one column per hue in SWATCH_HUES. Kept rectangular (and the
 * neutral kept out of it) so the grid can be laid out as rows of equal
 * saturation — mixed into one array of 25, the levels straddle the rows and the
 * grid reads as noise.
 */
export const TINT_SWATCH_COLUMNS = SWATCH_HUES.length;

export const TINT_SWATCHES: string[] = SWATCH_LEVELS.flatMap((level) =>
  SWATCH_HUES.map((h) => swatchHex(h, level)),
);

function hexOf(col: Oklch): string {
  const { r, g, b } = oklchToSrgb(col);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function parseHex(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export const READING_PAPER_IDS: ReadingPaperId[] = [
  'theme',
  'paper',
  'sepia',
  'grey',
  'night',
  'black',
];


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
  return a.paper === 'theme' && a.contrast === 1 && a.paperColors.theme === undefined;
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
 * The chip a given appearance is on, resolved.
 *
 * `appMode` is passed in rather than read off `<html>` so the derivation is a
 * function of its inputs: the attribute is written from an effect, so sampling
 * it here would be a render behind every theme switch, and would never notice
 * the OS flipping appearance at all. `useDocumentThemeMode()` supplies it.
 */
export function chipOf(id: ReadingPaperId, appMode: ThemeMode): PaperChip {
  if (id !== 'theme') return READING_PAPERS[id];
  // The app's own palette, so 'theme' is genuinely "as the app looks".
  const base = basePalette(appMode);
  return {
    paperL: srgbToOklch(base.surface).l,
    inkL: srgbToOklch(base.ink).l,
    defaultColor: cssHex(base.surface),
  };
}

function cssHex(rgb: Rgb): string {
  return `#${[rgb.r, rgb.g, rgb.b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** The colour in force for a chip — the user's pick, else the chip's default. */
export function mainColorFor(
  a: ReadingAppearance,
  id: ReadingPaperId,
  appMode: ThemeMode,
): string {
  return a.paperColors[id] ?? chipOf(id, appMode).defaultColor;
}

/**
 * Paper and ink for a chip and a colour: lightness from the chip, hue from the
 * colour, chroma from the colour but capped by what each lightness can hold.
 */
function paperInkFor(chip: PaperChip, mainColor: string): { paper: Oklch; ink: Oklch } {
  const rgb = parseHex(mainColor);
  const main = rgb ? srgbToOklch(rgb) : { l: 0.5, c: 0, h: 0 };

  // Carry the pick's saturation *relative to its own lightness*, not its raw
  // chroma. That is what transfers a colour intact onto a near-white paper and
  // a near-black ink at once: each end spends the same share of the very
  // different room it has. Raw chroma clamps to the same value at both.
  const room = maxChromaFor(main.l, main.h);
  const saturation = room > 1e-4 ? Math.min(1, main.c / room) : 0;

  const at = (l: number): Oklch => ({
    l,
    c: maxChromaFor(l, main.h) * saturation,
    h: main.h,
  });
  return { paper: at(chip.paperL), ink: at(chip.inkL) };
}

export function resolveReadingPalette(
  a: ReadingAppearance,
  appMode: ThemeMode,
): ReadingPalette {
  const chip = chipOf(a.paper, appMode);
  const { paper: paperHue, ink: inkHue } = paperInkFor(
    chip,
    mainColorFor(a, a.paper, appMode),
  );

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

/** The two colours a chip shows on its own button, honouring its picked colour. */
export function paperSwatch(
  a: ReadingAppearance,
  id: ReadingPaperId,
  appMode: ThemeMode,
): { paper: string; ink: string } {
  const { paper, ink } = paperInkFor(chipOf(id, appMode), mainColorFor(a, id, appMode));
  return { paper: cssColor(oklchToSrgb(paper)), ink: cssColor(oklchToSrgb(ink)) };
}

