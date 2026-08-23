import { audioPlayback, type PlaybackTrack } from './audioPlaybackManager';
import { browserTts, type BrowserTtsItem } from './browserTts';
import { buildPlaybackPlan } from './playbackPlan';
import {
  planToBrowserItems,
  planToOpenAiTracks,
  readingUsesBrowserVoice,
  streamReading,
} from './startPlayback';
import { getChapter, type Translation } from '@/services/bible/bibleApi';
import { toVerseSummaries } from '@/services/bible/verseSummaries';
import { nextChapterRef } from '@/services/bible/chapterNavigation';
import { readingHosts } from './readingHosts';
import { rangeHistoryNote } from './chatReadingHost';
import { usePlaybackStore } from '@/store/playbackStore';
import {
  effectiveReadingVoice,
  effectiveVoiceStyle,
  useSettingsStore,
} from '@/store/settingsStore';
import type { OpenAiVoiceId, VerseSummary } from '@/types/domain';

/**
 * Auto-play continues the current reading once it naturally ends. Mode
 * detection looks at the last reading's trailing chapter slice:
 *   - covers the whole chapter (verse 1 .. chapter-end)  → next full chapter
 *   - otherwise                                          → next ~5 verses
 *
 * Crosses book boundaries automatically; only stops at Revelation 22.
 *
 * Prefetches the next chunk's TTS while the current chunk plays so the
 * transition feels seamless.
 */

const CHUNK_SIZE = 5;

type Continuation = {
  bookId: number;
  chapter: number;
  /** verseStart undefined → entire chapter (chapter mode). */
  verseStart?: number;
  verseEnd?: number;
};

type PrefetchCache = {
  key: string;
  cont: Continuation;
  translation: Translation;
  summaries: VerseSummary[];
  /** Pre-built tracks (OpenAI voice) — ready to enqueue. */
  tracks: PlaybackTrack[] | null;
  /** For browser TTS, we only prefetch verse text; tracks are null. */
  isBrowserVoice: boolean;
};

let lastPlayedGroupId: string | null = null;
let prefetched: PrefetchCache | null = null;
let prefetchController: AbortController | null = null;
/** The groupId we last started (or completed) a prefetch for. The
 * playbackStore subscriber fires on every frame's currentWordIndex tick,
 * so without this guard each tick would abort + restart the in-flight
 * prefetch and it'd never finish. */
let prefetchAnchorGroupId: string | null = null;
let firingContinuation = false;

function chunkKey(cont: Continuation, translation: Translation): string {
  return `${translation}:${cont.bookId}:${cont.chapter}:${cont.verseStart ?? 'all'}:${cont.verseEnd ?? 'all'}`;
}

function autoPlayOn(): boolean {
  return useSettingsStore.getState().autoPlayReading;
}

export function cancelAutoPlayPrefetch(): void {
  if (prefetchController) {
    prefetchController.abort();
    prefetchController = null;
  }
  prefetched = null;
  prefetchAnchorGroupId = null;
}

/**
 * Decide what plays after the group's current verses. Returns null when the
 * Bible is fully read or the group has no verses to anchor on.
 *
 * Host-agnostic by construction: the mode falls out of the verses themselves, so
 * a reader group (always a full chapter, 1..N) automatically takes the
 * whole-chapter branch and continues into the next chapter. No reader
 * special-casing is needed anywhere in this module.
 */
async function computeNextChunk(
  groupId: string,
): Promise<{ cont: Continuation; translation: Translation } | null> {
  const verses = readingHosts.getGroup(groupId)?.verses;
  if (!verses || verses.length === 0) return null;

  const last = verses[verses.length - 1];
  // Trailing slice for the last verse's (book, chapter).
  const trailing: VerseSummary[] = [];
  for (let i = verses.length - 1; i >= 0; i--) {
    const v = verses[i];
    if (v.bookId === last.bookId && v.chapter === last.chapter) {
      trailing.unshift(v);
    } else {
      break;
    }
  }

  const chapterVerses = await getChapter(last.translation, last.bookId, last.chapter);
  if (chapterVerses.length === 0) return null;
  const chapterEnd = chapterVerses[chapterVerses.length - 1].verse;

  const atChapterEnd = last.verse >= chapterEnd;
  const fullyReadThisChapter =
    trailing[0].verse === 1 && trailing[trailing.length - 1].verse === chapterEnd;

  // Determine where to go next.
  if (fullyReadThisChapter) {
    // Chapter mode → next chapter (whole), possibly next book.
    return nextWholeChapter(last.bookId, last.chapter, last.translation);
  }

  // Verse mode → next N verses, rolling over chapters/books as needed.
  if (!atChapterEnd) {
    const start = last.verse + 1;
    const end = Math.min(start + CHUNK_SIZE - 1, chapterEnd);
    return {
      cont: {
        bookId: last.bookId,
        chapter: last.chapter,
        verseStart: start,
        verseEnd: end,
      },
      translation: last.translation,
    };
  }
  // Past chapter end → roll to next chapter, first N verses (or next book).
  return nextVerseChunkAfterChapterEnd(last.bookId, last.chapter, last.translation);
}

function nextWholeChapter(
  bookId: number,
  chapter: number,
  translation: Translation,
): { cont: Continuation; translation: Translation } | null {
  const ref = nextChapterRef(bookId, chapter);
  return ref ? { cont: { bookId: ref.bookId, chapter: ref.chapter }, translation } : null;
}

async function nextVerseChunkAfterChapterEnd(
  bookId: number,
  chapter: number,
  translation: Translation,
): Promise<{ cont: Continuation; translation: Translation } | null> {
  const ref = nextChapterRef(bookId, chapter);
  if (!ref) return null;
  const verses = await getChapter(translation, ref.bookId, ref.chapter);
  if (verses.length === 0) return null;
  const lastVerseNo = verses[verses.length - 1].verse;
  return {
    cont: {
      bookId: ref.bookId,
      chapter: ref.chapter,
      verseStart: 1,
      verseEnd: Math.min(CHUNK_SIZE, lastVerseNo),
    },
    translation,
  };
}

async function buildSummariesFor(
  cont: Continuation,
  translation: Translation,
  locale: 'en' | 'de',
): Promise<VerseSummary[]> {
  const verses = await getChapter(translation, cont.bookId, cont.chapter);
  if (verses.length === 0) return [];
  const slice =
    cont.verseStart === undefined
      ? verses
      : verses.filter(
          (v) =>
            v.verse >= (cont.verseStart as number) &&
            v.verse <= (cont.verseEnd ?? (cont.verseStart as number)),
        );
  return toVerseSummaries(translation, cont.bookId, cont.chapter, slice, locale);
}

/**
 * Enqueue an auto-play continuation as a NEW reading group — auto-play never
 * modifies the original one. The *host* decides what "a new group" means: chat
 * appends an assistant message (so the chunk gets its own ReaderPanel), the
 * reader inserts the chapter into its window (so the page grows as the voice
 * advances). Audio bridges via soft-end + the chapter-pause either way.
 */
async function enqueueContinuationFor(
  anchorGroupId: string,
  cont: Continuation,
  translation: Translation,
): Promise<void> {
  const settings = useSettingsStore.getState();
  let summaries: VerseSummary[];
  let tracksFromPrefetch: PlaybackTrack[] | null = null;

  const key = chunkKey(cont, translation);
  if (prefetched && prefetched.key === key) {
    summaries = prefetched.summaries;
    tracksFromPrefetch = prefetched.tracks;
    prefetched = null;
  } else {
    summaries = await buildSummariesFor(cont, translation, settings.locale);
  }
  if (summaries.length === 0) return;

  // Continuation is a whole chapter only when `cont.verseStart` is
  // undefined (chapter mode in computeNextChunk).
  const wholeChapter = cont.verseStart === undefined;

  const newGroupId = await readingHosts
    .hostFor(anchorGroupId)
    ?.appendReading(summaries, {
      wholeChapter,
      historyNote: rangeHistoryNote(summaries, settings.locale),
    });
  if (!newGroupId) return;

  const readerVoice = effectiveReadingVoice();
  // Offline counts as the device voice here too, so an endless reading keeps
  // going through a tunnel instead of falling silent at the chunk boundary.
  // If the network dropped *during* the previous chunk the two engines can
  // briefly overlap on its last verse — a far better outcome than silence.
  if (readingUsesBrowserVoice()) {
    const plan = buildPlaybackPlan(summaries, {
      locale: settings.locale,
      readChapterHeadings: settings.readChapterHeadings,
      readVerseNumbers: settings.readVerseNumbers,
      verseNumberStyle: settings.verseNumberStyle,
      pauseBetweenVersesMs: settings.pauseBetweenVersesMs,
      pauseBetweenChaptersMs: settings.pauseBetweenChaptersMs,
      wholeChapter,
    });
    const items: BrowserTtsItem[] = planToBrowserItems(plan, newGroupId);
    void browserTts.enqueue(items);
    return;
  }

  if (tracksFromPrefetch) {
    // Prefetch hit: the whole chunk is already built, so enqueue it at once.
    // (Tracks were tagged with the prefetch's reserved groupId — swap to our
    // actual new message so the WordHighlighter binds correctly.)
    const tracks = tracksFromPrefetch.map((t) => ({ ...t, groupId: newGroupId }));
    if (tracks.length > 0) void audioPlayback.enqueue(tracks);
  } else {
    // Cold build: stream so the continuation's first verse plays after one TTS
    // round-trip instead of after the whole (possibly chapter-long) chunk —
    // this is the fix for the long silent gap before a continuation.
    const plan = buildPlaybackPlan(summaries, {
      locale: settings.locale,
      readChapterHeadings: settings.readChapterHeadings,
      readVerseNumbers: settings.readVerseNumbers,
      verseNumberStyle: settings.verseNumberStyle,
      pauseBetweenVersesMs: settings.pauseBetweenVersesMs,
      pauseBetweenChaptersMs: settings.pauseBetweenChaptersMs,
      wholeChapter,
    });
    await streamReading(
      plan,
      newGroupId,
      readerVoice as OpenAiVoiceId,
      effectiveVoiceStyle() || undefined,
      undefined,
      { mode: 'enqueue' },
    );
  }
}

async function schedulePrefetchFor(groupId: string): Promise<void> {
  if (!autoPlayOn()) return;
  // Already prefetching for this anchor — let it finish.
  if (prefetchAnchorGroupId === groupId && (prefetchController || prefetched)) {
    return;
  }
  cancelAutoPlayPrefetch();
  prefetchAnchorGroupId = groupId;
  const controller = new AbortController();
  prefetchController = controller;
  try {
    const next = await computeNextChunk(groupId);
    if (!next || controller.signal.aborted) return;
    const settings = useSettingsStore.getState();
    const summaries = await buildSummariesFor(
      next.cont,
      next.translation,
      settings.locale,
    );
    if (controller.signal.aborted || summaries.length === 0) return;

    const key = chunkKey(next.cont, next.translation);
    let tracks: PlaybackTrack[] | null = null;
    const prefetchVoice = effectiveReadingVoice();
    const usingBrowser = readingUsesBrowserVoice();
    if (!usingBrowser) {
      const plan = buildPlaybackPlan(summaries, {
        locale: settings.locale,
        readChapterHeadings: settings.readChapterHeadings,
        readVerseNumbers: settings.readVerseNumbers,
        verseNumberStyle: settings.verseNumberStyle,
        pauseBetweenVersesMs: settings.pauseBetweenVersesMs,
        pauseBetweenChaptersMs: settings.pauseBetweenChaptersMs,
        wholeChapter: next.cont.verseStart === undefined,
      });
      tracks = await planToOpenAiTracks(
        plan,
        groupId,
        prefetchVoice as OpenAiVoiceId,
        effectiveVoiceStyle() || undefined,
        controller.signal,
      );
    }
    if (controller.signal.aborted) return;
    prefetched = {
      key,
      cont: next.cont,
      translation: next.translation,
      summaries,
      tracks,
      isBrowserVoice: usingBrowser,
    };
  } catch {
    /* abort or fetch failure — retry on next trigger */
  } finally {
    if (prefetchController === controller) prefetchController = null;
  }
}

/** Last groupId whose verses we played. Survives `softEnd()` clearing
 * the playback store's `current`, so the manual next-button path can
 * still pick up the conversation thread. Returns null before anything has
 * played in this session. */
export function getLastPlayedGroupId(): string | null {
  return lastPlayedGroupId;
}

/**
 * Same flow as the automatic soft-end continuation, exposed so the
 * floating playback bar's next button can fire it on demand even when
 * auto-play is off. The `firingContinuation` guard below protects against
 * double-tap spam.
 */
export const triggerContinuation = (groupId: string): Promise<void> =>
  onSoftEnd(groupId);

async function onSoftEnd(groupId: string): Promise<void> {
  if (firingContinuation) return;
  firingContinuation = true;
  try {
    const next = await computeNextChunk(groupId);
    if (!next) {
      // Nothing to continue with (e.g. end of Bible). If the manual
      // next-button path poked us into a 'loading' state for instant
      // feedback, restore idle so the thinking drone and PlayButton pulse
      // don't get stuck.
      restoreIdleIfStuck();
      return;
    }
    await enqueueContinuationFor(groupId, next.cont, next.translation);
    // Kick off the next prefetch right after enqueueing.
    void schedulePrefetchFor(groupId);
  } catch (e) {
    // A chapter fetch inside computeNextChunk can reject (offline, a pack that
    // isn't downloaded, a translation that genuinely lacks the next chapter).
    // Without this catch it escaped as an unhandled rejection AND left status
    // stuck at 'loading' — a permanently spinning play button and a thinking
    // drone that never stops. Reading offline makes that reachable constantly.
    console.warn('auto-play continuation failed', e);
    restoreIdleIfStuck();
  } finally {
    firingContinuation = false;
  }
}

/** Undo the optimistic 'loading' poke from the manual next-button path when no
 * continuation actually materialized. */
function restoreIdleIfStuck(): void {
  const ps = usePlaybackStore.getState();
  if (ps.status === 'loading' && !ps.current) ps.setStatus('idle');
}

/** Subscribe to playback + settings; call once at app startup. */
export function initAutoPlay(): void {
  // Track the last playing groupId so we can recover it on soft-end
  // (current is null by then).
  usePlaybackStore.subscribe((state, prev) => {
    if (state.current?.groupId) {
      lastPlayedGroupId = state.current.groupId;
    }

    const wasPlaying = prev.status === 'playing' || prev.status === 'loading';
    const becameIdle = state.status === 'idle';
    if (
      wasPlaying &&
      becameIdle &&
      (audioPlayback.isSoftEnded() || browserTts.isSoftEnded()) &&
      autoPlayOn() &&
      lastPlayedGroupId
    ) {
      void onSoftEnd(lastPlayedGroupId);
    }

    // Prefetch trigger: only when the playing message CHANGES. The
    // subscribe callback fires on every per-frame currentWordIndex tick;
    // anchoring on groupId means we kick off one prefetch per message
    // and let it complete (rather than aborting + restarting 60×/sec).
    if (state.current && autoPlayOn() && state.current.groupId) {
      const msgId = state.current.groupId;
      if (msgId !== prefetchAnchorGroupId) {
        void schedulePrefetchFor(msgId);
      }
    }
  });

  // React when the user toggles auto-play ON mid-playback.
  useSettingsStore.subscribe((state, prev) => {
    if (state.autoPlayReading && !prev.autoPlayReading && lastPlayedGroupId) {
      void schedulePrefetchFor(lastPlayedGroupId);
    }
    if (!state.autoPlayReading && prev.autoPlayReading) {
      cancelAutoPlayPrefetch();
    }
  });
}
