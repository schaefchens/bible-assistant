import { describe, expect, it } from 'vitest';
import {
  BIBLE_SOURCE,
  bibleSequence,
  expandList,
  findListSegment,
  isPostSegment,
  isWholeChapter,
  listSequence,
  sameSource,
  segmentId,
  type SegmentRef,
} from '@/services/reading/readingSequence';
import { readerSequenceFrom } from '@/services/reading/readerSequence';
import { isFlatList } from '@/services/reading/readingEntries';
import type { ReadingList } from '@/types/domain';

const GENESIS = 1;
const JONAH = 32;
const JOHN = 43;
const REVELATION = 66;

const list = (over: Partial<ReadingList> = {}): ReadingList => ({
  id: 'L1',
  name: 'Plan',
  days: [{ id: 'd1', entries: [] }],
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

/**
 * `segmentId` is a **format**, not an implementation detail: it is the playback
 * group key, so it binds queued audio to the verses on screen. Change a shape
 * and already-queued tracks stop resolving; the Bible shape is documented as
 * byte-identical to what shipped before deliberately.
 */
describe('segmentId — three shapes, pinned', () => {
  it('a chapter of the Bible', () => {
    expect(segmentId({ translation: 'LUT', bookId: JOHN, chapter: 3 })).toBe('reader:LUT:43:3');
  });

  it('a chapter of a reading list', () => {
    expect(
      segmentId({ translation: 'LUT', bookId: JOHN, chapter: 3, listId: 'L1', entryId: 'e1' }),
    ).toBe('reader:LUT:l:L1:e1:3');
  });

  it('one user-written post — no translation, because it has none', () => {
    expect(
      segmentId({ translation: 'KJV', bookId: 0, chapter: 0, spaceId: 'S1', postId: 'P1' }),
    ).toBe('reader:sp:S1:P1');
  });

  it('post identity wins over list identity', () => {
    // A post ref carries no list ids to fall back on, so the order of these
    // two branches is load-bearing.
    expect(
      segmentId({
        translation: 'KJV', bookId: 0, chapter: 0,
        spaceId: 'S1', postId: 'P1', listId: 'L1', entryId: 'e1',
      }),
    ).toBe('reader:sp:S1:P1');
  });

  it('embeds the translation, so switching text invalidates the group', () => {
    // Word counts differ between texts; letting queued TTS play on against
    // re-rendered verses desyncs the highlight with no way back.
    const ref = { translation: 'KJV' as const, bookId: JOHN, chapter: 3 };
    expect(segmentId(ref)).not.toBe(segmentId({ ...ref, translation: 'LUT' }));
  });

  it('is deterministic, so scrolling away and back re-binds', () => {
    const ref: SegmentRef = { translation: 'KJV', bookId: JOHN, chapter: 3 };
    expect(segmentId(ref)).toBe(segmentId({ ...ref }));
  });

  it('stays under the reader: namespace in every shape', () => {
    for (const ref of [
      { translation: 'KJV' as const, bookId: 1, chapter: 1 },
      { translation: 'KJV' as const, bookId: 1, chapter: 1, listId: 'L', entryId: 'e' },
      { translation: 'KJV' as const, bookId: 0, chapter: 0, spaceId: 'S', postId: 'P' },
    ]) {
      expect(segmentId(ref).startsWith('reader:')).toBe(true);
    }
  });
});

describe('isPostSegment / isWholeChapter', () => {
  it('needs both ids to be a post', () => {
    const base = { translation: 'KJV' as const, bookId: 0, chapter: 0 };
    expect(isPostSegment({ ...base, spaceId: 'S', postId: 'P' })).toBe(true);
    expect(isPostSegment({ ...base, spaceId: 'S' })).toBe(false);
    expect(isPostSegment(base)).toBe(false);
  });

  it('a whole chapter is one with no ranges', () => {
    const base = { translation: 'KJV' as const, bookId: JOHN, chapter: 3 };
    expect(isWholeChapter(base)).toBe(true);
    expect(isWholeChapter({ ...base, ranges: [] })).toBe(true);
    expect(isWholeChapter({ ...base, ranges: [{ start: 16, end: 16 }] })).toBe(false);
  });
});

describe('expandList', () => {
  it('fans a whole-book entry out to one segment per chapter', () => {
    // Jonah is 4 chapters; the entry names no chapter at all.
    const segs = expandList(list({ days: [{ id: 'd1', entries: [{ id: 'e1', bookId: JONAH }] }] }), 'KJV');
    expect(segs.map((s) => s.chapter)).toEqual([1, 2, 3, 4]);
    expect(new Set(segs.map((s) => s.entryId))).toEqual(new Set(['e1']));
  });

  it('fans a chapter span out across its chapters', () => {
    const segs = expandList(
      list({ days: [{ id: 'd1', entries: [{ id: 'e1', bookId: GENESIS, chapter: 1, chapterEnd: 3 }] }] }),
      'KJV',
    );
    expect(segs.map((s) => s.chapter)).toEqual([1, 2, 3]);
  });

  /**
   * "Genesis 1-3:5" is not something the parser can produce, and applying one
   * chapter's ranges to three would silently read the wrong verses.
   */
  it('drops ranges on a multi-chapter entry but keeps them on a single one', () => {
    const ranges = [{ start: 1, end: 5 }];
    const spanned = expandList(
      list({ days: [{ id: 'd1', entries: [{ id: 'e1', bookId: GENESIS, chapter: 1, chapterEnd: 3, ranges }] }] }),
      'KJV',
    );
    expect(spanned.every((s) => s.ranges === undefined)).toBe(true);

    const single = expandList(
      list({ days: [{ id: 'd1', entries: [{ id: 'e1', bookId: GENESIS, chapter: 1, ranges }] }] }),
      'KJV',
    );
    expect(single[0].ranges).toEqual(ranges);
  });

  it('marks an entry with its own translation as pinned, and only that one', () => {
    // The exemption that stops the reader "correcting" a deliberately German
    // entry to whatever is globally selected.
    const segs = expandList(
      list({
        days: [{ id: 'd1', entries: [
          { id: 'e1', bookId: GENESIS, chapter: 1, translation: 'LUT' },
          { id: 'e2', bookId: GENESIS, chapter: 2 },
        ] }],
      }),
      'KJV',
    );
    expect(segs[0]).toMatchObject({ translation: 'LUT', translationPinned: true });
    expect(segs[1].translation).toBe('KJV');
    expect(segs[1].translationPinned).toBeUndefined();
  });

  it('keeps entry order across days', () => {
    const segs = expandList(
      list({
        days: [
          { id: 'd1', title: 'Day 1', entries: [{ id: 'e1', bookId: GENESIS, chapter: 1 }] },
          { id: 'd2', title: 'Day 2', entries: [{ id: 'e2', bookId: GENESIS, chapter: 2 }] },
        ],
      }),
      'KJV',
    );
    expect(segs.map((s) => s.entryId)).toEqual(['e1', 'e2']);
  });

  /**
   * The decision that keeps "Day 1" off a plain list's heading and the picker's
   * groups. `isFlatList` owns it and nothing may re-derive it — a picker that
   * concluded groupedness from the segments it got made a two-day plan with an
   * empty second day into three different things at once.
   */
  describe('day structure is carried only when the list has one', () => {
    it('a plain list yields segments with no day at all', () => {
      const flat = list({ days: [{ id: 'd1', entries: [{ id: 'e1', bookId: GENESIS, chapter: 1 }] }] });
      expect(isFlatList(flat)).toBe(true);
      const seg = expandList(flat, 'KJV')[0];
      expect(seg.dayIndex).toBeUndefined();
      expect(seg.dayTitle).toBeUndefined();
    });

    it('a titled single day is NOT flat', () => {
      const titled = list({ days: [{ id: 'd1', title: 'Morning', entries: [{ id: 'e1', bookId: GENESIS, chapter: 1 }] }] });
      expect(isFlatList(titled)).toBe(false);
      expect(expandList(titled, 'KJV')[0]).toMatchObject({ dayIndex: 0, dayTitle: 'Morning' });
    });

    it('a two-day plan carries the day index even when a day is empty', () => {
      const plan = list({
        days: [
          { id: 'd1', entries: [{ id: 'e1', bookId: GENESIS, chapter: 1 }] },
          { id: 'd2', entries: [] },
        ],
      });
      expect(isFlatList(plan)).toBe(false);
      expect(expandList(plan, 'KJV')[0].dayIndex).toBe(0);
    });
  });
});

describe('findListSegment — re-resolving a stale copy', () => {
  // A SegmentRef is a copy, and copies of list data go stale (a renamed day, a
  // new translation override). Anything holding one re-resolves it.
  const plan = list({
    days: [{ id: 'd1', title: 'Day 1', entries: [{ id: 'e1', bookId: JONAH, chapter: 1 }, { id: 'e2', bookId: JONAH, chapter: 2 }] }],
  });

  it('finds the segment for an entry and chapter', () => {
    expect(findListSegment(plan, 'KJV', 'e2', 2)).toMatchObject({ entryId: 'e2', chapter: 2 });
  });

  it('is null when the entry is gone or the chapter does not match', () => {
    expect(findListSegment(plan, 'KJV', 'nope', 1)).toBeNull();
    expect(findListSegment(plan, 'KJV', 'e1', 9)).toBeNull();
  });
});

describe('bibleSequence', () => {
  const seq = bibleSequence('KJV');

  it('has no listable form — 1,189 chapters is a grid, not a list', () => {
    expect(seq.all()).toBeNull();
  });

  it('starts at Genesis 1 and stops at Revelation 22', () => {
    expect(seq.first()).toEqual({ translation: 'KJV', bookId: GENESIS, chapter: 1 });
    expect(seq.next({ translation: 'KJV', bookId: REVELATION, chapter: 22 })).toBeNull();
    expect(seq.prev({ translation: 'KJV', bookId: GENESIS, chapter: 1 })).toBeNull();
  });

  it('carries the translation into every step', () => {
    expect(seq.next({ translation: 'KJV', bookId: GENESIS, chapter: 1 })).toEqual({
      translation: 'KJV', bookId: GENESIS, chapter: 2,
    });
  });
});

describe('listSequence — a plan ends hard at both edges', () => {
  const plan = list({
    days: [{ id: 'd1', entries: [
      { id: 'e1', bookId: JONAH, chapter: 1 },
      { id: 'e2', bookId: JONAH, chapter: 2 },
    ] }],
  });
  const seq = listSequence(plan, 'KJV');
  const at = (entryId: string, chapter: number) => findListSegment(plan, 'KJV', entryId, chapter)!;

  it('walks in entry order', () => {
    expect(seq.first()).toMatchObject({ entryId: 'e1' });
    expect(seq.next(at('e1', 1))).toMatchObject({ entryId: 'e2' });
  });

  /** A plan that looped back to its start would never be finishable. */
  it('does not wrap at either end', () => {
    expect(seq.next(at('e2', 2))).toBeNull();
    expect(seq.prev(at('e1', 1))).toBeNull();
  });

  it('returns null for a segment that is not in the list', () => {
    expect(seq.next({ translation: 'KJV', bookId: JOHN, chapter: 3 })).toBeNull();
  });

  it('lists every segment, for the picker', () => {
    expect(seq.all()).toHaveLength(2);
  });
});

describe('sameSource', () => {
  it('two Bibles are the same source', () => {
    expect(sameSource(BIBLE_SOURCE, { kind: 'bible' })).toBe(true);
  });

  it('different kinds never match', () => {
    expect(sameSource(BIBLE_SOURCE, { kind: 'list', listId: 'L1' })).toBe(false);
  });

  it('lists match on id', () => {
    expect(sameSource({ kind: 'list', listId: 'L1' }, { kind: 'list', listId: 'L1' })).toBe(true);
    expect(sameSource({ kind: 'list', listId: 'L1' }, { kind: 'list', listId: 'L2' })).toBe(false);
  });

  /**
   * A selection is a *snapshot*, so asking for "everything new" again after
   * reading some of it is a new request under the same label. Comparing labels
   * would let a stale snapshot be mistaken for a fresh one.
   */
  it('selections match on their pieces, not their label', () => {
    const a = { kind: 'selection' as const, label: 'New', postIds: ['p1', 'p2'] };
    expect(sameSource(a, { kind: 'selection', label: 'Different label', postIds: ['p1', 'p2'] })).toBe(true);
    expect(sameSource(a, { kind: 'selection', label: 'New', postIds: ['p1'] })).toBe(false);
    expect(sameSource(a, { kind: 'selection', label: 'New', postIds: ['p2', 'p1'] })).toBe(false);
  });
});

/**
 * `readerSequenceFrom` is the pure half of what used to be two copies —
 * `readerStore.sequenceFor` and `useReaderSequence` — which had a comment on
 * each saying they must not diverge. The fallback branches are the point: a
 * source can outlive what it points at when another device deletes it.
 */
describe('readerSequenceFrom', () => {
  const empty = { lists: [], profile: null, spaces: [], posts: [], subscriptions: [], feed: {} };
  const plan = list({ days: [{ id: 'd1', entries: [{ id: 'e1', bookId: JONAH, chapter: 1 }] }] });

  it('walks a list when the list is there', () => {
    const seq = readerSequenceFrom({ kind: 'list', listId: 'L1' }, 'KJV', { ...empty, lists: [plan] });
    expect(seq.all()).toHaveLength(1);
  });

  it('falls back to the Bible when the list was deleted elsewhere', () => {
    // Not an error: clearing a filter must not leave the tab unable to navigate.
    const seq = readerSequenceFrom({ kind: 'list', listId: 'gone' }, 'KJV', empty);
    expect(seq.all()).toBeNull();
    expect(seq.first()).toEqual({ translation: 'KJV', bookId: GENESIS, chapter: 1 });
  });

  it('falls back to the Bible when a space cannot be resolved', () => {
    const seq = readerSequenceFrom({ kind: 'space', spaceId: 'gone' }, 'KJV', empty);
    expect(seq.all()).toBeNull();
  });

  it('serves a selection from its own ids, with no store lookup', () => {
    const seq = readerSequenceFrom(
      { kind: 'selection', label: 'New', postIds: [] }, 'KJV', empty,
    );
    expect(seq.all()).toEqual([]);
  });

  it('defaults to the Bible', () => {
    expect(readerSequenceFrom(BIBLE_SOURCE, 'LUT', empty).first()).toEqual({
      translation: 'LUT', bookId: GENESIS, chapter: 1,
    });
  });
});
