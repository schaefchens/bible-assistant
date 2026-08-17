import { bookKey, packDb, type PackState } from '@/db/bibleDexie';
import { invalidateChapterCache, type Translation } from './bibleApi';
import { invalidateLocalPackCache } from './chapterSources';
import { findTranslation, getManifest, packUrl, type ManifestBook } from './packManifest';

export type PackProgress = {
  code: Translation;
  state: PackState | 'downloading' | 'installed';
  booksDone: number;
  booksTotal: number;
  bytesDone: number;
  bytesTotal: number;
};

const RETRIES = 3;
const CONCURRENCY = 4;

/** Books from the manifest that we don't already have at the right version. */
async function missingBooks(
  code: Translation,
  version: string,
  books: ManifestBook[],
): Promise<ManifestBook[]> {
  const rows = await packDb.books.where('code').equals(code).toArray();
  const have = new Map(rows.map((r) => [r.bookId, r.version]));
  // A version mismatch counts as missing, so bumping PACK_VERSION upgrades in
  // place rather than needing an explicit uninstall.
  return books.filter((b) => have.get(b.b) !== version);
}

async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      await fn(items[i]);
    }
  });
  await Promise.all(workers);
}

async function fetchWithBackoff(url: string, signal: AbortSignal): Promise<ArrayBuffer> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    if (signal.aborted) throw new DOMException('aborted', 'AbortError');
    try {
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.arrayBuffer();
    } catch (e) {
      if (signal.aborted) throw e;
      lastErr = e;
      // 0.5s, 1s, 2s — long enough to ride out a tunnel, short enough not to stall.
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
  throw lastErr;
}

async function sha256Hex(buf: ArrayBuffer): Promise<string | null> {
  // Requires a secure context. capacitor://localhost and https://localhost
  // both qualify, as does the HTTPS web build; plain-http dev does not.
  if (!globalThis.crypto?.subtle) return null;
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Download one translation.
 *
 * Resumability is free here because each of the 66 book files is committed to
 * Dexie the moment it lands: killing the app mid-download and reopening simply
 * re-computes `missingBooks` and fetches the remainder. That's why this uses
 * per-book sharding rather than HTTP Range requests — more robust on a flaky
 * mobile connection, and a fraction of the code.
 */
export async function downloadPack(
  code: Translation,
  onProgress: (p: PackProgress) => void,
  signal: AbortSignal,
): Promise<void> {
  const manifest = await getManifest(true);
  const entry = findTranslation(manifest, code);
  if (!entry) throw new Error(`no manifest entry for ${code}`);
  if (!entry.available) throw new Error(`${code} is not available for download`);

  const missing = await missingBooks(code, entry.version, entry.books);
  const booksTotal = entry.books.length;
  let bytesDone = entry.bytes - missing.reduce((a, b) => a + b.bytes, 0);
  let booksDone = booksTotal - missing.length;

  const emit = (state: PackProgress['state']) =>
    onProgress({ code, state, booksDone, booksTotal, bytesDone, bytesTotal: entry.bytes });

  emit('downloading');

  await packDb.meta.put({
    code,
    version: entry.version,
    state: 'partial',
    booksDone,
    bytes: bytesDone,
    installedAt: 0,
  });

  await mapWithConcurrency(missing, CONCURRENCY, async (book) => {
    const buf = await fetchWithBackoff(packUrl(book.path), signal);

    if (book.sha256) {
      const actual = await sha256Hex(buf);
      if (actual && actual !== book.sha256) {
        throw new Error(`checksum mismatch for ${code} book ${book.b}`);
      }
    }

    await packDb.books.put({
      key: bookKey(code, book.b),
      code,
      bookId: book.b,
      version: entry.version,
      bytes: book.bytes,
      json: new TextDecoder().decode(buf),
    });

    booksDone++;
    // NB: progress is summed from the manifest's byte counts, never from
    // Content-Length — packs are served pre-gzipped, so Content-Length is the
    // *compressed* size while fetch yields decompressed bytes, and mixing the
    // two sails past 100%.
    bytesDone += book.bytes;
    emit('downloading');
  });

  await packDb.meta.put({
    code,
    version: entry.version,
    state: 'installed',
    booksDone: booksTotal,
    bytes: entry.bytes,
    installedAt: Date.now(),
  });

  // Both layers: the memoized chapters *and* the parsed book packs behind them.
  invalidateChapterCache(code);
  invalidateLocalPackCache(code);
  emit('installed');
}

export async function deletePack(code: Translation): Promise<void> {
  await packDb.books.where('code').equals(code).delete();
  await packDb.meta.delete(code);
  // Without this the in-memory cache keeps serving the deleted text until the
  // app restarts.
  // Both layers: the memoized chapters *and* the parsed book packs behind them.
  invalidateChapterCache(code);
  invalidateLocalPackCache(code);
}

export async function readInstalledMeta() {
  return packDb.meta.toArray();
}
