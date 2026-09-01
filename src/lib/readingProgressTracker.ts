import { expandList } from '@/services/reading/readingSequence';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { isListProvenance, type ReadingProvenance } from './readingHosts';

/**
 * Recording progress through a reading list.
 *
 * Deliberately free of any playback or reader import, so both can call it: the
 * audio path marks a passage finished when its narration ends, and the reader
 * marks it finished when the user turns the page past it. Reading silently has
 * to count — a plan that only advances when you listen would be wrong about
 * anyone who reads.
 */

/** Remember where the user is in a list, so the next session resumes here. */
export function noteEntryStarted(provenance: ReadingProvenance | undefined): void {
  // Only a reading list tracks progress. A space has no per-post completion —
  // unread is a local dot on the space, not a synced tick (see communityStore),
  // because that would want readingProgress's union-merge machinery, which is
  // keyed by listId.
  if (!provenance || !isListProvenance(provenance)) return;
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
  if (!provenance || !isListProvenance(provenance)) return;
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
