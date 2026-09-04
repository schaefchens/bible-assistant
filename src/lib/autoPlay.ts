import { audioPlayback, type PlaybackTrack } from './audioPlaybackManager';
import { browserTts, type BrowserTtsItem } from './browserTts';
import { buildPlaybackPlan } from './playbackPlan';
import {
  planToBrowserItems,
  planToOpenAiTracks,
  readingUsesBrowserVoice,
  streamReading,
} from './startPlayback';
import {
  continuationKey,
  isWholeChapterReading,
  loadReadingVerses,
  nextReadingAfter,
  type NextReading,
} from './readingContinuation';
import { noteEntryFinished, noteEntryStarted } from './readingProgressTracker';
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
 * Auto-play continues the current reading once it naturally ends, and prefetches
 * the next chunk's TTS while the current one plays so the transition feels
 * seamless.
 *
 * **What** comes next is not decided here — `lib/readingContinuation.ts` owns
 * that, so a reading list continues as a list and everything else continues in
 * canonical order. This module is only the machinery: when to ask, what to
 * prefetch, and how to enqueue the answer.
 */

type PrefetchCache = {
  key: string;
  next: NextReading;
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

function autoPlayOn(): boolean {
  return useSettingsStore.getState().autoPlayReading;
}

/**
 * True when the device voice is the engine that just read — still speaking, or
 * soft-ended and waiting for a continuation to bridge into.
 *
 * `readingUsesBrowserVoice` cannot answer this: it decides from the *setting*
 * and the network, and a reading that fell back to the device voice because TTS
 * was unreachable still has an OpenAI voice selected and an online browser.
 */
function browserTtsIsReading(): boolean {
  return browserTts.isActive() || browserTts.isSoftEnded();
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
 * Enqueue a continuation as a NEW reading group — auto-play never modifies the
 * original one. The *host* decides what "a new group" means: chat appends an
 * assistant message (so the chunk gets its own ReaderPanel), the reader inserts
 * the segment into its window (so the page grows as the voice advances). Audio
 * bridges via soft-end + the chapter-pause either way.
 */
async function enqueueContinuationFor(
  anchorGroupId: string,
  next: NextReading,
): Promise<void> {
  const settings = useSettingsStore.getState();
  let summaries: VerseSummary[];
  let tracksFromPrefetch: PlaybackTrack[] | null = null;

  const key = continuationKey(next);
  if (prefetched && prefetched.key === key) {
    summaries = prefetched.summaries;
    tracksFromPrefetch = prefetched.tracks;
    prefetched = null;
  } else {
    summaries = await loadReadingVerses(next, settings.locale);
  }
  if (summaries.length === 0) return;

  const wholeChapter = isWholeChapterReading(next);

  const newGroupId = await readingHosts
    .hostFor(anchorGroupId)
    ?.appendReading(summaries, {
      wholeChapter,
      // Post units have no reference to note — `rangeHistoryNote` would format
      // book 0, chapter 0. The reader (the only host that can hold a post)
      // ignores the note anyway, but a "(Played aloud: ?0 0.)" waiting for the
      // first host that doesn't is not worth leaving lying around.
      historyNote: summaries[0]?.unit
        ? undefined
        : rangeHistoryNote(summaries, settings.locale),
      provenance: next.provenance,
    });
  if (!newGroupId) return;

  // The plan has moved on: record it before the audio starts, so closing the
  // app mid-chapter still resumes in the right place.
  noteEntryStarted(next.provenance);

  const readerVoice = effectiveReadingVoice();
  // Built up front: the engine choice needs to see the plan, because a chapter
  // already downloaded should keep playing in its downloaded voice even offline.
  const contPlan = buildPlaybackPlan(summaries, {
    locale: settings.locale,
    readChapterHeadings: settings.readChapterHeadings,
    readVerseNumbers: settings.readVerseNumbers,
    verseNumberStyle: settings.verseNumberStyle,
    pauseBetweenVersesMs: settings.pauseBetweenVersesMs,
    pauseBetweenChaptersMs: settings.pauseBetweenChaptersMs,
    wholeChapter,
  });
  // Offline counts as the device voice here too, so an endless reading keeps
  // going through a tunnel instead of falling silent at the chunk boundary.
  // If the network dropped *during* the previous chunk the two engines can
  // briefly overlap on its last verse — a far better outcome than silence.
  //
  // `browserTtsIsReading()` is the second half of that, and it is about
  // *continuity* rather than about the network: whichever engine read the last
  // chunk has to read this one. `streamReading` drops a fresh reading to the
  // device voice when its first track won't build (TTS unreachable, no key,
  // quota), and without this the continuation would ask the same dead service
  // again and the reading would simply stop — measured, with a backend
  // returning 502: every track failed to build and nothing was enqueued at all.
  if (browserTtsIsReading() || (await readingUsesBrowserVoice(contPlan))) {
    const items: BrowserTtsItem[] = planToBrowserItems(contPlan, newGroupId);
    void browserTts.enqueue(items);
    return;
  }

  // An empty prefetch is a *failed* prefetch, not a silent chunk — fall through
  // to the cold build rather than enqueueing nothing.
  const prefetchTracks = tracksFromPrefetch?.length
    ? tracksFromPrefetch.map((t) => ({ ...t, groupId: newGroupId }))
    : null;

  if (prefetchTracks) {
    // Prefetch hit: the whole chunk is already built, so enqueue it at once.
    // (Tracks were tagged with the prefetch's reserved groupId — swap to our
    // actual new group so the WordHighlighter binds correctly.)
    void audioPlayback.enqueue(prefetchTracks);
  } else {
    // Cold build: stream so the continuation's first verse plays after one TTS
    // round-trip instead of after the whole (possibly chapter-long) chunk —
    // this is the fix for the long silent gap before a continuation.
    await streamReading(
      contPlan,
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
    const next = await nextReadingAfter(groupId);
    if (!next || controller.signal.aborted) return;
    const settings = useSettingsStore.getState();
    const summaries = await loadReadingVerses(next, settings.locale);
    if (controller.signal.aborted || summaries.length === 0) return;

    let tracks: PlaybackTrack[] | null = null;
    const prefetchVoice = effectiveReadingVoice();
    const plan = buildPlaybackPlan(summaries, {
      locale: settings.locale,
      readChapterHeadings: settings.readChapterHeadings,
      readVerseNumbers: settings.readVerseNumbers,
      verseNumberStyle: settings.verseNumberStyle,
      pauseBetweenVersesMs: settings.pauseBetweenVersesMs,
      pauseBetweenChaptersMs: settings.pauseBetweenChaptersMs,
      wholeChapter: isWholeChapterReading(next),
    });
    const usingBrowser = await readingUsesBrowserVoice(plan);
    if (!usingBrowser) {
      tracks = await planToOpenAiTracks(
        plan,
        groupId,
        prefetchVoice as OpenAiVoiceId,
        effectiveVoiceStyle() || undefined,
        controller.signal,
      );
    }
    if (controller.signal.aborted) return;
    // Nothing built means TTS failed for every item, which is a failure to
    // report by *not* caching: a cached empty result reads as "this chunk is
    // silent" at enqueue time, and the reading ends with no error anywhere.
    if (!usingBrowser && tracks !== null && tracks.length === 0) return;
    prefetched = {
      key: continuationKey(next),
      next,
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

/**
 * Record that a reading ran to its end — the "narration finished a passage"
 * caller of `readingProgressTracker`.
 *
 * Kept out of `onSoftEnd` because that only runs with auto-play **on**, and
 * ticking a passage off has nothing to do with whether the next one plays by
 * itself. In the reader the dwell rule covered the difference; in the chat
 * nothing did, so a plan played from a voice command (`play_reading_list`) or a
 * passage tapped in the picker ticked *nothing at all* on a default install,
 * where `autoPlayReading` is off.
 *
 * Idempotent: `setEntryDone` no-ops when the entry is already ticked, so the
 * continuation path below may call it again for the same group.
 */
function notePassageFinished(groupId: string): void {
  const finished = readingHosts.getGroup(groupId);
  noteEntryFinished(
    finished?.provenance,
    // The *last* chapter of the group: an entry spanning several is only
    // finished when its final segment is.
    finished?.verses[finished.verses.length - 1]?.chapter,
  );
}

async function onSoftEnd(groupId: string): Promise<void> {
  if (firingContinuation) return;
  firingContinuation = true;
  try {
    // Whatever just finished is finished, whether or not anything follows it —
    // the last entry of a plan has to tick too. Also reached from the manual
    // next button (`triggerContinuation`), which is the one caller the
    // subscription's own tick doesn't cover: no soft-end has fired there.
    notePassageFinished(groupId);
    const next = await nextReadingAfter(groupId);
    if (!next) {
      // Nothing to continue with (the end of a reading list, the end of the
      // Bible). If the manual next-button path poked us into a 'loading' state
      // for instant feedback, restore idle so the thinking drone and PlayButton
      // pulse don't get stuck.
      restoreIdleIfStuck();
      return;
    }
    await enqueueContinuationFor(groupId, next);
    // Kick off the next prefetch right after enqueueing.
    void schedulePrefetchFor(groupId);
  } catch (e) {
    // A chapter fetch inside the continuation can reject (offline, a pack that
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
    // A soft-end is a reading reaching its own end (a user stop clears the
    // flag), so it is the signal for both jobs — but only continuing is the
    // auto-play setting's business.
    if (
      wasPlaying &&
      becameIdle &&
      (audioPlayback.isSoftEnded() || browserTts.isSoftEnded()) &&
      lastPlayedGroupId
    ) {
      notePassageFinished(lastPlayedGroupId);
      if (autoPlayOn()) void onSoftEnd(lastPlayedGroupId);
    }

    // Prefetch trigger: only when the playing group CHANGES. The
    // subscribe callback fires on every per-frame currentWordIndex tick;
    // anchoring on groupId means we kick off one prefetch per group
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
