import fs from 'node:fs';
import { SaxesParser } from 'saxes';
import { normalizeSpace, stripForTts, makePk } from './phpCompat.mjs';

/**
 * Streaming parse of a Zefania XML bible into per-book verse maps.
 *
 * Two schemas exist in public/bibles/ and the PHP parser handles both by
 * accepting either spelling of every element and attribute:
 *
 *   Zefania 2005 (LUT, S51, ELB, S00, HFA, ESV, NKJV):
 *     <BIBLEBOOK bnumber> <CHAPTER cnumber> <VERS vnumber>
 *   Simplified (KJV):
 *     <bible> <testament> <book number> <chapter number> <verse number>
 *
 * Inside a verse the only inner element that appears anywhere in the corpus is
 * <gr str="..."> (Strong's), plus a handful of <NOTE>/<DIV> in s51.xml. The
 * PHP matches those two by exact uppercase nodeName, so we do too — a
 * lowercase <note> would be kept as text by both implementations.
 *
 * Returns: Map<bookId, { chapters: Map<chapterNo, verse[]>, strongs: Map<...> }>
 */
export function parseZefania(xmlPath, { onProgress } = {}) {
  const parser = new SaxesParser({ position: false });
  const books = new Map();

  // Walk state
  let bookId = 0;
  let chapterNo = 0;
  let verseNo = 0;
  let inVerse = false;
  /** Depth of the <NOTE>/<DIV> subtree we're currently skipping, 0 = not skipping. */
  let skipDepth = 0;
  /** Nesting depth inside a <gr>; 0 means we're in plain verse text. Must be a
   * depth (not a boolean or the str value) because a <gr> may carry no `str`
   * attribute, and text after </gr> must start a fresh segment. */
  let grDepth = 0;
  let segments = [];
  let hasStrongs = false;

  const flushVerse = () => {
    if (!inVerse || verseNo <= 0) return;
    const text = normalizeSpace(segments.map((s) => s.t).join(''));
    const textTts = stripForTts(text);
    const verse = { pk: makePk(bookId, chapterNo, verseNo), verse: verseNo, text };
    // Omit textTts when identical — it matches for the overwhelming majority
    // of verses and the client re-materializes it on decode. Cuts LUT's raw
    // pack from 9.2 MB to 5.0 MB.
    if (textTts !== text) verse.textTts = textTts;

    const book = books.get(bookId);
    if (!book.chapters.has(chapterNo)) book.chapters.set(chapterNo, []);
    book.chapters.get(chapterNo).push(verse);

    if (hasStrongs) {
      if (!book.strongs.has(chapterNo)) book.strongs.set(chapterNo, {});
      book.strongs.get(chapterNo)[verseNo] = segments.map((s) =>
        s.s !== null ? { t: s.t, s: s.s } : { t: s.t },
      );
    }

    inVerse = false;
    segments = [];
    hasStrongs = false;
  };

  parser.on('opentag', (node) => {
    const name = node.name;

    if (skipDepth > 0) {
      skipDepth++;
      return;
    }

    if (name === 'BIBLEBOOK' || name === 'book') {
      bookId = Number(node.attributes.bnumber ?? node.attributes.number ?? 0);
      if (bookId > 0 && !books.has(bookId)) {
        books.set(bookId, { chapters: new Map(), strongs: new Map() });
      }
      onProgress?.(bookId);
      return;
    }
    if (name === 'CHAPTER' || name === 'chapter') {
      chapterNo = Number(node.attributes.cnumber ?? node.attributes.number ?? 0);
      return;
    }
    if (name === 'VERS' || name === 'verse') {
      verseNo = Number(node.attributes.vnumber ?? node.attributes.number ?? 0);
      inVerse = true;
      segments = [];
      hasStrongs = false;
      return;
    }
    if (!inVerse) return;

    if (name === 'gr') {
      if (grDepth === 0) {
        const str = node.attributes.str ?? '';
        const s = str !== '' ? str : null;
        if (s !== null) hasStrongs = true;
        // Start an empty segment; text events append into it, which reproduces
        // the PHP's use of $node->textContent (nested markup included).
        segments.push({ t: '', s });
      }
      grDepth++;
      return;
    }
    if (name === 'NOTE' || name === 'DIV') {
      skipDepth = 1;
      return;
    }
    // Anything else (rare): its plain text is folded in, matching the PHP
    // fallback that appends $node->textContent.
  });

  parser.on('text', (t) => {
    if (skipDepth > 0 || !inVerse) return;
    if (grDepth > 0) {
      segments[segments.length - 1].t += t;
      return;
    }
    segments.push({ t, s: null });
  });

  parser.on('closetag', (node) => {
    if (skipDepth > 0) {
      skipDepth--;
      return;
    }
    const name = node.name;
    if (name === 'gr') {
      if (grDepth > 0) grDepth--;
      return;
    }
    if (name === 'VERS' || name === 'verse') {
      flushVerse();
      grDepth = 0;
    }
  });

  const xml = fs.readFileSync(xmlPath, 'utf8');
  parser.write(xml).close();

  return books;
}
