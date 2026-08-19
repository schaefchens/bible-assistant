import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Translation } from '@/services/bible/bibleApi';
import { isChapterMissing } from '@/services/bible/chapterSources';
import {
  nextBookRef,
  nextChapterRef,
  prevChapterRef,
  type ChapterRef,
} from '@/services/bible/chapterNavigation';
import { loadChapterSummaries } from '@/services/bible/verseSummaries';
import type { VerseSummary } from '@/types/domain';
import { useSettingsStore } from './settingsStore';
import { useLastReadingStore } from './lastReadingStore';

/**
 * How many chapters stay mounted at once. This is the load-bearing mitigation
 * for render cost: every verse mounts a `WordHighlighter` with two playback-store
 * selectors, and the playback rAF loop rewrites `current` ~60×/s. Psalm 119
 * alone is 176 verses. Don't raise this without profiling.
 */
const MAX_VISIBLE = 6;

/** Resolution cache size. Bigger than the window on purpose — see `chapters`. */
const MAX_CACHED = 24;

export function readerGroupId(
  translation: Translation,
  bookId: number,
  chapter: number,
): string {
  return `reader:${translation}:${bookId}:${chapter}`;
}

export type LoadedChapter = {
  id: string;
  translation: Translation;
  bookId: number;
  chapter: number;
  /** The whole chapter, ascending. `verses[i].text` is `verseSpeakable(v)`. */
  verses: VerseSummary[];
};

export type ReaderPosition = {
  translation: Translation;
  bookId: number;
  chapter: number;
};

export type ReaderError = {
  kind: 'unavailable' | 'network';
  translation: Translation;
  bookId: number;
  chapter: number;
};

type ReaderState = {
  /** Where the user is in the book. **The only persisted field.** */
  position: ReaderPosition | null;
  /**
   * Loaded chapters keyed by group id. Deliberately separate from `visible`:
   * it survives window trimming, so a track queued for a chapter that has
   * scrolled out of the DOM still resolves for the highlighter, the
   * last-reading writer and `rebuildCurrentTail`.
   */
  chapters: Record<string, LoadedChapter>;
  /** The mounted window — a contiguous ascending run in canonical order. */
  visible: string[];
  status: 'idle' | 'loading';
  error: ReaderError | null;

  /** Open the persisted (or seeded) position. Safe to call repeatedly. */
  ensureOpen: () => Promise<void>;
  /** Replace the window with a single chapter. */
  goTo: (ref: ReaderPosition) => Promise<void>;
  /** Paged prev/next — replaces the window. */
  stepChapter: (dir: 1 | -1) => Promise<void>;
  /** Endless scroll — append (+1) or prepend (-1). Returns the new group id. */
  extend: (dir: 1 | -1) => Promise<string | null>;
  /** Record a scroll-derived position without loading anything. */
  setPosition: (ref: ReaderPosition) => void;
  /** Insert a reading the playback engine produced (auto-continuation).
   * Idempotent — returns the existing id when that chapter is already loaded. */
  adopt: (verses: VerseSummary[]) => string | null;
  /** React to a translation change: reload the window at the same chapter. */
  reloadForTranslation: (translation: Translation) => Promise<void>;
  clearError: () => void;
};

function locale() {
  return useSettingsStore.getState().locale;
}

/** Drop the oldest cache entries once past MAX_CACHED, never evicting anything
 * currently mounted. */
function pruneCache(
  chapters: Record<string, LoadedChapter>,
  visible: string[],
): Record<string, LoadedChapter> {
  const keys = Object.keys(chapters);
  if (keys.length <= MAX_CACHED) return chapters;
  const keep = new Set(visible);
  const out = { ...chapters };
  // Object key order is insertion order, so the front of `keys` is the oldest.
  for (const k of keys) {
    if (Object.keys(out).length <= MAX_CACHED) break;
    if (!keep.has(k)) delete out[k];
  }
  return out;
}

function classifyError(e: unknown, ref: ChapterRef, translation: Translation): ReaderError {
  // `null` means every source returned empty without throwing — same user-facing
  // situation as a missing chapter: this text doesn't have it.
  return {
    kind: e === null || isChapterMissing(e) ? 'unavailable' : 'network',
    translation,
    bookId: ref.bookId,
    chapter: ref.chapter,
  };
}

/** Which way the user was moving, which decides how a missing chapter is
 * absorbed. `'none'` (an explicit jump) treats it as a real error. */
type StepDirection = 'forward' | 'backward' | 'none';

/** How many neighbouring chapters to try before giving up. A translation can
 * lack more than one trailing chapter, but this must stay small — each attempt
 * is a request. */
const MAX_GAP_SKIP = 3;

/**
 * Load one chapter, transparently absorbing the versification gap.
 *
 * `BookEntry.chapters` is English versification, but the German texts genuinely
 * lack chapters the catalog advertises — bundled LUT's Malachi ends at 3 where
 * KJV has 4. So a step can point at a chapter that does not exist, and the miss
 * surfaces two different ways depending on the source (see `isChapterMissing`).
 *
 * Rather than dead-ending the user on a chapter that was never real, a step
 * continues the way they were already going: forward rolls into the next book,
 * backward walks down to the book's true last chapter. The store then sets
 * `position` from whatever actually loaded, so the UI self-corrects — a pager
 * label that optimistically said "Malachi 4" lands on Malachi 3 and renames
 * itself.
 *
 * An explicit jump (the picker, a resume) gets no such tolerance: there the user
 * named a specific chapter and deserves to be told it isn't there.
 */
async function loadChapter(
  translation: Translation,
  ref: ChapterRef,
  dir: StepDirection,
  attemptsLeft = MAX_GAP_SKIP,
): Promise<{ chapter: LoadedChapter; error: null } | { chapter: null; error: ReaderError }> {
  let missed: unknown = null;
  try {
    const verses = await loadChapterSummaries(translation, ref.bookId, ref.chapter, locale());
    if (verses.length > 0) {
      return {
        chapter: {
          id: readerGroupId(translation, ref.bookId, ref.chapter),
          translation,
          bookId: ref.bookId,
          chapter: ref.chapter,
          verses,
        },
        error: null,
      };
    }
  } catch (e) {
    if (!isChapterMissing(e)) {
      return { chapter: null, error: classifyError(e, ref, translation) };
    }
    missed = e;
  }

  const nextTry =
    dir === 'forward'
      ? nextBookRef(ref.bookId)
      : dir === 'backward' && ref.chapter > 1
        ? { bookId: ref.bookId, chapter: ref.chapter - 1 }
        : null;

  if (!nextTry || attemptsLeft <= 0) {
    return { chapter: null, error: classifyError(missed, ref, translation) };
  }
  // Forward only ever rolls once — the next book's chapter 1 either exists or
  // something is genuinely wrong.
  return loadChapter(translation, nextTry, dir === 'forward' ? 'none' : dir, attemptsLeft - 1);
}

export const useReaderStore = create<ReaderState>()(
  persist(
    (set, get) => {
      /** Shared loader: fetch, then splice into the window. */
      async function load(
        ref: ChapterRef,
        mode: 'replace' | 'append' | 'prepend',
        /** Which way the user was moving, so a chapter this translation lacks is
         * skipped rather than dead-ending. Not derivable from `mode`: the paged
         * next button replaces the window. */
        dir: StepDirection = 'none',
      ): Promise<string | null> {
        const translation = useSettingsStore.getState().translation;
        const id = readerGroupId(translation, ref.bookId, ref.chapter);
        const cached = get().chapters[id];

        if (cached && mode !== 'replace' && get().visible.includes(id)) return id;

        set({ status: 'loading', error: null });
        const result = cached
          ? { chapter: cached, error: null as null }
          : await loadChapter(translation, ref, dir);
        if (!result.chapter) {
          // A failed append/prepend must never clobber what's already readable.
          set({ status: 'idle', error: result.error });
          return null;
        }
        const chapter = result.chapter;

        set((s) => {
          const chapters = { ...s.chapters, [chapter.id]: chapter };
          let visible: string[];
          if (mode === 'replace') {
            visible = [chapter.id];
          } else if (s.visible.includes(chapter.id)) {
            visible = s.visible;
          } else if (mode === 'append') {
            visible = [...s.visible, chapter.id].slice(-MAX_VISIBLE);
          } else {
            visible = [chapter.id, ...s.visible].slice(0, MAX_VISIBLE);
          }
          return {
            chapters: pruneCache(chapters, visible),
            visible,
            status: 'idle',
            error: null,
            position:
              mode === 'prepend' && s.position
                ? s.position
                : {
                    translation: chapter.translation,
                    bookId: chapter.bookId,
                    chapter: chapter.chapter,
                  },
          };
        });
        return chapter.id;
      }

      return {
        position: null,
        chapters: {},
        visible: [],
        status: 'idle',
        error: null,

        ensureOpen: async () => {
          if (get().visible.length > 0 || get().status === 'loading') return;
          const stored = get().position;
          // Seed from the audio resume point on the very first open only, so
          // the tab feels like it remembers you. After that the two are
          // independent: this is "which page am I looking at", the last-reading
          // slot is "where the audio was".
          const slot = useLastReadingStore.getState().slot;
          const ref: ChapterRef = stored
            ? { bookId: stored.bookId, chapter: stored.chapter }
            : slot
              ? { bookId: slot.bookId, chapter: slot.chapter }
              : { bookId: 1, chapter: 1 };
          await load(ref, 'replace');
        },

        goTo: async (ref) => {
          const cur = get();
          // The active translation always wins over whatever the caller passed,
          // so there is exactly one source of truth for which text is on screen.
          const translation = useSettingsStore.getState().translation;
          const id = readerGroupId(translation, ref.bookId, ref.chapter);
          // StrictMode double-mounts and repeat taps shouldn't refetch.
          if (cur.visible.length === 1 && cur.visible[0] === id) return;
          await load({ bookId: ref.bookId, chapter: ref.chapter }, 'replace');
        },

        stepChapter: async (dir) => {
          const pos = get().position;
          if (!pos) return;
          const ref =
            dir === 1
              ? nextChapterRef(pos.bookId, pos.chapter)
              : prevChapterRef(pos.bookId, pos.chapter);
          if (!ref) return;
          await load(ref, 'replace', dir === 1 ? 'forward' : 'backward');
        },

        extend: async (dir) => {
          const { visible, chapters } = get();
          const edgeId = dir === 1 ? visible[visible.length - 1] : visible[0];
          const edge = edgeId ? chapters[edgeId] : undefined;
          if (!edge) return null;
          const ref =
            dir === 1
              ? nextChapterRef(edge.bookId, edge.chapter)
              : prevChapterRef(edge.bookId, edge.chapter);
          if (!ref) return null;
          return load(ref, dir === 1 ? 'append' : 'prepend', dir === 1 ? 'forward' : 'backward');
        },

        setPosition: (ref) => {
          const cur = get().position;
          if (
            cur &&
            cur.translation === ref.translation &&
            cur.bookId === ref.bookId &&
            cur.chapter === ref.chapter
          ) {
            return;
          }
          set({ position: ref });
        },

        adopt: (verses) => {
          const first = verses[0];
          if (!first) return null;
          const id = readerGroupId(first.translation, first.bookId, first.chapter);
          if (get().visible.includes(id)) return id;
          const chapter: LoadedChapter = {
            id,
            translation: first.translation,
            bookId: first.bookId,
            chapter: first.chapter,
            verses,
          };
          set((s) => {
            // Auto-continuation extends the window regardless of the
            // endless-scroll setting: reading aloud a chapter the user cannot
            // see is worse than growing the page.
            const visible = [...s.visible.filter((v) => v !== id), id].slice(-MAX_VISIBLE);
            return {
              chapters: pruneCache({ ...s.chapters, [id]: chapter }, visible),
              visible,
              error: null,
            };
          });
          return id;
        },

        reloadForTranslation: async (translation) => {
          const pos = get().position;
          if (!pos || pos.translation === translation) return;
          set({ visible: [], position: { ...pos, translation } });
          await load({ bookId: pos.bookId, chapter: pos.chapter }, 'replace');
        },

        clearError: () => set({ error: null }),
      };
    },
    {
      name: 'ba.reader',
      version: 1,
      // Never persist `chapters` — verse text × N chapters would bloat
      // localStorage and go stale when a pack is upgraded, while getChapter is
      // already memoized and in-flight-deduped, so reloading on boot is cheap.
      partialize: (state) => ({ position: state.position }) as unknown as ReaderState,
    },
  ),
);

/** Read contract for the reader host — see `lib/readerReadingHost.ts`. */
export function findReaderChapter(groupId: string): LoadedChapter | null {
  return useReaderStore.getState().chapters[groupId] ?? null;
}
