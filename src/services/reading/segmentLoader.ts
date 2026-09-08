import { loadChapterSummaries } from '@/services/bible/verseSummaries';
import type { Translation } from '@/services/bible/bibleApi';
import { isChapterMissing } from '@/services/bible/chapterSources';
import { nextBookRef } from '@/services/bible/chapterNavigation';
import { spacePostUnits } from '@/services/community/spaceReading';
import type { Locale, VerseSummary } from '@/types/domain';
import {
  isPostSegment,
  isWholeChapter,
  segmentId,
  type ReadingSequence,
  type SegmentRef,
} from './readingSequence';

/**
 * How the reader gets one segment: the fetch, the slice, the error, and the
 * versification gap it walks past on the way.
 *
 * `loadSegmentUnits` came out of `readerStore` first, because that one
 * hardcoded `loadChapterSummaries` call was the reason the reader could only
 * ever show Bible chapters. `loadSegment` and its helpers followed later, for
 * the duller reason that they were never store business either: the whole
 * cluster is a pure function of (ref, direction, sequence, locale), and what
 * the store actually owns is the window, the cache and the position.
 *
 * Nothing here reads a store — the locale arrives as an argument — which is
 * what keeps it testable.
 *
 * `loadSegmentUnits` and `absorbsGaps` are module-private again now that the
 * only caller is in this file. They were exported for `readerStore` alone.
 */

/**
 * Load the units behind one segment, whatever kind of thing it is.
 *
 * A post resolves from local state with no fetch: the user's own posts are in
 * Dexie, and a subscribed space's are in the verified feed cache. That is also
 * why a missing post is simply an empty result — there is no network to blame,
 * so the store reports it as an unavailable segment.
 */
async function loadSegmentUnits(
  ref: SegmentRef,
  locale: Locale,
): Promise<VerseSummary[]> {
  if (isPostSegment(ref)) {
    return spacePostUnits(ref.spaceId!, ref.postId!);
  }
  return loadChapterSummaries(ref.translation, ref.bookId, ref.chapter, locale);
}

/**
 * Whether a failed segment load is worth retrying by stepping past it.
 *
 * Bible versification gaps are normal — `BookEntry.chapters` is English, so LUT
 * genuinely has no Malachi 4 — and a *step* absorbs them by walking on. A post
 * either exists or it does not: skipping to the next one would silently show
 * the reader something they did not ask for.
 */
function absorbsGaps(ref: SegmentRef): boolean {
  return !isPostSegment(ref);
}

/**
 * A loaded reader unit: a whole chapter, or the slice of one a reading-list
 * entry asked for.
 *
 * Called a *segment* rather than a chapter because it stopped being one when
 * lists arrived — "Psalm 23:1-6" is a first-class thing the reader renders and
 * plays. `ref.ranges === undefined` means the whole chapter, which is the
 * overwhelmingly common case and the only one the Bible source produces.
 */
export type LoadedSegment = {
  id: string;
  ref: SegmentRef;
  /** The segment's verses, ascending. `verses[i].text` is `verseSpeakable(v)`. */
  verses: VerseSummary[];
};

export type ReaderError = {
  kind: 'unavailable' | 'network';
  translation: Translation;
  bookId: number;
  chapter: number;
};

/** Which way the user was moving, which decides how a missing chapter is
 * absorbed. `'none'` (an explicit jump) treats it as a real error. */
export type StepDirection = 'forward' | 'backward' | 'none';

/** How many neighbouring segments to try before giving up. A translation can
 * lack more than one trailing chapter, but this must stay small — each attempt
 * is a request. */
const MAX_GAP_SKIP = 3;

function classifyError(e: unknown, ref: SegmentRef): ReaderError {
  // `null` means every source returned empty without throwing — same user-facing
  // situation as a missing chapter: this text doesn't have it. For a post there
  // is no network in the path at all, so an empty result is always
  // 'unavailable': the post has been deleted, or the space is no longer shared.
  return {
    kind: isPostSegment(ref) || e === null || isChapterMissing(e) ? 'unavailable' : 'network',
    translation: ref.translation,
    bookId: ref.bookId,
    chapter: ref.chapter,
  };
}

/** Restrict a chapter's verses to what the segment actually covers. */
/** A post is never sliced — `isWholeChapter` is true for it (no ranges), so
 * this returns its units untouched. */
function sliceToRanges(verses: VerseSummary[], ref: SegmentRef): VerseSummary[] {
  if (isWholeChapter(ref)) return verses;
  return verses.filter((v) => ref.ranges!.some((r) => v.verse >= r.start && v.verse <= r.end));
}

/**
 * Load one segment, transparently absorbing the versification gap.
 *
 * `BookEntry.chapters` is English versification, but the German texts genuinely
 * lack chapters the catalog advertises — bundled LUT's Malachi ends at 3 where
 * KJV has 4. So a step can point at a chapter that does not exist, and the miss
 * surfaces two different ways depending on the source (see `isChapterMissing`).
 *
 * Rather than dead-ending the user on a chapter that was never real, a step
 * continues the way they were already going: `nextInSequence` hands back the
 * following segment, which for the Bible rolls into the next book and for a
 * reading list is simply the next entry. The caller sets `position` from
 * whatever actually loaded, so the UI self-corrects — a pager label that
 * optimistically said "Malachi 4" lands on Malachi 3 and renames itself.
 *
 * An explicit jump (the picker, a resume) gets no such tolerance: there the user
 * named a specific passage and deserves to be told it isn't there.
 */
export async function loadSegment(
  ref: SegmentRef,
  dir: StepDirection,
  sequence: ReadingSequence,
  locale: Locale,
  attemptsLeft = MAX_GAP_SKIP,
): Promise<{ segment: LoadedSegment; error: null } | { segment: null; error: ReaderError }> {
  let missed: unknown = null;
  try {
    const verses = await loadSegmentUnits(ref, locale);
    const sliced = sliceToRanges(verses, ref);
    if (sliced.length > 0) {
      return { segment: { id: segmentId(ref), ref, verses: sliced }, error: null };
    }
  } catch (e) {
    if (!isChapterMissing(e)) {
      return { segment: null, error: classifyError(e, ref) };
    }
    missed = e;
  }

  // Only Bible versification has gaps to absorb. A post that isn't there is a
  // real miss, and stepping past it would show the reader a different post than
  // the one they asked for.
  const nextTry = !absorbsGaps(ref)
    ? null
    : dir === 'forward'
      ? // Skip the rest of a book the catalog over-counted rather than each of
        // its phantom chapters one request at a time.
        (ref.listId ? sequence.next(ref) : bibleForwardSkip(ref))
      : dir === 'backward'
        ? sequence.prev(ref)
        : null;

  if (!nextTry || attemptsLeft <= 0) {
    return { segment: null, error: classifyError(missed, ref) };
  }
  return loadSegment(nextTry, dir, sequence, locale, attemptsLeft - 1);
}

/** Forward past a missing chapter in the Bible: the next book's chapter 1.
 * Stepping one chapter at a time would retry every phantom chapter of an
 * over-counted book. */
function bibleForwardSkip(ref: SegmentRef): SegmentRef | null {
  const next = nextBookRef(ref.bookId);
  return next ? { translation: ref.translation, bookId: next.bookId, chapter: next.chapter } : null;
}
