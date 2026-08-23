import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core';

/**
 * Theme application.
 *
 * The palettes themselves live in src/index.css as CSS custom properties on
 * `[data-theme]` selectors — deliberately not here. Two reasons: the first paint
 * is correct before any of this runs, and there is exactly one place a colour is
 * written down. This module only decides *which* palette is active and tells the
 * parts of the platform that CSS can't reach.
 *
 * Built to be widened later:
 *  - `[data-theme]` is an attribute selector, so it applies at any depth. A
 *    per-reader palette (sepia, night) is `<div data-theme="sepia">` plus a
 *    block in index.css — no change here.
 *  - `setPaletteVars()` writes tokens imperatively for palettes that cannot
 *    exist at build time, which is what a user-adjustable contrast control
 *    needs. THEME_TOKENS is the contract such a palette has to satisfy.
 */

export type ThemeChoice = 'system' | 'light' | 'dark';
export type ThemeMode = 'light' | 'dark';

/** Every token a complete palette defines. Keep in step with index.css. */
export const THEME_TOKENS = [
  'surface',
  'surface-raised',
  'surface-sunken',
  'ink',
  'ink-muted',
  'brand',
  'brand-muted',
  'brand-bright',
  'on-brand',
  'card-none-bg',
  'card-none-fg',
] as const;

export type ThemeToken = (typeof THEME_TOKENS)[number];

/** `prefers-color-scheme`, defaulting to dark — this app's original identity. */
export function systemThemeMode(): ThemeMode {
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function resolveThemeMode(choice: ThemeChoice): ThemeMode {
  return choice === 'system' ? systemThemeMode() : choice;
}

/**
 * Read a token back out of the cascade as a CSS colour.
 *
 * Used for the places that need a literal value (the theme-color meta tag).
 * Reading the computed value rather than keeping a copy here is what keeps
 * index.css the only place a colour is written down.
 */
function tokenColor(token: ThemeToken): string | null {
  if (typeof window === 'undefined') return null;
  const channels = getComputedStyle(document.documentElement)
    .getPropertyValue(`--${token}`)
    .trim();
  return channels ? `rgb(${channels})` : null;
}

/**
 * Point the native system bars' icon contrast at the resolved mode.
 *
 * Only the icons: `setStyle` has no background-colour counterpart, and the bars'
 * background comes from static XML on Android (values/ + values-night/), so it
 * follows the *device* rather than an in-app override. Forcing light on a dark
 * phone therefore leaves the bars dark — a known, documented edge case that
 * would need a native shim to close.
 */
function syncSystemBars(mode: ThemeMode): void {
  if (!Capacitor.isNativePlatform()) return;
  // DARK means "light content on a dark background" — so it pairs with our dark
  // theme, and LIGHT with our light one. Easy to read backwards.
  const style = mode === 'dark' ? SystemBarsStyle.Dark : SystemBarsStyle.Light;
  void SystemBars.setStyle({ style }).catch(() => {
    /* cosmetic — never worth failing a theme switch over */
  });
}

/** Apply a resolved mode to the document, the browser chrome and the OS bars. */
export function applyThemeMode(mode: ThemeMode): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = mode;

  // The address-bar / task-switcher colour. Read after the attribute is set so
  // it picks up the palette we just activated.
  const meta = document.querySelector('meta[name="theme-color"]');
  const color = tokenColor('surface');
  if (meta && color) meta.setAttribute('content', color);

  syncSystemBars(mode);
}

/** Resolve a choice and apply it. */
export function applyTheme(choice: ThemeChoice): ThemeMode {
  const mode = resolveThemeMode(choice);
  applyThemeMode(mode);
  return mode;
}

/**
 * Re-apply when the OS flips appearance. Only meaningful while the choice is
 * 'system'; callers re-subscribe when the choice changes.
 */
export function watchSystemTheme(onChange: (mode: ThemeMode) => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mq = window.matchMedia('(prefers-color-scheme: light)');
  const handler = () => onChange(mq.matches ? 'light' : 'dark');
  mq.addEventListener('change', handler);
  return () => mq.removeEventListener('change', handler);
}

/**
 * Write palette tokens directly onto an element, for palettes that don't exist
 * as a stylesheet block — a user-tuned contrast preset, say. Values are
 * space-separated RGB channels, matching index.css (see the comment there for
 * why hex won't do).
 *
 * Unused today; it is the seam that keeps user-defined themes from needing a
 * refactor of any of the above.
 */
export function setPaletteVars(
  el: HTMLElement,
  tokens: Partial<Record<ThemeToken, string>>,
): void {
  for (const [token, channels] of Object.entries(tokens)) {
    if (channels) el.style.setProperty(`--${token}`, channels);
  }
}
