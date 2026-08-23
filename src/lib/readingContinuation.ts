import { getChapter, type Translation } from '@/services/bible/bibleApi';
import { toVerseSummaries } from '@/services/bible/verseSummaries';
import { nextChapterRef } from '@/services/bible/chapterNavigation';
import { expandList } from '@/services/reading/readingSequence';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { Locale, VerseRange, VerseSummary } from '@/types/domain';
import { readingHosts, type ListProvenance } from './readingHosts';

/**
 * **The one answer to "what plays after this reading?"**
 *
 * Two rules, one entry point:
 *
 *   - a group with reading-list provenance continues with the next entry of
 *     that list, and stops at its end — a list is a playlist;
 *   - anything else continues in canonical order, which is the behaviour every
 *     reading had before lists existed: a fully-read chapter rolls into the next
 *     one, a verse range walks on in ~5-verse chunks.
 *
 * Both hosts go through here, so chat and the reader cannot drift apart: the
 * chat's chain of assistant messages and the reader's chain of chapters are the
 * same mechanism seen from two screens. Before this module, the canonical rule
 * lived inside autoPlay and there was nowhere for a second rule to go.
 */

/** How many verses a verse-mode continuation reads at a time. */
const CHUNK_SIZE = 5;

/**
 * How many list entries to step over when a translation genuinely lacks a
 * chapter the list names (English versification in `BookEntry.chapters` — LUT
 * has no Malachi 4). Small on purpose: each attempt can be a request.
 */
const MAX_GAP_SKIP = 3;

export type NextReading = {
  translation: Translation;
  bookId: number;
  chapter: number;
  /** `undefined` → the whole chapter. */
  ranges?: VerseRange[];
  /** Carried onto the next group, so a list keeps playing as a list. */
  provenance?: ListProvenance;
};

/** Stable identity for a continuation, so a prefetch can be matched to the
 * chunk it was built for. */
export function continuationKey(next: NextReading): string {
  const span = next.ranges
    ? next.ranges.map((r) => `${r.start}-${r.end}`).join(',')
    : 'all';
  return `${next.translation}:${next.bookId}:${next.chapter}:${span}`;
}

export function isWholeChapterReading(next: NextReading): boolean {
  return next.ranges === undefined || next.ranges.length === 0;
}

/** What plays after `groupId`, or null when there is nothing (the end of a
 * list, the end of Revelation, a group whose verses have gone). */
export async function nextReadingAfter(groupId: string): Promise<NextReading | null> {
  const group = readingHosts.getGroup(groupId);
  if (!group || group.verses.length === 0) return null;
  if (group.provenance) {
    const inList = await nextInList(group.provenance, group.verses);
    // A list that has been deleted since the reading started falls back to
    // canonical order rather than falling silent mid-sentence.
    if (inList !== undefined) return inList;
  }
  return canonicalNext(group.verses);
}

/** Fetch a continuation's verses. `getChapter` is memoized and
 * in-flight-deduped, so a speculative call here is cheap. */
export async function loadReadingVerses(
  next: NextReading,
  locale: Locale,
): Promise<VerseSummary[]> {
  const verses = await getChapter(next.translation, next.bookId, next.chapter);
  if (verses.length === 0) return [];
  const slice = isWholeChapterReading(next)
    ? verses
    : verses.filter((v) => next.ranges!.some((r) => v.verse >= r.start && v.verse <= r.end));
  return toVerseSummaries(next.translation, next.bookId, next.chapter, slice, locale);
}

/**
 * The next segment of the list this reading belongs to.
 *
 * Returns `null` at the end of the list (stop), a reading to play, or
 * `undefined` for "this list is gone, decide some other way".
 *
 * The current position is matched on `(entryId, chapter)` rather than on the
 * segment id, so a translation changed mid-plan doesn't lose the user's place.
 */
async function nextInList(
  provenance: ListProvenance,
  verses: VerseSummary[],
): Promise<NextReading | null | undefined> {
  const list = useLibraryStore
    .getState()
    .readingLists.find((l) => l.id === provenance.listId);
  if (!list) return undefined;

  const last = verses[verses.length - 1];
  const segments = expandList(list, useSettingsStore.getState().translation);
  const at = segments.findIndex(
    (s) => s.entryId === provenance.entryId && s.chapter === last.chapter,
  );
  if (at === -1) return undefined;

  // Walk forward past anything this translation doesn't actually have, so a
  // plan written against another edition doesn't stall on a phantom chapter.
  for (let i = at + 1; i < segments.length && i <= at + 1 + MAX_GAP_SKIP; i++) {
    const seg = segments[i];
    const chapter = await getChapter(seg.translation, seg.bookId, seg.chapter).catch(() => []);
    if (chapter.length === 0) continue;
    return {
      translation: seg.translation,
      bookId: seg.bookId,
      chapter: seg.chapter,
      ranges: seg.ranges,
      provenance: seg.entryId
        ? { listId: list.id, entryId: seg.entryId }
        : undefined,
    };
  }
  return null;
}

/**
 * Canonical continuation, from the verses alone.
 *
 * The mode falls out of the reading's own trailing chapter slice:
 *   - covers the whole chapter (verse 1 .. chapter end) → the next whole chapter
 *   - otherwise                                        → the next ~5 verses
 *
 * Crosses book boundaries automatically; only stops at Revelation 22. This is
 * host-agnostic by construction, which is why a reader chapter (always 1..N)
 * takes the whole-chapter branch with no reader special-casing anywhere.
 */
async function canonicalNext(verses: VerseSummary[]): Promise<NextReading | null> {
  const last = verses[verses.length - 1];
  const trailing: VerseSummary[] = [];
  for (let i = verses.length - 1; i >= 0; i--) {
    const v = verses[i];
    if (v.bookId === last.bookId && v.chapter === last.chapter) trailing.unshift(v);
    else break;
  }

  const chapterVerses = await getChapter(last.translation, last.bookId, last.chapter);
  if (chapterVerses.length === 0) return null;
  const chapterEnd = chapterVerses[chapterVerses.length - 1].verse;

  const fullyReadThisChapter =
    trailing[0].verse === 1 && trailing[trailing.length - 1].verse === chapterEnd;

  if (fullyReadThisChapter) {
    const ref = nextChapterRef(last.bookId, last.chapter);
    return ref
      ? { translation: last.translation, bookId: ref.bookId, chapter: ref.chapter }
      : null;
  }

  if (last.verse < chapterEnd) {
    const start = last.verse + 1;
    return {
      translation: last.translation,
      bookId: last.bookId,
      chapter: last.chapter,
      ranges: [{ start, end: Math.min(start + CHUNK_SIZE - 1, chapterEnd) }],
    };
  }

  // Past the chapter's end in verse mode → the first verses of the next chapter.
  const ref = nextChapterRef(last.bookId, last.chapter);
  if (!ref) return null;
  const nextChapterVerses = await getChapter(last.translation, ref.bookId, ref.chapter);
  if (nextChapterVerses.length === 0) return null;
  const lastVerseNo = nextChapterVerses[nextChapterVerses.length - 1].verse;
  return {
    translation: last.translation,
    bookId: ref.bookId,
    chapter: ref.chapter,
    ranges: [{ start: 1, end: Math.min(CHUNK_SIZE, lastVerseNo) }],
  };
}
