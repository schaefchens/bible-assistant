import type { Translation } from '@/services/bible/bibleApi';
import type { Locale } from '@/types/domain';

/** Single source of truth for translation→language decisions (announcement
 * text and TTS voice/locale). When adding a translation, classify it here —
 * nothing else needs to change. */
const GERMAN_TRANSLATIONS = new Set<Translation>(['S00', 'LUT', 'HFA', 'S51', 'ELB']);

export function isGermanTranslation(t: Translation): boolean {
  return GERMAN_TRANSLATIONS.has(t);
}

/** App locale ('de' | 'en') for a translation. */
export function localeForTranslation(t: Translation): Locale {
  return isGermanTranslation(t) ? 'de' : 'en';
}

/** BCP-47 language tag for the browser SpeechSynthesis voice. */
export function bcp47ForTranslation(t: Translation): 'de-DE' | 'en-US' {
  return isGermanTranslation(t) ? 'de-DE' : 'en-US';
}
