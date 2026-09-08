import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BOOKS } from '@/services/bible/bookCatalog';
import { TOTAL_VERSES, VERSE_COUNTS } from '@/services/bible/verseCounts';

vi.mock('@/lib/cryptoRandom', () => ({ cryptoRandomInt: vi.fn() }));

const { cryptoRandomInt } = await import('@/lib/cryptoRandom');
const { pickRandomBook, pickUniformChapter, pickWeightedChapter } = await import(
  '@/services/bible/randomPassage'
);
const actual = await vi.importActual<typeof import('@/lib/cryptoRandom')>('@/lib/cryptoRandom');
const randInt = vi.mocked(cryptoRandomInt);

const PSALMS = 19;
const OBADIAH = 31;
const REVELATION = 66;
const sum = (a: readonly number[]) => a.reduce((x, y) => x + y, 0);
const versesIn = (bookId: number) => sum(VERSE_COUNTS[bookId - 1]);
const CHAPTER_COUNT = VERSE_COUNTS.reduce((n, c) => n + c.length, 0);

/** The draw is only as good as its RNG, and the rejection branch never fires
 * naturally, so it is worth one direct look. */
describe('cryptoRandomInt', () => {
  it('returns 0 for a range with no choice in it', () => {
    expect(actual.cryptoRandomInt(0)).toBe(0);
    expect(actual.cryptoRandomInt(1)).toBe(0);
    expect(actual.cryptoRandomInt(-5)).toBe(0);
  });

  it('stays inside [0, n)', () => {
    for (let i = 0; i < 500; i++) {
      const v = actual.cryptoRandomInt(7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(7);
    }
  });

  it('rejects a biased draw rather than returning it', () => {
    // limit = floor(0xffffffff / 3) * 3 = 4294967295. A value at or above the
    // limit must be discarded and redrawn, not folded in with `% n`.
    const seq = [0xffffffff, 4]; // first is >= limit, second is fine
    let i = 0;
    const spy = vi
      .spyOn(globalThis.crypto, 'getRandomValues')
      .mockImplementation(((buf: Uint32Array) => {
        buf[0] = seq[Math.min(i++, seq.length - 1)];
        return buf;
      }) as typeof crypto.getRandomValues);
    expect(actual.cryptoRandomInt(3)).toBe(1); // 4 % 3, i.e. the second draw
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
});

/**
 * `pickWeightedChapter()` is a binary search over running verse totals. Stub
 * the RNG and the mapping becomes exactly checkable — far better than inferring
 * it from samples.
 */
describe('pickWeightedChapter — the target maps to the chapter holding that verse', () => {
  const gen = VERSE_COUNTS[0]; // Genesis: 31, 25, 24, …

  it.each([
    { target: 0, chapter: 1, why: 'the very first verse is Genesis 1' },
    { target: gen[0] - 1, chapter: 1, why: 'the last verse of Genesis 1 is still Genesis 1' },
    { target: gen[0], chapter: 2, why: 'one past it rolls into Genesis 2' },
    { target: gen[0] + gen[1] - 1, chapter: 2, why: 'the last verse of Genesis 2' },
    { target: gen[0] + gen[1], chapter: 3, why: 'and one past that is Genesis 3' },
  ])('$why', ({ target, chapter }) => {
    randInt.mockReturnValue(target);
    expect(pickWeightedChapter()).toEqual({ bookId: 1, chapter });
  });

  it('the last verse in the Bible is Revelation 22', () => {
    randInt.mockReturnValue(TOTAL_VERSES - 1);
    expect(pickWeightedChapter()).toEqual({
      bookId: REVELATION,
      chapter: VERSE_COUNTS[REVELATION - 1].length,
    });
  });

  it('draws its target from the whole verse count, not the chapter count', () => {
    randInt.mockReturnValue(0);
    pickWeightedChapter();
    expect(randInt).toHaveBeenCalledWith(TOTAL_VERSES);
  });

  it('within one book, weights by that book’s own chapters', () => {
    randInt.mockReturnValue(0);
    expect(pickWeightedChapter(PSALMS)).toEqual({ bookId: PSALMS, chapter: 1 });
    expect(randInt).toHaveBeenLastCalledWith(versesIn(PSALMS));
  });
});

/**
 * The regression this function exists to prevent, asserted the way it actually
 * shows up. Drawing book → chapter → verse uniformly at each step is uniform at
 * every step and wildly non-uniform overall; the source records that it made
 * any given verse of Obadiah some 400x likelier than one of Psalms.
 *
 * So: over many draws the share landing in a book must track its share of
 * *verses*, not its share of *chapters*. Those two differ enough for Psalms
 * (7.9% of verses vs 12.6% of chapters) that a regression to either uniform
 * chapters or uniform books fails this outright.
 */
describe('pickWeightedChapter — uniform across all 31,102 verses', () => {
  const N = 40_000;
  beforeEach(() => randInt.mockImplementation(actual.cryptoRandomInt));

  it('lands in a book in proportion to its verses, not its chapters', () => {
    let psalms = 0;
    for (let i = 0; i < N; i++) if (pickWeightedChapter().bookId === PSALMS) psalms++;

    const share = psalms / N;
    const byVerses = versesIn(PSALMS) / TOTAL_VERSES; // 0.0791
    const byChapters = VERSE_COUNTS[PSALMS - 1].length / CHAPTER_COUNT; // 0.1262

    expect(share).toBeCloseTo(byVerses, 2);
    // Belt and braces: even a loose tolerance must not reach the uniform answer.
    expect(Math.abs(share - byVerses)).toBeLessThan(Math.abs(share - byChapters));
  });

  it('never returns a chapter the book does not have', () => {
    for (let i = 0; i < 2_000; i++) {
      const { bookId, chapter } = pickWeightedChapter();
      expect(chapter).toBeGreaterThanOrEqual(1);
      expect(chapter).toBeLessThanOrEqual(VERSE_COUNTS[bookId - 1].length);
    }
  });
});

/**
 * The chapter draw is deliberately *not* weighted — "a random chapter" means
 * every chapter equally likely, so Psalms gets 150 tickets and Obadiah one.
 * This is the contrast that keeps the two functions from being confused for
 * each other.
 */
describe('pickUniformChapter — uniform over the 1,189 chapters', () => {
  beforeEach(() => randInt.mockImplementation(actual.cryptoRandomInt));

  it('lands in a book in proportion to its chapters', () => {
    const N = 40_000;
    let psalms = 0;
    for (let i = 0; i < N; i++) if (pickUniformChapter().bookId === PSALMS) psalms++;
    expect(psalms / N).toBeCloseTo(VERSE_COUNTS[PSALMS - 1].length / CHAPTER_COUNT, 2);
  });

  it('a one-chapter book can only yield chapter 1', () => {
    for (let i = 0; i < 50; i++) {
      expect(pickUniformChapter(OBADIAH)).toEqual({ bookId: OBADIAH, chapter: 1 });
    }
  });

  it('asks for a chapter within the named book only', () => {
    randInt.mockReturnValue(0);
    expect(pickUniformChapter(PSALMS)).toEqual({ bookId: PSALMS, chapter: 1 });
    expect(randInt).toHaveBeenLastCalledWith(150);
  });
});

describe('pickRandomBook — uniform over the 66', () => {
  it('draws from the whole canon', () => {
    randInt.mockReturnValue(0);
    expect(pickRandomBook().id).toBe(1);
    expect(randInt).toHaveBeenCalledWith(BOOKS.length);
    expect(BOOKS).toHaveLength(66);
  });

  it('can reach the last book', () => {
    randInt.mockReturnValue(BOOKS.length - 1);
    expect(pickRandomBook().id).toBe(REVELATION);
  });
});

/** The catalog and the verse table are two descriptions of one thing, and
 * `bible:counts` asserts they agree. Restating the totals here means a spec
 * that quietly depends on them fails loudly if either is regenerated. */
describe('the tables the draw reads from', () => {
  it('still describes 1,189 chapters and 31,102 verses', () => {
    expect(CHAPTER_COUNT).toBe(1189);
    expect(TOTAL_VERSES).toBe(31102);
    expect(sum(BOOKS.map((b) => b.chapters))).toBe(1189);
  });
});
