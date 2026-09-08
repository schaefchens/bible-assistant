import { describe, expect, it } from 'vitest';
import { parseReference } from '@/services/bible/referenceParser';
import {
  nextBookRef,
  nextChapterRef,
  prevChapterRef,
} from '@/services/bible/chapterNavigation';
import { getBookById } from '@/services/bible/bookCatalog';

const GENESIS = 1;
const MALACHI = 39;
const MATTHEW = 40;
const JOHN = 43;
const GALATIANS = 48;
const REVELATION = 66;

/**
 * Two parsers, both pure, both the single source of truth for something the app
 * used to answer in several places. `chapterNavigation` is the more
 * consequential: its docblock records that the rule "was written three times
 * (autoPlay, useContinueReading, playbackPosition) and the copies disagreed
 * about book rollover".
 */

describe('parseReference — the shapes users and the model actually send', () => {
  it.each([
    { input: 'Galatians 5:22', bookId: GALATIANS, chapter: 5, ranges: [{ start: 22, end: 22 }] },
    { input: 'gal 5,22', bookId: GALATIANS, chapter: 5, ranges: [{ start: 22, end: 22 }] },
    { input: 'Galater 5,22', bookId: GALATIANS, chapter: 5, ranges: [{ start: 22, end: 22 }] },
    { input: 'mt 23:8-10', bookId: MATTHEW, chapter: 23, ranges: [{ start: 8, end: 10 }] },
    { input: '1. Mose 1', bookId: GENESIS, chapter: 1, ranges: undefined },
    { input: 'matthew 1', bookId: MATTHEW, chapter: 1, ranges: undefined },
    { input: 'John 3:16', bookId: JOHN, chapter: 3, ranges: [{ start: 16, end: 16 }] },
  ])('parses $input', ({ input, bookId, chapter, ranges }) => {
    expect(parseReference(input)).toMatchObject({ bookId, chapter });
    expect(parseReference(input)!.verseRanges).toEqual(ranges);
  });

  it('accepts an en- or em-dash where a hyphen belongs', () => {
    // Phones substitute these silently, and the model emits them too.
    for (const dash of ['–', '—']) {
      expect(parseReference(`Matthew 23:8${dash}10`)!.verseRanges).toEqual([{ start: 8, end: 10 }]);
    }
  });

  it('ignores surrounding whitespace', () => {
    expect(parseReference('   John 3:16  ')).toMatchObject({ bookId: JOHN, chapter: 3 });
  });

  it('is case-insensitive on the book name', () => {
    expect(parseReference('JOHN 3')).toMatchObject({ bookId: JOHN, chapter: 3 });
    expect(parseReference('john 3')).toMatchObject({ bookId: JOHN, chapter: 3 });
  });
});

describe('parseReference — non-contiguous verses', () => {
  it('keeps the gap in verseRanges', () => {
    expect(parseReference('Matthew 22:37,39')!.verseRanges).toEqual([
      { start: 37, end: 37 },
      { start: 39, end: 39 },
    ]);
  });

  it('mixes a range and a single', () => {
    expect(parseReference('Matthew 22:37-39,42')!.verseRanges).toEqual([
      { start: 37, end: 39 },
      { start: 42, end: 42 },
    ]);
  });

  /**
   * The trap the source warns about in as many words: the legacy convenience
   * pair spans the gap. A caller that reads verseStart..verseEnd on a
   * non-contiguous spec selects verses the user did not ask for.
   */
  it('exposes a verseStart..verseEnd interval that deliberately spans gaps', () => {
    const p = parseReference('Matthew 22:37,42')!;
    expect(p.verseStart).toBe(37);
    expect(p.verseEnd).toBe(42);
    expect(p.verseRanges).toEqual([
      { start: 37, end: 37 },
      { start: 42, end: 42 },
    ]);
  });
});

describe('parseReference — what it refuses', () => {
  it.each([
    { input: '', why: 'empty input' },
    { input: 'Hobbiton 1:1', why: 'a book that does not exist' },
    { input: 'John', why: 'a book with no chapter' },
    { input: '3:16', why: 'a chapter with no book' },
    { input: 'John 0', why: 'chapter zero' },
    { input: 'John 99', why: 'a chapter past the end of the book' },
    { input: 'John 3:16-12', why: 'a range that ends before it starts' },
    { input: 'John 3:abc', why: 'a non-numeric verse spec' },
  ])('returns null for $why', ({ input }) => {
    expect(parseReference(input)).toBeNull();
  });

  it('bounds the chapter by the book, not by a global maximum', () => {
    // Psalms has 150 chapters, Obadiah 1 — so the same number is valid in one
    // and not the other.
    expect(parseReference('Psalm 150')).toMatchObject({ chapter: 150 });
    expect(parseReference('Obadiah 2')).toBeNull();
  });
});

describe('nextChapterRef — the rule that used to exist three times', () => {
  it('steps within a book', () => {
    expect(nextChapterRef(GENESIS, 1)).toEqual({ bookId: GENESIS, chapter: 2 });
  });

  it('rolls into the next book at a book’s last chapter', () => {
    const genesis = getBookById(GENESIS)!;
    expect(nextChapterRef(GENESIS, genesis.chapters)).toEqual({ bookId: 2, chapter: 1 });
  });

  it('crosses the Old/New Testament seam like any other book boundary', () => {
    const malachi = getBookById(MALACHI)!;
    expect(nextChapterRef(MALACHI, malachi.chapters)).toEqual({ bookId: MATTHEW, chapter: 1 });
  });

  it('stops at Revelation 22 rather than wrapping to Genesis', () => {
    const rev = getBookById(REVELATION)!;
    expect(rev.chapters).toBe(22);
    expect(nextChapterRef(REVELATION, rev.chapters)).toBeNull();
  });

  it('treats a chapter past the book’s end as end-of-book', () => {
    // Reached via English versification pointing past what a German text has.
    expect(nextChapterRef(GENESIS, 999)).toEqual({ bookId: 2, chapter: 1 });
  });

  it('returns null for a book that does not exist', () => {
    expect(nextChapterRef(0, 1)).toBeNull();
    expect(nextChapterRef(67, 1)).toBeNull();
  });
});

describe('nextBookRef', () => {
  it('opens the following book at chapter 1', () => {
    expect(nextBookRef(GENESIS)).toEqual({ bookId: 2, chapter: 1 });
  });

  it('is null past Revelation', () => {
    expect(nextBookRef(REVELATION)).toBeNull();
    expect(nextBookRef(999)).toBeNull();
  });
});

describe('prevChapterRef', () => {
  it('steps back within a book', () => {
    expect(prevChapterRef(GENESIS, 2)).toEqual({ bookId: GENESIS, chapter: 1 });
  });

  it('rolls back into the previous book’s last chapter', () => {
    const genesis = getBookById(GENESIS)!;
    expect(prevChapterRef(2, 1)).toEqual({ bookId: GENESIS, chapter: genesis.chapters });
  });

  it('stops at Genesis 1', () => {
    expect(prevChapterRef(GENESIS, 1)).toBeNull();
  });
});

describe('forward and backward agree', () => {
  /** Stepping forward then back must land where you started, at every book
   * seam — the property the three divergent copies broke. */
  it('is reversible across every book boundary', () => {
    for (let id = 1; id < REVELATION; id++) {
      const book = getBookById(id)!;
      const fwd = nextChapterRef(id, book.chapters)!;
      expect(fwd).toEqual({ bookId: id + 1, chapter: 1 });
      expect(prevChapterRef(fwd.bookId, fwd.chapter)).toEqual({
        bookId: id,
        chapter: book.chapters,
      });
    }
  });

  it('walks the whole canon in exactly 1,189 steps', () => {
    let ref = { bookId: GENESIS, chapter: 1 };
    let steps = 1;
    for (;;) {
      const next = nextChapterRef(ref.bookId, ref.chapter);
      if (!next) break;
      ref = next;
      steps++;
      if (steps > 2000) throw new Error('canonical walk did not terminate');
    }
    expect(steps).toBe(1189);
    expect(ref).toEqual({ bookId: REVELATION, chapter: 22 });
  });
});
