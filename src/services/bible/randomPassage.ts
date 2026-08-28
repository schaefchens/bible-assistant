import { cryptoRandomInt } from '@/lib/cryptoRandom';
import { BOOKS, getBookById, type BookEntry } from './bookCatalog';
import { TOTAL_VERSES, VERSE_COUNTS } from './verseCounts';

/** What a random draw returns: a whole book to start reading, a whole chapter,
 * or a single verse. */
export type RandomUnit = 'verse' | 'chapter' | 'book';

export type ChapterPick = { bookId: number; chapter: number };

/** One chapter of the Bible with the running verse total *through* it, so a
 * weighted draw is a binary search rather than a 1,189-step walk. */
type ChapterSlot = ChapterPick & { versesThrough: number };

let slots: ChapterSlot[] | null = null;

/** Every chapter in canonical order, built once on first draw. */
function chapterSlots(): ChapterSlot[] {
  if (slots) return slots;
  const built: ChapterSlot[] = [];
  let versesThrough = 0;
  for (const book of BOOKS) {
    const counts = VERSE_COUNTS[book.id - 1] ?? [];
    for (let i = 0; i < counts.length; i++) {
      versesThrough += counts[i];
      built.push({ bookId: book.id, chapter: i + 1, versesThrough });
    }
  }
  slots = built;
  return built;
}

/** Uniform over the 66 books. */
export function pickRandomBook(): BookEntry {
  return BOOKS[cryptoRandomInt(BOOKS.length)];
}

/**
 * Uniform over chapters — every chapter equally likely, so Psalms gets 150
 * tickets and Obadiah one. That is what "a random chapter" means; weighting it
 * by length would just be the verse draw wearing a chapter's clothes.
 */
export function pickUniformChapter(bookId?: number): ChapterPick {
  if (bookId === undefined) {
    const all = chapterSlots();
    const { bookId: b, chapter } = all[cryptoRandomInt(all.length)];
    return { bookId: b, chapter };
  }
  const chapters = getBookById(bookId)?.chapters ?? VERSE_COUNTS[bookId - 1]?.length ?? 1;
  return { bookId, chapter: cryptoRandomInt(chapters) + 1 };
}

/**
 * Picks the chapter a uniformly-drawn *verse* would fall in — i.e. weighted by
 * how many verses each chapter holds. Drawing book-then-chapter-then-verse
 * instead (which is what this replaced) is uniform at each step but wildly
 * non-uniform overall: it made any given verse of Obadiah (1 chapter, 21
 * verses) some 400× likelier than any given verse of Psalms.
 *
 * Only the *chapter* comes from the table. The verse is drawn from the text
 * that actually comes back, so a translation whose chapter is shorter than
 * KJV's can't produce a verse number it doesn't have.
 */
export function pickWeightedChapter(bookId?: number): ChapterPick {
  if (bookId === undefined) {
    const all = chapterSlots();
    const target = cryptoRandomInt(TOTAL_VERSES);
    // First chapter whose running total is past the target.
    let lo = 0;
    let hi = all.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (all[mid].versesThrough > target) hi = mid;
      else lo = mid + 1;
    }
    return { bookId: all[lo].bookId, chapter: all[lo].chapter };
  }

  const counts = VERSE_COUNTS[bookId - 1] ?? [];
  const total = counts.reduce((sum, n) => sum + n, 0);
  if (total === 0) return { bookId, chapter: 1 };
  let target = cryptoRandomInt(total);
  for (let i = 0; i < counts.length; i++) {
    if (target < counts[i]) return { bookId, chapter: i + 1 };
    target -= counts[i];
  }
  return { bookId, chapter: counts.length };
}
