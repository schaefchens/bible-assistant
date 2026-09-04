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
import {
  deletePostNarration,
  downloadPostNarration,
  postCoverage,
  postNarrationKey,
} from '@/services/narration/downloadPost';

export type NarrationStatus = ChapterCoverage | 'downloading' | 'unknown';

export type ChapterSubject = {
  kind: 'chapter';
  translation: Translation;
  bookId: number;
  chapter: number;
};

export type PostSubject = { kind: 'post'; spaceId: string; postId: string };

/**
 * What a download is of, *minus* the voice — which is what every caller
 * actually has in hand. Narration is per-voice, but a chapter row or a post
 * knows nothing about that; the control that renders it supplies the voice
 * (`effectiveReadingVoice`) and hands over a full `NarrationTarget`.
 */
export type NarrationSubject = ChapterSubject | PostSubject;

/**
 * What a download is *of*.
 *
 * A union rather than two stores, because everything around it — the status
 * map, the progress ring, the one-controller-per-key cancellation, the
 * two-tap remove — is identical for a Bible chapter and a user-written post.
 * Only the key and the three service calls differ, and they are the three
 * places this file branches.
 *
 * The two arms are spelled out rather than intersected with the whole subject
 * union, so the `kind` discriminant still narrows in those three places.
 */
export type NarrationTarget =
  | (ChapterSubject & { voice: OpenAiVoiceId; voiceStyle: string })
  | (PostSubject & { voice: OpenAiVoiceId; voiceStyle: string });

type Target = NarrationTarget;

/** Item progress of whatever is downloading, keyed like `status`. */
export type ChapterNarrationProgressMap = Partial<Record<string, ChapterNarrationProgress>>;

type NarrationState = {
  /** Keyed by narrationTargetKey — voice included, since narration is per-voice. */
  status: Partial<Record<string, NarrationStatus>>;
  progress: ChapterNarrationProgressMap;
  error: Partial<Record<string, string>>;
  check: (t: Target) => Promise<void>;
  download: (t: Target) => Promise<void>;
  cancel: (t: Target) => void;
  remove: (t: Target) => Promise<void>;
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

export const narrationTargetKey = (t: Target) =>
  t.kind === 'post'
    ? postNarrationKey(t.voice, t.spaceId, t.postId)
    : chapterNarrationKey(t.voice, t.translation, t.bookId, t.chapter);

const keyOf = narrationTargetKey;

/**
 * Per-target narration download state.
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
    const running = checking.get(key);
    if (running) return running;
    const run = (async () => {
      const coverage =
        t.kind === 'post'
          ? await postCoverage(t.voice, t.voiceStyle, t.spaceId, t.postId)
          : await chapterCoverage(t.voice, t.voiceStyle, t.translation, t.bookId, t.chapter);
      set((s) => ({ status: { ...s.status, [key]: coverage } }));
    })().finally(() => {
      checking.delete(key);
    });
    checking.set(key, run);
    return run;
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
      const onProgress = (p: ChapterNarrationProgress) =>
        set((s) => ({ progress: { ...s.progress, [key]: p } }));
      if (t.kind === 'post') {
        await downloadPostNarration(
          t.voice,
          t.voiceStyle,
          t.spaceId,
          t.postId,
          onProgress,
          controller.signal,
        );
      } else {
        await downloadChapterNarration(
          t.voice,
          t.voiceStyle,
          t.translation,
          t.bookId,
          t.chapter,
          onProgress,
          controller.signal,
        );
      }
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
    const key = keyOf(t);
    controllers.get(key)?.abort();
    controllers.delete(key);
  },

  async remove(t) {
    const key = keyOf(t);
    get().cancel(t);
    if (t.kind === 'post') {
      await deletePostNarration(t.voice, t.voiceStyle, t.spaceId, t.postId);
    } else {
      await deleteChapterNarration(t.voice, t.voiceStyle, t.translation, t.bookId, t.chapter);
    }
    set((s) => ({ status: { ...s.status, [key]: 'missing' } }));
  },
}));

export { chapterNarrationKey };
