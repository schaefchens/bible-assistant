import type { VerseSummary } from '@/types/domain';

/**
 * A paragraph never ends before this many verses have accumulated. Without it,
 * prose Bibles (where most verses are complete sentences) would break after
 * every verse — which is just the verse-per-line layout with extra spacing.
 *
 * This is the one knob if the paragraphs read badly.
 */
const MIN_VERSES_PER_PARAGRAPH = 4;

/** A verse that closes a sentence, allowing for a trailing quote or bracket. */
const ENDS_SENTENCE = /[.!?][)\]"'”’»]*\s*$/;

/**
 * Group a chapter's verses into paragraphs for the flowing-prose reader.
 *
 * **These breaks are computed, not editorial.** None of the eight source Bibles
 * carries paragraph or section markup — `public/bibles/*.xml` has only
 * `<verse>`, `<chapter>` and `<book>` elements, and the generated packs keep
 * just `{pk, verse, text, textTts?}`. So there is no upstream signal to render
 * and the alternative is one undifferentiated wall of text.
 *
 * The rule is deliberately conservative: break only *after* a verse that closes
 * a sentence, and only once at least MIN_VERSES_PER_PARAGRAPH verses have
 * accumulated. That guarantees a paragraph never splits mid-sentence, is
 * deterministic, and works the same in every translation — it just makes the
 * page breathe, it does not claim to know where a pericope begins.
 *
 * Returns arrays of indices into `verses`, so callers keep using the verse index
 * that `WordHighlighter` and the playback plan agree on.
 */
export function groupIntoParagraphs(verses: VerseSummary[]): number[][] {
  if (verses.length === 0) return [];
  const paragraphs: number[][] = [];
  let current: number[] = [];

  for (let i = 0; i < verses.length; i++) {
    current.push(i);
    const longEnough = current.length >= MIN_VERSES_PER_PARAGRAPH;
    const closes = ENDS_SENTENCE.test(verses[i].text);
    if (longEnough && closes && i < verses.length - 1) {
      paragraphs.push(current);
      current = [];
    }
  }
  // Whatever is left joins the final paragraph rather than dangling as a stub.
  if (current.length > 0) {
    if (current.length < MIN_VERSES_PER_PARAGRAPH && paragraphs.length > 0) {
      paragraphs[paragraphs.length - 1].push(...current);
    } else {
      paragraphs.push(current);
    }
  }
  return paragraphs;
}
