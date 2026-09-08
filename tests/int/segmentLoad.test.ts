import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReadingSequence, SegmentRef } from '@/services/reading/readingSequence';
import type { VerseSummary } from '@/types/domain';

/**
 * `loadSegment` decides what the reader is shown when the thing it asked for
 * is not there — and the two halves of that answer are opposites.
 *
 * A Bible chapter that is missing is **normal**: `BookEntry.chapters` is
 * English versification, so LUT genuinely has no Malachi 4, and a *step* walks
 * past it in the direction the user was already going. A missing **post** is a
 * real miss, and walking past it would show the reader a different piece than
 * the one they asked for — wrong content, silently, which is the top row of
 * CLAUDE.md's risk table.
 *
 * This had no test until `loadSegment` came out of `readerStore`: the store
 * built its own fetch and there was no way in. Now the locale is an argument
 * and nothing in the module reads a store, so only the two fetch edges are
 * faked — `sequence` is a plain object, because the loader only ever asks it
 * for a neighbour.
 *
 * The miss arrives two ways depending on the source (CLAUDE.md: "test it with
 * `isChapterMissing()`, never `instanceof` alone"), so both shapes appear
 * below: a 404 thrown by the online path, and the empty array every source
 * returning nothing produces.
 */

vi.mock('@/services/bible/verseSummaries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/bible/verseSummaries')>()),
  loadChapterSummaries: vi.fn(),
}));

vi.mock('@/services/community/spaceReading', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/community/spaceReading')>()),
  spacePostUnits: vi.fn(),
}));

const { loadChapterSummaries } = await import('@/services/bible/verseSummaries');
const { spacePostUnits } = await import('@/services/community/spaceReading');
const { loadSegment } = await import('@/services/reading/segmentLoader');
const { ApiError } = await import('@/services/api/client');

const chapter = vi.mocked(loadChapterSummaries);
const postUnits = vi.mocked(spacePostUnits);

const MALACHI = 39;
const MATTHEW = 40;

const verse = (n: number): VerseSummary =>
  ({ translation: 'KJV', bookId: MALACHI, chapter: 3, verse: n, text: `v${n}`, display: `v${n}` }) as VerseSummary;

/** A sequence that reports what it was asked and hands back a fixed neighbour. */
function fakeSequence(neighbour: SegmentRef | null = null) {
  const seq = {
    all: vi.fn(() => null),
    first: vi.fn(() => null),
    next: vi.fn(() => neighbour),
    prev: vi.fn(() => neighbour),
  };
  return seq as unknown as ReadingSequence & typeof seq;
}

const missing = () => new ApiError('not found', 404);

beforeEach(() => {
  chapter.mockReset();
  postUnits.mockReset();
});

describe('a missing post is never walked past', () => {
  const post: SegmentRef = {
    translation: 'KJV',
    bookId: 0,
    chapter: 0,
    spaceId: 'sp1',
    postId: 'p1',
  };

  it('reports it rather than showing the next piece', async () => {
    // The piece was deleted, or the space is no longer shared. Stepping on
    // would put a *different* author's writing under a heading the reader
    // chose — so this one must dead-end where a chapter would not.
    postUnits.mockReturnValue([]);
    const seq = fakeSequence({ translation: 'KJV', bookId: 0, chapter: 0, postId: 'p2' });

    const out = await loadSegment(post, 'forward', seq, 'en');

    expect(out.segment).toBeNull();
    expect(out.error?.kind).toBe('unavailable');
    expect(seq.next).not.toHaveBeenCalled();
  });

  it('is unavailable, not a network error — there is no network in the path', async () => {
    postUnits.mockImplementation(() => {
      throw new Error('nope');
    });

    const out = await loadSegment(post, 'none', fakeSequence(), 'en');

    expect(out.error?.kind).toBe('unavailable');
  });
});

describe('a versification gap is absorbed in the direction of travel', () => {
  const malachi4: SegmentRef = { translation: 'LUT', bookId: MALACHI, chapter: 4 };

  it.each([
    ['forward', 'the next book', MATTHEW, 1],
    ['backward', 'the sequence`s previous', MALACHI, 3],
  ] as const)('a %s step lands on %s', async (dir, _what, bookId, ch) => {
    chapter.mockImplementation(async (_t, b, c) =>
      b === bookId && c === ch ? [verse(1)] : Promise.reject(missing()),
    );

    const out = await loadSegment(
      malachi4,
      dir,
      fakeSequence({ translation: 'LUT', bookId: MALACHI, chapter: 3 }),
      'en',
    );

    expect(out.error).toBeNull();
    expect(out.segment?.ref.bookId).toBe(bookId);
    expect(out.segment?.ref.chapter).toBe(ch);
  });

  it('an explicit jump is told the passage is not there', async () => {
    // The user named this one in the picker. Quietly reading them something
    // else is worse than the error.
    chapter.mockRejectedValue(missing());
    const seq = fakeSequence({ translation: 'LUT', bookId: MATTHEW, chapter: 1 });

    const out = await loadSegment(malachi4, 'none', seq, 'en');

    expect(out.segment).toBeNull();
    expect(out.error).toEqual({
      kind: 'unavailable',
      translation: 'LUT',
      bookId: MALACHI,
      chapter: 4,
    });
    expect(seq.next).not.toHaveBeenCalled();
  });

  it('a step inside a list follows the list, not the next book', async () => {
    // A whole-book entry fans out using the catalog's chapter count, so the
    // gap turns up mid-plan — and there the next thing to read is the next
    // *entry*, which is rarely Matthew 1.
    const entry: SegmentRef = {
      translation: 'LUT',
      bookId: MALACHI,
      chapter: 4,
      listId: 'l1',
      entryId: 'e9',
    };
    const nextEntry: SegmentRef = {
      translation: 'LUT',
      bookId: 1,
      chapter: 1,
      listId: 'l1',
      entryId: 'e10',
    };
    chapter.mockImplementation(async (_t, b) => (b === 1 ? [verse(1)] : Promise.reject(missing())));
    const seq = fakeSequence(nextEntry);

    const out = await loadSegment(entry, 'forward', seq, 'en');

    expect(seq.next).toHaveBeenCalled();
    expect(out.segment?.ref.entryId).toBe('e10');
  });

  it('gives up after MAX_GAP_SKIP attempts instead of walking the whole Bible', async () => {
    // Every attempt is a request. A text that is simply unreachable must cost
    // a handful of them, not sixty-six.
    //
    // Removing the bound fails this spec by exhausting the heap rather than
    // by a red assertion — with no `attemptsLeft` the recursion has no end,
    // so the count below is never reached. That is the honest signal here:
    // don't 'fix' the crash by loosening the assertion.
    chapter.mockRejectedValue(missing());
    const seq = fakeSequence({ translation: 'LUT', bookId: MALACHI, chapter: 3 });

    const out = await loadSegment(malachi4, 'backward', seq, 'en');

    expect(out.segment).toBeNull();
    expect(chapter.mock.calls.length).toBeLessThanOrEqual(5);
  });

  it('an empty result is a miss too, not an empty chapter', async () => {
    // Offline, every source returns empty without throwing. Same user-facing
    // situation, so it takes the same path.
    chapter.mockImplementation(async (_t, b) => (b === MATTHEW ? [verse(1)] : []));

    const out = await loadSegment(malachi4, 'forward', fakeSequence(), 'en');

    expect(out.segment?.ref.bookId).toBe(MATTHEW);
  });
});

describe('what comes back is what the segment covers', () => {
  it('a verse range is sliced out of the chapter', async () => {
    // "Psalm 23:1-6" is a first-class segment. Handing back the whole chapter
    // would read past the end of what the list entry asked for.
    chapter.mockResolvedValue([verse(1), verse(2), verse(3), verse(4)]);

    const out = await loadSegment(
      { translation: 'KJV', bookId: MALACHI, chapter: 3, ranges: [{ start: 2, end: 3 }] },
      'none',
      fakeSequence(),
      'en',
    );

    expect(out.segment?.verses.map((v) => v.verse)).toEqual([2, 3]);
  });

  it('a failure that is not a missing chapter is a network error', async () => {
    // Drives what the reader is told: "this text doesn't have it" versus
    // "we couldn't reach it", which are different problems for the user.
    chapter.mockRejectedValue(new ApiError('bad gateway', 502));

    const out = await loadSegment(
      { translation: 'KJV', bookId: MALACHI, chapter: 3 },
      'forward',
      fakeSequence(),
      'en',
    );

    expect(out.error?.kind).toBe('network');
  });
});
