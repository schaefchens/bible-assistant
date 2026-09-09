import { useCommunityStore } from '@/store/communityStore';
import { useLibraryStore } from '@/store/libraryStore';
import type { MirroredList, ReadingList } from '@/types/domain';
import type { ReaderSource } from '@/services/reading/readingSequence';

/**
 * **The one answer to "which reading list is this id?"**
 *
 * A list used to be one thing — a row in `libraryStore` — so eight places
 * asked `readingLists.find(l => l.id === id)` and were right. Now a plan can
 * also be one mirrored out of a room, and two of those eight are the ones
 * CLAUDE.md's definition-of-done table calls severity-1:
 *
 * - `readingContinuation.nextInList` returns `undefined` for a list it cannot
 *   find, and `nextReadingAfter` reads that as "decide some other way" and
 *   falls through to `canonicalNext`. A shared plan of Psalm 23 → John 3 would
 *   continue with **Psalm 24** — the wrong audio, with nothing on screen
 *   changing to say so.
 * - `readingProgressTracker.noteEntryFinished` returns early, so a subscriber
 *   could read a whole plan and have **nothing ticked**, with the progress bar
 *   and the Continue button sitting at zero.
 *
 * So the lookup lives here once, in the pure/impure pair `resolveSpace` /
 * `resolveSpaceFrom` already established next door — and the primitive is **by
 * id**, not by source, because five of the call sites hold a bare `listId` out
 * of a `ListProvenance` and have no source to offer.
 */

/** Everything the lookup reads. The library half, mirroring `SpaceSnapshot`. */
export type ListSnapshot = { lists: ReadingList[]; mirroredLists: MirroredList[] };

export type ResolvedList = {
  list: ReadingList;
  /** False for a plan mirrored out of somebody's room: read-only, and copyable. */
  mine: boolean;
  /** The room it came from. Absent for the user's own. */
  code?: string;
  /** The author's display name, for the header kicker. Empty for the user's own. */
  author: string;
  /** The `SharedItem` it arrived as — what a report or a re-fetch names. */
  itemId?: string;
};

/**
 * Resolve a list id against the user's own lists and every mirrored plan.
 *
 * Three rules, each with a precedent in this codebase:
 *
 * - **Own lists win.** An author who also subscribes to a room holding their
 *   own plan gets their editable copy, not a read-only mirror of it. Same rule
 *   and same reason as `shareCodeForSpace` checking own spaces first.
 * - **First mirror wins**, so the same plan shared into two rooms resolves to
 *   one reading rather than flickering between them. Same rule as
 *   `groupSubscriptionsByAuthor`'s "first appearance decides".
 * - **`preferCode` is a hint, not a filter.** A source naming a room picks that
 *   room's copy when there is one, but a plan that has since moved rooms — or a
 *   source restored from `localStorage` naming a room since unsubscribed — still
 *   resolves rather than vanishing.
 */
export function resolveListById(
  listId: string,
  state: ListSnapshot,
  preferCode?: string,
): ResolvedList | null {
  const own = state.lists.find((l) => l.id === listId);
  if (own) return { list: own, mine: true, author: '' };

  const mirrors = state.mirroredLists.filter((m) => m.list.id === listId);
  if (mirrors.length === 0) return null;
  const pick = (preferCode && mirrors.find((m) => m.code === preferCode)) || mirrors[0];
  return { list: pick.list, mine: false, code: pick.code, author: pick.author, itemId: pick.itemId };
}

/** The pure form for React, so `exhaustive-deps` can see what it reads. */
export function resolveListFrom(
  source: Extract<ReaderSource, { kind: 'list' }>,
  state: ListSnapshot,
): ResolvedList | null {
  return resolveListById(source.listId, state, source.code);
}

/** The live form, for the store and `lib/`. */
export function resolveList(listId: string, preferCode?: string): ResolvedList | null {
  return resolveListById(
    listId,
    {
      lists: useLibraryStore.getState().readingLists,
      mirroredLists: useCommunityStore.getState().mirroredLists,
    },
    preferCode,
  );
}
