import { readerSequence } from '@/services/reading/readerSequence';
import { isPostSegment, segmentId, type SegmentRef } from '@/services/reading/readingSequence';
import type { LoadedSegment } from '@/services/reading/segmentLoader';
import {
  noteEntryFinished,
  noteEntryStarted,
  noteSpaceSeen,
} from '@/lib/readingProgressTracker';
import { useSettingsStore } from '@/store/settingsStore';

/**
 * Whether the reader's own movement means a passage was **read**.
 *
 * `readingProgressTracker` is where progress is *written*, by all three of its
 * callers; this is the reader's answer to whether there is anything to write.
 * It lives outside `readerStore` because it is a rule about movement rather
 * than state — and because `dwell` below is module state the store has no
 * business holding.
 *
 * It takes the loaded segments rather than reading the store it was extracted
 * from: all it wants is how long the passage being left was, and importing
 * `readerStore` from here would be the cycle that quietly turns a store's type
 * into `any` (see CLAUDE.md on `communityRows`).
 */
/**
 * What moved the reader, which is the only reliable way to know whether the
 * passage being left was *read*.
 *
 *   turn   — the pager's next button: you finished the page and turned it
 *   scroll — the passage crossed the viewport as you read down the page
 *   jump   — anywhere else: the picker, a resume, a translation reload, the
 *            endless-scroll prefetch. Lands you somewhere without reading what
 *            you passed.
 *
 * Inferring this from the positions alone doesn't work: picking the very next
 * passage out of the selector looks identical to turning the page onto it, and
 * marking it read was wrong.
 */
export type PositionIntent = 'turn' | 'scroll' | 'jump';

/**
 * How long a passage has to have been the reader's position before leaving it
 * counts as having read it — **scaled by how much there is to read**.
 *
 * Turning the page is a good signal, but not on its own: stepping through three
 * chapters to reach the fourth marked the two you flicked past. Dwell separates
 * them, because reading takes minutes and skipping takes seconds.
 *
 * A flat threshold can't do that job, though. "John 3:16" is read in three
 * seconds, so any threshold long enough to exclude flicking past a chapter
 * excluded *every* single-verse entry — they could never be marked read at all.
 * So the gate is per verse, with a floor that still catches a flick and a cap so
 * that Psalm 119 doesn't demand three minutes.
 */
const DWELL_PER_VERSE_MS = 1_000;
const DWELL_MIN_MS = 2_500;
const DWELL_MAX_MS = 20_000;

function dwellNeededFor(verseCount: number): number {
  return Math.min(DWELL_MAX_MS, Math.max(DWELL_MIN_MS, verseCount * DWELL_PER_VERSE_MS));
}

/** The position being dwelt on, and since when. */
let dwell: { id: string; since: number } | null = null;

/** Whether `next` comes after `previous` in their list — scrolling back up
 * must not tick anything off. */
function isForwardInList(previous: SegmentRef, next: SegmentRef): boolean {
  if (!next.listId) return false;
  const all = readerSequence(
    { kind: 'list', listId: next.listId },
    useSettingsStore.getState().translation,
  ).all();
  if (!all) return false;
  const from = all.findIndex((s) => segmentId(s) === segmentId(previous));
  const to = all.findIndex((s) => segmentId(s) === segmentId(next));
  return from !== -1 && to !== -1 && to > from;
}

/**
 * Record progress from the reader's own movement, so **reading counts, not just
 * listening**: a plan that only advanced when you pressed play was wrong about
 * anyone who reads silently.
 *
 * Handles both things a position change can mean: a reading-list entry being
 * finished, and a community piece being *seen*. They share the dwell rule
 * deliberately — the alternative was a second, subtly different notion of "you
 * were there long enough", and the flick-past problem is identical.
 */
export function trackListProgress(
  previous: SegmentRef | null,
  next: SegmentRef,
  intent: PositionIntent,
  segments: Record<string, LoadedSegment>,
): void {
  const now = Date.now();
  const previousId = previous ? segmentId(previous) : null;
  // How much was on the page decides how long counts as having read it. The
  // segment is still cached, so this needs no fetch.
  const verseCount = previousId
    ? (segments[previousId]?.verses.length ?? 0)
    : 0;
  const dwelt =
    !!previousId &&
    dwell?.id === previousId &&
    now - dwell.since >= dwellNeededFor(verseCount);
  dwell = { id: segmentId(next), since: now };

  // Leaving a piece you sat on counts as having seen it, which is what empties
  // an "everything new" reading as you work through it. Weaker than a reading
  // plan's tick, so no intent gate: dwell alone is the signal, and it applies
  // whichever way you moved.
  if (previous && isPostSegment(previous) && previous.postId && dwelt) {
    noteSpaceSeen(previous.postId);
  }

  if (!next.listId || !next.entryId) return;
  if (
    intent !== 'jump' &&
    dwelt &&
    previous &&
    previous.listId === next.listId &&
    previous.entryId &&
    isForwardInList(previous, next)
  ) {
    noteEntryFinished(
      { listId: previous.listId, entryId: previous.entryId },
      previous.chapter,
    );
  }
  noteEntryStarted({ listId: next.listId, entryId: next.entryId });
}
