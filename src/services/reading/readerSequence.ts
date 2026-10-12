import type { Translation } from '@/services/bible/bibleApi';
import { resolveListFrom, type ListSnapshot } from '@/services/community/sharedReading';
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
import { pinnedTranslations } from '@/services/reading/readingEntries';
import { useCommunityStore } from '@/store/communityStore';
import { useLibraryStore } from '@/store/libraryStore';

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
 * unable to navigate. A shared plan the author has since withdrawn is the same
 * case, and an ordinary one rather than an anomaly.
 */

/**
 * Everything the branches read: `SpaceSnapshot` for the space kinds, and
 * `ListSnapshot` for the list kind — which is the user's own lists *and* the
 * plans mirrored out of rooms, because a list source may name either.
 */
type ReaderSequenceDeps = SpaceSnapshot & ListSnapshot;


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
    const resolved = resolveListFrom(source, deps);
    if (resolved) return listSequence(resolved.list, translation);
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
  const { profile, spaces, posts, subscriptions, feed, mirroredLists } =
    useCommunityStore.getState();
  return readerSequenceFrom(source, translation, {
    lists: useLibraryStore.getState().readingLists,
    mirroredLists,
    profile,
    spaces,
    posts,
    subscriptions,
    feed,
  });
}

/**
 * The translations whose licence terms bind what the reader does — endless
 * scroll, continuous play (`translationCatalog`'s `features`): the selected
 * one, which is the user's Bible, and every one an entry of the list being
 * read pins.
 *
 * A list is taken whole rather than passage by passage. Asked per passage, the
 * controls would switch themselves on and off as the page scrolls from one
 * entry into the next — and endless scroll would already have appended a
 * pinned Schlachter 2000 chapter by the time it became the passage in view.
 *
 * A space or a selection names none. A post is not scripture, so no licence
 * limits how a shelf is read, whichever Bible is selected.
 */
export function readerTextsFrom(
  source: ReaderSource,
  translation: Translation,
  deps: ListSnapshot,
): Translation[] {
  if (source.kind === 'space' || source.kind === 'selection') return [];
  const list = source.kind === 'list' ? resolveListFrom(source, deps)?.list : undefined;
  return list ? [translation, ...pinnedTranslations(list)] : [translation];
}

/** The live form of {@link readerTextsFrom}, for the store. */
export function readerTexts(source: ReaderSource, translation: Translation): Translation[] {
  return readerTextsFrom(source, translation, {
    lists: useLibraryStore.getState().readingLists,
    mirroredLists: useCommunityStore.getState().mirroredLists,
  });
}
