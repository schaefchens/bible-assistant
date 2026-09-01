import { expandList } from '@/services/reading/readingSequence';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { isListProvenance, isSpaceProvenance, type ReadingProvenance } from './readingHosts';
import { useCommunityStore } from '@/store/communityStore';

/**
 * Recording progress through a reading list.
 *
 * Deliberately free of any playback or reader import, so both can call it: the
 * audio path marks a passage finished when its narration ends, and the reader
 * marks it finished when the user turns the page past it. Reading silently has
 * to count — a plan that only advances when you listen would be wrong about
 * anyone who reads.
 */

/**
 * Mark one community piece as seen.
 *
 * Kept here with the reading-list progress rather than in the store because the
 * same three things call it — narration reaching a piece, the reader moving off
 * one, and (via `noteEntryStarted`) playback starting one — and this module
 * exists precisely so both the audio path and the reader can share them.
 *
 * "Seen", not "read": it drives the unread dot and empties an "everything new"
 * reading. There is no synced per-piece completion, which would want
 * `readingProgress`'s union-merge machinery, and that is keyed by `listId`.
 */
export function noteSpaceSeen(postId: string): void {
  void useCommunityStore.getState().markSeen(postId);
}

/** Remember where the user is in a list, so the next session resumes here. */
export function noteEntryStarted(provenance: ReadingProvenance | undefined): void {
  if (!provenance) return;
  // Starting to narrate a piece is the strongest "seen" signal there is.
  if (isSpaceProvenance(provenance)) {
    noteSpaceSeen(provenance.postId);
    return;
  }
  if (!isListProvenance(provenance)) return;
  void useLibraryStore
    .getState()
    .setCurrentEntry(provenance.listId, provenance.entryId);
}

/**
 * Tick an entry off.
 *
 * `chapter` is the last chapter that was read, and it matters: an entry like
 * "Genesis 1-3" expands to three segments, and ticking it after the first would
 * mark two thirds of the reading done. The entry is finished only when its
 * *last* segment is.
 */
export function noteEntryFinished(
  provenance: ReadingProvenance | undefined,
  chapter?: number,
): void {
  if (!provenance) return;
  if (isSpaceProvenance(provenance)) {
    noteSpaceSeen(provenance.postId);
    return;
  }
  if (!isListProvenance(provenance)) return;
  const lib = useLibraryStore.getState();
  const list = lib.readingLists.find((l) => l.id === provenance.listId);
  if (!list) return;
  if (chapter !== undefined) {
    const own = expandList(list, useSettingsStore.getState().translation).filter(
      (s) => s.entryId === provenance.entryId,
    );
    const last = own[own.length - 1];
    if (last && last.chapter !== chapter) return;
  }
  void lib.setEntryDone(provenance.listId, provenance.entryId, true);
}
