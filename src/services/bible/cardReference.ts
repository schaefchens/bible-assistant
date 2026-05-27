import type { CardReference, CardVerseRange, Locale } from '@/types/domain';
import type { Translation } from './bibleApi';
import { parseReference, type ParsedReference } from './referenceParser';
import { formatRangeList } from './bookCatalog';
import { TRANSLATIONS } from './translationCatalog';

const translationByKey = new Map<string, Translation>(
  TRANSLATIONS.map((t) => [t.code.toLowerCase(), t.code]),
);

/** Case-insensitive match against known translation codes; returns the
 * canonical-cased code, or undefined if the string isn't a translation. */
export function asTranslationCode(s: string): Translation | undefined {
  return translationByKey.get(s.trim().toLowerCase());
}

/**
 * Parse one editor line into a structured CardReference.
 *
 * Format: `Reference; [Translation]; [Custom text]`
 *   "Galater 5,22"
 *   "Galater 5,22; S00"
 *   "Galater 5,22; LUT; Dies ist die Frucht des Geistes"
 *   "Galater 5,22; Das ist besonders wichtig"
 *
 * Of the segments after the reference, one matching a translation code
 * becomes the override; the rest (joined) become the label.
 */
export function parseCardReferenceLine(line: string): CardReference {
  const trimmed = line.trim();
  const segments = trimmed.split(';').map((s) => s.trim());
  const refText = segments[0] ?? '';
  const parsed = parseReference(refText);
  if (!parsed) {
    return { raw: trimmed };
  }

  let translation: Translation | undefined;
  const labelParts: string[] = [];
  for (const seg of segments.slice(1)) {
    if (!seg) continue;
    const code = asTranslationCode(seg);
    if (code && !translation) {
      translation = code;
    } else {
      labelParts.push(seg);
    }
  }

  const ref: CardReference = {
    bookId: parsed.bookId,
    chapter: parsed.chapter,
  };
  if (parsed.verseRanges) ref.ranges = parsed.verseRanges;
  if (translation) ref.translation = translation;
  const label = labelParts.join('; ');
  if (label) ref.label = label;
  return ref;
}

/** The bare reference text (no translation, no label), locale-aware. */
function formatBareReference(ref: CardReference, locale: Locale): string {
  if (ref.bookId == null || ref.chapter == null) return ref.raw ?? '';
  return formatRangeList(ref.bookId, ref.chapter, ref.ranges ?? [], locale);
}

/** Round-trip a CardReference back to an editable line for the editor. */
export function formatCardReferenceInput(ref: CardReference, locale: Locale): string {
  if (ref.bookId == null || ref.chapter == null) return ref.raw ?? '';
  const parts = [formatBareReference(ref, locale)];
  if (ref.translation) parts.push(ref.translation);
  if (ref.label) parts.push(ref.label);
  return parts.join('; ');
}

/** Display heading: reference plus translation badge (only when overridden). */
export function formatCardReferenceHeading(ref: CardReference, locale: Locale): string {
  const bare = formatBareReference(ref, locale);
  return ref.translation ? `${bare} · ${ref.translation}` : bare;
}

/** Build a ParsedReference for fetching; null when unparseable. */
export function cardReferenceToParsed(ref: CardReference): ParsedReference | null {
  if (ref.bookId == null || ref.chapter == null) return null;
  const ranges = ref.ranges;
  if (!ranges || ranges.length === 0) {
    return { bookId: ref.bookId, chapter: ref.chapter };
  }
  return {
    bookId: ref.bookId,
    chapter: ref.chapter,
    verseRanges: ranges,
    verseStart: ranges[0].start,
    verseEnd: ranges[ranges.length - 1].end,
  };
}

function isValidRange(v: unknown): v is CardVerseRange {
  return (
    !!v &&
    typeof v === 'object' &&
    typeof (v as CardVerseRange).start === 'number' &&
    typeof (v as CardVerseRange).end === 'number'
  );
}

/**
 * Normalize a persisted `references` value into CardReference[]. Handles the
 * legacy `string[]` shape (parse each line) and the structured shape
 * (pass through, light-validate). Used at the store boundary so legacy local
 * rows and remote payloads are migrated transparently on read.
 */
export function normalizeCardReferences(raw: unknown): CardReference[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry): CardReference => {
    if (typeof entry === 'string') {
      return parseCardReferenceLine(entry);
    }
    if (entry && typeof entry === 'object') {
      const e = entry as Record<string, unknown>;
      const ref: CardReference = {};
      if (typeof e.bookId === 'number') ref.bookId = e.bookId;
      if (typeof e.chapter === 'number') ref.chapter = e.chapter;
      if (Array.isArray(e.ranges)) {
        const ranges = e.ranges.filter(isValidRange);
        if (ranges.length > 0) ref.ranges = ranges;
      }
      if (typeof e.translation === 'string') {
        const code = asTranslationCode(e.translation);
        if (code) ref.translation = code;
      }
      if (typeof e.label === 'string' && e.label) ref.label = e.label;
      if (typeof e.raw === 'string' && e.raw) ref.raw = e.raw;
      // A structured entry with neither a book nor raw text is meaningless.
      if (ref.bookId == null && !ref.raw) return { raw: '' };
      return ref;
    }
    return { raw: '' };
  }).filter((r) => r.bookId != null || (r.raw ?? '') !== '');
}
