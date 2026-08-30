import { useLayoutEffect } from 'react';
import { useDocumentThemeMode } from '@/hooks/useDocumentThemeMode';
import { setPaletteVars, THEME_TOKENS } from '@/lib/theme';
import {
  resolveReadingPalette,
  setReadingVars,
  type ReadingAppearance,
} from '@/lib/readingAppearance';
import { useSettingsStore } from '@/store/settingsStore';

/**
 * Turn an element into a reading surface: the user's palette, type size and
 * measure, applied to it and inherited by everything under it.
 *
 * Written imperatively through the ref rather than returned as a `style` object
 * on purpose. Dragging a slider then repaints without re-rendering the verse
 * tree beneath, where every verse mounts a `WordHighlighter` holding two
 * playback-store selectors and the rAF loop is already rewriting `current`
 * ~60×/s.
 *
 * Returns the classes the element also needs — the typeface can't be a custom
 * property without duplicating the stacks that already live in tailwind.config.
 *
 * @param appearance overrides the stored value; the settings preview passes the
 *   value currently under the user's finger.
 */
export function useReadingSurface(
  ref: React.RefObject<HTMLElement | null>,
  appearance?: ReadingAppearance,
): string {
  const stored = useSettingsStore((s) => s.readingAppearance);
  const a = appearance ?? stored;
  // A `'theme'` paper is derived from the app's own palette, so it has to be
  // re-derived when that palette changes — including when the OS flips it.
  const appMode = useDocumentThemeMode();

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const palette = resolveReadingPalette(a, appMode);
    // Clear first: going back to the app theme has to *remove* what a custom
    // paper wrote, not leave a half-palette layered under it.
    for (const token of THEME_TOKENS) el.style.removeProperty(`--${token}`);
    if (palette.mode) el.dataset.theme = palette.mode;
    else delete el.dataset.theme;
    setPaletteVars(el, palette.vars);
    setReadingVars(el, a);
  }, [ref, a, appMode]);

  return a.fontFamily === 'sans' ? 'reading-surface font-sans' : 'reading-surface font-serif';
}
