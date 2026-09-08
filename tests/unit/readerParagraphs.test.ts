import { describe, expect, it } from 'vitest';
import { groupIntoParagraphs } from '@/lib/readerParagraphs';
import type { VerseSummary } from '@/types/domain';

/**
 * Paragraph breaks in the reader are **computed, not editorial** — none of the
 * eight source Bibles carries paragraph markup. So the rule is the whole
 * feature, and its two guarantees are worth pinning: a paragraph never splits
 * mid-sentence, and the output is deterministic across translations.
 *
 * MIN_VERSES_PER_PARAGRAPH is 4 and is private, so it is asserted through
 * behaviour rather than read.
 */

const verses = (...texts: string[]): VerseSummary[] =>
  texts.map((text, i) => ({
    translation: 'KJV',
    bookId: 1,
    chapter: 1,
    verse: i + 1,
    text,
    display: `Genesis 1:${i + 1}`,
  }));

/** Every index appears exactly once, in order — the invariant every caller
 * relies on, since these are indices into the array `WordHighlighter` and the
 * playback plan both use. */
const coversEveryVerseInOrder = (groups: number[][], n: number) =>
  expect(groups.flat()).toEqual(Array.from({ length: n }, (_, i) => i));

describe('groupIntoParagraphs', () => {
  it('an empty chapter has no paragraphs', () => {
    expect(groupIntoParagraphs([])).toEqual([]);
  });

  it('holds a sentence-ending verse until four have accumulated', () => {
    // Every verse closes a sentence. Breaking on each would just be the
    // verse-per-line layout with extra spacing, which is what the minimum
    // exists to prevent.
    const g = groupIntoParagraphs(verses('One.', 'Two.', 'Three.', 'Four.', 'Five.', 'Six.', 'Seven.', 'Eight.'));
    expect(g).toEqual([[0, 1, 2, 3], [4, 5, 6, 7]]);
  });

  it('never breaks mid-sentence, even long past the minimum', () => {
    // Only verse 6 closes a sentence, so that is the only legal break — and it
    // is not taken, because it is the last verse.
    const g = groupIntoParagraphs(verses('a,', 'b,', 'c,', 'd,', 'e,', 'f.'));
    expect(g).toEqual([[0, 1, 2, 3, 4, 5]]);
  });

  it('breaks at the first sentence end after the minimum, not at the minimum', () => {
    const g = groupIntoParagraphs(verses('a.', 'b,', 'c,', 'd,', 'e.', 'f,', 'g,', 'h,', 'i.', 'j.'));
    // Verse 4 ('e.') is the first sentence end at or past four verses.
    expect(g[0]).toEqual([0, 1, 2, 3, 4]);
    coversEveryVerseInOrder(g, 10);
  });

  it('merges a short tail into the previous paragraph rather than dangling', () => {
    // Verses 8-9 would be a two-verse stub on their own.
    const g = groupIntoParagraphs(verses('a.', 'b.', 'c.', 'd.', 'e.', 'f.', 'g.', 'h.', 'i,', 'j,'));
    expect(g).toEqual([[0, 1, 2, 3], [4, 5, 6, 7, 8, 9]]);
  });

  it('a whole chapter shorter than the minimum is one paragraph', () => {
    // Psalm 117 is two verses; it must not merge into a non-existent previous
    // paragraph, and it must not vanish.
    expect(groupIntoParagraphs(verses('O praise the Lord.', 'Praise ye the Lord.')))
      .toEqual([[0, 1]]);
  });

  it('never breaks after the last verse', () => {
    const g = groupIntoParagraphs(verses('a.', 'b.', 'c.', 'd.'));
    expect(g).toEqual([[0, 1, 2, 3]]);
  });

  it.each([
    { text: 'He wept.', why: 'a full stop' },
    { text: 'Who is this?', why: 'a question mark' },
    { text: 'Hosanna!', why: 'an exclamation' },
    { text: 'He said, "It is finished."', why: 'a stop inside a closing quote' },
    { text: 'and it was so.”', why: 'a typographic closing quote' },
    { text: 'the sons of Levi.)', why: 'a closing bracket' },
    // German sets »…« and Swiss/French «…», so either mark can be the closing
    // one. Only `»` was in the class originally, which is precisely the half
    // that cannot end a quotation in HFA or S00 — the two texts that use them.
    { text: 'so gross ist er.«', why: 'a German closing guillemet' },
    { text: 'ainsi soit-il.»', why: 'a Swiss/French closing guillemet' },
    { text: 'trailing space. ', why: 'trailing whitespace' },
  ])('treats $why as closing a sentence', ({ text }) => {
    const g = groupIntoParagraphs(verses('a,', 'b,', 'c,', text, 'e,', 'f,', 'g,', 'h,'));
    expect(g[0]).toEqual([0, 1, 2, 3]);
  });

  it.each([
    { text: 'and the LORD said,', why: 'a comma' },
    { text: 'saying:', why: 'a colon' },
    { text: 'Abraham begat Isaac;', why: 'a semicolon' },
    { text: 'a name — and', why: 'a dash' },
    { text: '', why: 'an empty verse' },
  ])('does not treat $why as closing a sentence', ({ text }) => {
    const g = groupIntoParagraphs(verses('a,', 'b,', 'c,', text, 'e,', 'f,', 'g,', 'h.'));
    expect(g).toHaveLength(1);
  });

  it('loses no verse and reorders none, whatever the shape', () => {
    const texts = Array.from({ length: 40 }, (_, i) => (i % 3 === 0 ? `v${i}.` : `v${i},`));
    coversEveryVerseInOrder(groupIntoParagraphs(verses(...texts)), 40);
  });

  it('is deterministic — the same chapter always groups identically', () => {
    const v = verses('a.', 'b,', 'c.', 'd,', 'e.', 'f,', 'g.', 'h,', 'i.');
    expect(groupIntoParagraphs(v)).toEqual(groupIntoParagraphs(v));
  });
});
