import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReadingList } from '@/types/domain';

/**
 * `readingProgressTracker` is the one place progress is written, and it is
 * deliberately free of any playback or reader import so both can call it:
 * narration finishing a passage, the reader moving past one, and a manual tick
 * all arrive here. "Reading silently has to count."
 *
 * Two fixes in the log live in this module's rules: `43e4b78` (a passage is
 * ticked when its narration ends, auto-play or not) and the "Genesis 1-3 marked
 * read after Genesis 1" class, which is the `chapter` argument's whole job.
 */

const { db } = await import('@/db/dexie');
const { useLibraryStore } = await import('@/store/libraryStore');
const { useSettingsStore } = await import('@/store/settingsStore');
const { useCommunityStore } = await import('@/store/communityStore');
const { noteEntryFinished, noteEntryStarted, noteSpaceSeen } = await import(
  '@/lib/readingProgressTracker'
);

const GENESIS = 1;
const JONAH = 32;

const list = (over: Partial<ReadingList> = {}): ReadingList => ({
  id: 'L1',
  name: 'Plan',
  days: [{ id: 'd1', entries: [] }],
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

/** "Genesis 1-3" — one entry, three chapters. The shape the chapter guard exists for. */
const spanning = list({
  days: [{ id: 'd1', entries: [{ id: 'e1', bookId: GENESIS, chapter: 1, chapterEnd: 3 }] }],
});

/** Two single-chapter entries. */
const simple = list({
  days: [{ id: 'd1', entries: [
    { id: 'e1', bookId: JONAH, chapter: 1 },
    { id: 'e2', bookId: JONAH, chapter: 2 },
  ] }],
});

const completed = (listId = 'L1') =>
  useLibraryStore.getState().readingProgress[listId]?.completed ?? [];

/** The tracker fires and forgets (`void`), so let its awaits settle. */
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(async () => {
  await Promise.all([db.readingProgress.clear(), db.syncQueue.clear()]);
  useLibraryStore.setState({ readingLists: [], readingProgress: {}, online: false, pendingOps: 0 });
  useSettingsStore.setState({ translation: 'KJV', syncEnabled: false });
});

describe('no provenance means nothing to record', () => {
  it('does nothing at all without provenance', async () => {
    useLibraryStore.setState({ readingLists: [simple] });
    noteEntryStarted(undefined);
    noteEntryFinished(undefined);
    await settle();
    expect(completed()).toEqual([]);
    expect(useLibraryStore.getState().readingProgress).toEqual({});
  });

  it('does nothing for a list it does not have', async () => {
    noteEntryFinished({ listId: 'gone', entryId: 'e1' });
    await settle();
    expect(useLibraryStore.getState().readingProgress.gone).toBeUndefined();
  });
});

describe('noteEntryStarted — where the user is', () => {
  it('records the current entry without ticking anything', async () => {
    useLibraryStore.setState({ readingLists: [simple] });
    noteEntryStarted({ listId: 'L1', entryId: 'e2' });
    await settle();
    expect(useLibraryStore.getState().readingProgress.L1?.currentEntryId).toBe('e2');
    expect(completed()).toEqual([]);
  });
});

describe('noteEntryFinished — ticking a passage off', () => {
  beforeEach(() => useLibraryStore.setState({ readingLists: [simple] }));

  it('ticks a single-chapter entry', async () => {
    noteEntryFinished({ listId: 'L1', entryId: 'e1' }, 1);
    await settle();
    expect(completed()).toEqual(['e1']);
  });

  it('ticks with no chapter given at all', async () => {
    // The manual tick path: the editor knows the entry, not a chapter.
    noteEntryFinished({ listId: 'L1', entryId: 'e1' });
    await settle();
    expect(completed()).toEqual(['e1']);
  });

  it('is idempotent, so a double call from two reporters costs nothing', async () => {
    // `onSoftEnd` and `notePassageFinished` can both fire for one passage.
    noteEntryFinished({ listId: 'L1', entryId: 'e1' }, 1);
    await settle();
    noteEntryFinished({ listId: 'L1', entryId: 'e1' }, 1);
    await settle();
    expect(completed()).toEqual(['e1']);
  });

  it('records two entries independently', async () => {
    noteEntryFinished({ listId: 'L1', entryId: 'e1' }, 1);
    await settle();
    noteEntryFinished({ listId: 'L1', entryId: 'e2' }, 2);
    await settle();
    expect(completed().sort()).toEqual(['e1', 'e2']);
  });
});

/**
 * The rule the `chapter` argument exists for: "Genesis 1-3" expands to three
 * segments, and ticking it after the first would mark two thirds of the
 * reading done.
 */
describe('a multi-chapter entry is finished only at its last chapter', () => {
  beforeEach(() => useLibraryStore.setState({ readingLists: [spanning] }));

  it.each([1, 2])('does not tick after chapter %i of three', async (chapter) => {
    noteEntryFinished({ listId: 'L1', entryId: 'e1' }, chapter);
    await settle();
    expect(completed()).toEqual([]);
  });

  it('ticks once the last chapter is done', async () => {
    noteEntryFinished({ listId: 'L1', entryId: 'e1' }, 3);
    await settle();
    expect(completed()).toEqual(['e1']);
  });

  it('measures "last" against the entry’s own segments, not the list’s', async () => {
    // Two spanning entries: finishing the first one's chapter 3 must tick e1,
    // not wait for the end of the list.
    useLibraryStore.setState({
      readingLists: [list({
        days: [{ id: 'd1', entries: [
          { id: 'e1', bookId: GENESIS, chapter: 1, chapterEnd: 3 },
          { id: 'e2', bookId: GENESIS, chapter: 4, chapterEnd: 6 },
        ] }],
      })],
    });
    noteEntryFinished({ listId: 'L1', entryId: 'e1' }, 3);
    await settle();
    expect(completed()).toEqual(['e1']);
  });

  it('ignores a chapter that is not part of the entry', async () => {
    noteEntryFinished({ listId: 'L1', entryId: 'e1' }, 99);
    await settle();
    expect(completed()).toEqual([]);
  });
});

/**
 * A whole-book entry fans out with the *catalog's* chapter count, so "last
 * chapter" is decided by the same expansion the reader walks — not by whatever
 * the chosen translation happens to contain.
 */
describe('a whole-book entry', () => {
  beforeEach(() => useLibraryStore.setState({
    readingLists: [list({ days: [{ id: 'd1', entries: [{ id: 'e1', bookId: JONAH }] }] })],
  }));

  it('is not finished partway through the book', async () => {
    noteEntryFinished({ listId: 'L1', entryId: 'e1' }, 3);
    await settle();
    expect(completed()).toEqual([]);
  });

  it('is finished at the book’s last chapter', async () => {
    // Jonah has 4 chapters.
    noteEntryFinished({ listId: 'L1', entryId: 'e1' }, 4);
    await settle();
    expect(completed()).toEqual(['e1']);
  });
});

/**
 * A pinned entry is read in its own translation, so the expansion the guard
 * measures against has to use the entry's translation rather than the active
 * one. (Both agree on chapter counts here — the point is that the tick lands.)
 */
describe('an entry pinned to another translation', () => {
  it('still ticks at its last chapter', async () => {
    useLibraryStore.setState({
      readingLists: [list({
        days: [{ id: 'd1', entries: [
          { id: 'e1', bookId: JONAH, chapter: 1, chapterEnd: 2, translation: 'LUT' },
        ] }],
      })],
    });
    useSettingsStore.setState({ translation: 'KJV' });
    noteEntryFinished({ listId: 'L1', entryId: 'e1' }, 2);
    await settle();
    expect(completed()).toEqual(['e1']);
  });
});

/**
 * Space provenance takes the other branch entirely: a piece is marked *seen*,
 * and no reading-list progress is touched. Mirrors the three callers described
 * in the module — narration starting a piece, finishing one, and the reader
 * moving off one.
 */
describe('a community piece is marked seen, not ticked', () => {
  beforeEach(() => {
    vi.spyOn(useCommunityStore.getState(), 'markSeen').mockResolvedValue(undefined);
  });

  it('marks seen when narration starts a piece', () => {
    noteEntryStarted({ spaceId: 'S1', postId: 'P1' });
    expect(useCommunityStore.getState().markSeen).toHaveBeenCalledWith('P1');
  });

  it('marks seen when a piece finishes', () => {
    noteEntryFinished({ spaceId: 'S1', postId: 'P1' });
    expect(useCommunityStore.getState().markSeen).toHaveBeenCalledWith('P1');
  });

  it('writes no reading-list progress for a piece', async () => {
    useLibraryStore.setState({ readingLists: [simple] });
    noteEntryFinished({ spaceId: 'S1', postId: 'P1' }, 1);
    await settle();
    expect(useLibraryStore.getState().readingProgress).toEqual({});
  });

  it('noteSpaceSeen is the same one entry point', () => {
    noteSpaceSeen('P2');
    expect(useCommunityStore.getState().markSeen).toHaveBeenCalledWith('P2');
  });
});
