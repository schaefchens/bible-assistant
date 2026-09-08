import { describe, expect, it } from 'vitest';
import {
  PASSAGES_PER_PAGE,
  listDays,
  listWindow,
  resumeSegment,
} from '@/services/reading/listWindow';
import type { ReadingDay, ReadingEntry, ReadingList, ReadingProgress } from '@/types/domain';
import type { SegmentRef } from '@/services/reading/readingSequence';

/**
 * `resumeSegment` is the app's one answer to "where am I in this list", and
 * four things must agree with it: the day the picker's window opens on, the row
 * it highlights, what its Continue button plays, and where `readerStore`
 * resumes the reader. It was written twice before this module existed, and the
 * copies disagreed about exactly one input — a `currentEntryId` naming an entry
 * that has since been deleted. That is a state the app keeps deliberately
 * (ticks for removed entries stay in storage, because an undo may bring the
 * entry back), and the picker's copy answered it by dropping its own Continue
 * button.
 *
 * `listWindow` is the rest of that decision: which day is today, which page a
 * flat list opens on, and what is visible. Getting it wrong shows the user the
 * wrong part of a plan — day 1 of 90 rather than the day they are in.
 */

const KJV = 'KJV' as const;

let seq = 0;
const entry = (bookId: number, chapter: number): ReadingEntry => ({
  id: `e${++seq}`,
  bookId,
  chapter,
});

const day = (entries: ReadingEntry[], title?: string): ReadingDay => ({
  id: `d${++seq}`,
  ...(title === undefined ? {} : { title }),
  entries,
});

const list = (days: ReadingDay[]): ReadingList => ({
  id: 'list-1',
  name: 'A plan',
  days,
  createdAt: 0,
  updatedAt: 0,
});

const progress = (over: Partial<ReadingProgress> = {}): ReadingProgress => ({
  listId: 'list-1',
  completed: [],
  updatedAt: 0,
  ...over,
});

/** A plain list: one untitled day. `isFlatList` is what decides that. */
const flat = (n: number) => {
  const entries = Array.from({ length: n }, (_, i) => entry(1, i + 1));
  return { list: list([day(entries)]), entries };
};

/** A plan: several titled days. */
const plan = (perDay: number[]) => {
  const days = perDay.map((n, d) =>
    day(
      Array.from({ length: n }, (_, i) => entry(d + 1, i + 1)),
      `Day ${d + 1}`,
    ),
  );
  return { list: list(days), days };
};

const ids = (segs: SegmentRef[]) => segs.map((s) => s.entryId);

describe('resumeSegment — the entry last played', () => {
  it('is the recorded position when it still exists', () => {
    const { list: l, entries } = flat(5);
    const segs = listWindow(l, progress(), KJV, null).items;
    const at = resumeSegment(segs, progress({ currentEntryId: entries[2].id }));
    expect(at?.entryId).toBe(entries[2].id);
  });

  it('falls back to the first unread when nothing was recorded', () => {
    // A plan ticked off by hand has no currentEntryId at all, which is why the
    // fallback exists rather than being a nicety.
    const { list: l, entries } = flat(5);
    const segs = listWindow(l, progress(), KJV, null).items;
    const p = progress({ completed: [entries[0].id, entries[1].id] });
    expect(resumeSegment(segs, p)?.entryId).toBe(entries[2].id);
  });

  it('falls back to the first unread when the recorded entry has been deleted', () => {
    // The one input the two old copies disagreed about. `updateProgress` leaves
    // ticks for removed entries in storage, so a currentEntryId pointing at a
    // gone entry is an ordinary state — not an exotic one. The store fell
    // through to the first unread; the picker returned nothing and lost its
    // Continue button.
    const { list: l, entries } = flat(5);
    const segs = listWindow(l, progress(), KJV, null).items;
    const p = progress({ completed: [entries[0].id], currentEntryId: 'deleted-entry' });
    expect(resumeSegment(segs, p)?.entryId).toBe(entries[1].id);
  });

  it('is the start of a list nothing has touched', () => {
    const { list: l, entries } = flat(3);
    const segs = listWindow(l, progress(), KJV, null).items;
    expect(resumeSegment(segs, undefined)?.entryId).toBe(entries[0].id);
  });

  it('is the start again once everything is read, rather than nothing', () => {
    // A finished plan still has to give Continue something to play, or the
    // button disappears at exactly the moment the user might replay it.
    const { list: l, entries } = flat(3);
    const segs = listWindow(l, progress(), KJV, null).items;
    const p = progress({ completed: entries.map((e) => e.id) });
    expect(resumeSegment(segs, p)?.entryId).toBe(entries[0].id);
  });

  it('answers nothing for a list with no passages at all', () => {
    expect(resumeSegment([], progress())).toBeUndefined();
  });
});

describe('listDays — one group per day the list has', () => {
  it('keeps a day that has no entries', () => {
    // Deriving the groups from the segments dropped it, and a two-day plan
    // whose second day was still empty was then three different things at
    // once: flat in the picker, Day 1 + a dangling DAY 2 in the editor, and
    // "Day 1" in the reader's heading.
    const { list: l } = plan([2, 0, 1]);
    const days = listDays(l, progress(), KJV);
    expect(days).toHaveLength(3);
    expect(days[1].items).toEqual([]);
  });

  it('marks a day done only when every passage in it is ticked', () => {
    const { list: l, days } = plan([2, 2]);
    const first = days[0].entries.map((e) => e.id);
    const d = listDays(l, progress({ completed: first }), KJV);
    expect(d[0].done).toBe(true);
    expect(d[1].done).toBe(false);
  });

  it('never marks an empty day done', () => {
    // It has nothing to read, and `done` needs at least one ticked passage —
    // without that, an empty day would swallow the window the moment the day
    // before it was finished.
    const { list: l } = plan([1, 0]);
    expect(listDays(l, progress(), KJV)[1].done).toBe(false);
  });

  it('distinguishes an untitled day from one titled with an empty string', () => {
    const l = list([day([entry(1, 1)]), day([entry(2, 1)], '')]);
    const days = listDays(l, progress(), KJV);
    expect(days[0].titled).toBe(false);
    expect(days[1].titled).toBe(true);
  });
});

describe('listWindow — a plan opens on the day you are in', () => {
  it('opens on the day holding the recorded entry, not on day 1', () => {
    const { list: l, days } = plan([2, 2, 2]);
    const target = days[2].entries[0].id;
    const w = listWindow(l, progress({ currentEntryId: target }), KJV, null);
    expect(w.grouped).toBe(true);
    expect(w.focus).toBe(2);
    expect(ids(w.visible)).toEqual(days[2].entries.map((e) => e.id));
  });

  it('opens on the first day with anything unread', () => {
    const { list: l, days } = plan([2, 2, 2]);
    const done = days[0].entries.map((e) => e.id);
    expect(listWindow(l, progress({ completed: done }), KJV, null).focus).toBe(1);
  });

  it('steps over an empty day when choosing where to open', () => {
    const { list: l, days } = plan([1, 0, 1]);
    const done = days[0].entries.map((e) => e.id);
    expect(listWindow(l, progress({ completed: done }), KJV, null).focus).toBe(2);
  });

  it('opens on the last day when the whole plan is read', () => {
    // The one case where the day shown and `resumeSegment` deliberately part
    // company: Continue has to be able to replay, so the resume position is
    // the *start* — but a finished plan should open where it was finished, not
    // back at day 1 of 90.
    const { list: l, days } = plan([1, 1, 1]);
    const all = days.flatMap((d) => d.entries.map((e) => e.id));
    const w = listWindow(l, progress({ completed: all }), KJV, null);
    expect(w.focus).toBe(2);
    expect(w.resume?.entryId).toBe(days[0].entries[0].id);
  });

  it('opens on the first unread day when the recorded entry has been deleted', () => {
    const { list: l, days } = plan([1, 1, 1]);
    const done = days[0].entries.map((e) => e.id);
    const p = progress({ completed: done, currentEntryId: 'deleted-entry' });
    const w = listWindow(l, p, KJV, null);
    // Here the two do agree: the day shown holds the segment Continue plays.
    expect(w.focus).toBe(1);
    expect(ids(w.visible)).toContain(w.resume?.entryId);
  });

  it('reports where the pager can go', () => {
    const { list: l } = plan([1, 1, 1]);
    expect(listWindow(l, progress(), KJV, 0)).toMatchObject({ canBack: false, canForward: true });
    expect(listWindow(l, progress(), KJV, 1)).toMatchObject({ canBack: true, canForward: true });
    expect(listWindow(l, progress(), KJV, 2)).toMatchObject({ canBack: true, canForward: false });
  });
});

describe('listWindow — a flat list pages instead', () => {
  it('is not grouped, however many passages it holds', () => {
    const { list: l } = flat(PASSAGES_PER_PAGE * 3);
    expect(listWindow(l, progress(), KJV, null).grouped).toBe(false);
  });

  it('shows one page at a time', () => {
    const { list: l } = flat(PASSAGES_PER_PAGE * 2 + 3);
    const w = listWindow(l, progress(), KJV, 0);
    expect(w.span).toBe(3);
    expect(w.visible).toHaveLength(PASSAGES_PER_PAGE);
    expect(listWindow(l, progress(), KJV, 2).visible).toHaveLength(3);
  });

  it('opens on the page holding the passage you are on', () => {
    const { list: l, entries } = flat(PASSAGES_PER_PAGE * 3);
    const target = entries[PASSAGES_PER_PAGE * 2 + 1].id;
    expect(listWindow(l, progress({ currentEntryId: target }), KJV, null).focus).toBe(2);
  });

  it('opens on page one when nothing has been played', () => {
    // Recorded, not derived — the same reading as a plan's day.
    const { list: l, entries } = flat(PASSAGES_PER_PAGE * 3);
    const done = entries.slice(0, PASSAGES_PER_PAGE * 2).map((e) => e.id);
    expect(listWindow(l, progress({ completed: done }), KJV, null).focus).toBe(0);
  });

  it('is one page when there is nothing in it, rather than none', () => {
    const w = listWindow(list([day([])]), progress(), KJV, null);
    expect(w.span).toBe(1);
    expect(w.visible).toEqual([]);
    expect(w.resume).toBeUndefined();
  });
});

describe('listWindow — a browsed position is clamped, not trusted', () => {
  it('clamps an index past the end, so a list that shrank still shows a day', () => {
    // The caller keeps its browse position across renders and the list can
    // shrink under it; the nearest real day beats an empty screen.
    const { list: l } = plan([1, 1]);
    expect(listWindow(l, progress(), KJV, 99).focus).toBe(1);
  });

  it('clamps a negative index', () => {
    const { list: l } = plan([1, 1]);
    expect(listWindow(l, progress(), KJV, -5).focus).toBe(0);
  });
});
