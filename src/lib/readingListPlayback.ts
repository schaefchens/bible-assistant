import { audioPlayback } from './audioPlaybackManager';
import { chatReadingHost, rangeHistoryNote } from './chatReadingHost';
import { loadReadingVerses } from './readingContinuation';
import { startAmbientIfEnabled, startPlaybackForVerses } from './startPlayback';
import { isWholeChapter } from '@/services/reading/readingSequence';
import type { ListProvenance } from './readingHosts';
import {
  expandList,
  segmentId,
  type SegmentRef,
} from '@/services/reading/readingSequence';
import { useLibraryStore } from '@/store/libraryStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';

/**
 * Playing a reading list, and recording how far through it the user got.
 *
 * Either host can play one: the reader follows along page by page, and the chat
 * renders each passage as a reading in the conversation. Both attach the list
 * provenance, which is the whole trick — continuation then asks the *list* what
 * comes next, so a list plays as a playlist from either screen (see
 * `lib/readingContinuation.ts`).
 */

/** Where the list resumes: the entry last started, else its first segment. */
function resumeSegment(listId: string): SegmentRef | null {
  const lib = useLibraryStore.getState();
  const list = lib.readingLists.find((l) => l.id === listId);
  if (!list) return null;
  const segments = expandList(list, useSettingsStore.getState().translation);
  if (segments.length === 0) return null;
  const currentEntryId = lib.readingProgress[listId]?.currentEntryId;
  if (!currentEntryId) return segments[0];
  return segments.find((s) => s.entryId === currentEntryId) ?? segments[0];
}

/**
 * Start (or resume) a list in the reader. Returns false when there is nothing
 * to play — an empty list, or one whose passages this translation lacks.
 *
 * Call from a user gesture: `ensureContext()` needs one to unlock audio on iOS.
 */
export async function playReadingList(listId: string): Promise<boolean> {
  const ref = resumeSegment(listId);
  if (!ref) return false;
  audioPlayback.ensureContext();
  return playSegmentInReader(ref);
}

/** Start (or resume) a list as a reading in the conversation. */
export async function playReadingListInChat(listId: string): Promise<boolean> {
  const ref = resumeSegment(listId);
  if (!ref) return false;
  audioPlayback.ensureContext();
  return playSegmentInChat(ref);
}

/** Play one segment in the reader, making its list the reader's source so
 * everything after it follows the list. */
export async function playSegmentInReader(ref: SegmentRef): Promise<boolean> {
  if (ref.listId) {
    await useReaderStore.getState().setSource({ kind: 'list', listId: ref.listId });
  }
  await useReaderStore.getState().goTo(ref);

  const segment = useReaderStore.getState().segments[segmentId(ref)];
  if (!segment) return false;
  audioPlayback.ensureContext();
  startAmbientIfEnabled();
  noteEntryStarted(provenanceOf(ref));
  // Deliberately NOT awaited: `startPlaybackForVerses` resolves only once the
  // whole passage's TTS has been built (45 verses of Mark 1 is ~45 requests),
  // and "started" means the verses are loaded and the first track is on its way.
  // Awaiting it left the assistant's turn spinning at "Thinking…" for a minute
  // while audio was already playing.
  void startPlaybackForVerses(segment.id, segment.verses, 0);
  return true;
}

/**
 * Play one segment as a reading in the conversation — the chat screen's
 * counterpart, so tapping a passage there behaves like every other chat reading
 * instead of throwing the user onto another tab.
 */
export async function playSegmentInChat(ref: SegmentRef): Promise<boolean> {
  const locale = useSettingsStore.getState().locale;
  const verses = await loadReadingVerses(
    { translation: ref.translation, bookId: ref.bookId, chapter: ref.chapter, ranges: ref.ranges },
    locale,
  );
  if (verses.length === 0) return false;
  const groupId = await chatReadingHost.appendReading(verses, {
    wholeChapter: isWholeChapter(ref),
    historyNote: rangeHistoryNote(verses, locale),
    provenance: provenanceOf(ref),
  });
  if (!groupId) return false;
  audioPlayback.ensureContext();
  startAmbientIfEnabled();
  noteEntryStarted(provenanceOf(ref));
  // Fire-and-forget for the same reason as playSegmentInReader above.
  void startPlaybackForVerses(groupId, verses, 0);
  return true;
}

function provenanceOf(ref: SegmentRef): ListProvenance | undefined {
  return ref.listId && ref.entryId ? { listId: ref.listId, entryId: ref.entryId } : undefined;
}

/** Remember where the user is in a list, so the next session resumes here. */
export function noteEntryStarted(provenance: ListProvenance | undefined): void {
  if (!provenance) return;
  void useLibraryStore
    .getState()
    .setCurrentEntry(provenance.listId, provenance.entryId);
}

/**
 * Tick an entry off once its audio has finished.
 *
 * `chapter` is the last chapter that played, and it matters: an entry like
 * "Genesis 1-3" expands to three segments, and ticking it when the first one
 * ended would mark two thirds of the reading done. The entry is only finished
 * when its *last* segment is.
 */
export function noteEntryFinished(
  provenance: ListProvenance | undefined,
  chapter?: number,
): void {
  if (!provenance) return;
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
