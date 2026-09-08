import { describe, expect, it } from 'vitest';
import {
  emptyReadingProgress,
  mergeReadingProgress,
  normalizeReadingProgress,
  progressStats,
} from '@/services/reading/readingProgress';
import type { ReadingList, ReadingProgress } from '@/types/domain';

/**
 * `mergeReadingProgress` is the only merge rule in the app that is not
 * last-write-wins, and it runs in two places — the client on pull and
 * api.php's `handleUpsertProgress` on write. Its docblock claims the two
 * properties that let those two run in any order; nothing checked them.
 *
 * The cost of getting it wrong is stated in the source: "a lost tick is a
 * passage the user is told to read twice."
 */

const progress = (over: Partial<ReadingProgress> = {}): ReadingProgress => ({
  listId: 'list-1',
  completed: [],
  updatedAt: 0,
  ...over,
});

describe('mergeReadingProgress — absent operands', () => {
  it('two nothings merge to nothing', () => {
    expect(mergeReadingProgress(undefined, undefined)).toBeNull();
  });

  it('either side alone survives untouched', () => {
    const p = progress({ completed: ['e1'], updatedAt: 5 });
    expect(mergeReadingProgress(p, undefined)).toEqual(p);
    expect(mergeReadingProgress(undefined, p)).toEqual(p);
  });
});

describe('mergeReadingProgress — completed is unioned, never replaced', () => {
  it('keeps ticks only the older record has', () => {
    // The bug this rule exists to prevent: device B ticked e2 without pulling
    // first. Last-write-wins would drop e1 and re-present it as unread.
    const older = progress({ completed: ['e1'], updatedAt: 10 });
    const newer = progress({ completed: ['e2'], updatedAt: 20 });
    expect(mergeReadingProgress(older, newer)!.completed.sort()).toEqual(['e1', 'e2']);
  });

  it('does not duplicate a tick both devices have', () => {
    const a = progress({ completed: ['e1', 'e2'], updatedAt: 10 });
    const b = progress({ completed: ['e2', 'e3'], updatedAt: 20 });
    expect(mergeReadingProgress(a, b)!.completed.sort()).toEqual(['e1', 'e2', 'e3']);
  });
});

describe('mergeReadingProgress — currentEntryId follows updatedAt', () => {
  it('takes the newer answer to "where am I"', () => {
    const a = progress({ currentEntryId: 'e1', updatedAt: 10 });
    const b = progress({ currentEntryId: 'e2', updatedAt: 20 });
    expect(mergeReadingProgress(a, b)!.currentEntryId).toBe('e2');
    expect(mergeReadingProgress(b, a)!.currentEntryId).toBe('e2');
  });

  it('carries the newest timestamp', () => {
    const a = progress({ updatedAt: 10 });
    const b = progress({ updatedAt: 20 });
    expect(mergeReadingProgress(a, b)!.updatedAt).toBe(20);
    expect(mergeReadingProgress(b, a)!.updatedAt).toBe(20);
  });
});

describe('mergeReadingProgress — the two properties the docblock claims', () => {
  const a = progress({ completed: ['e1', 'e3'], currentEntryId: 'e3', updatedAt: 30 });
  const b = progress({ completed: ['e2'], currentEntryId: 'e2', updatedAt: 40 });

  it('is commutative, so client and server need not agree on order', () => {
    const ab = mergeReadingProgress(a, b)!;
    const ba = mergeReadingProgress(b, a)!;
    expect({ ...ab, completed: [...ab.completed].sort() })
      .toEqual({ ...ba, completed: [...ba.completed].sort() });
  });

  it('is idempotent, so a replayed pull changes nothing', () => {
    const once = mergeReadingProgress(a, b)!;
    const twice = mergeReadingProgress(once, b)!;
    expect({ ...twice, completed: [...twice.completed].sort() })
      .toEqual({ ...once, completed: [...once.completed].sort() });
    expect(mergeReadingProgress(once, once)).toEqual(once);
  });

  /**
   * The one place commutativity is only conditional, recorded rather than
   * asserted away: `newer` is chosen with `>=`, so on an exact `updatedAt` tie
   * the *second* operand's `currentEntryId` wins and the order does matter.
   * Both `completed` and `updatedAt` stay order-free even then, which is what
   * protects against data loss — a tie can pick either resume point, and both
   * are defensible. Two devices writing in the same millisecond is the only way
   * to reach it.
   */
  it('on an updatedAt tie, loses nothing but does pick by argument order', () => {
    const x = progress({ completed: ['e1'], currentEntryId: 'e1', updatedAt: 50 });
    const y = progress({ completed: ['e2'], currentEntryId: 'e2', updatedAt: 50 });
    expect(mergeReadingProgress(x, y)!.currentEntryId).toBe('e2');
    expect(mergeReadingProgress(y, x)!.currentEntryId).toBe('e1');
    // No tick is lost either way — the property that actually matters.
    expect(mergeReadingProgress(x, y)!.completed.sort()).toEqual(['e1', 'e2']);
    expect(mergeReadingProgress(y, x)!.completed.sort()).toEqual(['e1', 'e2']);
  });

  it('takes listId from the first operand', () => {
    // Documented as "for the same list", so this only decides what happens to
    // a caller that broke that contract. Pinned so a refactor notices.
    const other = progress({ listId: 'list-2', updatedAt: 99 });
    expect(mergeReadingProgress(a, other)!.listId).toBe('list-1');
  });
});

describe('normalizeReadingProgress', () => {
  it('rejects anything without a listId', () => {
    expect(normalizeReadingProgress(null)).toBeNull();
    expect(normalizeReadingProgress('nope')).toBeNull();
    expect(normalizeReadingProgress({})).toBeNull();
    expect(normalizeReadingProgress({ listId: '' })).toBeNull();
  });

  it('drops non-string ticks rather than trusting the wire', () => {
    const p = normalizeReadingProgress({
      listId: 'list-1',
      completed: ['e1', 42, null, 'e2'],
      updatedAt: 'soon',
    })!;
    expect(p.completed).toEqual(['e1', 'e2']);
    expect(p.updatedAt).toBe(0);
    expect(p.currentEntryId).toBeUndefined();
  });
});

describe('progressStats', () => {
  const list: ReadingList = {
    id: 'list-1',
    name: 'Plan',
    days: [
      { id: 'd1', entries: [{ id: 'e1', bookId: 1, chapter: 1 }, { id: 'e2', bookId: 1, chapter: 2 }] },
      { id: 'd2', entries: [{ id: 'e3', bookId: 1, chapter: 3 }] },
    ],
    createdAt: 0,
    updatedAt: 0,
  };

  it('counts across every day of the list', () => {
    const s = progressStats(list, progress({ completed: ['e1', 'e3'] }));
    expect(s).toEqual({ total: 3, done: 2, fraction: 2 / 3 });
  });

  it('reads 0 with no progress record at all', () => {
    expect(progressStats(list)).toEqual({ total: 3, done: 0, fraction: 0 });
  });

  /** A tick for a deleted entry stays in storage (an undo may bring it back)
   * but must not be counted, or a plan reads 105% done. */
  it('ignores ticks for entries the list no longer has', () => {
    const s = progressStats(list, progress({ completed: ['e1', 'e2', 'e3', 'gone'] }));
    expect(s).toEqual({ total: 3, done: 3, fraction: 1 });
  });

  it('an empty list is 0, not NaN', () => {
    const empty: ReadingList = { ...list, days: [{ id: 'd1', entries: [] }] };
    expect(progressStats(empty, progress())).toEqual({ total: 0, done: 0, fraction: 0 });
  });
});

describe('emptyReadingProgress', () => {
  it('starts at zero for the given list', () => {
    expect(emptyReadingProgress('list-9')).toEqual({
      listId: 'list-9',
      completed: [],
      updatedAt: 0,
    });
  });
});
