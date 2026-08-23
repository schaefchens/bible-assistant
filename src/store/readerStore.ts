import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Translation } from '@/services/bible/bibleApi';
import { isChapterMissing } from '@/services/bible/chapterSources';
import { nextBookRef } from '@/services/bible/chapterNavigation';
import { loadChapterSummaries } from '@/services/bible/verseSummaries';
import {
  BIBLE_SOURCE,
  bibleSequence,
  isWholeChapter,
  listSequence,
  segmentId,
  type ReaderSource,
  type ReadingSequence,
  type SegmentRef,
} from '@/services/reading/readingSequence';
import type { VerseSummary } from '@/types/domain';
import { useLibraryStore } from './libraryStore';
import { useSettingsStore } from './settingsStore';
import { useLastReadingStore } from './lastReadingStore';

/**
 * How many segments stay mounted at once. This is the load-bearing mitigation
 * for render cost: every verse mounts a `WordHighlighter` with two playback-store
 * selectors, and the playback rAF loop rewrites `current` ~60×/s. Psalm 119
 * alone is 176 verses. Don't raise this without profiling.
 */
const MAX_VISIBLE = 6;

/** Resolution cache size. Bigger than the window on purpose — see `segments`. */
const MAX_CACHED = 24;

/**
 * A loaded reader unit: a whole chapter, or the slice of one a reading-list
 * entry asked for.
 *
 * Called a *segment* rather than a chapter because it stopped being one when
 * lists arrived — "Psalm 23:1-6" is a first-class thing the reader renders and
 * plays. `ref.ranges === undefined` means the whole chapter, which is the
 * overwhelmingly common case and the only one the Bible source produces.
 */
export type LoadedSegment = {
  id: string;
  ref: SegmentRef;
  /** The segment's verses, ascending. `verses[i].text` is `verseSpeakable(v)`. */
  verses: VerseSummary[];
};

export type ReaderError = {
  kind: 'unavailable' | 'network';
  translation: Translation;
  bookId: number;
  chapter: number;
};

type ReaderState = {
  /** What the reader is walking through. Persisted with `position`, so the tab
   * reopens on the plan you were in the middle of. */
  source: ReaderSource;
  /** Where the user is. **Persisted**, along with `source`. */
  position: SegmentRef | null;
  /**
   * Loaded segments keyed by group id. Deliberately separate from `visible`:
   * it survives window trimming, so a track queued for a segment that has
   * scrolled out of the DOM still resolves for the highlighter, the
   * last-reading writer and `rebuildCurrentTail`.
   */
  segments: Record<string, LoadedSegment>;
  /** The mounted window — a contiguous run in the active sequence's order. */
  visible: string[];
  status: 'idle' | 'loading';
  error: ReaderError | null;

  /** Open the persisted (or seeded) position. Safe to call repeatedly. */
  ensureOpen: () => Promise<void>;
  /** Replace the window with a single segment. */
  goTo: (ref: SegmentRef) => Promise<void>;
  /** Switch what the reader walks through, and jump to where that source
   * resumes. */
  setSource: (source: ReaderSource) => Promise<void>;
  /** Paged prev/next — replaces the window. */
  step: (dir: 1 | -1) => Promise<void>;
  /** Endless scroll — append (+1) or prepend (-1). Returns the new group id. */
  extend: (dir: 1 | -1) => Promise<string | null>;
  /** Record a scroll-derived position without loading anything. */
  setPosition: (ref: SegmentRef) => void;
  /** Insert a reading the playback engine produced (auto-continuation).
   * Idempotent — returns the existing id when that segment is already loaded. */
  adopt: (verses: VerseSummary[], ref?: SegmentRef) => string | null;
  /** React to a translation change: reload the window at the same place. */
  reloadForTranslation: (translation: Translation) => Promise<void>;
  clearError: () => void;
};

function locale() {
  return useSettingsStore.getState().locale;
}

/**
 * The sequence for the current source. Resolved on demand rather than stored,
 * so editing a list (adding tomorrow's chapter) is reflected the next time the
 * reader steps, with no cache to invalidate.
 *
 * Falls back to the Bible when a list-sourced reader outlives its list — a list
 * deleted on another device must not leave the tab unable to navigate.
 */
function sequenceFor(source: ReaderSource, translation: Translation): ReadingSequence {
  if (source.kind === 'list') {
    const list = useLibraryStore.getState().readingLists.find((l) => l.id === source.listId);
    if (list) return listSequence(list, translation);
  }
  return bibleSequence(translation);
}

/** Drop the oldest cache entries once past MAX_CACHED, never evicting anything
 * currently mounted. */
function pruneCache(
  segments: Record<string, LoadedSegment>,
  visible: string[],
): Record<string, LoadedSegment> {
  const keys = Object.keys(segments);
  if (keys.length <= MAX_CACHED) return segments;
  const keep = new Set(visible);
  const out = { ...segments };
  // Object key order is insertion order, so the front of `keys` is the oldest.
  for (const k of keys) {
    if (Object.keys(out).length <= MAX_CACHED) break;
    if (!keep.has(k)) delete out[k];
  }
  return out;
}

function classifyError(e: unknown, ref: SegmentRef): ReaderError {
  // `null` means every source returned empty without throwing — same user-facing
  // situation as a missing chapter: this text doesn't have it.
  return {
    kind: e === null || isChapterMissing(e) ? 'unavailable' : 'network',
    translation: ref.translation,
    bookId: ref.bookId,
    chapter: ref.chapter,
  };
}

/** Which way the user was moving, which decides how a missing chapter is
 * absorbed. `'none'` (an explicit jump) treats it as a real error. */
type StepDirection = 'forward' | 'backward' | 'none';

/** How many neighbouring segments to try before giving up. A translation can
 * lack more than one trailing chapter, but this must stay small — each attempt
 * is a request. */
const MAX_GAP_SKIP = 3;

/** Restrict a chapter's verses to what the segment actually covers. */
function sliceToRanges(verses: VerseSummary[], ref: SegmentRef): VerseSummary[] {
  if (isWholeChapter(ref)) return verses;
  return verses.filter((v) => ref.ranges!.some((r) => v.verse >= r.start && v.verse <= r.end));
}

/**
 * Load one segment, transparently absorbing the versification gap.
 *
 * `BookEntry.chapters` is English versification, but the German texts genuinely
 * lack chapters the catalog advertises — bundled LUT's Malachi ends at 3 where
 * KJV has 4. So a step can point at a chapter that does not exist, and the miss
 * surfaces two different ways depending on the source (see `isChapterMissing`).
 *
 * Rather than dead-ending the user on a chapter that was never real, a step
 * continues the way they were already going: `nextInSequence` hands back the
 * following segment, which for the Bible rolls into the next book and for a
 * reading list is simply the next entry. The store then sets `position` from
 * whatever actually loaded, so the UI self-corrects — a pager label that
 * optimistically said "Malachi 4" lands on Malachi 3 and renames itself.
 *
 * An explicit jump (the picker, a resume) gets no such tolerance: there the user
 * named a specific passage and deserves to be told it isn't there.
 */
async function loadSegment(
  ref: SegmentRef,
  dir: StepDirection,
  sequence: ReadingSequence,
  attemptsLeft = MAX_GAP_SKIP,
): Promise<{ segment: LoadedSegment; error: null } | { segment: null; error: ReaderError }> {
  let missed: unknown = null;
  try {
    const verses = await loadChapterSummaries(
      ref.translation,
      ref.bookId,
      ref.chapter,
      locale(),
    );
    const sliced = sliceToRanges(verses, ref);
    if (sliced.length > 0) {
      return { segment: { id: segmentId(ref), ref, verses: sliced }, error: null };
    }
  } catch (e) {
    if (!isChapterMissing(e)) {
      return { segment: null, error: classifyError(e, ref) };
    }
    missed = e;
  }

  const nextTry =
    dir === 'forward'
      ? // Skip the rest of a book the catalog over-counted rather than each of
        // its phantom chapters one request at a time.
        (ref.listId ? sequence.next(ref) : bibleForwardSkip(ref))
      : dir === 'backward'
        ? sequence.prev(ref)
        : null;

  if (!nextTry || attemptsLeft <= 0) {
    return { segment: null, error: classifyError(missed, ref) };
  }
  return loadSegment(nextTry, dir, sequence, attemptsLeft - 1);
}

/** Forward past a missing chapter in the Bible: the next book's chapter 1.
 * Stepping one chapter at a time would retry every phantom chapter of an
 * over-counted book. */
function bibleForwardSkip(ref: SegmentRef): SegmentRef | null {
  const next = nextBookRef(ref.bookId);
  return next ? { translation: ref.translation, bookId: next.bookId, chapter: next.chapter } : null;
}

/** The stored shape of `position` before segments existed. */
type LegacyPosition = { translation: Translation; bookId: number; chapter: number };

export const useReaderStore = create<ReaderState>()(
  persist(
    (set, get) => {
      /** Shared loader: fetch, then splice into the window. */
      async function load(
        ref: SegmentRef,
        mode: 'replace' | 'append' | 'prepend',
        /** Which way the user was moving, so a chapter this translation lacks is
         * skipped rather than dead-ending. Not derivable from `mode`: the paged
         * next button replaces the window. */
        dir: StepDirection = 'none',
      ): Promise<string | null> {
        const id = segmentId(ref);
        const cached = get().segments[id];

        if (cached && mode !== 'replace' && get().visible.includes(id)) return id;

        set({ status: 'loading', error: null });
        const sequence = sequenceFor(get().source, useSettingsStore.getState().translation);
        const result = cached
          ? { segment: cached, error: null as null }
          : await loadSegment(ref, dir, sequence);
        if (!result.segment) {
          // A failed append/prepend must never clobber what's already readable.
          set({ status: 'idle', error: result.error });
          return null;
        }
        const segment = result.segment;

        set((s) => {
          const segments = { ...s.segments, [segment.id]: segment };
          let visible: string[];
          if (mode === 'replace') {
            visible = [segment.id];
          } else if (s.visible.includes(segment.id)) {
            visible = s.visible;
          } else if (mode === 'append') {
            visible = [...s.visible, segment.id].slice(-MAX_VISIBLE);
          } else {
            visible = [segment.id, ...s.visible].slice(0, MAX_VISIBLE);
          }
          return {
            segments: pruneCache(segments, visible),
            visible,
            status: 'idle',
            error: null,
            position: mode === 'prepend' && s.position ? s.position : segment.ref,
          };
        });
        return segment.id;
      }

      /**
       * Where a source resumes: for a list, the entry the user was last on; for
       * the Bible, the verse they last *heard* — dropping someone at Genesis 1
       * is only right on a genuinely fresh install.
       */
      function resumeOf(source: ReaderSource, translation: Translation): SegmentRef | null {
        const sequence = sequenceFor(source, translation);
        if (source.kind === 'list') {
          const currentEntryId = useLibraryStore.getState().readingProgress[source.listId]
            ?.currentEntryId;
          const all = sequence.all();
          const at = currentEntryId
            ? all?.find((s) => s.entryId === currentEntryId)
            : undefined;
          return at ?? sequence.first();
        }
        const slot = useLastReadingStore.getState().slot;
        return slot
          ? { translation, bookId: slot.bookId, chapter: slot.chapter }
          : sequence.first();
      }

      return {
        source: BIBLE_SOURCE,
        position: null,
        segments: {},
        visible: [],
        status: 'idle',
        error: null,

        ensureOpen: async () => {
          if (get().visible.length > 0 || get().status === 'loading') return;
          const translation = useSettingsStore.getState().translation;
          // A list deleted on another device (or by the assistant) would leave
          // the tab pointing at nothing. Navigation already degrades to
          // canonical order; drop the source too so the UI stops claiming to be
          // in a plan.
          const source = get().source;
          if (
            source.kind === 'list' &&
            !useLibraryStore.getState().readingLists.some((l) => l.id === source.listId)
          ) {
            set({ source: BIBLE_SOURCE, position: null });
          }
          const stored = get().position;
          if (stored) {
            await load(stored, 'replace');
            return;
          }
          // First-ever open. A Bible reader seeds from the audio resume point so
          // the tab feels like it remembers you; after that the two are
          // independent (this is "which page am I looking at", the last-reading
          // slot is "where the audio was"). A list-sourced reader resumes from
          // its own progress instead — the plan is the whole point.
          const seeded = resumeOf(get().source, translation);
          await load(seeded ?? { translation, bookId: 1, chapter: 1 }, 'replace');
        },

        goTo: async (ref) => {
          const cur = get();
          // The active translation always wins over whatever the caller passed,
          // unless the segment's own list entry overrode it — so there is
          // exactly one source of truth for which text is on screen.
          const translation = ref.entryId
            ? ref.translation
            : useSettingsStore.getState().translation;
          const target: SegmentRef = { ...ref, translation };
          const id = segmentId(target);
          // StrictMode double-mounts and repeat taps shouldn't refetch.
          if (cur.visible.length === 1 && cur.visible[0] === id) return;
          await load(target, 'replace');
        },

        setSource: async (source) => {
          const cur = get().source;
          if (
            cur.kind === source.kind &&
            (cur.kind !== 'list' || (source.kind === 'list' && cur.listId === source.listId))
          ) {
            return;
          }
          const translation = useSettingsStore.getState().translation;
          const previous = get().position;
          // Every group id belongs to the old source, so the window has to go.
          set({ source, visible: [], position: null, error: null });
          // Leaving a reading list keeps the passage on screen, now read
          // canonically: the user cleared a *filter*, they didn't ask to be sent
          // somewhere else. (The active translation wins — the passage they were
          // on may have been pinned to another text by its entry.)
          const ref =
            source.kind === 'bible' && previous
              ? { translation, bookId: previous.bookId, chapter: previous.chapter }
              : resumeOf(source, translation);
          if (ref) await load(ref, 'replace');
        },

        step: async (dir) => {
          const pos = get().position;
          if (!pos) return;
          const sequence = sequenceFor(get().source, useSettingsStore.getState().translation);
          const ref = dir === 1 ? sequence.next(pos) : sequence.prev(pos);
          if (!ref) return;
          await load(ref, 'replace', dir === 1 ? 'forward' : 'backward');
        },

        extend: async (dir) => {
          const { visible, segments } = get();
          const edgeId = dir === 1 ? visible[visible.length - 1] : visible[0];
          const edge = edgeId ? segments[edgeId] : undefined;
          if (!edge) return null;
          const sequence = sequenceFor(get().source, useSettingsStore.getState().translation);
          const ref = dir === 1 ? sequence.next(edge.ref) : sequence.prev(edge.ref);
          if (!ref) return null;
          return load(ref, dir === 1 ? 'append' : 'prepend', dir === 1 ? 'forward' : 'backward');
        },

        setPosition: (ref) => {
          const cur = get().position;
          if (cur && segmentId(cur) === segmentId(ref)) return;
          set({ position: ref });
        },

        adopt: (verses, ref) => {
          const first = verses[0];
          if (!first) return null;
          // An explicit ref keeps a continuation inside its reading list; without
          // one this is an ordinary chapter of the Bible.
          const segmentRef: SegmentRef =
            ref ?? {
              translation: first.translation,
              bookId: first.bookId,
              chapter: first.chapter,
            };
          const id = segmentId(segmentRef);
          if (get().visible.includes(id)) return id;
          const segment: LoadedSegment = { id, ref: segmentRef, verses };
          set((s) => {
            // Auto-continuation extends the window regardless of the
            // endless-scroll setting: reading aloud a passage the user cannot
            // see is worse than growing the page.
            const visible = [...s.visible.filter((v) => v !== id), id].slice(-MAX_VISIBLE);
            return {
              segments: pruneCache({ ...s.segments, [id]: segment }, visible),
              visible,
              error: null,
            };
          });
          return id;
        },

        reloadForTranslation: async (translation) => {
          const pos = get().position;
          // A pinned segment names its own text — there is nothing to reload.
          if (!pos || pos.translationPinned || pos.translation === translation) return;
          set({ visible: [], position: { ...pos, translation } });
          await load({ ...pos, translation }, 'replace');
        },

        clearError: () => set({ error: null }),
      };
    },
    {
      name: 'ba.reader',
      version: 2,
      // Never persist `segments` — verse text × N would bloat localStorage and
      // go stale when a pack is upgraded, while getChapter is already memoized
      // and in-flight-deduped, so reloading on boot is cheap.
      partialize: (state) =>
        ({ position: state.position, source: state.source }) as unknown as ReaderState,
      /** v1 stored `position` as a bare {translation, bookId, chapter} and had
       * no source. Both are structurally what a Bible segment is, so the
       * migration is just filling in the source. */
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as Partial<ReaderState> & {
          position?: LegacyPosition | SegmentRef | null;
        };
        if (version < 2) {
          return { ...state, source: BIBLE_SOURCE } as ReaderState;
        }
        return state as ReaderState;
      },
    },
  ),
);

/** Read contract for the reader host — see `lib/readerReadingHost.ts`. */
export function findReaderSegment(groupId: string): LoadedSegment | null {
  return useReaderStore.getState().segments[groupId] ?? null;
}
