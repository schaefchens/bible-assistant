import { useSyncExternalStore } from 'react';
import type { ThemeMode } from '@/lib/theme';

/**
 * The palette the document is currently on, as an *observed* value.
 *
 * `lib/theme.ts` owns `<html data-theme>` and writes it from an effect, so
 * reading the attribute during render is a tick behind whatever just changed it
 * — and nothing re-renders when the OS flips appearance under a `'system'`
 * choice. Anything deriving from the app's own palette (the `'theme'` paper)
 * has to watch the attribute rather than sample it, or it keeps yesterday's
 * colours until something unrelated re-renders it.
 */
function subscribe(onChange: () => void): () => void {
  if (typeof document === 'undefined') return () => {};
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
  return () => observer.disconnect();
}

function snapshot(): ThemeMode {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

export function useDocumentThemeMode(): ThemeMode {
  return useSyncExternalStore(subscribe, snapshot, () => 'dark');
}
