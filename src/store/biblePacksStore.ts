import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Translation } from '@/services/bible/bibleApi';
import { isPreinstalled } from '@/services/bible/packFormat';
import {
  findTranslation,
  getManifest,
  type PackManifest,
} from '@/services/bible/packManifest';
import {
  deletePack,
  downloadPack,
  readInstalledMeta,
  type PackProgress,
} from '@/services/bible/packDownloader';

export type PackStatus =
  | 'bundled' // ships in the app binary
  | 'installed' // fully downloaded
  | 'partial' // interrupted mid-download, resumable
  | 'missing' // available, not downloaded
  | 'unavailable'; // withdrawn server-side

type BiblePacksState = {
  manifest: PackManifest | null;
  status: Partial<Record<Translation, PackStatus>>;
  progress: Partial<Record<Translation, PackProgress>>;
  error: Partial<Record<Translation, string>>;
  /**
   * Translations the user has asked to have offline — the only persisted field.
   *
   * Wanting is not the same as having: a pack picked while offline, or
   * interrupted by a closed app, stays wanted so retryWanted() can finish it
   * later. Deleting a pack un-wants it, or the next retry would bring it back.
   */
  wanted: Translation[];
  init: () => Promise<void>;
  download: (code: Translation) => Promise<void>;
  want: (code: Translation) => Promise<void>;
  retryWanted: () => Promise<void>;
  cancel: (code: Translation) => void;
  remove: (code: Translation) => Promise<void>;
};

/** One controller per in-flight download, so cancel targets the right job. */
const controllers = new Map<Translation, AbortController>();

export const useBiblePacksStore = create<BiblePacksState>()(
  persist(
    (set, get) => ({
      manifest: null,
      status: {},
      progress: {},
      error: {},
      wanted: [],

      async init() {
        const [manifest, metas] = await Promise.all([getManifest(), readInstalledMeta()]);
        const byCode = new Map(metas.map((m) => [m.code, m]));
        const status: Partial<Record<Translation, PackStatus>> = {};

        for (const entry of manifest?.translations ?? []) {
          const code = entry.code;
          // isPreinstalled(), not entry.bundled: on web the bundled texts are
          // downloadable like any other pack, because that is what makes them
          // readable offline. See packFormat.isPreinstalled().
          if (isPreinstalled(code)) {
            status[code] = 'bundled';
            continue;
          }
          const meta = byCode.get(code);
          if (meta?.state === 'installed' && meta.version === entry.version) {
            // A server-side revoke removes even an installed copy.
            if (entry.revoke) {
              void deletePack(code);
              status[code] = 'unavailable';
              continue;
            }
            status[code] = 'installed';
            continue;
          }
          if (!entry.available) {
            status[code] = 'unavailable';
            continue;
          }
          status[code] = meta ? 'partial' : 'missing';
        }

        set({ manifest, status });
      },

      async download(code) {
        if (controllers.has(code)) return; // already running
        const controller = new AbortController();
        controllers.set(code, controller);
        set((s) => ({ error: { ...s.error, [code]: undefined } }));

        try {
          await downloadPack(
            code,
            (p) => set((s) => ({ progress: { ...s.progress, [code]: p } })),
            controller.signal,
          );
          set((s) => ({ status: { ...s.status, [code]: 'installed' } }));
        } catch (e) {
          // An abort is a user action, not a failure — leave it resumable.
          const aborted = e instanceof DOMException && e.name === 'AbortError';
          set((s) => ({
            status: { ...s.status, [code]: 'partial' },
            error: aborted ? s.error : { ...s.error, [code]: (e as Error)?.message ?? 'download failed' },
          }));
        } finally {
          controllers.delete(code);
          set((s) => ({ progress: { ...s.progress, [code]: undefined } }));
        }
      },

      /**
       * Record that the user wants this translation offline, and start fetching it.
       *
       * Called when a translation is *selected*, not only when its download button
       * is tapped: a text you have chosen but cannot read without the network is
       * the exact gap this is here to close. Cheap enough to be automatic — the
       * packs are ~1.5 MB gzipped, so there is nothing to confirm.
       */
      async want(code) {
        // The translation may have been chosen before any list mounted — a
        // fresh install picks one from the device locale — so resolve status
        // first rather than assuming init() has run.
        if (!get().manifest) await get().init();
        const status = get().status[code];
        // Nothing to want: it ships in the binary, or was withdrawn server-side.
        if (status === 'bundled' || status === 'unavailable') return;
        // An undefined status means the manifest didn't load at all; record the
        // want anyway so retryWanted() can resolve it once one is available.
        if (!get().wanted.includes(code)) {
          set((s) => ({ wanted: [...s.wanted, code] }));
        }
        if (status === 'missing' || status === 'partial') await get().download(code);
      },

      /**
       * Finish any wanted pack that isn't installed. Called on reconnect, so a
       * translation chosen in airplane mode arrives on its own rather than needing
       * the user to notice and retry.
       *
       * Sequential on purpose: eight parallel pack downloads on a phone connection
       * is worse for the one the user is waiting on.
       */
      async retryWanted() {
        if (get().wanted.length === 0) return;
        // Always re-init: this runs on reconnect, which is exactly when a
        // manifest that failed to load at boot becomes available.
        await get().init();
        for (const code of get().wanted) {
          const status = get().status[code];
          if (status === 'missing' || status === 'partial') await get().download(code);
        }
      },

      cancel(code) {
        controllers.get(code)?.abort();
        controllers.delete(code);
      },

      async remove(code) {
        get().cancel(code);
        await deletePack(code);
        const entry = findTranslation(get().manifest, code);
        set((s) => ({
          status: { ...s.status, [code]: entry?.available === false ? 'unavailable' : 'missing' },
          progress: { ...s.progress, [code]: undefined },
          // Deliberate deletion outranks an earlier selection, or retryWanted()
          // would quietly download it again on the next reconnect.
          wanted: s.wanted.filter((c) => c !== code),
        }));
      },
    }),
    {
      name: 'ba.biblePacks',
      // Only `wanted` survives a reload. Status and progress are re-derived by
      // init() from the manifest plus what Dexie actually holds, which is the
      // only trustworthy source — a persisted 'installed' could outlive a
      // cleared IndexedDB.
      partialize: (state) => ({ wanted: state.wanted }) as unknown as BiblePacksState,
    },
  ),
);

/** Human-readable download size for a translation, or null when unknown. */
export function packSizeLabel(manifest: PackManifest | null, code: Translation): string | null {
  const entry = findTranslation(manifest, code);
  if (!entry?.wireBytes) return null;
  return `${(entry.wireBytes / 1048576).toFixed(1)} MB`;
}
