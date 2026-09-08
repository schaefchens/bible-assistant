import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Translation } from '@/services/bible/bibleApi';
import { resolveSpace, selectionSegments } from '@/services/community/spaceReading';
import {
  loadSegment,
  type LoadedSegment,
  type ReaderError,
  type StepDirection,
} from '@/services/reading/segmentLoader';
import { trackListProgress, type PositionIntent } from '@/lib/readerProgress';
import { readerSequence } from '@/services/reading/readerSequence';
import { resumeSegment } from '@/services/reading/listWindow';
import {
  BIBLE_SOURCE,
  findListSegment,
  isPostSegment,
  sameSource,
  segmentId,
  type ReaderSource,
  type SegmentRef,
} from '@/services/reading/readingSequence';
import type { VerseSummary } from '@/types/domain';
import { useCommunityStore } from './communityStore';
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

function locale() {
  return useSettingsStore.getState().locale;
}

/** Re-exported: `segmentLoader` defines what it hands back, but three modules
 * (`SegmentBlock`, `readerReadingHost`, `ChapterUnavailableCard`) have always
 * asked the store for the reader's types, and the store is still where the
 * reader's state lives. */
export type { LoadedSegment, ReaderError };

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

/**
 * Re-resolve a list segment from its list, so the ref in play is always the one
 * the sequence would produce.
 *
 * A `SegmentRef` is persisted with `position`, and a copy goes stale: a day
 * renamed, a translation override added, or — as happened — a field this build
 * computes differently. Looking it up costs nothing (the list is in memory) and
 * removes a whole class of "the reader disagrees with the list" bugs. Falls back
 * to the ref as given when the list isn't loaded yet or no longer has that
 * entry.
 */
function resolveAgainstList(ref: SegmentRef): SegmentRef {
  if (!ref.listId || !ref.entryId) return ref;
  const list = useLibraryStore.getState().readingLists.find((l) => l.id === ref.listId);
  if (!list) return ref;
  return (
    findListSegment(
      list,
      useSettingsStore.getState().translation,
      ref.entryId,
      ref.chapter,
    ) ?? ref
  );
}

/** The stored shape of `position` before segments existed. */
type LegacyPosition = { translation: Translation; bookId: number; chapter: number };

export const useReaderStore = create<ReaderState>()(
  persist(
    (set, get) => {
      /** Shared loader: fetch, then splice into the window. */
      async function load(
        given: SegmentRef,
        mode: 'replace' | 'append' | 'prepend',
        /** Which way the user was moving, so a chapter this translation lacks is
         * skipped rather than dead-ending. Not derivable from `mode`: the paged
         * next button replaces the window. */
        dir: StepDirection = 'none',
        /** What this load means for progress — see PositionIntent. Defaults to
         * the safe answer: a load that doesn't say is not a read. */
        intent: PositionIntent = 'jump',
      ): Promise<string | null> {
        const ref = resolveAgainstList(given);
        const id = segmentId(ref);
        const cached = get().segments[id];

        if (cached && mode !== 'replace' && get().visible.includes(id)) return id;

        set({ status: 'loading', error: null });
        const sequence = readerSequence(get().source, useSettingsStore.getState().translation);
        const result = cached
          ? { segment: cached, error: null as null }
          : await loadSegment(ref, dir, sequence, locale());
        if (!result.segment) {
          // A failed append/prepend must never clobber what's already readable.
          set({ status: 'idle', error: result.error });
          return null;
        }
        const segment = result.segment;

        const previousPosition = get().position;
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
        // Prepending loads what came *before* — it doesn't move the reader.
        if (mode !== 'prepend') trackListProgress(previousPosition, segment.ref, intent, get().segments);
        return segment.id;
      }

      /**
       * Where a source resumes: for a list, the entry the user was last on; for
       * the Bible, the verse they last *heard* — dropping someone at Genesis 1
       * is only right on a genuinely fresh install.
       */
      function resumeOf(source: ReaderSource, translation: Translation): SegmentRef | null {
        const sequence = readerSequence(source, translation);
        if (source.kind === 'list') {
          const progress = useLibraryStore.getState().readingProgress[source.listId];
          // The same rule the picker's window opens on — one copy, in
          // `listWindow`, because these two must not disagree about where the
          // reader left off.
          return resumeSegment(sequence.all() ?? [], progress) ?? sequence.first();
        }
        // A space opens on its newest post. There is no per-post progress to
        // resume from (unread is a local dot, not a synced tick), and the newest
        // piece is what someone opening a blog wants.
        // A space opens on its newest piece; a selection opens at the top of
        // what was selected, which is the order the user asked for.
        if (source.kind === 'space' || source.kind === 'selection') return sequence.first();
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
          //
          // Only once the library has actually loaded: its lists arrive from
          // Dexie asynchronously, and an empty array during boot looks exactly
          // like a deleted list — which silently unlocked the plan the user was
          // in the middle of, on every reload.
          const library = useLibraryStore.getState();
          const community = useCommunityStore.getState();
          const source = get().source;
          const staleList =
            library.initialized &&
            source.kind === 'list' &&
            !library.readingLists.some((l) => l.id === source.listId);
          // Same reasoning for a space, and the same boot race: communityStore
          // fills from Dexie asynchronously, and an empty store during boot is
          // indistinguishable from an unsubscribed space.
          const staleSpace =
            community.initialized && source.kind === 'space' && resolveSpace(source) === null;
          // A persisted selection whose pieces have all gone (expired, or the
          // subscription dropped) has nothing to show, and unlike a space it
          // cannot come back — the snapshot is spent.
          const staleSelection =
            community.initialized &&
            source.kind === 'selection' &&
            selectionSegments(source.postIds, translation).length === 0;
          if (staleList || staleSpace || staleSelection) {
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
          // ...and a post has no translation to override: `translationPinned`
          // says so, and rewriting it would change the segment id.
          const translation =
            ref.entryId || ref.translationPinned
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
          if (sameSource(cur, source)) return;
          const translation = useSettingsStore.getState().translation;
          const previous = get().position;
          // Every group id belongs to the old source, so the window has to go.
          set({ source, visible: [], position: null, error: null });
          // Leaving a reading list keeps the passage on screen, now read
          // canonically: the user cleared a *filter*, they didn't ask to be sent
          // somewhere else. (The active translation wins — the passage they were
          // on may have been pinned to another text by its entry.)
          //
          // A post cannot be carried across: it has no book or chapter, so
          // reusing it would ask the Bible for chapter 0 of book 0. Leaving a
          // space therefore resumes wherever the Bible reader last was.
          const carryOver = previous && !isPostSegment(previous) ? previous : null;
          const ref =
            source.kind === 'bible' && carryOver
              ? { translation, bookId: carryOver.bookId, chapter: carryOver.chapter }
              : resumeOf(source, translation);
          if (ref) await load(ref, 'replace');
        },

        step: async (dir) => {
          const pos = get().position;
          if (!pos) return;
          const sequence = readerSequence(get().source, useSettingsStore.getState().translation);
          const ref = dir === 1 ? sequence.next(pos) : sequence.prev(pos);
          if (!ref) return;
          // Only forward is a page turn; stepping back is not a read.
          await load(ref, 'replace', dir === 1 ? 'forward' : 'backward', dir === 1 ? 'turn' : 'jump');
        },

        extend: async (dir) => {
          const { visible, segments } = get();
          const edgeId = dir === 1 ? visible[visible.length - 1] : visible[0];
          const edge = edgeId ? segments[edgeId] : undefined;
          if (!edge) return null;
          const sequence = readerSequence(get().source, useSettingsStore.getState().translation);
          const ref = dir === 1 ? sequence.next(edge.ref) : sequence.prev(edge.ref);
          if (!ref) return null;
          return load(ref, dir === 1 ? 'append' : 'prepend', dir === 1 ? 'forward' : 'backward');
        },

        setPosition: (ref) => {
          const cur = get().position;
          if (cur && segmentId(cur) === segmentId(ref)) return;
          set({ position: ref });
          trackListProgress(cur, ref, 'scroll', get().segments);
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
          // **Auto-continuation moves the reader the way the reader moves.**
          // Endless scroll grows downward, so the continuation appends and the
          // page carries on under the voice. Paged mode turns pages — so it
          // turns this one. Appending there stacked the next chapter (or the
          // next piece of somebody's writing) underneath the current one while
          // the header and the pager still named the old one: three different
          // answers on screen to "where am I?".
          const endless = useSettingsStore.getState().readerEndlessScroll;
          const already = get().visible.includes(id);
          if (already && (endless || get().visible.length === 1)) return id;

          // Reuse the cached segment when there is one, so `SegmentBlock`'s memo
          // (keyed on object identity) doesn't re-render a piece already mounted.
          const segment: LoadedSegment = get().segments[id] ?? { id, ref: segmentRef, verses };
          const previousPosition = get().position;
          set((s) => {
            const visible = endless
              ? [...s.visible.filter((v) => v !== id), id].slice(-MAX_VISIBLE)
              : [id];
            return {
              segments: pruneCache({ ...s.segments, [id]: segment }, visible),
              visible,
              error: null,
              // Endless mode leaves the position to the scroll observer, which
              // moves it as the voice scrolls into the new segment. Paged mode
              // has no scroll to observe: the page just turned, so say so.
              position: endless ? s.position : segment.ref,
            };
          });
          if (!endless) {
            // 'jump', not 'turn': auto-play already ticked the passage that
            // finished (`noteEntryFinished`) and claimed the new one
            // (`noteEntryStarted`). Letting the dwell rule fire here as well
            // would mark progress twice, from two different clocks.
            trackListProgress(previousPosition, segment.ref, 'jump', get().segments);
          }
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
