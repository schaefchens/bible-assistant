import type { ParsedReference } from './referenceParser';
import { apiPostJson } from '@/services/api/client';

export type Translation = 'S00' | 'ESV';

export type BollsBook = {
  bookid: number;
  name: string;
  chronorder: number;
  chapters: number;
};

export type BollsVerse = {
  pk: number;
  verse: number;
  text: string;
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
  if (ref.verseStart === undefined) return chapter;
  const start = ref.verseStart;
  const end = ref.verseEnd ?? ref.verseStart;
  return chapter.filter((v) => v.verse >= start && v.verse <= end);
}

export function stripHtml(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
