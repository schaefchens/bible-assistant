import type { ReadingDay, ReadingEntry, ReadingList } from '@/types/domain';
import { newReadingDay } from '@/services/reading/readingEntries';

/**
 * Pure edits on a reading list's days and entries, each returning a new list —
 * or the SAME reference when nothing changed, so callers can skip a redundant
 * persist. `upsertReadingList` bumps `updatedAt` and queues the sync.
 *
 * Kept out of the store for the same reason `boardOperations` is: these are the
 * editor's vocabulary, they compose, and they're trivially testable without a
 * Dexie or a network in scope.
 */

export function withEntriesAdded(
  list: ReadingList,
  dayId: string,
  entries: ReadingEntry[],
): ReadingList {
  if (entries.length === 0) return list;
  return mapDay(list, dayId, (day) => ({ ...day, entries: [...day.entries, ...entries] }));
}

export function withEntryRemoved(list: ReadingList, entryId: string): ReadingList {
  let touched = false;
  const days = list.days.map((day) => {
    if (!day.entries.some((e) => e.id === entryId)) return day;
    touched = true;
    return { ...day, entries: day.entries.filter((e) => e.id !== entryId) };
  });
  return touched ? { ...list, days } : list;
}

export function withEntryUpdated(
  list: ReadingList,
  entryId: string,
  patch: Partial<Omit<ReadingEntry, 'id'>>,
): ReadingList {
  let touched = false;
  const days = list.days.map((day) => {
    if (!day.entries.some((e) => e.id === entryId)) return day;
    touched = true;
    return {
      ...day,
      entries: day.entries.map((e) => (e.id === entryId ? { ...e, ...patch } : e)),
    };
  });
  return touched ? { ...list, days } : list;
}

/**
 * Move one entry a single step in reading order.
 *
 * Crossing a day boundary is deliberate: at the top of a day, up means "belongs
 * to the previous day", which is how someone fixes a plan they mis-split. It
 * keeps one control doing one thing instead of adding a separate "move to day"
 * picker.
 */
export function withEntryMoved(
  list: ReadingList,
  entryId: string,
  dir: -1 | 1,
): ReadingList {
  const dayIndex = list.days.findIndex((d) => d.entries.some((e) => e.id === entryId));
  if (dayIndex === -1) return list;
  const day = list.days[dayIndex];
  const at = day.entries.findIndex((e) => e.id === entryId);
  const target = at + dir;

  if (target >= 0 && target < day.entries.length) {
    const entries = day.entries.slice();
    [entries[at], entries[target]] = [entries[target], entries[at]];
    return replaceDay(list, dayIndex, { ...day, entries });
  }

  // Off the edge of this day — hand the entry to the neighbouring one.
  const neighbourIndex = dayIndex + dir;
  if (neighbourIndex < 0 || neighbourIndex >= list.days.length) return list;
  const entry = day.entries[at];
  const neighbour = list.days[neighbourIndex];
  const days = list.days.slice();
  days[dayIndex] = { ...day, entries: day.entries.filter((e) => e.id !== entryId) };
  days[neighbourIndex] =
    dir === -1
      ? { ...neighbour, entries: [...neighbour.entries, entry] }
      : { ...neighbour, entries: [entry, ...neighbour.entries] };
  return { ...list, days };
}

export function withDayAdded(list: ReadingList, title?: string): ReadingList {
  return { ...list, days: [...list.days, newReadingDay(title)] };
}

export function withDayTitle(list: ReadingList, dayId: string, title: string): ReadingList {
  const clean = title.trim();
  return mapDay(list, dayId, (day) => ({ ...day, title: clean || undefined }));
}

/**
 * Remove a day, keeping its entries by folding them into the previous day (or
 * the next, for the first day). Losing passages to a mis-tap on a structural
 * control would be the wrong trade; an empty day just disappears.
 */
export function withDayRemoved(list: ReadingList, dayId: string): ReadingList {
  const index = list.days.findIndex((d) => d.id === dayId);
  if (index === -1) return list;
  const day = list.days[index];
  const days = list.days.filter((d) => d.id !== dayId);
  // A list always has at least one day — emptying it out would break every
  // reader of `days[0]`.
  if (days.length === 0) return { ...list, days: [{ ...day, entries: [] }] };
  if (day.entries.length > 0) {
    const fold = index === 0 ? 0 : index - 1;
    days[fold] =
      index === 0
        ? { ...days[fold], entries: [...day.entries, ...days[fold].entries] }
        : { ...days[fold], entries: [...days[fold].entries, ...day.entries] };
  }
  return { ...list, days };
}

function mapDay(
  list: ReadingList,
  dayId: string,
  fn: (day: ReadingDay) => ReadingDay,
): ReadingList {
  const index = list.days.findIndex((d) => d.id === dayId);
  if (index === -1) return list;
  return replaceDay(list, index, fn(list.days[index]));
}

function replaceDay(list: ReadingList, index: number, day: ReadingDay): ReadingList {
  const days = list.days.slice();
  days[index] = day;
  return { ...list, days };
}
