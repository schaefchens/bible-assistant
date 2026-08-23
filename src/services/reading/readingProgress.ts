import type { ReadingList, ReadingProgress } from '@/types/domain';
import { listEntries } from './readingEntries';

/**
 * Merge two progress records for the same list.
 *
 * `completed` is **unioned** rather than taken from the newer record: two
 * devices working different days of the same plan would otherwise erase each
 * other's ticks, and a lost tick is a passage the user is told to read twice.
 * `currentEntryId` does follow `updatedAt`, because "where am I" genuinely has
 * one newest answer.
 *
 * Commutative and idempotent, which is what lets the client apply it on pull
 * and the server apply it on write without the two needing to agree on order.
 */
export function mergeReadingProgress(
  a: ReadingProgress | undefined,
  b: ReadingProgress | undefined,
): ReadingProgress | null {
  if (!a) return b ?? null;
  if (!b) return a;
  const newer = b.updatedAt >= a.updatedAt ? b : a;
  return {
    listId: a.listId,
    completed: Array.from(new Set([...a.completed, ...b.completed])),
    currentEntryId: newer.currentEntryId,
    updatedAt: Math.max(a.updatedAt, b.updatedAt),
  };
}

export function emptyReadingProgress(listId: string): ReadingProgress {
  return { listId, completed: [], updatedAt: 0 };
}

export function normalizeReadingProgress(raw: unknown): ReadingProgress | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  if (typeof p.listId !== 'string' || !p.listId) return null;
  return {
    listId: p.listId,
    completed: Array.isArray(p.completed) ? p.completed.filter((c): c is string => typeof c === 'string') : [],
    currentEntryId:
      typeof p.currentEntryId === 'string' && p.currentEntryId ? p.currentEntryId : undefined,
    updatedAt: typeof p.updatedAt === 'number' ? p.updatedAt : 0,
  };
}

export type ProgressStats = {
  total: number;
  done: number;
  /** 0..1 */
  fraction: number;
};

/**
 * Completion counted against the entries the list *currently* has, so removing
 * an entry can't leave a plan reading 105% done. Ticks for entries that no
 * longer exist are kept in storage (an undo may bring the entry back) but not
 * counted.
 */
export function progressStats(list: ReadingList, progress?: ReadingProgress): ProgressStats {
  const entries = listEntries(list);
  const done = progress
    ? entries.filter((e) => progress.completed.includes(e.id)).length
    : 0;
  return {
    total: entries.length,
    done,
    fraction: entries.length === 0 ? 0 : done / entries.length,
  };
}
