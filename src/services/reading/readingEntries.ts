import type {
  Locale,
  ReadingDay,
  ReadingEntry,
  ReadingList,
  VerseRange,
} from '@/types/domain';
import type { Translation } from '@/services/bible/bibleApi';
import { findBookByName, formatRangeList, formatReference, getBookById } from '@/services/bible/bookCatalog';
import { parseReference } from '@/services/bible/referenceParser';
import { asTranslationCode } from '@/services/bible/cardReference';

/**
 * Reading-list entries as text: parsing what the user (or the model) typed, and
 * formatting it back.
 *
 * The line format matches the card editor's deliberately —
 * `Reference; [Translation]; [Label]` — so one syntax covers both features and
 * `asTranslationCode` stays the single arbiter of what counts as a translation
 * code. What is *added* here is the two shapes a plan needs that a card
 * reference has no use for: a whole book ("John") and a chapter span
 * ("Genesis 1-3").
 */

/** `(\d?\.?\s*Word...)` — the book-name shape `parseReference` accepts, so
 * "1. Mose" and "Song of Solomon" both survive the span/book branches below. */
const BOOK_NAME = String.raw`\d?\.?\s*[A-Za-zÄÖÜäöüß]+(?:\s+[A-Za-zÄÖÜäöüß]+)*`;
const CHAPTER_SPAN_RE = new RegExp(String.raw`^\s*(${BOOK_NAME})\s+(\d+)\s*-\s*(\d+)\s*$`, 'u');
const WHOLE_BOOK_RE = new RegExp(String.raw`^\s*(${BOOK_NAME})\s*$`, 'u');

export function newEntryId(): string {
  return crypto.randomUUID();
}

/**
 * Parse one editor line into an entry. Returns null when the reference can't be
 * resolved.
 *
 * Unlike a card reference, an unparseable line is **rejected** rather than kept
 * as `raw`: a card is a note that may hold a half-remembered reference, but a
 * reading list is a playback queue, and an entry playback can't resolve would
 * be a silent hole in the middle of a plan.
 */
export function parseReadingEntryLine(line: string): ReadingEntry | null {
  const segments = line.split(';').map((s) => s.trim());
  const refText = segments[0] ?? '';
  if (!refText) return null;

  const base = parsePassage(refText);
  if (!base) return null;

  let translation: Translation | undefined;
  const labelParts: string[] = [];
  for (const seg of segments.slice(1)) {
    if (!seg) continue;
    const code = asTranslationCode(seg);
    if (code && !translation) translation = code;
    else labelParts.push(seg);
  }

  const entry: ReadingEntry = { id: newEntryId(), ...base };
  if (translation) entry.translation = translation;
  const label = labelParts.join('; ');
  if (label) entry.label = label;
  return entry;
}

/** Parse many lines, dropping the ones that don't resolve. */
export function parseReadingEntryLines(text: string): ReadingEntry[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map(parseReadingEntryLine)
    .filter((e): e is ReadingEntry => e !== null);
}

/** The passage part of a line, without the id or the `;` suffixes. */
function parsePassage(refText: string): Omit<ReadingEntry, 'id'> | null {
  const cleaned = refText.replace(/[–—]/g, '-');

  // Chapter/verse first: "Genesis 1", "Ps 23:1-6", "1. Mose 1,3".
  const parsed = parseReference(cleaned);
  if (parsed) {
    const out: Omit<ReadingEntry, 'id'> = {
      bookId: parsed.bookId,
      chapter: parsed.chapter,
    };
    if (parsed.verseRanges) out.ranges = parsed.verseRanges;
    return out;
  }

  // "Genesis 1-3" — a chapter span, which parseReference rejects because its
  // verse spec never starts with a dash.
  const span = cleaned.match(CHAPTER_SPAN_RE);
  if (span) {
    const book = findBookByName(span[1]);
    if (!book) return null;
    const from = parseInt(span[2], 10);
    const to = parseInt(span[3], 10);
    if (from < 1 || to < from || from > book.chapters) return null;
    // Clamp rather than reject: `BookEntry.chapters` is English versification,
    // so an over-long span is usually a plan written against another edition,
    // not a typo worth throwing the whole line away for.
    const end = Math.min(to, book.chapters);
    return end > from
      ? { bookId: book.id, chapter: from, chapterEnd: end }
      : { bookId: book.id, chapter: from };
  }

  // A bare book name — "John", "1. Mose" — meaning the whole book.
  const bare = cleaned.match(WHOLE_BOOK_RE);
  if (bare) {
    const book = findBookByName(bare[1]);
    if (book) return { bookId: book.id };
  }
  return null;
}

/** Display text for an entry: "John", "Genesis 1-3", "Psalm 23:1-6". */
export function formatReadingEntry(entry: ReadingEntry, locale: Locale): string {
  const book = getBookById(entry.bookId);
  if (!book) return `?${entry.bookId}`;
  const name = locale === 'de' ? book.nameDe : book.nameEn;
  if (entry.chapter === undefined) return name;
  if (entry.chapterEnd && entry.chapterEnd > entry.chapter) {
    return `${name} ${entry.chapter}-${entry.chapterEnd}`;
  }
  if (entry.ranges && entry.ranges.length > 0) {
    return formatRangeList(entry.bookId, entry.chapter, entry.ranges, locale);
  }
  return formatReference(entry.bookId, entry.chapter, undefined, undefined, locale);
}

/** Round-trip an entry back to an editable line, suffixes included. */
export function formatReadingEntryInput(entry: ReadingEntry, locale: Locale): string {
  const parts = [formatReadingEntry(entry, locale)];
  if (entry.translation) parts.push(entry.translation);
  if (entry.label) parts.push(entry.label);
  return parts.join('; ');
}

/**
 * How many chapters an entry covers, from the catalog alone — no fetch.
 *
 * English versification again, so this is an *estimate* for the German texts
 * (LUT has no Malachi 4). Fine for the "21 chapters" summary it feeds; anything
 * that must be exact resolves the entry instead.
 */
export function entryChapterCount(entry: ReadingEntry): number {
  if (entry.chapter === undefined) return getBookById(entry.bookId)?.chapters ?? 0;
  if (entry.chapterEnd && entry.chapterEnd > entry.chapter) {
    return entry.chapterEnd - entry.chapter + 1;
  }
  return 1;
}

/**
 * The "note · TRANSLATION" line shown under a passage, or undefined when there
 * is neither. A pinned translation is worth showing; the active one is not, so
 * callers pass it only when the entry overrode it.
 */
export function passageDetail(parts: (string | undefined)[]): string | undefined {
  const detail = parts.filter(Boolean).join(' · ');
  return detail || undefined;
}

/** Every entry of a list, days flattened, in reading order. */
export function listEntries(list: ReadingList): ReadingEntry[] {
  return list.days.flatMap((d) => d.entries);
}

export function listChapterCount(list: ReadingList): number {
  return listEntries(list).reduce((n, e) => n + entryChapterCount(e), 0);
}

/**
 * True when the list is a plain list rather than a structured plan, i.e. one
 * untitled day. The UI renders these flat, with no day headings.
 */
export function isFlatList(list: ReadingList): boolean {
  return list.days.length <= 1 && !list.days[0]?.title;
}

export function newReadingDay(title?: string): ReadingDay {
  return { id: crypto.randomUUID(), title, entries: [] };
}

export function newReadingList(name: string): ReadingList {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    name,
    days: [newReadingDay()],
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeRange(v: unknown): VerseRange | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Partial<VerseRange>;
  if (typeof r.start !== 'number' || typeof r.end !== 'number') return null;
  if (r.end < r.start) return null;
  return { start: r.start, end: r.end };
}

function normalizeEntry(raw: unknown): ReadingEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Record<string, unknown>;
  if (typeof e.bookId !== 'number' || !getBookById(e.bookId)) return null;
  const entry: ReadingEntry = {
    id: typeof e.id === 'string' && e.id ? e.id : newEntryId(),
    bookId: e.bookId,
  };
  if (typeof e.chapter === 'number' && e.chapter >= 1) entry.chapter = e.chapter;
  if (entry.chapter !== undefined && typeof e.chapterEnd === 'number' && e.chapterEnd > entry.chapter) {
    entry.chapterEnd = e.chapterEnd;
  }
  if (entry.chapter !== undefined && entry.chapterEnd === undefined && Array.isArray(e.ranges)) {
    const ranges = e.ranges.map(normalizeRange).filter((r): r is VerseRange => r !== null);
    if (ranges.length > 0) entry.ranges = ranges;
  }
  if (typeof e.translation === 'string') {
    const code = asTranslationCode(e.translation);
    if (code) entry.translation = code;
  }
  if (typeof e.label === 'string' && e.label) entry.label = e.label;
  return entry;
}

/**
 * Coerce a persisted or remote value into a `ReadingList`.
 *
 * Applied at every boundary the store reads from — Dexie rows, a server pull,
 * an assistant tool call — because all three can carry a shape this build never
 * wrote. Guarantees the two invariants the rest of the code assumes: at least
 * one day, and every entry resolvable to a real book.
 */
export function normalizeReadingList(raw: unknown): ReadingList | null {
  if (!raw || typeof raw !== 'object') return null;
  const l = raw as Record<string, unknown>;
  if (typeof l.id !== 'string' || !l.id) return null;

  const days: ReadingDay[] = [];
  if (Array.isArray(l.days)) {
    for (const d of l.days) {
      if (!d || typeof d !== 'object') continue;
      const day = d as Record<string, unknown>;
      const entries = Array.isArray(day.entries)
        ? day.entries.map(normalizeEntry).filter((e): e is ReadingEntry => e !== null)
        : [];
      days.push({
        id: typeof day.id === 'string' && day.id ? day.id : crypto.randomUUID(),
        title: typeof day.title === 'string' && day.title ? day.title : undefined,
        entries,
      });
    }
  }
  if (days.length === 0) days.push(newReadingDay());

  const now = Date.now();
  return {
    id: l.id,
    name: typeof l.name === 'string' ? l.name : '',
    description: typeof l.description === 'string' && l.description ? l.description : undefined,
    days,
    color: typeof l.color === 'string' ? (l.color as ReadingList['color']) : undefined,
    emoji: typeof l.emoji === 'string' && l.emoji ? l.emoji : undefined,
    createdAt: typeof l.createdAt === 'number' ? l.createdAt : now,
    updatedAt: typeof l.updatedAt === 'number' ? l.updatedAt : now,
  };
}
