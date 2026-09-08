import type { Card, ReadingList, ReadingProgress } from '@/types/domain';
import { normalizeCardReferences } from '@/services/bible/cardReference';
import { newReadingDay, normalizeReadingList } from '@/services/reading/readingEntries';

/**
 * Turning a stored row into a row the app can render.
 *
 * The third thing both halves need: `libraryStore.init` reads these rows off
 * disk and `librarySync.pullFromServer` reads them off the wire, and both have
 * to shape them identically — a list that sorts differently depending on which
 * path loaded it is the kind of inconsistency nobody notices until two devices
 * disagree.
 */

// Normalize a card read from storage/server into the current shape. Migrates
// legacy `references: string[]` (and any partial structured data) into
// CardReference[] on read, so old local rows and remote payloads both work.
export function normalizeCard(card: Card): Card {
  return { ...card, references: normalizeCardReferences(card.references) };
}

/** Most-recently-touched first — "continue what I was reading" without a
 * user-maintained order array. */
export function sortLists(lists: ReadingList[]): ReadingList[] {
  return lists.slice().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function indexProgress(rows: ReadingProgress[]): Record<string, ReadingProgress> {
  const out: Record<string, ReadingProgress> = {};
  for (const row of rows) out[row.listId] = row;
  return out;
}

/** A stored row that predates a field (or a hand-edited server file) must not
 * crash the reader. normalizeReadingList only rejects a row with no id, which a
 * Dexie row keyed by id cannot be — the fallback just keeps the
 * "at least one day" invariant true if that ever changes. */
export function normalizeList(list: ReadingList): ReadingList {
  return (
    normalizeReadingList(list) ?? {
      ...list,
      days: list.days?.length ? list.days : [newReadingDay()],
    }
  );
}
