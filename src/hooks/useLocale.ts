import { useTranslation } from 'react-i18next';
import { localeOf } from '@/i18n/locale';
import type { Locale } from '@/types/domain';

/**
 * Which of the app's two locales the UI is in.
 *
 * Reads the **live i18next language** rather than `settings.locale`, which is
 * what the thirteen inline copies of this did and is the behaviour to keep:
 * `i18n/index.ts` drives `changeLanguage` from the store, so i18next is the
 * downstream value and the one the rest of the render is already using through
 * `t()`. Going to the store instead would let a component's book names change a
 * tick before its labels did.
 *
 * Built on `useTranslation()` for the same reason: that subscription is what
 * re-renders the component when the language changes.
 */
export function useLocale(): Locale {
  const { i18n } = useTranslation();
  return localeOf(i18n.language);
}
