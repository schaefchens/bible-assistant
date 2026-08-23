import type { ReadingDay, ReadingEntry } from '@/types/domain';
import { BOOKS, findBookByName, getBookById } from '@/services/bible/bookCatalog';
import { newEntryId, newReadingDay } from './readingEntries';

/**
 * Building a long plan from a *rule* rather than from an enumeration.
 *
 * "The whole Bible in a year" is 1,189 chapters over 365 days. Having the model
 * write that out is slow, expensive and unreliable — a plan that long will be
 * truncated long before it is finished, and a truncated plan is a wrong plan.
 * So the assistant says what to cover and in how many days, and the arithmetic
 * happens here: exact, instant, and the same every time.
 */

/** Scope words the assistant may use instead of naming every book. */
const ALIASES: Record<string, number[]> = {
  bible: range(1, 66),
  ot: range(1, 39),
  oldtestament: range(1, 39),
  nt: range(40, 66),
  newtestament: range(40, 66),
  gospels: [40, 41, 42, 43],
  pentateuch: range(1, 5),
  torah: range(1, 5),
};

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

function normalize(scope: string): string {
  return scope.trim().toLowerCase().replace(/[\s_-]/g, '');
}

/** The books a scope word or book name refers to, or null when unresolvable. */
function resolveScope(scope: string): number[] | null {
  const alias = ALIASES[normalize(scope)];
  if (alias) return alias;
  const book = findBookByName(scope);
  return book ? [book.id] : null;
}

export type BuiltPlan = {
  days: ReadingDay[];
  /** Chapters the plan covers, for the reply the assistant gives. */
  chapterCount: number;
  /** Scope words that matched nothing, reported rather than dropped. */
  unresolved: string[];
};

/**
 * Spread every chapter of `scopes` across `dayCount` days, in canonical order.
 *
 * The split is even to within one chapter (`round` on a fractional stride rather
 * than a fixed size), so a 365-day whole-Bible plan reads 3 or 4 chapters a day
 * and never leaves a stub day at the end.
 */
export function buildPlanDays(scopes: string[], dayCount: number): BuiltPlan {
  const unresolved: string[] = [];
  const bookIds: number[] = [];
  for (const scope of scopes) {
    const resolved = resolveScope(scope);
    if (!resolved) unresolved.push(scope);
    else for (const id of resolved) if (!bookIds.includes(id)) bookIds.push(id);
  }
  bookIds.sort((a, b) => a - b);

  const chapters: { bookId: number; chapter: number }[] = [];
  for (const bookId of bookIds) {
    const book = getBookById(bookId) ?? BOOKS.find((b) => b.id === bookId);
    if (!book) continue;
    for (let chapter = 1; chapter <= book.chapters; chapter++) {
      chapters.push({ bookId, chapter });
    }
  }
  if (chapters.length === 0) {
    return { days: [], chapterCount: 0, unresolved };
  }

  // Never more days than chapters — an empty day is not a reading.
  const totalDays = Math.max(1, Math.min(Math.floor(dayCount), chapters.length));
  const stride = chapters.length / totalDays;
  const days: ReadingDay[] = [];
  for (let d = 0; d < totalDays; d++) {
    const from = Math.round(d * stride);
    const to = Math.round((d + 1) * stride);
    const entries: ReadingEntry[] = chapters.slice(from, to).map((c) => ({
      id: newEntryId(),
      bookId: c.bookId,
      chapter: c.chapter,
    }));
    days.push({ ...newReadingDay(), entries });
  }
  return { days, chapterCount: chapters.length, unresolved };
}
