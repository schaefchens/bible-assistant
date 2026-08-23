import { create } from 'zustand';
import type { Translation } from '@/services/bible/bibleApi';
import type { OpenAiVoiceId } from '@/types/domain';
import {
  chapterCoverage,
  chapterNarrationKey,
  deleteChapterNarration,
  downloadChapterNarration,
  type ChapterCoverage,
  type ChapterNarrationProgress,
} from '@/services/narration/downloadChapter';

export type NarrationStatus = ChapterCoverage | 'downloading' | 'unknown';

type Target = {
  voice: OpenAiVoiceId;
  voiceStyle: string;
  translation: Translation;
  bookId: number;
  chapter: number;
};

type NarrationState = {
  /** Keyed by chapterNarrationKey — voice included, since narration is per-voice. */
  status: Partial<Record<string, NarrationStatus>>;
  progress: Partial<Record<string, ChapterNarrationProgress>>;
  error: Partial<Record<string, string>>;
  check: (t: Target) => Promise<void>;
  download: (t: Target) => Promise<void>;
  cancel: (t: Target) => void;
  remove: (t: Target) => Promise<void>;
};

/** One controller per in-flight download, so cancel targets the right chapter. */
const controllers = new Map<string, AbortController>();

const keyOf = (t: Target) => chapterNarrationKey(t.voice, t.translation, t.bookId, t.chapter);

/**
 * Per-chapter narration download state.
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
    const key = keyOf(t);
    // Don't stomp a live download's status with a coverage read.
    if (get().status[key] === 'downloading') return;
    const coverage = await chapterCoverage(
      t.voice,
      t.voiceStyle,
      t.translation,
      t.bookId,
      t.chapter,
    );
    set((s) => ({ status: { ...s.status, [key]: coverage } }));
  },

  async download(t) {
    const key = keyOf(t);
    if (controllers.has(key)) return; // already running
    const controller = new AbortController();
    controllers.set(key, controller);
    set((s) => ({
      status: { ...s.status, [key]: 'downloading' },
      error: { ...s.error, [key]: undefined },
    }));

    try {
      await downloadChapterNarration(
        t.voice,
        t.voiceStyle,
        t.translation,
        t.bookId,
        t.chapter,
        (p) => set((s) => ({ progress: { ...s.progress, [key]: p } })),
        controller.signal,
      );
      set((s) => ({ status: { ...s.status, [key]: 'installed' } }));
    } catch (e) {
      // An abort is a user action, not a failure — whatever landed before it
      // stays, so re-derive rather than assuming either extreme.
      const aborted = e instanceof DOMException && e.name === 'AbortError';
      set((s) => ({
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
    const key = keyOf(t);
    controllers.get(key)?.abort();
    controllers.delete(key);
  },

  async remove(t) {
    const key = keyOf(t);
    get().cancel(t);
    await deleteChapterNarration(t.voice, t.voiceStyle, t.translation, t.bookId, t.chapter);
    set((s) => ({ status: { ...s.status, [key]: 'missing' } }));
  },
}));

export { chapterNarrationKey };
