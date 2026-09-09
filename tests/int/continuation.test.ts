import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReadingGroup, ReadingHost } from '@/lib/readingHosts';
import type { BibleVerse } from '@/services/bible/bibleApi';
import type { ReadingList, VerseSummary } from '@/types/domain';

/**
 * `nextReadingAfter` is the highest-consequence rule in the app: it is the one
 * place where a mistake produces **wrong audio** rather than a wrong label.
 * CLAUDE.md records that it "previously existed three times (autoPlay,
 * readerStore, useContinueReading) and the copies disagreed about book
 * rollover", and that without the post guard "auto-play reads a blog post and
 * then starts Genesis".
 *
 * Integration rather than unit: the rule reads two stores, the host registry
 * and `getChapter`. Only `getChapter` — the network edge — is faked; the
 * registry is the real one, driven through its own `register()`.
 */

vi.mock('@/services/bible/bibleApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/bible/bibleApi')>()),
  getChapter: vi.fn(),
}));

const { getChapter } = await import('@/services/bible/bibleApi');
const { readingHosts } = await import('@/lib/readingHosts');
const { nextReadingAfter, continuationKey, isWholeChapterReading } = await import(
  '@/lib/readingContinuation'
);
const { useLibraryStore } = await import('@/store/libraryStore');
const { useCommunityStore } = await import('@/store/communityStore');
const { useSettingsStore } = await import('@/store/settingsStore');

const fetchChapter = vi.mocked(getChapter);

const GENESIS = 1;
const MALACHI = 39;
const MATTHEW = 40;
const JOHN = 43;
const JONAH = 32;
const REVELATION = 66;

/** Chapter lengths the faked `getChapter` will answer with. Anything not named
 * here comes back empty, which is how a translation lacking a chapter looks. */
let chapterLengths: Record<string, number> = {};
const has = (bookId: number, chapter: number, verses: number) => {
  chapterLengths[`${bookId}:${chapter}`] = verses;
};

/** A group registered under our own namespace, so the real registry dispatches
 * to it exactly as it would to chat or the reader. */
const groups = new Map<string, ReadingGroup>();

const verse = (bookId: number, chapter: number, v: number, over: Partial<VerseSummary> = {}): VerseSummary => ({
  translation: 'KJV',
  bookId,
  chapter,
  verse: v,
  text: `verse ${v}`,
  display: `${bookId} ${chapter}:${v}`,
  ...over,
});

/** A whole chapter as a group, the way the reader always produces one. */
const wholeChapter = (bookId: number, chapter: number, upTo: number): VerseSummary[] =>
  Array.from({ length: upTo }, (_, i) => verse(bookId, chapter, i + 1));

const register = (id: string, group: Omit<ReadingGroup, 'id'>) => {
  groups.set(id, { id, ...group });
  return id;
};

const list = (over: Partial<ReadingList> = {}): ReadingList => ({
  id: 'L1',
  name: 'Plan',
  days: [{ id: 'd1', entries: [] }],
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

beforeEach(() => {
  groups.clear();
  chapterLengths = {};
  const host: ReadingHost = {
    ns: 'test',
    getGroup: (id) => groups.get(id) ?? null,
    listGroups: () => [...groups.values()],
    defaultGroup: () => null,
    previousGroup: async () => null,
    appendReading: async () => null,
  };
  readingHosts.register(host);

  fetchChapter.mockImplementation(async (_t, bookId, chapter) => {
    const n = chapterLengths[`${bookId}:${chapter}`] ?? 0;
    return Array.from({ length: n }, (_, i) => ({ verse: i + 1, text: `v${i + 1}` })) as BibleVerse[];
  });

  useLibraryStore.setState({ readingLists: [] });
  useCommunityStore.setState({ mirroredLists: [] });
  useSettingsStore.setState({ translation: 'KJV' });
});

describe('nothing to continue from', () => {
  it('is null for an unknown group', async () => {
    expect(await nextReadingAfter('test:missing')).toBeNull();
  });

  it('is null for a group with no verses', async () => {
    register('test:empty', { verses: [], wholeChapter: true });
    expect(await nextReadingAfter('test:empty')).toBeNull();
  });
});

describe('canonical order — no provenance', () => {
  it('rolls a fully-read chapter into the next one', async () => {
    has(JOHN, 3, 36);
    register('test:g', { verses: wholeChapter(JOHN, 3, 36), wholeChapter: true });
    expect(await nextReadingAfter('test:g')).toEqual({
      translation: 'KJV', bookId: JOHN, chapter: 4,
    });
  });

  /** The disagreement the three old copies had. */
  it('rolls the last chapter of a book into the next book', async () => {
    has(MALACHI, 4, 6);
    register('test:g', { verses: wholeChapter(MALACHI, 4, 6), wholeChapter: true });
    expect(await nextReadingAfter('test:g')).toEqual({
      translation: 'KJV', bookId: MATTHEW, chapter: 1,
    });
  });

  it('stops at the end of Revelation rather than wrapping to Genesis', async () => {
    has(REVELATION, 22, 21);
    register('test:g', { verses: wholeChapter(REVELATION, 22, 21), wholeChapter: true });
    expect(await nextReadingAfter('test:g')).toBeNull();
  });

  it('walks on in ~5-verse chunks from a partial reading', async () => {
    has(JOHN, 3, 36);
    register('test:g', {
      verses: [verse(JOHN, 3, 16), verse(JOHN, 3, 17), verse(JOHN, 3, 18)],
      wholeChapter: false,
    });
    expect(await nextReadingAfter('test:g')).toEqual({
      translation: 'KJV', bookId: JOHN, chapter: 3, ranges: [{ start: 19, end: 23 }],
    });
  });

  it('clamps the last chunk to the end of the chapter', async () => {
    has(JOHN, 3, 36);
    register('test:g', { verses: [verse(JOHN, 3, 34)], wholeChapter: false });
    expect(await nextReadingAfter('test:g')).toEqual({
      translation: 'KJV', bookId: JOHN, chapter: 3, ranges: [{ start: 35, end: 36 }],
    });
  });

  it('crosses into the next chapter’s first verses when a chunk runs out', async () => {
    has(JOHN, 3, 36);
    has(JOHN, 4, 54);
    register('test:g', { verses: [verse(JOHN, 3, 36)], wholeChapter: false });
    expect(await nextReadingAfter('test:g')).toEqual({
      translation: 'KJV', bookId: JOHN, chapter: 4, ranges: [{ start: 1, end: 5 }],
    });
  });

  it('judges "fully read" on the trailing chapter only', async () => {
    // A group spanning a boundary (Gen 1 complete, then Gen 2:1-3) continues
    // from where it actually left off, not from the completed chapter.
    has(GENESIS, 1, 31);
    has(GENESIS, 2, 25);
    register('test:g', {
      verses: [...wholeChapter(GENESIS, 1, 31), verse(GENESIS, 2, 1), verse(GENESIS, 2, 2)],
      wholeChapter: false,
    });
    expect(await nextReadingAfter('test:g')).toEqual({
      translation: 'KJV', bookId: GENESIS, chapter: 2, ranges: [{ start: 3, end: 7 }],
    });
  });

  it('is null when the chapter it is standing on cannot be loaded', async () => {
    register('test:g', { verses: [verse(JOHN, 3, 16)], wholeChapter: false });
    expect(await nextReadingAfter('test:g')).toBeNull();
  });

  it('keeps the reading’s own translation', async () => {
    has(JOHN, 3, 36);
    register('test:g', {
      verses: wholeChapter(JOHN, 3, 36).map((v) => ({ ...v, translation: 'LUT' as const })),
      wholeChapter: true,
    });
    expect(await nextReadingAfter('test:g')).toMatchObject({ translation: 'LUT' });
  });
});

describe('a list is a playlist', () => {
  const plan = list({
    days: [{ id: 'd1', entries: [
      { id: 'e1', bookId: JONAH, chapter: 1 },
      { id: 'e2', bookId: JONAH, chapter: 2 },
    ] }],
  });

  beforeEach(() => {
    useLibraryStore.setState({ readingLists: [plan] });
  });

  it('continues with the next entry, not with the next chapter of the Bible', async () => {
    has(JONAH, 1, 17);
    has(JONAH, 2, 10);
    register('test:g', {
      verses: wholeChapter(JONAH, 1, 17),
      wholeChapter: true,
      provenance: { listId: 'L1', entryId: 'e1' },
    });
    expect(await nextReadingAfter('test:g')).toEqual({
      translation: 'KJV', bookId: JONAH, chapter: 2, ranges: undefined,
      provenance: { listId: 'L1', entryId: 'e2' },
    });
  });

  it('carries the provenance forward, so it keeps playing as a list', async () => {
    has(JONAH, 1, 17);
    has(JONAH, 2, 10);
    register('test:g', {
      verses: wholeChapter(JONAH, 1, 17),
      wholeChapter: true,
      provenance: { listId: 'L1', entryId: 'e1' },
    });
    const next = await nextReadingAfter('test:g');
    expect(next?.provenance).toEqual({ listId: 'L1', entryId: 'e2' });
  });

  /** A plan that rolled into Genesis at its end would never be finishable. */
  it('stops at the end of the list instead of continuing canonically', async () => {
    has(JONAH, 2, 10);
    has(JONAH, 3, 10);
    register('test:g', {
      verses: wholeChapter(JONAH, 2, 10),
      wholeChapter: true,
      provenance: { listId: 'L1', entryId: 'e2' },
    });
    expect(await nextReadingAfter('test:g')).toBeNull();
  });

  /**
   * Versification is English in the catalog, so a plan can legitimately name a
   * chapter the chosen text lacks. One gap is stepped over rather than
   * stalling the plan.
   */
  it('steps over a chapter this translation genuinely lacks', async () => {
    useLibraryStore.setState({
      readingLists: [list({
        days: [{ id: 'd1', entries: [
          { id: 'e1', bookId: MALACHI, chapter: 3 },
          { id: 'e2', bookId: MALACHI, chapter: 4 },   // LUT has no Malachi 4
          { id: 'e3', bookId: MATTHEW, chapter: 1 },
        ] }],
      })],
    });
    has(MALACHI, 3, 18);
    has(MATTHEW, 1, 25);
    // Malachi 4 is deliberately absent from chapterLengths → comes back empty.
    register('test:g', {
      verses: wholeChapter(MALACHI, 3, 18),
      wholeChapter: true,
      provenance: { listId: 'L1', entryId: 'e1' },
    });
    expect(await nextReadingAfter('test:g')).toMatchObject({
      bookId: MATTHEW, chapter: 1, provenance: { listId: 'L1', entryId: 'e3' },
    });
  });

  /**
   * A list deleted on another device mid-reading falls back to canonical order
   * rather than falling silent mid-sentence.
   */
  it('falls back to canonical order when the list has been deleted', async () => {
    useLibraryStore.setState({ readingLists: [] });
    has(JOHN, 3, 36);
    register('test:g', {
      verses: wholeChapter(JOHN, 3, 36),
      wholeChapter: true,
      provenance: { listId: 'gone', entryId: 'e1' },
    });
    expect(await nextReadingAfter('test:g')).toEqual({
      translation: 'KJV', bookId: JOHN, chapter: 4,
    });
  });

  it('falls back when the entry is no longer in the list', async () => {
    has(JOHN, 3, 36);
    register('test:g', {
      verses: wholeChapter(JOHN, 3, 36),
      wholeChapter: true,
      provenance: { listId: 'L1', entryId: 'deleted-entry' },
    });
    expect(await nextReadingAfter('test:g')).toMatchObject({ bookId: JOHN, chapter: 4 });
  });
});

/**
 * **The guard that stops auto-play reading a blog post and then starting
 * Genesis.** Post units carry `bookId: 0`, so a post group reaching
 * `canonicalNext()` asks the Bible what follows chapter 0 of book 0.
 */
/**
 * The severity-1 case for shared plans.
 *
 * `nextInList` used to resolve `provenance.listId` against `libraryStore` alone.
 * A plan mirrored out of a room is in neither of that store's arrays, so the
 * lookup missed, `nextInList` returned `undefined`, and `nextReadingAfter` reads
 * that as "decide some other way" — falling through to `canonicalNext`. A
 * subscriber reading Jonah 1 as day one of somebody's plan would then have been
 * read **Jonah 2 of the Bible** rather than the plan's second entry, or worse,
 * walked off the end of the plan into Genesis with nothing on screen changing.
 */
describe("somebody else's plan is a playlist too", () => {
  const plan = list({
    days: [{ id: 'd1', entries: [
      { id: 'e1', bookId: JONAH, chapter: 1 },
      { id: 'e2', bookId: JOHN, chapter: 3 },
    ] }],
  });

  beforeEach(() => {
    // In the *community* store, never the library's — that is the whole point.
    useLibraryStore.setState({ readingLists: [] });
    useCommunityStore.setState({
      mirroredLists: [
        {
          list: plan,
          code: 'ROOMCODE',
          itemId: 'I1',
          author: 'Christoph',
          authorKey: 'ab'.repeat(32),
          updatedAt: 0,
        },
      ],
    });
  });

  it('continues with the plan\'s next entry, not the next chapter of the Bible', async () => {
    has(JONAH, 1, 17);
    has(JONAH, 2, 10);
    has(JOHN, 3, 36);
    register('test:g', {
      verses: wholeChapter(JONAH, 1, 17),
      wholeChapter: true,
      provenance: { listId: 'L1', entryId: 'e1' },
    });
    const next = await nextReadingAfter('test:g');
    expect(next).toMatchObject({ bookId: JOHN, chapter: 3 });
    expect(next?.provenance).toEqual({ listId: 'L1', entryId: 'e2' });
  });

  it('stops at the end rather than rolling into the next book', async () => {
    has(JOHN, 3, 36);
    has(JOHN, 4, 54);
    register('test:g', {
      verses: wholeChapter(JOHN, 3, 36),
      wholeChapter: true,
      provenance: { listId: 'L1', entryId: 'e2' },
    });
    expect(await nextReadingAfter('test:g')).toBeNull();
  });

  it('falls back to canonical order once the author withdraws it', async () => {
    // Not an error: a withdrawn plan is an ordinary state, and the reader must
    // still be able to carry on rather than stopping dead mid-chapter.
    useCommunityStore.setState({ mirroredLists: [] });
    has(JONAH, 1, 17);
    has(JONAH, 2, 10);
    register('test:g', {
      verses: wholeChapter(JONAH, 1, 17),
      wholeChapter: true,
      provenance: { listId: 'L1', entryId: 'e1' },
    });
    expect(await nextReadingAfter('test:g')).toMatchObject({ bookId: JONAH, chapter: 2 });
  });
});

describe('a post group never falls through to the Bible', () => {
  const postUnit = (): VerseSummary => ({
    translation: 'KJV',
    bookId: 0,
    chapter: 0,
    verse: 1,
    text: 'A paragraph of somebody’s own writing.',
    display: 'A morning by the river',
    unit: {
      kind: 'post',
      spaceId: 'S1',
      postId: 'P1',
      index: 0,
      language: 'de',
      title: 'A morning by the river',
      author: 'Christoph',
      publishedAt: 1_700_000_000_000,
    },
  });

  it('is null for a post group carrying no provenance at all', async () => {
    // Defensive branch: without it this reads Genesis 1 next.
    has(GENESIS, 1, 31);
    register('test:g', { verses: [postUnit()], wholeChapter: false });
    expect(await nextReadingAfter('test:g')).toBeNull();
  });

  it('never asks the Bible about book 0', async () => {
    register('test:g', { verses: [postUnit()], wholeChapter: false });
    await nextReadingAfter('test:g');
    for (const call of fetchChapter.mock.calls) {
      expect(call[1]).not.toBe(0);
    }
  });
});

describe('continuationKey — matching a prefetch to its chunk', () => {
  it('distinguishes a whole chapter from a range of it', () => {
    const base = { translation: 'KJV' as const, bookId: JOHN, chapter: 3 };
    expect(continuationKey(base)).toBe('KJV:43:3:all');
    expect(continuationKey({ ...base, ranges: [{ start: 1, end: 5 }] })).toBe('KJV:43:3:1-5');
  });

  it('distinguishes translations, so a switch cannot reuse a prefetch', () => {
    const base = { bookId: JOHN, chapter: 3 };
    expect(continuationKey({ ...base, translation: 'KJV' }))
      .not.toBe(continuationKey({ ...base, translation: 'LUT' }));
  });

  it('keys a post by its ids, since it has no chapter', () => {
    expect(continuationKey({
      translation: 'KJV', bookId: 0, chapter: 0, post: { spaceId: 'S1', postId: 'P1' },
    })).toBe('post:S1:P1');
  });

  it('is stable for equal readings', () => {
    const a = { translation: 'KJV' as const, bookId: 1, chapter: 1, ranges: [{ start: 1, end: 5 }] };
    expect(continuationKey(a)).toBe(continuationKey({ ...a, ranges: [{ start: 1, end: 5 }] }));
  });
});

describe('isWholeChapterReading — which heading the announcement uses', () => {
  it('is true with no ranges and with an empty one', () => {
    const base = { translation: 'KJV' as const, bookId: JOHN, chapter: 3 };
    expect(isWholeChapterReading(base)).toBe(true);
    expect(isWholeChapterReading({ ...base, ranges: [] })).toBe(true);
    expect(isWholeChapterReading({ ...base, ranges: [{ start: 1, end: 5 }] })).toBe(false);
  });
});
