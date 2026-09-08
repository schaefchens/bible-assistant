import type { Locale } from '@/types/domain';

/**
 * Narrow a language tag to one of the two locales this app has.
 *
 * The app ships English and German, so every BCP-47 tag that arrives — from
 * i18next (`de`, `de-DE`, `de-CH`), from `navigator.language`, from a stored
 * preference — has to collapse to one of them, and anything unrecognised is
 * English because that is the `fallbackLng`.
 *
 * **This is the one copy of that rule.** It was written out fourteen times:
 * thirteen components and routes doing
 * `(i18n.language || 'en').startsWith('de') ? 'de' : 'en'` inline, plus
 * `settingsStore.detectLocale` doing the same test against `navigator.language`
 * — a different source, the same question. A third locale means editing this
 * function, not finding fourteen call sites.
 *
 * Components should reach for {@link useLocale} instead, which reads the *live*
 * i18next language and re-renders when it changes.
 */
export function localeOf(tag: string | undefined | null): Locale {
  return (tag ?? '').toLowerCase().startsWith('de') ? 'de' : 'en';
}
