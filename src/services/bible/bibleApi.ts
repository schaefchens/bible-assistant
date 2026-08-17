import type { ParsedReference } from './referenceParser';
// chapterSources imports only *types* from this module, so there's no runtime
// cycle despite the apparent circularity.
import { resolveChapter } from './chapterSources';

export type Translation =
  | 'S00'
  | 'ESV'
  | 'KJV'
  | 'NKJV'
  | 'LUT'
  | 'HFA'
  | 'S51'
  | 'ELB';

/** One run of words within a verse — `s` is the Strong's number (or
 * space-separated numbers) when the source bible carries them. */
export type VerseSegment = { t: string; s?: string };

export type BibleVerse = {
  pk: number;
  verse: number;
  text: string;
  /** TTS-ready variant: HTML, study notes, and bracketed editor inserts
   * removed by the PHP Zefania parser. */
  textTts?: string;
  /** Strong's-tagged word segments. Present only for the Strong's bibles
   * (LUT, S51, ELB). */
  segments?: VerseSegment[];
};

const chapterCache = new Map<string, BibleVerse[]>();
/** In-flight requests, so concurrent callers share one fetch. autoPlay and
 * useContinueReading both prefetch the same next chapter today and each used
 * to issue its own POST. */
const inflight = new Map<string, Promise<BibleVerse[]>>();

export async function getChapter(
  translation: Translation,
  bookId: number,
  chapter: number,
): Promise<BibleVerse[]> {
  const key = `${translation}:${bookId}:${chapter}`;
  const cached = chapterCache.get(key);
  if (cached) return cached;
  const pending = inflight.get(key);
  if (pending) return pending;

  // resolveChapter walks bundled packs then the network — see chapterSources.
  const p = resolveChapter(translation, bookId, chapter)
    .then((verses) => {
      chapterCache.set(key, verses);
      return verses;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, p);
  return p;
}

/**
 * Drop memoized chapters — call after deleting or upgrading a downloaded pack,
 * otherwise the in-memory cache keeps serving the old text until restart.
 */
export function invalidateChapterCache(translation?: Translation): void {
  if (!translation) {
    chapterCache.clear();
    return;
  }
  for (const k of chapterCache.keys()) {
    if (k.startsWith(`${translation}:`)) chapterCache.delete(k);
  }
}

export async function getVerses(
  translation: Translation,
  ref: ParsedReference,
): Promise<BibleVerse[]> {
  const chapter = await getChapter(translation, ref.bookId, ref.chapter);
  if (!ref.verseRanges || ref.verseRanges.length === 0) return chapter;
  return chapter.filter((v) =>
    ref.verseRanges!.some((r) => v.verse >= r.start && v.verse <= r.end),
  );
}

/** Clean a verse for display *and* TTS: drop HTML markup, bracketed editor
 * inserts ("[37]", "[SOME OF THE EARLIEST MANUSCRIPTS...]"), and any orphan
 * bracket characters left when a "[[ ... ]]" span crosses verse boundaries.
 * Used as a fallback for verses that arrive without a parser-supplied
 * `textTts` (shouldn't happen with the current XML pipeline, but keeps the
 * helper safe to apply unconditionally). */
export function stripHtml(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/\[+[^[\]]*\]+/g, '')
    .replace(/[[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Preferred TTS/display text for a verse — uses the parser's pre-cleaned
 * `textTts` when present, otherwise falls back to `stripHtml(text)`. */
export function verseSpeakable(v: BibleVerse): string {
  return v.textTts ?? stripHtml(v.text);
}
