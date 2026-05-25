import { findBookByName, getBookById } from './bookCatalog';

export type VerseRange = { start: number; end: number };

export type ParsedReference = {
  bookId: number;
  chapter: number;
  /** All requested verse ranges, in order. A single verse is `{start:v,end:v}`.
   * `undefined` means the whole chapter. Supports non-contiguous like
   * `"Matthew 22:37,39"` → `[{37,37},{39,39}]`. */
  verseRanges?: VerseRange[];
  /** Convenience: first range's start (legacy callers). */
  verseStart?: number;
  /** Convenience: last range's end (legacy callers). NOTE: when the spec
   * is non-contiguous the `[verseStart..verseEnd]` interval spans gaps —
   * callers that need the actual selection must use `verseRanges`. */
  verseEnd?: number;
};

/**
 * Accepts strings like:
 *   "Galatians 5:22", "gal 5,22", "Galater 5,22"
 *   "mt 23:8-10", "Matthew 23,8-10"
 *   "matthew 1", "1. Mose 1"
 *   "1 John 4:7-12"
 *   "Matthew 22:37,39"      (non-contiguous verses)
 *   "Matthew 22:37-39,42"   (mix of range + single)
 */
export function parseReference(input: string): ParsedReference | null {
  const cleaned = input.trim().replace(/[–—]/g, '-');
  // Book + chapter + optional verse spec.
  const m = cleaned.match(
    /^\s*(\d?\.?\s*[A-Za-zÄÖÜäöüß]+(?:\s+[A-Za-zÄÖÜäöüß]+)*)\s+(\d+)(?:[:,.\s]\s*(.+))?\s*$/u,
  );
  if (!m) return null;

  const bookRaw = m[1];
  const chapter = parseInt(m[2], 10);
  const verseSpec = m[3]?.trim();

  const book = findBookByName(bookRaw);
  if (!book) return null;
  if (chapter < 1 || chapter > book.chapters) return null;

  if (!verseSpec) {
    return { bookId: book.id, chapter };
  }

  // Verse spec: comma- or period-separated list of `N` or `N-M`.
  const ranges: VerseRange[] = [];
  for (const raw of verseSpec.split(/\s*[,.]\s*/)) {
    const part = raw.trim();
    if (!part) continue;
    const rangeMatch = part.match(/^(\d+)\s*-\s*(\d+)$/);
    const singleMatch = part.match(/^(\d+)$/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);
      if (end < start) return null;
      ranges.push({ start, end });
    } else if (singleMatch) {
      const v = parseInt(singleMatch[1], 10);
      ranges.push({ start: v, end: v });
    } else {
      return null;
    }
  }
  if (ranges.length === 0) {
    return { bookId: book.id, chapter };
  }
  return {
    bookId: book.id,
    chapter,
    verseRanges: ranges,
    verseStart: ranges[0].start,
    verseEnd: ranges[ranges.length - 1].end,
  };
}

export function isReferenceValid(ref: ParsedReference): boolean {
  const book = getBookById(ref.bookId);
  if (!book) return false;
  if (ref.chapter < 1 || ref.chapter > book.chapters) return false;
  if (ref.verseRanges) {
    for (const r of ref.verseRanges) {
      if (r.end < r.start) return false;
    }
  }
  return true;
}
