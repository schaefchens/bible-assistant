import type { ReadingList, ReadingProgress } from '@/types/domain';
import type { Translation } from '@/services/bible/bibleApi';
import { expandList, type SegmentRef } from './readingSequence';
import { isFlatList } from './readingEntries';

/**
 * How many passages an ungrouped list shows before paging. A list is a thing to
 * pick from, and a wall of ninety references is not something you pick from.
 */
export const PASSAGES_PER_PAGE = 10;

/** One day of a list, as something that picks from it sees the day. */
export type ListDay = {
  title: string | null;
  /** The day carries a title of its own, even an empty one. */
  titled: boolean;
  items: SegmentRef[];
  /** Every passage in it has been read — the day is behind you. */
  done: boolean;
};

/**
 * A list, windowed down to the part worth showing, plus where the reader is in
 * it. A ninety-day plan is not something anyone picks from whole.
 */
export type ListWindow = {
  /** One per day the list *has* — see `listDays`. */
  days: ListDay[];
  /** A plan (two or more days) rather than a flat collection. */
  grouped: boolean;
  /** Every segment, in reading order, ignoring day structure. */
  items: SegmentRef[];
  /** Which day (or page) is shown. */
  focus: number;
  /** How many days (or pages) there are. */
  span: number;
  /** The segments the window is showing: one day, or one page. */
  visible: SegmentRef[];
  /** Where the reader is — see `resumeSegment`. */
  resume: SegmentRef | undefined;
  canBack: boolean;
  canForward: boolean;
};

/**
 * Where the reader is in a list: the entry last played, else the first still
 * unread, else the start.
 *
 * **This is the one copy of that rule.** Three things read it and must agree —
 * the row the picker highlights, what its Continue button plays, and where
 * `readerStore.resumeOf` puts the reader — and it was written twice before this
 * module existed, once in the picker and once in the store. The copies
 * disagreed about a `currentEntryId` naming an entry that no longer exists,
 * which is a state the app deliberately keeps: `updateProgress` leaves ticks
 * for removed entries in storage because an undo may bring the entry back. The
 * store fell through to the first unread passage; the picker's `find` returned
 * nothing and it simply dropped its Continue button.
 *
 * So a recorded position that has gone missing is treated as no position at
 * all, which is what the second fallback below is for.
 *
 * Which day the *window* opens on is a near-neighbour of this and deliberately
 * not the same question — see `focusDayOf`.
 */
export function resumeSegment(
  segments: SegmentRef[],
  progress: ReadingProgress | undefined,
): SegmentRef | undefined {
  if (progress?.currentEntryId) {
    const at = segments.find((s) => s.entryId === progress.currentEntryId);
    if (at) return at;
  }
  // Nothing recorded (a plan ticked off by hand, say), or recorded against an
  // entry that has since gone: the first thing still unread.
  const done = new Set(progress?.completed ?? []);
  const unread = segments.find((s) => !s.entryId || !done.has(s.entryId));
  return unread ?? segments[0];
}

/**
 * The list's passages grouped the way the list is written, with whether each
 * group is finished.
 *
 * One group per day the list *has*, not per day its segments happen to mention:
 * a day with no entries yields no segments, so deriving the groups from the
 * segments alone dropped it — and a two-day plan whose second day was still
 * empty then rendered as a flat, ungrouped list in the picker while the editor
 * showed it as Day 1 + Day 2 and the reader's heading said "Day 1". Three
 * answers to "is this a plan?"; `isFlatList` is the one that decides.
 */
export function listDays(
  list: ReadingList,
  progress: ReadingProgress | undefined,
  translation: Translation,
): ListDay[] {
  const done = new Set(progress?.completed ?? []);
  const days: ListDay[] = list.days.map((day) => ({
    title: day.title ?? null,
    titled: day.title !== undefined,
    items: [],
    done: false,
  }));
  for (const seg of expandList(list, translation)) {
    // A flat list's segments carry no dayIndex, and it has exactly one day.
    days[seg.dayIndex ?? 0]?.items.push(seg);
  }
  for (const d of days) {
    d.done = d.items.length > 0 && d.items.every((i) => !!i.entryId && done.has(i.entryId));
  }
  return days;
}

function clampIndex(value: number, length: number): number {
  return Math.min(Math.max(value, 0), Math.max(0, length - 1));
}

/**
 * Which day is "today": the one holding the recorded position, else the first
 * with anything unread, else the last. Opening a plan should land on the day
 * you are actually in, not on day 1 of 90.
 *
 * This keys off the **recorded** `currentEntryId`, not off `resumeSegment`, and
 * the difference shows in exactly one case: a plan read all the way through
 * with nothing recorded. `resumeSegment` answers "the start" there, because
 * Continue has to be able to replay something — but the day to *show* is the
 * last one, where the reader finished, not day 1 of 90. Feeding the resume
 * position in here would send a completed plan back to the beginning.
 *
 * Everywhere else the two agree, including the deleted-entry case: an id that
 * matches no day falls through to the first unread, which is the day holding
 * the segment `resumeSegment` returns.
 */
function focusDayOf(days: ListDay[], progress: ReadingProgress | undefined): number {
  if (days.length === 0) return 0;
  const recorded = progress?.currentEntryId;
  if (recorded) {
    const at = days.findIndex((d) => d.items.some((i) => i.entryId === recorded));
    if (at !== -1) return at;
  }
  // An empty day is never "where you are": it has nothing to read, and it is
  // never `done` (that needs at least one ticked passage), so without the
  // length guard it would swallow the window the moment the day before it was
  // finished.
  const firstUnread = days.findIndex((d) => d.items.length > 0 && !d.done);
  return firstUnread === -1 ? days.length - 1 : firstUnread;
}

/**
 * The whole of what something picking from a list needs to draw: the days, the
 * page, what is visible, and where the reader is.
 *
 * `browseAt` is the position the user has stepped to, or `null` to open where
 * the reader actually is. It is clamped rather than validated, so a caller
 * holding a stale index (a list that shrank under it) shows the nearest real
 * day instead of nothing.
 */
export function listWindow(
  list: ReadingList,
  progress: ReadingProgress | undefined,
  translation: Translation,
  browseAt: number | null,
): ListWindow {
  const days = listDays(list, progress, translation);
  const grouped = !isFlatList(list);
  const items = days.flatMap((d) => d.items);
  const resume = resumeSegment(items, progress);

  const span = grouped ? days.length : Math.max(1, Math.ceil(items.length / PASSAGES_PER_PAGE));
  // A flat list opens on the page holding the recorded position — the same
  // "recorded, not derived" reading as `focusDayOf`, so the two kinds of list
  // open on the same principle. An unrecorded or vanished id means page one.
  const at = progress?.currentEntryId
    ? items.findIndex((i) => i.entryId === progress.currentEntryId)
    : -1;
  const openAt = grouped
    ? focusDayOf(days, progress)
    : Math.floor(Math.max(0, at) / PASSAGES_PER_PAGE);
  const focus = clampIndex(browseAt ?? openAt, span);

  return {
    days,
    grouped,
    items,
    focus,
    span,
    visible: grouped
      ? (days[focus]?.items ?? [])
      : items.slice(focus * PASSAGES_PER_PAGE, (focus + 1) * PASSAGES_PER_PAGE),
    resume,
    canBack: focus > 0,
    canForward: focus < span - 1,
  };
}
