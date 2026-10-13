/**
 * Convert a USX 3.0 bundle — one `<CODE>.usx` per book plus `metadata.xml`,
 * the way the Digital Bible Library delivers a licensed text — into the
 * Zefania XML that both Bible parsers read (api.php and parseZefania.mjs).
 *
 *   node scripts/bible/usxToZefania.mjs <usx-dir> <out.xml> [--verbose]
 *
 * It is step one of replacing a text; the rest (a new pack version, the
 * packs, the golden fixtures, the deploy) is in docs/architecture/offline.md.
 *
 * Converting rather than teaching both parsers USX keeps the one rule that
 * matters downstream intact: the PHP and the JS parser read the same simple
 * format, and `bible:verify` proves they agree on it.
 *
 * What counts as verse text is decided here, and only here:
 *
 *   - Text between a verse's start and end milestones (`<verse sid>` …
 *     `<verse eid>`), in a paragraph style listed in VERSE_PARAS. A verse that
 *     runs over several paragraphs (poetry lines) is joined with a space.
 *   - Character styles keep their text: `nd` stays "Herr" as written (print
 *     sets it in small caps; the app has no small caps to set), `qs` keeps a
 *     psalm's "(Sela.)", which belongs to the verse.
 *   - Dropped: every `<note>` (footnotes and cross references), headings,
 *     chapter labels, speaker and acrostic labels, introductions, and the
 *     book's identification block — see SKIPPED_PARAS.
 *
 * Anything this script has not been taught — an element, a paragraph style or
 * a character style it does not list — stops the conversion instead of being
 * guessed at. A new revision of the bundle that uses one needs a decision about
 * whether it is scripture, and a silent default would make that decision for
 * somebody: either reading a heading aloud as a verse, or losing a line of text.
 *
 * Pretty-printed USX indents an element's children until its first piece of
 * text, so a whitespace-only text node containing a newline is layout, not
 * content — `<verse/>\n    <char>Herr</char>` is "Herr", not " Herr". Every
 * other whitespace is kept and later collapsed by `normalizeSpace`.
 *
 * Two repairs for what the Schlachter 2000 bundle lost on its way from Word to
 * USX, both found by diffing every verse against an independent copy:
 *
 *   - A space at a character-style boundary. `allein<note/><char style="qt">
 *     dienen` (Matthew 4:10) is "allein dienen" in print; ninety-odd of those,
 *     nearly all where a quotation starts right after a cross reference. So
 *     two letters meeting across the start or end of a `<char>` get a space.
 *     A note alone between two letters is left joined: that is a footnote on
 *     the first half of a compound, "Tarsis⁺schiffe", "zunichte⁺machen".
 *   - KNOWN_STRAYS: text outside every verse that is a leftover marker, not
 *     scripture. Anything else outside a verse still stops the conversion.
 */
import fs from 'node:fs';
import path from 'node:path';
import { SaxesParser } from 'saxes';

/** USFM book codes in canonical order; the index + 1 is the app's book id. */
const BOOK_CODES = [
  'GEN', 'EXO', 'LEV', 'NUM', 'DEU', 'JOS', 'JDG', 'RUT', '1SA', '2SA', '1KI', '2KI', '1CH',
  '2CH', 'EZR', 'NEH', 'EST', 'JOB', 'PSA', 'PRO', 'ECC', 'SNG', 'ISA', 'JER', 'LAM', 'EZK',
  'DAN', 'HOS', 'JOL', 'AMO', 'OBA', 'JON', 'MIC', 'NAM', 'HAB', 'ZEP', 'HAG', 'ZEC', 'MAL',
  'MAT', 'MRK', 'LUK', 'JHN', 'ACT', 'ROM', '1CO', '2CO', 'GAL', 'EPH', 'PHP', 'COL', '1TH',
  '2TH', '1TI', '2TI', 'TIT', 'PHM', 'HEB', 'JAS', '1PE', '2PE', '1JN', '2JN', '3JN', 'JUD',
  'REV',
];
const FIRST_NT_BOOK = 40;

/** Paragraph styles whose verse text is scripture. `d` is a psalm's title,
 * which this versification numbers as verse 1 (Psalm 3:1 "Ein Psalm Davids…"). */
const VERSE_PARAS = new Set([
  'p', 'm', 'nb', 'pi', 'pi1', 'pi2', 'mi', 'pc', 'pm', 'pmo', 'pmc', 'pmr',
  'q', 'q1', 'q2', 'q3', 'q4', 'qc', 'qr', 'qm', 'qm1', 'qm2', 'li', 'li1', 'li2',
  'd', 'b',
]);

/** Paragraph styles that are not scripture: identification, introductions,
 * headings, chapter labels, speakers ("Die Braut") and acrostic letters
 * ("Aleph a"), parallel-passage references. */
const SKIPPED_PARAS = new Set([
  'ide', 'h', 'toc1', 'toc2', 'toc3', 'rem', 'mt', 'mt1', 'mt2', 'mt3',
  'imt', 'imt1', 'imt2', 'is', 'is1', 'is2', 'ip', 'ipi', 'im', 'imi', 'ipq', 'imq', 'ipr',
  'iq', 'iq1', 'iq2', 'ib', 'ili', 'ili1', 'ili2', 'iot', 'io', 'io1', 'io2', 'iex', 'ie',
  'ms', 'ms1', 'ms2', 'ms3', 'mr', 's', 's1', 's2', 's3', 's4', 'sr', 'r', 'sp', 'cl', 'qa',
  'sd', 'sd1', 'sd2',
]);

/** Character styles inside verse text, all of which keep their text. Notes
 * are skipped whole, so the note-only styles (fr, ft, xo, xt, …) never get
 * here. */
const VERSE_CHARS = new Set([
  'nd', 'qt', 'tl', 'qs', 'em', 'bk', 'add', 'wj', 'it', 'bd', 'bdit', 'sc', 'k', 'pn',
  'png', 'ord', 'no', 'sls',
]);

/** Text found outside every verse that is known not to be scripture, as
 * "<BOOK> <chapter>" -> the trimmed text. Proverbs 26 opens with a stray "p",
 * a USFM paragraph marker that ended up as text. */
const KNOWN_STRAYS = new Map([['PRO 26', 'p']]);

const WORD_CHAR = /[\p{L}\p{N}]/u;

/** What a run repaired and which strays it met — printed at the end, so a new
 * revision of the bundle shows its changes in the log, not only in a diff. */
const repairs = [];
const strays = new Set();

function fail(where, msg) {
  throw new Error(`${where}: ${msg}`);
}

/** For text and for the double-quoted attributes of the header alike. */
function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** The verse rows of one book: Map<chapter, Map<verse, text>>. */
function convertBook(file, bookId) {
  const code = BOOK_CODES[bookId - 1];
  const parser = new SaxesParser({ position: true });
  const chapters = new Map();
  const where = () => `${path.basename(file)}:${parser.line}`;

  let chapter = 0;
  /** The open verse, or null between an end milestone and the next start. */
  let verse = null;
  /** Styles of the open <para>s (USX does not nest them, but be honest). */
  const paras = [];
  let noteDepth = 0;
  let bookDepth = 0;

  const inVerseText = () =>
    verse !== null && noteDepth === 0 && bookDepth === 0 && paras.length > 0
    && VERSE_PARAS.has(paras[paras.length - 1]);

  const closeVerse = () => {
    const text = verse.text.replace(/\s+/g, ' ').trim();
    if (text === '') fail(where(), `${code} ${chapter}:${verse.n} has no text`);
    const rows = chapters.get(chapter);
    if (rows.has(verse.n)) fail(where(), `${code} ${chapter}:${verse.n} appears twice`);
    rows.set(verse.n, text);
    verse = null;
  };

  /** Append to the open verse; `boundary` says a `<char>` started or ended
   * since the last text, which is where the source lost its spaces. */
  const append = (t) => {
    if (
      verse.boundary && WORD_CHAR.test(verse.text.slice(-1)) && WORD_CHAR.test(t.charAt(0))
    ) {
      verse.text += ' ';
      repairs.push(`${code} ${chapter}:${verse.n} …${verse.text.slice(-12)}|${t.slice(0, 12)}…`);
    }
    verse.text += t;
    verse.boundary = false;
  };

  parser.on('opentag', (node) => {
    const a = node.attributes;
    if (noteDepth > 0) {
      if (node.name === 'note') noteDepth++;
      return;
    }
    switch (node.name) {
      case 'usx':
        return;
      case 'book':
        if (a.code !== code) fail(where(), `expected book ${code}, found ${a.code}`);
        bookDepth++;
        return;
      case 'chapter':
        if (a.sid !== undefined) {
          if (verse !== null) fail(where(), `chapter ${a.sid} starts inside ${verse.sid}`);
          chapter = Number(a.number);
          if (!Number.isInteger(chapter) || chapter <= 0 || a.sid !== `${code} ${chapter}`) {
            fail(where(), `bad chapter milestone ${JSON.stringify(a)}`);
          }
          if (chapters.has(chapter)) fail(where(), `${code} ${chapter} appears twice`);
          chapters.set(chapter, new Map());
        } else if (verse !== null) {
          fail(where(), `chapter ${a.eid} ends inside ${verse.sid}`);
        }
        return;
      case 'verse':
        if (a.sid !== undefined) {
          if (verse !== null) fail(where(), `${a.sid} starts inside ${verse.sid}`);
          const n = Number(a.number);
          if (!Number.isInteger(n) || n <= 0 || a.sid !== `${code} ${chapter}:${n}`) {
            fail(where(), `bad verse milestone ${JSON.stringify(a)}`);
          }
          verse = { n, sid: a.sid, text: '', boundary: false };
        } else {
          if (verse === null || a.eid !== verse.sid) {
            fail(where(), `verse end ${a.eid} does not close ${verse?.sid ?? 'an open verse'}`);
          }
          closeVerse();
        }
        return;
      case 'para': {
        const style = a.style ?? '';
        if (!VERSE_PARAS.has(style) && !SKIPPED_PARAS.has(style)) {
          fail(where(), `paragraph style "${style}" is neither verse text nor skipped — classify it`);
        }
        paras.push(style);
        // A verse that carries on into the next paragraph (a poetry line, a
        // psalm title into its first line) needs a space at the seam.
        if (inVerseText()) verse.text += ' ';
        return;
      }
      case 'note':
        noteDepth = 1;
        return;
      case 'char':
        // Only where it would become verse text: a heading or an introduction
        // may style its words however it likes.
        if (VERSE_PARAS.has(paras[paras.length - 1]) && !VERSE_CHARS.has(a.style ?? '')) {
          fail(where(), `character style "${a.style}" in verse text — classify it`);
        }
        if (inVerseText()) verse.boundary = true;
        return;
      case 'ref':
      case 'optbreak':
        return;
      default:
        fail(where(), `element <${node.name}> is not handled — teach the converter about it`);
    }
  });

  parser.on('closetag', (node) => {
    if (noteDepth > 0) {
      if (node.name === 'note') noteDepth--;
      return;
    }
    if (node.name === 'book') bookDepth--;
    if (node.name === 'char' && inVerseText()) verse.boundary = true;
    if (node.name === 'para') {
      if (inVerseText()) verse.text += ' ';
      paras.pop();
    }
  });

  parser.on('text', (t) => {
    if (!inVerseText()) {
      // Scripture outside any verse would be lost without a word — refuse,
      // unless it is a stray this script knows about.
      if (
        noteDepth === 0 && bookDepth === 0 && t.trim() !== ''
        && paras.length > 0 && VERSE_PARAS.has(paras[paras.length - 1])
      ) {
        const at = `${code} ${chapter}`;
        if (KNOWN_STRAYS.get(at) === t.trim()) {
          strays.add(at);
          return;
        }
        fail(where(), `text outside a verse in a "${paras[paras.length - 1]}" paragraph: ${JSON.stringify(t.slice(0, 60))}`);
      }
      return;
    }
    if (t.trim() === '' && t.includes('\n')) return; // indentation, not content
    append(t);
  });

  parser.on('error', (e) => fail(where(), e.message));
  parser.write(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')).close();

  if (verse !== null) fail(where(), `${verse.sid} never ends`);
  return chapters;
}

/** Name and copyright line from the bundle's metadata.xml, for the header. */
function readMetadata(dir) {
  const file = path.join(dir, 'metadata.xml');
  const xml = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const pick = (re) => re.exec(xml)?.[1]?.trim() ?? '';
  return {
    name: pick(/<identification>[\s\S]*?<name>([^<]*)<\/name>/),
    copyright: pick(/<copyright>[\s\S]*?<p>([^<]*)<\/p>/),
    id: pick(/<DBLMetadata[^>]*\bid="([^"]*)"/),
    revision: pick(/<DBLMetadata[^>]*\brevision="([^"]*)"/),
  };
}

function main() {
  const [dir, out] = process.argv.slice(2);
  if (!dir || !out) {
    console.error('usage: node scripts/bible/usxToZefania.mjs <usx-dir> <out.xml> [--verbose]');
    process.exit(2);
  }

  const meta = readMetadata(dir);
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<bible translation="${escapeXml(meta.name)}" status="${escapeXml(meta.copyright)}"` +
      ` source="${escapeXml(`DBL ${meta.id} revision ${meta.revision}, converted by scripts/bible/usxToZefania.mjs`)}">`,
  ];

  let verses = 0;
  let chapterCount = 0;
  for (let bookId = 1; bookId <= BOOK_CODES.length; bookId++) {
    if (bookId === 1) lines.push('\t<testament name="Old">');
    if (bookId === FIRST_NT_BOOK) lines.push('\t</testament>', '\t<testament name="New">');

    const file = path.join(dir, `${BOOK_CODES[bookId - 1]}.usx`);
    if (!fs.existsSync(file)) fail(dir, `${path.basename(file)} is missing`);
    const chapters = convertBook(file, bookId);

    lines.push(`\t\t<book number="${bookId}">`);
    for (const [c, rows] of [...chapters].sort((x, y) => x[0] - y[0])) {
      lines.push(`\t\t\t<chapter number="${c}">`);
      for (const [v, text] of [...rows].sort((x, y) => x[0] - y[0])) {
        lines.push(`\t\t\t\t<verse number="${v}">${escapeXml(text)}</verse>`);
        verses++;
      }
      lines.push('\t\t\t</chapter>');
      chapterCount++;
    }
    lines.push('\t\t</book>');
  }
  lines.push('\t</testament>', '</bible>', '');

  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, lines.join('\n'));
  console.log(
    `${meta.name || 'bible'}: ${BOOK_CODES.length} books, ${chapterCount} chapters, ${verses} verses -> ${out}`,
  );
  console.log(`  ${repairs.length} space(s) restored at a character-style boundary`);
  if (process.argv.includes('--verbose')) for (const r of repairs) console.log(`    ${r}`);
  for (const at of KNOWN_STRAYS.keys()) {
    console.log(
      strays.has(at)
        ? `  skipped the known stray in ${at}`
        : `  ! no stray in ${at} any more — drop it from KNOWN_STRAYS`,
    );
  }
}

main();
