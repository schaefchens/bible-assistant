import { getBookById } from './bookCatalog';

/** Revelation. Canonical order stops here — no wrap-around to Genesis. */
const LAST_BOOK_ID = 66;

export type ChapterRef = { bookId: number; chapter: number };

/**
 * The canonical "one chapter forward" step, rolling into the next book at a
 * book's end and returning null at Revelation 22.
 *
 * This is the single source of truth for chapter boundaries. Before it existed
 * the same rule was written three times (autoPlay, useContinueReading,
 * playbackPosition) and the copies disagreed about book rollover.
 *
 * Caveat worth knowing: `BookEntry.chapters` is *English* versification, so for
 * the German translations this can point at a chapter that genuinely does not
 * exist (LUT has no Malachi 4). Callers that load the result must treat an
 * unavailable within-book chapter as end-of-book — see `nextBookRef`.
 */
export function nextChapterRef(bookId: number, chapter: number): ChapterRef | null {
  const book = getBookById(bookId);
  if (!book) return null;
  if (chapter < book.chapters) return { bookId, chapter: chapter + 1 };
  return nextBookRef(bookId);
}

/** Chapter 1 of the following book, or null past Revelation. */
export function nextBookRef(bookId: number): ChapterRef | null {
  if (bookId >= LAST_BOOK_ID) return null;
  return { bookId: bookId + 1, chapter: 1 };
}

/** One chapter back, rolling into the previous book's last chapter. Null at
 * Genesis 1. */
export function prevChapterRef(bookId: number, chapter: number): ChapterRef | null {
  if (chapter > 1) return { bookId, chapter: chapter - 1 };
  if (bookId <= 1) return null;
  const prev = getBookById(bookId - 1);
  if (!prev) return null;
  return { bookId: bookId - 1, chapter: prev.chapters };
}
