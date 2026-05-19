import { findBookByName, getBookById } from './bookCatalog';

export type ParsedReference = {
  bookId: number;
  chapter: number;
  verseStart?: number;
  verseEnd?: number;
};

/**
 * Accepts strings like:
 *   "Galatians 5:22", "gal 5,22", "Galater 5,22"
 *   "mt 23:8-10", "Matthew 23,8-10"
 *   "matthew 1", "1. Mose 1"
 *   "1 John 4:7-12"
 */
export function parseReference(input: string): ParsedReference | null {
  const cleaned = input.trim().replace(/[–—]/g, '-');
  // Capture leading book token: optional digit prefix (e.g. "1") + book name word(s)
  const m = cleaned.match(/^\s*(\d?\.?\s*[A-Za-zÄÖÜäöüß]+(?:\s+[A-Za-zÄÖÜäöüß]+)*)\s+(\d+)\s*(?:[:,.\s]\s*(\d+)(?:\s*[-–]\s*(\d+))?)?\s*$/u);
  if (!m) return null;

  const bookRaw = m[1];
  const chapter = parseInt(m[2], 10);
  const verseStart = m[3] ? parseInt(m[3], 10) : undefined;
  const verseEnd = m[4] ? parseInt(m[4], 10) : undefined;

  const book = findBookByName(bookRaw);
  if (!book) return null;
  if (chapter < 1 || chapter > book.chapters) return null;
  if (verseEnd !== undefined && verseStart !== undefined && verseEnd < verseStart) return null;

  return {
    bookId: book.id,
    chapter,
    verseStart,
    verseEnd: verseEnd ?? verseStart,
  };
}

export function isReferenceValid(ref: ParsedReference): boolean {
  const book = getBookById(ref.bookId);
  if (!book) return false;
  if (ref.chapter < 1 || ref.chapter > book.chapters) return false;
  if (
    ref.verseStart !== undefined &&
    ref.verseEnd !== undefined &&
    ref.verseEnd < ref.verseStart
  )
    return false;
  return true;
}
