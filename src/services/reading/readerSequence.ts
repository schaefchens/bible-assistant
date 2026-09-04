import type { Translation } from '@/services/bible/bibleApi';
import {
  resolveSpaceFrom,
  selectionSegments,
  type SpaceSnapshot,
} from '@/services/community/spaceReading';
import {
  bibleSequence,
  listSequence,
  selectionSequence,
  spaceSequence,
  type ReaderSource,
  type ReadingSequence,
} from '@/services/reading/readingSequence';
import { useCommunityStore } from '@/store/communityStore';
import { useLibraryStore } from '@/store/libraryStore';
import type { ReadingList } from '@/types/domain';

/**
 * **The one answer to "what sequence is the reader walking through?"**
 *
 * There used to be two: a `sequenceFor()` inside `readerStore` and a
 * near-identical copy inside `useReaderSequence`, with a comment on each
 * telling the next person that both had to grow the same branches. They did
 * grow together, three times, which is three chances they hadn't. Now the
 * branching lives here once and the two callers differ only in where the data
 * comes from — the same pure/impure split `resolveSpace` /
 * `resolveSpaceFrom` already uses, and for the same reason.
 *
 * Falls back to the Bible when a source outlives what it points at — a list
 * deleted, or a space unsubscribed, on another device must not leave the tab
 * unable to navigate.
 */

/** Everything the branches read. `SpaceSnapshot` plus the reading lists. */
export type ReaderSequenceDeps = SpaceSnapshot & { lists: ReadingList[] };


/**
 * The pure form, for React: a hook has to pass *selected* values so
 * `exhaustive-deps` can see them, or the memo keeps serving a stale sequence
 * when a feed refreshes or the user edits a list.
 */
export function readerSequenceFrom(
  source: ReaderSource,
  translation: Translation,
  deps: ReaderSequenceDeps,
): ReadingSequence {
  if (source.kind === 'list') {
    const list = deps.lists.find((l) => l.id === source.listId);
    if (list) return listSequence(list, translation);
  }
  if (source.kind === 'space') {
    const space = resolveSpaceFrom(source, deps);
    if (space) return spaceSequence(space.spaceId, space.posts, translation);
  }
  if (source.kind === 'selection') {
    // Deliberately not a function of `seen`: the selection is a snapshot taken
    // when the user asked for it, so marking pieces seen while reading must not
    // reshuffle it. See ReaderSource's 'selection' variant.
    return selectionSequence(selectionSegments(source.postIds, translation));
  }
  return bibleSequence(translation);
}

/**
 * The live form, for the store and `lib/`. Resolved on demand rather than
 * stored, so editing a list (adding tomorrow's chapter) is reflected the next
 * time the reader steps, with no cache to invalidate.
 */
export function readerSequence(
  source: ReaderSource,
  translation: Translation,
): ReadingSequence {
  const { profile, spaces, posts, subscriptions, feed } = useCommunityStore.getState();
  return readerSequenceFrom(source, translation, {
    lists: useLibraryStore.getState().readingLists,
    profile,
    spaces,
    posts,
    subscriptions,
    feed,
  });
}
