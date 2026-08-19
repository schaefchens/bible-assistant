import {
  getChapter,
  verseSpeakable,
  type BibleVerse,
  type Translation,
} from './bibleApi';
import { formatReference } from './bookCatalog';
import type { Locale, VerseSummary } from '@/types/domain';

/**
 * `BibleVerse[]` → `VerseSummary[]`, the playback-ready shape.
 *
 * `text` is deliberately `verseSpeakable(v)` — the exact string handed to TTS.
 * Rendering anything else (raw `v.text` with its HTML, a footnote marker) drifts
 * the word indices and `WordHighlighter`'s highlight silently desyncs from the
 * audio, so display and speech must share this one string.
 */
export function toVerseSummaries(
  translation: Translation,
  bookId: number,
  chapter: number,
  verses: BibleVerse[],
  locale: Locale,
): VerseSummary[] {
  return verses.map((v) => ({
    translation,
    bookId,
    chapter,
    verse: v.verse,
    text: verseSpeakable(v),
    display: formatReference(bookId, chapter, v.verse, v.verse, locale),
  }));
}

/** Fetch a whole chapter as summaries. `getChapter` is memoized and
 * in-flight-deduped, so calling this speculatively (prefetch, scroll-ahead) is
 * cheap and safe. */
export async function loadChapterSummaries(
  translation: Translation,
  bookId: number,
  chapter: number,
  locale: Locale,
): Promise<VerseSummary[]> {
  const verses = await getChapter(translation, bookId, chapter);
  return toVerseSummaries(translation, bookId, chapter, verses, locale);
}
