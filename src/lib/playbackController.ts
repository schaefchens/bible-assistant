import { audioPlayback, type PlaybackTrack } from './audioPlaybackManager';
import { browserTts, type BrowserTtsItem } from './browserTts';
import { buildPlaybackPlan, type PlanItem } from './playbackPlan';
import { planToBrowserItems, planToOpenAiTracks } from './startPlayback';
import { useChatStore } from '@/store/chatStore';
import { usePlaybackStore } from '@/store/playbackStore';
import {
  effectiveReadingVoice,
  effectiveVoiceStyle,
  useSettingsStore,
} from '@/store/settingsStore';
import { getAmbientTrackUrl } from '@/services/api/ambient';
import { isBrowserVoice, type OpenAiVoiceId } from '@/types/domain';

/**
 * Watches reading-rhythm settings and rebuilds the upcoming portion of the
 * playback queue when they change mid-flight. The currently-playing track
 * is left alone (no audio interruption); only verses that haven't started
 * yet are re-planned with the new settings.
 *
 * Note: only the currently-playing message's tail is rebuilt. Other
 * messages that happen to be queued ahead (multi-reading playlist) keep
 * their original tracks until they become "current" — at which point a
 * follow-up settings change would catch them.
 */

let rebuildTimer: number | null = null;
let inflightGeneration = 0;

const DEBOUNCE_MS = 150;

function scheduleRebuild() {
  if (rebuildTimer !== null) clearTimeout(rebuildTimer);
  rebuildTimer = window.setTimeout(() => {
    rebuildTimer = null;
    void rebuildCurrentTail();
  }, DEBOUNCE_MS);
}

async function rebuildCurrentTail(): Promise<void> {
  const cur = usePlaybackStore.getState().current;
  if (!cur) return;

  const msg = useChatStore
    .getState()
    .messages.find((m) => m.id === cur.messageId);
  const verses = msg?.verses ?? [];
  if (verses.length === 0) return;

  // Decide where the "tail" starts. If the currently-playing track is a
  // verse (highlightVerse !== false on the loaded track), skip past it —
  // the user is hearing it now. If it's a heading/number announcement, the
  // next verse hasn't started yet, so include it in the rebuild.
  const snapshot = audioPlayback.getQueueSnapshot();
  const currentTrack =
    snapshot.tracks[snapshot.currentIndex] as PlaybackTrack | undefined;
  const browserSnapshot = browserTts.getQueueSnapshot();
  const currentItem =
    browserSnapshot.items[browserSnapshot.currentIndex] as
      | BrowserTtsItem
      | undefined;

  const readerVoice = effectiveReadingVoice();
  const usingBrowser = browserTts.isActive() || isBrowserVoice(readerVoice);

  // The currently-playing track tells us where to slice. For the audio
  // engine: highlightVerse=false means it's an announcement; the verse
  // itself is upcoming. For browser TTS: we have no kind flag, so we
  // conservatively assume the current item IS the verse (most common case)
  // and rebuild from verseIndex+1.
  let startVerseIdx: number;
  if (usingBrowser) {
    // Browser items don't carry kind metadata; treat the current as the
    // verse and rebuild after it. (If it was actually an announcement, the
    // next item — the verse — is included in the rebuild anyway by the
    // index math below since cur.verseIndex points to that verse.)
    startVerseIdx = currentItem ? cur.verseIndex + 1 : 0;
  } else {
    const isAnnouncement = currentTrack?.highlightVerse === false;
    startVerseIdx = isAnnouncement ? cur.verseIndex : cur.verseIndex + 1;
  }

  if (startVerseIdx >= verses.length) return;

  const remaining = verses.slice(startVerseIdx);
  const settings = useSettingsStore.getState();

  const plan = buildPlaybackPlan(remaining, {
    locale: settings.locale,
    readChapterHeadings: settings.readChapterHeadings,
    readVerseNumbers: settings.readVerseNumbers,
    verseNumberStyle: settings.verseNumberStyle,
    pauseBetweenVersesMs: settings.pauseBetweenVersesMs,
    pauseBetweenChaptersMs: settings.pauseBetweenChaptersMs,
  });
  // Shift verseIndex back to the message's verse positions.
  const shifted: PlanItem[] = plan.map((it) =>
    it.kind === 'verse'
      ? { ...it, verseIndex: it.verseIndex + startVerseIdx }
      : { ...it, verseIndex: it.verseIndex + startVerseIdx },
  );

  const myGen = ++inflightGeneration;

  if (usingBrowser) {
    const items = planToBrowserItems(shifted, cur.messageId);
    // Atomic enough — no async between snapshot and replace for browser.
    if (myGen !== inflightGeneration) return;
    browserTts.replaceUpcomingFor(cur.messageId, items);
    return;
  }

  const tracks = await planToOpenAiTracks(
    shifted,
    cur.messageId,
    readerVoice as OpenAiVoiceId,
    effectiveVoiceStyle() || undefined,
    undefined,
  );
  // A newer rebuild may have started while TTS fetches were in flight —
  // drop this one to avoid stomping fresher state.
  if (myGen !== inflightGeneration) return;
  // Re-verify we're still on the same message.
  const nowCur = usePlaybackStore.getState().current;
  if (!nowCur || nowCur.messageId !== cur.messageId) return;
  audioPlayback.replaceUpcomingFor(cur.messageId, tracks);
}

function isPlaybackActive(): boolean {
  const status = usePlaybackStore.getState().status;
  return status === 'playing' || status === 'loading' || status === 'paused';
}

async function startAmbientNow(trackId: string): Promise<void> {
  try {
    const url = await getAmbientTrackUrl(trackId);
    if (!url) return;
    await audioPlayback.ambient.load(url);
    audioPlayback.ambient.play();
  } catch (e) {
    console.warn('ambient start failed', e);
  }
}

/** Wire up the controller. Call once at app startup. */
export function initPlaybackController(): void {
  useSettingsStore.subscribe((state, prev) => {
    // Reading-rhythm settings: rebuild the upcoming verses with new metadata.
    if (
      state.readChapterHeadings !== prev.readChapterHeadings ||
      state.readVerseNumbers !== prev.readVerseNumbers ||
      state.verseNumberStyle !== prev.verseNumberStyle ||
      state.pauseBetweenVersesMs !== prev.pauseBetweenVersesMs ||
      state.pauseBetweenChaptersMs !== prev.pauseBetweenChaptersMs
    ) {
      scheduleRebuild();
    }

    // Ambient music toggled mid-flight: start/stop the music bus so the
    // change is audible immediately without waiting for the next reading.
    const prevWantsMusic = prev.ambient.enabled && !!prev.ambient.trackId;
    const nextWantsMusic = state.ambient.enabled && !!state.ambient.trackId;
    if (prevWantsMusic !== nextWantsMusic) {
      if (nextWantsMusic && isPlaybackActive() && state.ambient.trackId) {
        void startAmbientNow(state.ambient.trackId);
      } else if (!nextWantsMusic) {
        audioPlayback.ambient.pause();
      }
    } else if (
      nextWantsMusic &&
      prev.ambient.trackId !== state.ambient.trackId &&
      state.ambient.trackId
    ) {
      // Music stays enabled but the track changed — swap in the new one,
      // matching the prior playing state (so a paused bus stays paused).
      const wasPlaying = audioPlayback.ambient.isPlaying();
      audioPlayback.ambient.pause();
      void (async () => {
        try {
          const url = await getAmbientTrackUrl(state.ambient.trackId!);
          if (!url) return;
          await audioPlayback.ambient.load(url);
          if (wasPlaying || isPlaybackActive()) {
            audioPlayback.ambient.play();
          }
        } catch (e) {
          console.warn('ambient swap failed', e);
        }
      })();
    }
  });
}
