/**
 * Colour maths, in sRGB and OKLCH.
 *
 * Exists because the reading-appearance controls need two things CSS can't give
 * us: a *perceptual* lightness axis (so a "contrast" slider feels linear instead
 * of dying in its last 20%), and a contrast ratio to show the user. Both are
 * plain arithmetic, so this module is pure — no DOM, no stores, no imports.
 *
 * Values leave here as space-separated RGB channels (`channels()`), which is the
 * format every theme token is written in; see the comment at the top of
 * src/index.css for why hex is not an option.
 *
 * OKLab conversion constants are Björn Ottosson's.
 */

/** sRGB, 0–255 per channel. */
export type Rgb = { r: number; g: number; b: number };

/** OKLCH. `l` 0–1, `c` roughly 0–0.37, `h` degrees 0–360. */
export type Oklch = { l: number; c: number; h: number };

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

const clamp01 = (v: number) => clamp(v, 0, 1);

/* ---------------------------------------------------------------- transfer */

function toLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function fromLinear(c: number): number {
  const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return v * 255;
}

/* -------------------------------------------------------------- sRGB ⇄ OKLCH */

export function srgbToOklch(rgb: Rgb): Oklch {
  const r = toLinear(rgb.r);
  const g = toLinear(rgb.g);
  const b = toLinear(rgb.b);

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  const okL = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const okA = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const okB = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;

  const c = Math.hypot(okA, okB);
  // A neutral has no meaningful hue; report 0 rather than atan2's noise.
  const h = c < 1e-6 ? 0 : (Math.atan2(okB, okA) * 180) / Math.PI;
  return { l: okL, c, h: (h + 360) % 360 };
}

/** OKLCH → linear sRGB, unclamped, so the caller can test for gamut escape. */
function oklchToLinear(col: Oklch): [number, number, number] {
  const rad = (col.h * Math.PI) / 180;
  const okA = col.c * Math.cos(rad);
  const okB = col.c * Math.sin(rad);

  const l = (col.l + 0.3963377774 * okA + 0.2158037573 * okB) ** 3;
  const m = (col.l - 0.1055613458 * okA - 0.0638541728 * okB) ** 3;
  const s = (col.l - 0.0894841775 * okA - 1.291485548 * okB) ** 3;

  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const IN_GAMUT_EPS = 1e-4;
const inGamut = (lin: [number, number, number]) =>
  lin.every((c) => c >= -IN_GAMUT_EPS && c <= 1 + IN_GAMUT_EPS);

/**
 * OKLCH → sRGB, **gamut-mapped by reducing chroma** rather than by clamping the
 * channels. Clamping shifts hue — a too-saturated blue clips to purple — which
 * is exactly the wrong failure for a tint control the user is dragging. Holding
 * L and h and giving up chroma keeps the colour recognisably the one asked for.
 */
export function oklchToSrgb(col: Oklch): Rgb {
  let lin = oklchToLinear(col);
  if (!inGamut(lin)) {
    let lo = 0;
    let hi = col.c;
    // 12 halvings resolves chroma to ~1e-4, well under a channel step.
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinear({ ...col, c: mid }))) lo = mid;
      else hi = mid;
    }
    lin = oklchToLinear({ ...col, c: lo });
  }
  return {
    r: Math.round(clamp(fromLinear(clamp01(lin[0])), 0, 255)),
    g: Math.round(clamp(fromLinear(clamp01(lin[1])), 0, 255)),
    b: Math.round(clamp(fromLinear(clamp01(lin[2])), 0, 255)),
  };
}

/* ----------------------------------------------------------- token channels */

/** `{r:247,g:243,b:234}` → `"247 243 234"`, the theme-token format. */
export function channels(rgb: Rgb): string {
  return `${rgb.r} ${rgb.g} ${rgb.b}`;
}

/** The inverse, for reading a token back out of the cascade. */
export function parseChannels(value: string): Rgb | null {
  const parts = value.trim().split(/[\s,/]+/).slice(0, 3).map(Number);
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return null;
  return { r: parts[0], g: parts[1], b: parts[2] };
}

/** `"247 243 234"` → `"rgb(247 243 234)"`, for inline previews and gradients. */
export function cssColor(rgb: Rgb): string {
  return `rgb(${rgb.r} ${rgb.g} ${rgb.b})`;
}

/* ------------------------------------------------------------------- WCAG */

/** WCAG 2.1 relative luminance. */
export function relativeLuminance(rgb: Rgb): number {
  return (
    0.2126 * toLinear(rgb.r) + 0.7152 * toLinear(rgb.g) + 0.0722 * toLinear(rgb.b)
  );
}

/** WCAG 2.1 contrast ratio, 1…21. Order-independent. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Linear interpolation in OKLCH, taking the short way round the hue circle. */
export function mixOklch(from: Oklch, to: Oklch, t: number): Oklch {
  let dh = ((to.h - from.h + 540) % 360) - 180;
  // A neutral endpoint has no hue to travel to; hold the other's.
  if (to.c < 1e-4 || from.c < 1e-4) dh = 0;
  return {
    l: from.l + (to.l - from.l) * t,
    c: from.c + (to.c - from.c) * t,
    h: (from.h + dh * t + 360) % 360,
  };
}
