import type { ParsedReference } from './referenceParser';
import { apiPostJson } from '@/services/api/client';

export type Translation = 'S00' | 'ESV' | 'KJV' | 'NKJV' | 'LUT' | 'HFA';

export type BollsBook = {
  bookid: number;
  name: string;
  chronorder: number;
  chapters: number;
};

/** One run of words within a verse — `s` is the Strong's number (or
 * space-separated numbers) when the source bible carries them. */
export type VerseSegment = { t: string; s?: string };

export type BollsVerse = {
  pk: number;
  verse: number;
  text: string;
  /** TTS-ready variant: HTML, study notes, and bracketed editor inserts
   * removed. Populated by the PHP Zefania parser; absent for legacy
   * bolls.life rows, where callers should fall back to `stripHtml(text)`. */
  textTts?: string;
  /** Strong's-tagged word segments. Present only for the Strong's bibles
   * (currently just LUT among the user-facing translations). */
  segments?: VerseSegment[];
};

const BASE = 'https://bolls.life';
const BOOKS_CACHE_KEY = (t: Translation) => `ba.bollsBooks.${t}`;
const BOOKS_CACHE_TTL = 1000 * 60 * 60 * 24 * 30;

type CachedBooks = {
  fetchedAt: number;
  books: BollsBook[];
};

export async function getBooks(translation: Translation): Promise<BollsBook[]> {
  const cacheKey = BOOKS_CACHE_KEY(translation);
  const raw = localStorage.getItem(cacheKey);
  if (raw) {
    try {
      const cached = JSON.parse(raw) as CachedBooks;
      if (Date.now() - cached.fetchedAt < BOOKS_CACHE_TTL) {
        return cached.books;
      }
    } catch {
      /* fall through */
    }
  }
  const res = await fetch(`${BASE}/get-books/${translation}/`);
  if (!res.ok) throw new Error(`bolls.life books fetch failed: ${res.status}`);
  const books = (await res.json()) as BollsBook[];
  localStorage.setItem(cacheKey, JSON.stringify({ fetchedAt: Date.now(), books }));
  return books;
}

const chapterCache = new Map<string, BollsVerse[]>();

async function fetchChapterDirect(
  translation: Translation,
  bookId: number,
  chapter: number,
): Promise<BollsVerse[]> {
  const res = await fetch(`${BASE}/get-text/${translation}/${bookId}/${chapter}/`);
  if (!res.ok) throw new Error(`bolls.life chapter fetch failed: ${res.status}`);
  return (await res.json()) as BollsVerse[];
}

export async function getChapter(
  translation: Translation,
  bookId: number,
  chapter: number,
): Promise<BollsVerse[]> {
  const key = `${translation}:${bookId}:${chapter}`;
  const cached = chapterCache.get(key);
  if (cached) return cached;

  let verses: BollsVerse[];
  try {
    // Go through the server proxy first — it caches on disk alongside the
    // audio, so repeat fetches don't hit bolls.life across sessions/devices.
    const resp = await apiPostJson<{ verses: BollsVerse[]; cached: boolean }>(
      'bible.chapter',
      { translation, bookId, chapter },
    );
    verses = resp.verses;
  } catch {
    // Fallback to direct fetch (e.g., server unreachable / dev mode).
    verses = await fetchChapterDirect(translation, bookId, chapter);
  }
  chapterCache.set(key, verses);
  return verses;
}

export async function getVerses(
  translation: Translation,
  ref: ParsedReference,
): Promise<BollsVerse[]> {
  const chapter = await getChapter(translation, ref.bookId, ref.chapter);
  if (!ref.verseRanges || ref.verseRanges.length === 0) return chapter;
  return chapter.filter((v) =>
    ref.verseRanges!.some((r) => v.verse >= r.start && v.verse <= r.end),
  );
}

/** Clean a verse for display *and* TTS: drop HTML markup, bracketed editor
 * inserts ("[37]", "[SOME OF THE EARLIEST MANUSCRIPTS...]"), and any orphan
 * bracket characters left when a "[[ ... ]]" span crosses verse boundaries.
 * Mirrors `stripForTts` in api.php so legacy bolls.life rows arrive
 * normalized too. */
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
export function verseSpeakable(v: BollsVerse): string {
  return v.textTts ?? stripHtml(v.text);
}
