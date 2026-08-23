import { create } from 'zustand';
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
  init: () => Promise<void>;
  download: (code: Translation) => Promise<void>;
  cancel: (code: Translation) => void;
  remove: (code: Translation) => Promise<void>;
};

/** One controller per in-flight download, so cancel targets the right job. */
const controllers = new Map<Translation, AbortController>();

export const useBiblePacksStore = create<BiblePacksState>((set, get) => ({
  manifest: null,
  status: {},
  progress: {},
  error: {},

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
    }));
  },
}));

/** Human-readable download size for a translation, or null when unknown. */
export function packSizeLabel(manifest: PackManifest | null, code: Translation): string | null {
  const entry = findTranslation(manifest, code);
  if (!entry?.wireBytes) return null;
  return `${(entry.wireBytes / 1048576).toFixed(1)} MB`;
}
