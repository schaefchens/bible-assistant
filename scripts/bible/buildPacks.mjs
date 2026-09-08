/**
 * Convert public/bibles/*.xml into the runtime pack format.
 *
 *   node scripts/bible/buildPacks.mjs [--only LUT,KJV]
 *
 * Output layout (one file per book — the app reads chapters sequentially
 * within a book, so a 2-book LRU makes almost every read free):
 *
 *   public/bible-packs/<CODE>/<version>/<bookId>.json          bundled texts
 *   public/bible-packs/manifest.json                           always
 *   build/bible-packs/<CODE>/<version>/<bookId>.json           downloadable
 *   .../<CODE>/<version>/strongs/<bookId>.json                 sidecars
 *
 * Two output roots because Vite copies public/ wholesale into the app bundle:
 * only the public-domain LUT and KJV belong in the binary. Everything else is
 * rsync'd to the server and fetched on demand.
 *
 * Strong's numbers live in *sidecar* files, never inlined. Nothing in the UI
 * reads them today, and inlining would roughly triple the parse cost of every
 * German chapter read — on the one path that has to feel instant.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseZefania } from './parseZefania.mjs';
import { BIBLE_XML_MAP, BUNDLED_TRANSLATIONS } from './phpCompat.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const XML_DIR = path.join(ROOT, 'public/bibles');
const BUNDLED_OUT = path.join(ROOT, 'public/bible-packs');
const DOWNLOAD_OUT = path.join(ROOT, 'build/bible-packs');

/** Bumping this invalidates every cached/downloaded pack (version is in the
 * path, so old files simply stop being referenced). */
const PACK_VERSION = process.env.PACK_VERSION ?? '2026-08-16.1';
const PACK_FORMAT = 'pack-v1';

const onlyArg = process.argv.indexOf('--only');
const only =
  onlyArg > -1 ? process.argv[onlyArg + 1].split(',').map((s) => s.trim().toUpperCase()) : null;

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const json = JSON.stringify(data);
  fs.writeFileSync(file, json);
  return Buffer.byteLength(json);
}

/**
 * Pre-compress so Apache can serve .gz directly instead of deflating per
 * request (see the RewriteCond in public/bible-packs/.htaccess).
 *
 * Only for files that are actually *served*. Bundled packs are read straight
 * off the device filesystem, where a .gz sibling is pure dead weight — 3.1 MB
 * of it, in every single install.
 */
function writeGz(file) {
  const gz = zlib.gzipSync(fs.readFileSync(file), { level: 9 });
  fs.writeFileSync(file + '.gz', gz);
  return gz.length;
}

/** Compressed size without writing anything — for manifest bookkeeping. */
function gzSize(file) {
  return zlib.gzipSync(fs.readFileSync(file), { level: 9 }).length;
}

const manifest = {
  schema: 1,
  packFormat: PACK_FORMAT,
  version: PACK_VERSION,
  translations: [],
};

const codes = Object.keys(BIBLE_XML_MAP).filter((c) => !only || only.includes(c));

for (const code of codes) {
  const xmlPath = path.join(XML_DIR, BIBLE_XML_MAP[code]);
  if (!fs.existsSync(xmlPath)) {
    console.warn(`skip ${code}: ${xmlPath} missing`);
    continue;
  }

  const bundled = BUNDLED_TRANSLATIONS.includes(code);
  const outRoot = bundled ? BUNDLED_OUT : DOWNLOAD_OUT;
  const dir = path.join(outRoot, code, PACK_VERSION);

  process.stdout.write(`${code.padEnd(5)} parsing… `);
  const books = parseZefania(xmlPath);

  const bookEntries = [];
  let totalBytes = 0;
  let totalWire = 0;
  let verseCount = 0;
  let strongsBooks = 0;

  for (const [bookId, book] of [...books].sort((a, b) => a[0] - b[0])) {
    const chapters = {};
    for (const [chapterNo, verses] of [...book.chapters].sort((a, b) => a[0] - b[0])) {
      chapters[String(chapterNo)] = verses;
      verseCount += verses.length;
    }
    const pack = { f: PACK_FORMAT, t: code, b: bookId, v: PACK_VERSION, c: chapters };

    const file = path.join(dir, `${bookId}.json`);
    const bytes = writeJson(file, pack);
    const wire = bundled ? gzSize(file) : writeGz(file);
    totalBytes += bytes;
    totalWire += wire;

    bookEntries.push({
      b: bookId,
      path: `${code}/${PACK_VERSION}/${bookId}.json`,
      bytes,
      // Of the *uncompressed* JSON — that's what the client hashes, since
      // fetch() transparently decompresses the .gz the server sends.
      sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
    });

    // Strong's sidecar — emitted for every translation that has the data, but
    // never bundled and never downloaded by default.
    if (book.strongs.size > 0) {
      const strongs = {};
      for (const [chapterNo, byVerse] of [...book.strongs].sort((a, b) => a[0] - b[0])) {
        strongs[String(chapterNo)] = byVerse;
      }
      const sFile = path.join(DOWNLOAD_OUT, code, PACK_VERSION, 'strongs', `${bookId}.json`);
      writeJson(sFile, { f: PACK_FORMAT, t: code, b: bookId, v: PACK_VERSION, c: strongs });
      writeGz(sFile);
      strongsBooks++;
    }
  }

  const mb = (n) => (n / 1048576).toFixed(2);
  console.log(
    `${books.size} books, ${verseCount} verses, ${mb(totalBytes)} MB raw / ${mb(totalWire)} MB wire` +
      (strongsBooks ? `, +${strongsBooks} Strong's sidecars` : '') +
      (bundled ? '  [bundled]' : ''),
  );

  manifest.translations.push({
    code,
    bundled,
    // Flipping this to false hides the download everywhere within one manifest
    // fetch — no app update needed. See the licensing note in the plan.
    available: true,
    version: PACK_VERSION,
    bytes: totalBytes,
    wireBytes: totalWire,
    books: bookEntries,
  });
}

// The manifest ships in the bundle too, so the picker renders correct state
// with no connectivity; the server copy is authoritative when reachable.
const manifestBytes = writeJson(path.join(BUNDLED_OUT, 'manifest.json'), manifest);
fs.mkdirSync(DOWNLOAD_OUT, { recursive: true });
fs.copyFileSync(path.join(BUNDLED_OUT, 'manifest.json'), path.join(DOWNLOAD_OUT, 'manifest.json'));

console.log(`\nmanifest: ${manifest.translations.length} translations, ${manifestBytes} B`);
console.log(`bundled  -> ${path.relative(ROOT, BUNDLED_OUT)}`);
console.log(`download -> ${path.relative(ROOT, DOWNLOAD_OUT)}  (rsync to the server)`);
