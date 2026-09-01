import { loadChapterSummaries } from '@/services/bible/verseSummaries';
import { spacePostUnits } from '@/services/community/spaceReading';
import type { Locale, VerseSummary } from '@/types/domain';
import { isPostSegment, type SegmentRef } from './readingSequence';

/**
 * Load the units behind one segment, whatever kind of thing it is.
 *
 * Extracted out of `readerStore.loadSegment`, which used to call
 * `loadChapterSummaries` directly — that one line was the reason the reader
 * could only ever show Bible chapters. Everything else about the store's
 * loading machinery (the window, the cache, the scroll pinning, the error
 * classification) turned out to be source-agnostic already.
 *
 * A post resolves from local state with no fetch: the user's own posts are in
 * Dexie, and a subscribed space's are in the verified feed cache. That is also
 * why a missing post is simply an empty result — there is no network to blame,
 * so the store reports it as an unavailable segment.
 */
export async function loadSegmentUnits(
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
export function absorbsGaps(ref: SegmentRef): boolean {
  return !isPostSegment(ref);
}
