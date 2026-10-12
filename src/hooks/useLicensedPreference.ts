import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import type { Translation } from '@/services/bible/bibleApi';
import {
  forbiddenBy,
  type TranslationFeature,
  type TranslationInfo,
} from '@/services/bible/translationCatalog';
import { readerTextsFrom } from '@/services/reading/readerSequence';
import { isReaderRoute } from '@/lib/appRoutes';
import { useCommunityStore } from '@/store/communityStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';

/**
 * A reading preference a translation's licence can rule out — endless scroll,
 * auto-play (`translationCatalog`'s `features`). A control needs all three
 * answers: what the user chose, which is kept as they set it whatever they
 * read; the translation that rules it out right now, which is why the control
 * is inactive and what it says; and whether it is actually in effect.
 */
export type LicensedPreference = {
  chosen: boolean;
  forbiddenBy: TranslationInfo | null;
  on: boolean;
};

function licensed(
  chosen: boolean,
  texts: Translation[],
  feature: TranslationFeature,
): LicensedPreference {
  const by = forbiddenBy(texts, feature) ?? null;
  return { chosen, forbiddenBy: by, on: chosen && by === null };
}

/** `readerTextsFrom` with every input selected, so a list edited or a plan
 * re-shared with a pinned entry reaches the memo. */
function useReaderTexts(): Translation[] {
  const source = useReaderStore((s) => s.source);
  const translation = useSettingsStore((s) => s.translation);
  const lists = useLibraryStore((s) => s.readingLists);
  const mirroredLists = useCommunityStore((s) => s.mirroredLists);
  return useMemo(
    () => readerTextsFrom(source, translation, { lists, mirroredLists }),
    [source, translation, lists, mirroredLists],
  );
}

/** Endless scroll, as the reader runs it — `readerStore`'s `endlessOn` asks
 * the same question for auto-continuation. */
export function useEndlessScroll(): LicensedPreference {
  const chosen = useSettingsStore((s) => s.readerEndlessScroll);
  const texts = useReaderTexts();
  return useMemo(() => licensed(chosen, texts, 'endlessScroll'), [chosen, texts]);
}

/**
 * Auto-play, as the screen you are on runs it. In the reader, the reader's
 * texts — list pins included, none for a shelf — which is what playback itself
 * asks about a reader passage (`playOnForbiddenBy`). Anywhere else, the
 * selected translation: it is what a reading the assistant starts is read in.
 */
export function useAutoPlay(): LicensedPreference {
  const chosen = useSettingsStore((s) => s.autoPlayReading);
  const translation = useSettingsStore((s) => s.translation);
  const onReader = isReaderRoute(useLocation().pathname);
  const readerTexts = useReaderTexts();
  return useMemo(
    () => licensed(chosen, onReader ? readerTexts : [translation], 'continuousPlay'),
    [chosen, onReader, readerTexts, translation],
  );
}
