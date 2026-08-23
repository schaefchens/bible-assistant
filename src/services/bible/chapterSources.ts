import { Capacitor } from '@capacitor/core';
import { ApiError, apiPostJson } from '@/services/api/client';
import { bookKey, packDb } from '@/db/bibleDexie';
import type { BibleVerse, Translation } from './bibleApi';
import {
  BUNDLED_PACK_VERSION,
  decodeChapter,
  isPreinstalled,
  type BookPack,
} from './packFormat';

/**
 * A place chapters can come from.
 *
 * `null` means "I don't have this" — try the next source. A thrown error means
 * "I should have had this and failed", which is preserved so the caller still
 * sees a real ApiError rather than a generic miss.
 */
export interface ChapterSource {
  readonly name: string;
  getChapter(
    translation: Translation,
    bookId: number,
    chapter: number,
  ): Promise<BibleVerse[] | null>;
}

/* ---------------------------------------------------------------- bundled -- */

/**
 * Packs shipped inside the app binary. `cap sync` copies webDir into
 * ios/App/App/public and android/.../assets/public, both of which the WebView
 * serves locally — so this fetch never touches the network and needs no
 * plugin, no copyFromAssets, and no first-launch import step.
 */
const bundledCache = new Map<string, BookPack>();
const BUNDLED_LRU = 2; // reads are sequential within a book; two is plenty

async function loadBundledBook(
  translation: Translation,
  bookId: number,
): Promise<BookPack | null> {
  const key = `${translation}:${bookId}`;
  const hit = bundledCache.get(key);
  if (hit) return hit;

  const url = `${import.meta.env.BASE_URL}bible-packs/${translation}/${BUNDLED_PACK_VERSION}/${bookId}.json`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const pack = (await res.json()) as BookPack;

  bundledCache.set(key, pack);
  if (bundledCache.size > BUNDLED_LRU) {
    const oldest = bundledCache.keys().next().value;
    if (oldest !== undefined) bundledCache.delete(oldest);
  }
  return pack;
}

export const bundledSource: ChapterSource = {
  name: 'bundled',
  async getChapter(translation, bookId, chapter) {
    if (!isPreinstalled(translation)) return null;
    const pack = await loadBundledBook(translation, bookId);
    return pack ? decodeChapter(pack, chapter) : null;
  },
};

/* -------------------------------------------------------------- downloaded -- */

/**
 * Packs the user downloaded, held in the `bible-assistant-packs` Dexie DB.
 *
 * Rows store the pack as a JSON *string*, so this parses on read — ~0.5 ms for
 * a 76 KB book, and the parsed result is memoized by the same 2-book LRU idea
 * as the bundled source.
 */
const localCache = new Map<string, BookPack>();
const LOCAL_LRU = 2;

async function loadLocalBook(
  translation: Translation,
  bookId: number,
): Promise<BookPack | null> {
  const key = bookKey(translation, bookId);
  const hit = localCache.get(key);
  if (hit) return hit;

  const row = await packDb.books.get(key);
  if (!row) return null;

  const pack = JSON.parse(row.json) as BookPack;
  localCache.set(key, pack);
  if (localCache.size > LOCAL_LRU) {
    const oldest = localCache.keys().next().value;
    if (oldest !== undefined) localCache.delete(oldest);
  }
  return pack;
}

/** Drop parsed packs after a delete/upgrade, mirroring invalidateChapterCache. */
export function invalidateLocalPackCache(translation?: Translation): void {
  if (!translation) {
    localCache.clear();
    return;
  }
  for (const k of localCache.keys()) {
    if (k.startsWith(`${translation}:`)) localCache.delete(k);
  }
}

export const localPackSource: ChapterSource = {
  name: 'localPack',
  async getChapter(translation, bookId, chapter) {
    // Only skip what bundledSource has already handled — which, on web, is
    // nothing: there LUT/KJV are downloaded into Dexie like any other pack.
    if (isPreinstalled(translation)) return null;
    const pack = await loadLocalBook(translation, bookId);
    return pack ? decodeChapter(pack, chapter) : null;
  },
};

/* ----------------------------------------------------------------- network -- */

export const networkSource: ChapterSource = {
  name: 'network',
  async getChapter(translation, bookId, chapter) {
    const resp = await apiPostJson<{ verses: BibleVerse[]; cached: boolean }>(
      'bible.chapter',
      { translation, bookId, chapter },
    );
    return resp.verses;
  },
};

/* ---------------------------------------------------------------- resolver -- */

export class ChapterUnavailableError extends Error {
  translation: Translation;
  bookId: number;
  chapter: number;

  constructor(translation: Translation, bookId: number, chapter: number) {
    super(`chapter unavailable: ${translation} ${bookId}:${chapter}`);
    this.name = 'ChapterUnavailableError';
    this.translation = translation;
    this.bookId = bookId;
    this.chapter = chapter;
  }
}

/**
 * Native reads bundled packs first — they're local files, so they're both the
 * fastest option and the only one that works offline.
 *
 * Web deliberately skips them: there the same packs are 76–557 KB HTTP fetches
 * that the service worker doesn't precache, which is both slower than the ~4 KB
 * bible.chapter POST and no use offline. Web reaches the same texts through
 * localPackSource instead, by downloading them — see isPreinstalled().
 */
const SOURCES: ChapterSource[] = Capacitor.isNativePlatform()
  ? [bundledSource, localPackSource, networkSource]
  : [localPackSource, networkSource];

/**
 * Whether a failed chapter resolution means "this translation simply doesn't
 * have that chapter" — as opposed to a network or server problem.
 *
 * Two shapes mean the same thing, because the offline and online paths report it
 * differently: the pack path throws ChapterUnavailableError when every source
 * came up empty, and `bible.chapter` answers 404 "chapter not found" when the
 * Zefania parse finds no such chapter.
 *
 * This is a routine situation, not an exotic one: `BookEntry.chapters` is English
 * versification, so the German texts legitimately lack chapters the catalog
 * advertises (LUT's Malachi ends at 3 where KJV has 4). Callers stepping forward
 * should treat it as end-of-book and roll into the next book.
 */
export function isChapterMissing(e: unknown): boolean {
  if (e instanceof ChapterUnavailableError) return true;
  return e instanceof ApiError && e.status === 404;
}

export async function resolveChapter(
  translation: Translation,
  bookId: number,
  chapter: number,
): Promise<BibleVerse[]> {
  let lastError: unknown;
  for (const source of SOURCES) {
    try {
      const verses = await source.getChapter(translation, bookId, chapter);
      if (verses && verses.length > 0) return verses;
    } catch (e) {
      lastError = e;
    }
  }
  // Preserve the original failure (usually an ApiError) so existing callers
  // that inspect status codes keep working.
  if (lastError) throw lastError;
  throw new ChapterUnavailableError(translation, bookId, chapter);
}
