import { create } from 'zustand';
import {
  deleteNarration,
  downloadNarration,
  narrationCoverage,
  narrationTargetKey,
  type NarrationCoverage,
  type NarrationProgress,
  type NarrationTarget,
} from '@/services/narration/narrationDownload';

export type NarrationStatus = NarrationCoverage | 'downloading' | 'unknown';

/** Item progress of whatever is downloading, keyed like `status`. */
export type NarrationProgressMap = Partial<Record<string, NarrationProgress>>;

type NarrationState = {
  /** Keyed by narrationTargetKey — voice included, since narration is per-voice. */
  status: Partial<Record<string, NarrationStatus>>;
  progress: NarrationProgressMap;
  error: Partial<Record<string, string>>;
  check: (t: NarrationTarget) => Promise<void>;
  download: (t: NarrationTarget) => Promise<void>;
  cancel: (t: NarrationTarget) => void;
  remove: (t: NarrationTarget) => Promise<void>;
};

/** One controller per in-flight download, so cancel targets the right item. */
const controllers = new Map<string, AbortController>();

/**
 * In-flight coverage checks, so concurrent asks for the same target collapse
 * into one.
 *
 * A check is not free — it loads the chapter (from the pack, or the network if
 * there is no pack) and then reads the narration index and the media cache once
 * per verse. A day of a plan is now asked about twice over: once by each
 * passage row's own button, and once by the group button above them. Same
 * reason `getChapter` is in-flight-deduped a layer down.
 */
const checking = new Map<string, Promise<void>>();

/**
 * Per-target narration download state, for a Bible chapter or a post alike —
 * the status map, the progress ring, the one-controller-per-key cancellation
 * and the two-tap remove are identical for both, and since
 * `services/narration/narrationDownload.ts` took over the kind branch this file
 * no longer knows there is one.
 *
 * Transient by design — nothing here is persisted. The truth lives in Dexie
 * (the narration index plus the pinned mediaCache rows) and `check()` re-derives
 * from it, which is the only source that can't go stale against a cache the
 * browser may have cleared underneath us.
 */
export const useNarrationStore = create<NarrationState>((set, get) => ({
  status: {},
  progress: {},
  error: {},

  async check(t) {
    const key = narrationTargetKey(t);
    // Don't stomp a live download's status with a coverage read.
    if (get().status[key] === 'downloading') return;
    const running = checking.get(key);
    if (running) return running;
    const run = (async () => {
      const coverage = await narrationCoverage(t);
      set((s) => ({ status: { ...s.status, [key]: coverage } }));
    })().finally(() => {
      checking.delete(key);
    });
    checking.set(key, run);
    return run;
  },

  async download(t) {
    const key = narrationTargetKey(t);
    if (controllers.has(key)) return; // already running
    const controller = new AbortController();
    controllers.set(key, controller);
    set((s) => ({
      status: { ...s.status, [key]: 'downloading' },
      error: { ...s.error, [key]: undefined },
    }));

    try {
      await downloadNarration(
        t,
        (p) => set((s) => ({ progress: { ...s.progress, [key]: p } })),
        controller.signal,
      );
      set((s) => ({ status: { ...s.status, [key]: 'installed' } }));
    } catch (e) {
      // An abort is a user action, not a failure — whatever landed before it
      // stays, so re-derive rather than assuming either extreme.
      //
      // The status has to leave 'downloading' *before* that re-derivation:
      // `check` refuses to speak over a live download, so re-deriving straight
      // out of this branch found the status still 'downloading' and returned
      // without touching it — leaving a spinner that never stopped and a
      // cancel button that looked like it had done nothing. 'unknown' renders
      // as the plain download glyph, which is what the check is about to
      // replace with the real coverage.
      const aborted = e instanceof DOMException && e.name === 'AbortError';
      set((s) => ({
        status: { ...s.status, [key]: 'unknown' },
        error: aborted
          ? s.error
          : { ...s.error, [key]: (e as Error)?.message ?? 'download failed' },
      }));
      controllers.delete(key);
      await get().check(t);
      return;
    } finally {
      controllers.delete(key);
      set((s) => ({ progress: { ...s.progress, [key]: undefined } }));
    }
  },

  cancel(t) {
    const key = narrationTargetKey(t);
    controllers.get(key)?.abort();
    controllers.delete(key);
  },

  async remove(t) {
    get().cancel(t);
    await deleteNarration(t);
    set((s) => ({ status: { ...s.status, [narrationTargetKey(t)]: 'missing' } }));
  },
}));
