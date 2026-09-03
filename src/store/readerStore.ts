import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Translation } from '@/services/bible/bibleApi';
import { isChapterMissing } from '@/services/bible/chapterSources';
import { nextBookRef } from '@/services/bible/chapterNavigation';
import { resolveSpace, selectionSegments } from '@/services/community/spaceReading';
import { absorbsGaps, loadSegmentUnits } from '@/services/reading/segmentLoader';
import {
  BIBLE_SOURCE,
  bibleSequence,
  findListSegment,
  isPostSegment,
  isWholeChapter,
  listSequence,
  sameSource,
  segmentId,
  selectionSequence,
  spaceSequence,
  type ReaderSource,
  type ReadingSequence,
  type SegmentRef,
} from '@/services/reading/readingSequence';
import {
  noteEntryFinished,
  noteEntryStarted,
  noteSpaceSeen,
} from '@/lib/readingProgressTracker';
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
 * Falls back to the Bible when a source outlives what it points at — a list
 * deleted, or a space unsubscribed, on another device must not leave the tab
 * unable to navigate. `useReaderSequence()` is the reactive twin of this and
 * has to grow the same branches.
 */
function sequenceFor(source: ReaderSource, translation: Translation): ReadingSequence {
  if (source.kind === 'list') {
    const list = useLibraryStore.getState().readingLists.find((l) => l.id === source.listId);
    if (list) return listSequence(list, translation);
  }
  if (source.kind === 'space') {
    const space = resolveSpace(source);
    if (space) return spaceSequence(space.spaceId, space.posts, translation);
  }
  if (source.kind === 'selection') {
    return selectionSequence(selectionSegments(source.postIds, translation));
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
  // situation as a missing chapter: this text doesn't have it. For a post there
  // is no network in the path at all, so an empty result is always
  // 'unavailable': the post has been deleted, or the space is no longer shared.
  return {
    kind: isPostSegment(ref) || e === null || isChapterMissing(e) ? 'unavailable' : 'network',
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

/**
 * What moved the reader, which is the only reliable way to know whether the
 * passage being left was *read*.
 *
 *   turn   — the pager's next button: you finished the page and turned it
 *   scroll — the passage crossed the viewport as you read down the page
 *   jump   — anywhere else: the picker, a resume, a translation reload, the
 *            endless-scroll prefetch. Lands you somewhere without reading what
 *            you passed.
 *
 * Inferring this from the positions alone doesn't work: picking the very next
 * passage out of the selector looks identical to turning the page onto it, and
 * marking it read was wrong.
 */
type PositionIntent = 'turn' | 'scroll' | 'jump';

/**
 * How long a passage has to have been the reader's position before leaving it
 * counts as having read it — **scaled by how much there is to read**.
 *
 * Turning the page is a good signal, but not on its own: stepping through three
 * chapters to reach the fourth marked the two you flicked past. Dwell separates
 * them, because reading takes minutes and skipping takes seconds.
 *
 * A flat threshold can't do that job, though. "John 3:16" is read in three
 * seconds, so any threshold long enough to exclude flicking past a chapter
 * excluded *every* single-verse entry — they could never be marked read at all.
 * So the gate is per verse, with a floor that still catches a flick and a cap so
 * that Psalm 119 doesn't demand three minutes.
 */
const DWELL_PER_VERSE_MS = 1_000;
const DWELL_MIN_MS = 2_500;
const DWELL_MAX_MS = 20_000;

function dwellNeededFor(verseCount: number): number {
  return Math.min(DWELL_MAX_MS, Math.max(DWELL_MIN_MS, verseCount * DWELL_PER_VERSE_MS));
}

/** The position being dwelt on, and since when. */
let dwell: { id: string; since: number } | null = null;

/** Whether `next` comes after `previous` in their list — scrolling back up
 * must not tick anything off. */
function isForwardInList(previous: SegmentRef, next: SegmentRef): boolean {
  if (!next.listId) return false;
  const all = sequenceFor(
    { kind: 'list', listId: next.listId },
    useSettingsStore.getState().translation,
  ).all();
  if (!all) return false;
  const from = all.findIndex((s) => segmentId(s) === segmentId(previous));
  const to = all.findIndex((s) => segmentId(s) === segmentId(next));
  return from !== -1 && to !== -1 && to > from;
}

/**
 * Record progress from the reader's own movement, so **reading counts, not just
 * listening**: a plan that only advanced when you pressed play was wrong about
 * anyone who reads silently.
 *
 * Handles both things a position change can mean: a reading-list entry being
 * finished, and a community piece being *seen*. They share the dwell rule
 * deliberately — the alternative was a second, subtly different notion of "you
 * were there long enough", and the flick-past problem is identical.
 */
function trackListProgress(
  previous: SegmentRef | null,
  next: SegmentRef,
  intent: PositionIntent,
): void {
  const now = Date.now();
  const previousId = previous ? segmentId(previous) : null;
  // How much was on the page decides how long counts as having read it. The
  // segment is still cached, so this needs no fetch.
  const verseCount = previousId
    ? (useReaderStore.getState().segments[previousId]?.verses.length ?? 0)
    : 0;
  const dwelt =
    !!previousId &&
    dwell?.id === previousId &&
    now - dwell.since >= dwellNeededFor(verseCount);
  dwell = { id: segmentId(next), since: now };

  // Leaving a piece you sat on counts as having seen it, which is what empties
  // an "everything new" reading as you work through it. Weaker than a reading
  // plan's tick, so no intent gate: dwell alone is the signal, and it applies
  // whichever way you moved.
  if (previous && isPostSegment(previous) && previous.postId && dwelt) {
    noteSpaceSeen(previous.postId);
  }

  if (!next.listId || !next.entryId) return;
  if (
    intent !== 'jump' &&
    dwelt &&
    previous &&
    previous.listId === next.listId &&
    previous.entryId &&
    isForwardInList(previous, next)
  ) {
    noteEntryFinished(
      { listId: previous.listId, entryId: previous.entryId },
      previous.chapter,
    );
  }
  noteEntryStarted({ listId: next.listId, entryId: next.entryId });
}

/** Restrict a chapter's verses to what the segment actually covers. */
/** A post is never sliced — `isWholeChapter` is true for it (no ranges), so
 * this returns its units untouched. */
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
    const verses = await loadSegmentUnits(ref, locale());
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

  // Only Bible versification has gaps to absorb. A post that isn't there is a
  // real miss, and stepping past it would show the reader a different post than
  // the one they asked for.
  const nextTry = !absorbsGaps(ref)
    ? null
    : dir === 'forward'
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
        if (mode !== 'prepend') trackListProgress(previousPosition, segment.ref, intent);
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
          const progress = useLibraryStore.getState().readingProgress[source.listId];
          const all = sequence.all();
          if (progress?.currentEntryId) {
            const at = all?.find((s) => s.entryId === progress.currentEntryId);
            if (at) return at;
          }
          // Nothing recorded (a plan ticked off by hand, say): the first thing
          // still unread, which is also the day the picker opens on.
          const done = new Set(progress?.completed ?? []);
          const unread = all?.find((s) => !s.entryId || !done.has(s.entryId));
          return unread ?? sequence.first();
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
          const sequence = sequenceFor(get().source, useSettingsStore.getState().translation);
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
          const sequence = sequenceFor(get().source, useSettingsStore.getState().translation);
          const ref = dir === 1 ? sequence.next(edge.ref) : sequence.prev(edge.ref);
          if (!ref) return null;
          return load(ref, dir === 1 ? 'append' : 'prepend', dir === 1 ? 'forward' : 'backward');
        },

        setPosition: (ref) => {
          const cur = get().position;
          if (cur && segmentId(cur) === segmentId(ref)) return;
          set({ position: ref });
          trackListProgress(cur, ref, 'scroll');
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
            trackListProgress(previousPosition, segment.ref, 'jump');
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
