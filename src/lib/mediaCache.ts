import { db, type CachedMedia } from '@/db/dexie';

/**
 * Persistent cache for verse audio and word-alignment JSON.
 *
 * Replaces the Workbox `verse-audio-v2` CacheFirst route, which was the app's
 * only durable audio cache and does not exist in the native builds (no service
 * worker under the capacitor:// scheme). Without this every verse re-downloads
 * on each cold start and offline reading is impossible.
 *
 * IndexedDB rather than CacheStorage on purpose: CacheStorage availability
 * under capacitor:// on iOS isn't something to bet an offline feature on,
 * whereas Dexie is already a dependency with an established migration chain.
 *
 * Every failure path falls back to a plain network fetch — a broken cache must
 * never break playback.
 */

/** Roughly a few thousand verses; audio is ~30-60 KB each. */
const BUDGET_BYTES = 300 * 1024 * 1024;
/** Evict in batches so we're not doing this on every single write. */
const EVICT_TO_BYTES = Math.floor(BUDGET_BYTES * 0.8);

/** Bytes added since the last eviction sweep; avoids querying size constantly. */
let bytesSinceSweep = 0;
const SWEEP_EVERY_BYTES = 20 * 1024 * 1024;

async function readCache(url: string): Promise<CachedMedia | undefined> {
  try {
    return await db.mediaCache.get(url);
  } catch {
    return undefined;
  }
}

async function writeCache(
  url: string,
  body: ArrayBuffer,
  contentType: string,
  pinned = false,
): Promise<void> {
  try {
    const now = Date.now();
    await db.mediaCache.put({
      url,
      body,
      contentType,
      size: body.byteLength,
      createdAt: now,
      lastUsedAt: now,
      pinned: pinned ? 1 : 0,
    });
    bytesSinceSweep += body.byteLength;
    if (bytesSinceSweep >= SWEEP_EVERY_BYTES) {
      bytesSinceSweep = 0;
      void evictIfNeeded();
    }
  } catch {
    // Quota exceeded or storage unavailable — the fetch already succeeded, so
    // the caller is fine; we just don't get to keep it.
  }
}

/**
 * Drop least-recently-used entries until we're back under the budget.
 *
 * Pinned rows are counted toward the total but never evicted: they are what the
 * user explicitly downloaded, and reclaiming them would undo the one thing a
 * download is for. That means enough pinned data can push the cache past the
 * budget with nothing left to free — the sweep simply stops, which is the
 * correct outcome. The Settings readout is where that becomes visible.
 */
async function evictIfNeeded(): Promise<void> {
  try {
    const rows = await db.mediaCache.orderBy('lastUsedAt').toArray();
    let total = rows.reduce((a, r) => a + r.size, 0);
    if (total <= BUDGET_BYTES) return;
    const doomed: string[] = [];
    for (const row of rows) {
      if (total <= EVICT_TO_BYTES) break;
      if (row.pinned === 1) continue;
      doomed.push(row.url);
      total -= row.size;
    }
    if (doomed.length) await db.mediaCache.bulkDelete(doomed);
  } catch {
    // ignore
  }
}

/**
 * Fetch `url`, serving from the persistent cache when possible.
 *
 * Returns a fresh ArrayBuffer copy on cache hits: `decodeAudioData` detaches
 * the buffer it is given, so handing out the stored instance would corrupt the
 * cached row for every subsequent read.
 *
 * `pin` marks the row as deliberately downloaded, exempting it from eviction.
 * It also upgrades an existing unpinned row — a chapter you happened to have
 * played and then chose to download shouldn't have to be fetched again.
 */
export async function fetchCached(url: string, opts?: { pin?: boolean }): Promise<ArrayBuffer> {
  const pin = opts?.pin === true;
  const hit = await readCache(url);
  if (hit) {
    // Best-effort LRU touch; not worth awaiting or failing over.
    void db.mediaCache
      .update(url, pin ? { lastUsedAt: Date.now(), pinned: 1 } : { lastUsedAt: Date.now() })
      .catch(() => {});
    return hit.body.slice(0);
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch failed: ${res.status} ${url}`);
  const body = await res.arrayBuffer();
  await writeCache(url, body, res.headers.get('content-type') ?? '', pin);
  return body;
}

/**
 * Whether `url` is already held locally — i.e. playable with no network.
 *
 * Counts on the index rather than reading the row: this is called before every
 * track is built, and `get()` would deserialize a ~125 KB ArrayBuffer just to
 * answer a yes/no.
 */
export async function isCached(url: string): Promise<boolean> {
  try {
    return (await db.mediaCache.where('url').equals(url).count()) > 0;
  } catch {
    return false;
  }
}

/** Convenience for JSON payloads (word alignments). */
export async function fetchCachedJson<T = unknown>(url: string): Promise<T> {
  const buf = await fetchCached(url);
  return JSON.parse(new TextDecoder().decode(buf)) as T;
}

/** Total bytes currently held, split by whether the user asked for it. */
export async function mediaCacheStats(): Promise<{ total: number; pinned: number }> {
  try {
    const rows = await db.mediaCache.toArray();
    let total = 0;
    let pinned = 0;
    for (const r of rows) {
      total += r.size;
      if (r.pinned === 1) pinned += r.size;
    }
    return { total, pinned };
  } catch {
    return { total: 0, pinned: 0 };
  }
}

/**
 * Empty the cache, downloaded narration included, and drop the index with it —
 * leaving `narration` rows pointing at bytes that are gone would make
 * cachedNarrationSource promise offline playback it cannot deliver.
 */
export async function clearMediaCache(): Promise<void> {
  try {
    await db.mediaCache.clear();
    await db.narration.clear();
    bytesSinceSweep = 0;
  } catch {
    // ignore
  }
}

/**
 * One-shot reclaim of the retired Workbox audio cache.
 *
 * Existing PWA installs can be holding hundreds of MB under `verse-audio-v2`,
 * and now that the runtime route is gone nothing will ever read or expire it.
 * Safe to call on every boot: after the first success there is nothing to
 * delete, and it's a no-op wherever CacheStorage doesn't exist (native).
 */
export async function reclaimLegacyAudioCache(): Promise<void> {
  if (typeof caches === 'undefined') return;
  try {
    if (await caches.has('verse-audio-v2')) await caches.delete('verse-audio-v2');
  } catch {
    // ignore
  }
}
