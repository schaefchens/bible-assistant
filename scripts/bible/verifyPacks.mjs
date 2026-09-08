/**
 * Gate for the XML -> pack migration.
 *
 * dist/storage/bible/ holds chapter JSON produced by the *live PHP parser* —
 * free golden fixtures. This diffs the JS parser's output against every one of
 * them, field by field, and exits non-zero on any mismatch. Run it before
 * pointing api.php at the packs; keep it as a CI step afterwards.
 *
 *   node scripts/bible/verifyPacks.mjs [fixtureDir]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseZefania } from './parseZefania.mjs';
import { BIBLE_XML_MAP } from './phpCompat.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURE_DIR = process.argv[2] ?? path.join(ROOT, 'dist/storage/bible');
const XML_DIR = path.join(ROOT, 'public/bibles');

/** Only this cache generation matches the shape the parser emits today.
 * See BIBLE_CACHE_FORMAT in api.php — the marker exists precisely so older
 * generations self-invalidate, and dist/storage/bible/ still holds plenty of
 * them (bare pre-XML arrays with <S>/<i> markup, plus some xml-v1). Diffing
 * against those would report failures that are really just stale cache. */
const GOLDEN_FORMAT = 'xml-v2';

/** Collect {translation, bookId, chapter, file} for every fixture on disk. */
function collectFixtures(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const translation of fs.readdirSync(dir)) {
    const tDir = path.join(dir, translation);
    if (!fs.statSync(tDir).isDirectory()) continue;
    for (const bookId of fs.readdirSync(tDir)) {
      const bDir = path.join(tDir, bookId);
      if (!fs.statSync(bDir).isDirectory()) continue;
      for (const f of fs.readdirSync(bDir)) {
        if (!f.endsWith('.json')) continue;
        out.push({
          translation,
          bookId: Number(bookId),
          chapter: Number(path.basename(f, '.json')),
          file: path.join(bDir, f),
        });
      }
    }
  }
  return out;
}

/** The client re-materializes textTts on decode; do the same before diffing. */
function materialize(v) {
  return { pk: v.pk, verse: v.verse, text: v.text, textTts: v.textTts ?? v.text };
}

const PACK_ROOTS = [path.join(ROOT, 'public/bible-packs'), path.join(ROOT, 'build/bible-packs')];

/** Read a chapter back out of a built pack, if one exists on disk. */
function readPackChapter(translation, bookId, chapter) {
  for (const root of PACK_ROOTS) {
    const tDir = path.join(root, translation);
    if (!fs.existsSync(tDir)) continue;
    for (const version of fs.readdirSync(tDir)) {
      const file = path.join(tDir, version, `${bookId}.json`);
      if (!fs.existsSync(file)) continue;
      const pack = JSON.parse(fs.readFileSync(file, 'utf8'));
      const rows = pack.c?.[String(chapter)];
      if (rows) return rows;
    }
  }
  return null;
}

function diffVerse(expected, actual, where) {
  const problems = [];
  for (const key of ['pk', 'verse', 'text', 'textTts']) {
    if (expected[key] !== actual[key]) {
      problems.push(
        `${where} .${key}\n    php: ${JSON.stringify(expected[key])}\n    js : ${JSON.stringify(actual[key])}`,
      );
    }
  }
  return problems;
}

const fixtures = collectFixtures(FIXTURE_DIR);
if (fixtures.length === 0) {
  console.error(`No fixtures found under ${FIXTURE_DIR}`);
  process.exit(2);
}

// Group by translation so each XML is parsed once.
const byTranslation = new Map();
for (const f of fixtures) {
  if (!byTranslation.has(f.translation)) byTranslation.set(f.translation, []);
  byTranslation.get(f.translation).push(f);
}

let checkedChapters = 0;
let checkedVerses = 0;
let skipped = 0;
let packChaptersChecked = 0;
const failures = [];

for (const [translation, items] of [...byTranslation].sort()) {
  const xmlName = BIBLE_XML_MAP[translation];
  if (!xmlName) {
    failures.push(`unknown translation in fixtures: ${translation}`);
    continue;
  }
  const xmlPath = path.join(XML_DIR, xmlName);
  if (!fs.existsSync(xmlPath)) {
    console.warn(`skip ${translation}: ${xmlPath} not present`);
    continue;
  }

  process.stdout.write(`${translation}: parsing ${xmlName}… `);
  const books = parseZefania(xmlPath);
  process.stdout.write(`${items.length} fixture chapter(s)\n`);

  for (const { bookId, chapter, file } of items) {
    const fixture = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(fixture.verses) || fixture.format !== GOLDEN_FORMAT) {
      skipped++;
      continue;
    }
    const expected = fixture.verses.map(materialize);
    // Prefer the pack on disk when one has been built: that exercises the
    // whole chain (parse -> omit textTts -> serialize -> parse -> rehydrate),
    // not just the parser. Falls back to the in-memory parse otherwise.
    const fromPack = readPackChapter(translation, bookId, chapter);
    if (fromPack) packChaptersChecked++;
    const actual = (fromPack ?? books.get(bookId)?.chapters.get(chapter) ?? []).map(materialize);
    const where = `${translation} ${bookId}:${chapter}${fromPack ? ' [pack]' : ''}`;

    if (expected.length !== actual.length) {
      failures.push(`${where} verse count php=${expected.length} js=${actual.length}`);
      continue;
    }
    for (let i = 0; i < expected.length; i++) {
      const problems = diffVerse(expected[i], actual[i], `${where} v${expected[i].verse}`);
      if (problems.length) failures.push(...problems);
    }
    checkedChapters++;
    checkedVerses += expected.length;
  }
}

console.log(
  `\nchecked ${checkedChapters} chapters / ${checkedVerses} verses across ${byTranslation.size} translation(s)` +
    (skipped ? `  (skipped ${skipped} fixture(s) from an older cache generation)` : ''),
);
console.log(
  packChaptersChecked
    ? `${packChaptersChecked} of those were read back out of built packs (full round-trip)`
    : 'no built packs found — parser was checked, pack serialization was not',
);

if (failures.length) {
  console.error(`\n✗ ${failures.length} mismatch(es):\n`);
  for (const f of failures.slice(0, 25)) console.error('  ' + f);
  if (failures.length > 25) console.error(`  … and ${failures.length - 25} more`);
  process.exit(1);
}
console.log('✓ JS parser output is identical to the PHP parser on every fixture');
