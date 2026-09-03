import {
  findReaderSegment,
  useReaderStore,
  type LoadedSegment,
} from '@/store/readerStore';
import {
  findListSegment,
  isWholeChapter,
  segmentId,
  type SegmentRef,
} from '@/services/reading/readingSequence';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import {
  isListProvenance,
  isSpaceProvenance,
  type ReadingGroup,
  type ReadingGroupId,
  type ReadingHost,
  type ReadingProvenance,
} from './readingHosts';

/**
 * What a segment's ref says about where the reading came from — the reader's
 * half of the contract `lib/readingContinuation.ts` reads.
 *
 * **A post is checked first, and it is not an optimisation.** A post's ref
 * carries no list ids, so without this branch a piece of somebody's writing
 * reached `nextReadingAfter` with no provenance at all, hit its defensive
 * "post units but nowhere to continue" guard, and the reading stopped dead at
 * the end of the first piece — with auto-continuation on, and with the pager
 * quite happily showing another piece after it. Everything downstream of here
 * (`nextInSpace`, `appendReading`'s space branch, `noteEntryStarted`'s
 * markSeen) was already in place and simply never got called.
 */
function provenanceOf(ref: SegmentRef): ReadingProvenance | undefined {
  if (ref.spaceId && ref.postId) return { spaceId: ref.spaceId, postId: ref.postId };
  if (ref.listId && ref.entryId) return { listId: ref.listId, entryId: ref.entryId };
  return undefined;
}

function toGroup(segment: LoadedSegment): ReadingGroup {
  const { ref } = segment;
  return {
    id: segment.id,
    verses: segment.verses,
    // A Bible segment is always a whole chapter, so headings read "John,
    // chapter 3"; a list entry with verse ranges reads "John 3:16-18".
    wholeChapter: isWholeChapter(ref),
    provenance: provenanceOf(ref),
  };
}

/**
 * Readings that live on the reader screen: each is a loaded segment — a whole
 * chapter of the Bible, or one chapter's worth of a reading-list entry.
 *
 * Group ids are **deterministic** (see `segmentId`), which is what makes the
 * whole thing work — scroll away and back, or replay, and the same segment
 * yields the same id, so queued tracks still resolve and `WordHighlighter`
 * re-binds without any plumbing.
 */
export const readerReadingHost: ReadingHost = {
  ns: 'reader',

  getGroup(id: ReadingGroupId): ReadingGroup | null {
    const segment = findReaderSegment(id);
    return segment ? toGroup(segment) : null;
  },

  /** Only the mounted window, in the active sequence's order — that is the
   * playlist the user can actually see. */
  listGroups(): ReadingGroup[] {
    const { visible, segments } = useReaderStore.getState();
    const out: ReadingGroup[] = [];
    for (const id of visible) {
      const segment = segments[id];
      if (segment) out.push(toGroup(segment));
    }
    return out;
  },

  /** Play on the reader route starts the segment the user is looking at. */
  defaultGroup(): ReadingGroupId | null {
    const { position, visible, segments } = useReaderStore.getState();
    if (position) {
      const id = segmentId(position);
      if (segments[id]) return id;
    }
    return visible[0] ?? null;
  },

  /** Loads the previous segment if it isn't mounted, so stepping back past
   * verse 1 walks into it rather than dead-ending. */
  async previousGroup(id: ReadingGroupId): Promise<ReadingGroupId | null> {
    const list = readerReadingHost.listGroups();
    const i = list.findIndex((g) => g.id === id);
    if (i > 0) return list[i - 1].id;
    if (!findReaderSegment(id)) return null;
    return useReaderStore.getState().extend(-1);
  },

  /**
   * Idempotent by construction: `adopt` returns the existing id when endless
   * scroll has already loaded the segment auto-continuation is asking for.
   *
   * A continuation inside a reading list adopts **the list's own segment**, so
   * it gets the same group id, day label and pinned translation the sequence
   * would give it. Rebuilding a ref from the verses instead is what made a
   * continuation land as a plain Bible chapter — the list quietly stopped being
   * a playlist, and a pinned translation got overwritten mid-reading.
   */
  appendReading(verses, opts): Promise<ReadingGroupId | null> {
    const first = verses[0];
    let ref: SegmentRef | undefined;
    const provenance = opts.provenance;
    if (first && provenance && isListProvenance(provenance)) {
      const list = useLibraryStore
        .getState()
        .readingLists.find((l) => l.id === provenance.listId);
      ref =
        (list &&
          findListSegment(
            list,
            useSettingsStore.getState().translation,
            provenance.entryId,
            first.chapter,
          )) ||
        undefined;
    } else if (first && provenance && isSpaceProvenance(provenance)) {
      // A post's segment is built from the unit itself: `verses` came out of
      // `postToUnits`, so the title is right there and no store lookup can
      // disagree with it.
      ref = {
        translation: first.translation,
        translationPinned: true,
        bookId: 0,
        chapter: 0,
        spaceId: provenance.spaceId,
        postId: provenance.postId,
        postTitle: first.unit?.title,
      };
    }
    return Promise.resolve(useReaderStore.getState().adopt(verses, ref));
  },
};
