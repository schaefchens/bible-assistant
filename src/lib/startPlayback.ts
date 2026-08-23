import { audioPlayback, type PlaybackTrack } from './audioPlaybackManager';
import { browserTts, type BrowserTtsItem } from './browserTts';
import { postTts, postTtsSpeak } from '@/services/api/tts';
import { getAmbientTrackUrl } from '@/services/api/ambient';
import { readingHosts } from './readingHosts';
import { usePlaybackStore } from '@/store/playbackStore';
import {
  effectiveReadingVoice,
  effectiveVoiceStyle,
  useSettingsStore,
} from '@/store/settingsStore';
import { isBrowserVoice, type OpenAiVoiceId, type VerseSummary } from '@/types/domain';
import {
  buildPlaybackPlan,
  sliceFromVerseIndex,
  type PlanItem,
} from './playbackPlan';
import { localeForTranslation } from './translationLocaleMap';
import { getTranslationInfo } from '@/services/bible/translationCatalog';

/**
 * Fire-and-forget: if the user has ambient music enabled, load the selected
 * track (cached after first run) and start it. Safe to call repeatedly —
 * `ambient.play()` no-ops while a source is already running.
 */
export function startAmbientIfEnabled(): void {
  const { ambient } = useSettingsStore.getState();
  if (!ambient.enabled || !ambient.trackId) return;
  void getAmbientTrackUrl(ambient.trackId)
    .then((url) => {
      if (!url) return;
      return audioPlayback.ambient.load(url).then(() => {
        audioPlayback.ambient.play();
      });
    })
    .catch((e) => {
      console.warn('ambient start failed', e);
    });
}

/**
 * Set what the lock screen / Control Center shows for this reading:
 * "Galatians 5:22" for a single verse, "Galatians 5:22–26" for a range, with
 * the translation as the subtitle.
 *
 * Called from both reading entry points — `startPlaybackForVerses` (taps, the
 * transport, resume-last-reading) and `streamReading` (the AI `read_verses`
 * tool, which builds tracks from a plan and never goes through the former).
 */
export function publishNowPlaying(verses: VerseSummary[], startIndex = 0): void {
  const first = verses[startIndex] ?? verses[0];
  if (!first) return;
  const last = verses[verses.length - 1];
  const label =
    last && last !== first ? `${first.display}–${last.verse}` : first.display;
  audioPlayback.setNowPlaying(label, getTranslationInfo(first.translation).name);
}

/**
 * True when the browser is *certain* there is no network. A false positive is
 * possible (a captive portal reports online), a false negative is not — which
 * is exactly the guarantee needed here: this must never claim offline while a
 * TTS request would have succeeded.
 */
function definitelyOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/**
 * Which engine reads: the on-device voice, or OpenAI TTS?
 *
 * Being offline counts as "device voice" even when an OpenAI voice is selected.
 * Without this every buildTrack() in the reading fails, each failure is
 * swallowed, and the reading plays *nothing at all* — the app looks broken with
 * no error surfaced anywhere. Reading with the one voice that needs no network
 * is the only useful answer.
 *
 * Not a pure predicate: choosing the device voice *because* of the network
 * announces the fallback once per session, so the UI can explain why the voice
 * changed. This is called at the points where the engine is committed to, which
 * is exactly where that belongs.
 *
 * Deliberately NOT consulted by playbackController's mid-reading rebuild, nor
 * by playFromVerseWord — the engine there has to stay whichever one is already
 * playing. A reading queued while online keeps working offline (its audio is in
 * mediaCache, and seeking within a queued track needs no network), so switching
 * engines under it would both leave two engines talking over each other and
 * throw away better audio.
 *
 * Note for downloadable narration: "offline" only implies "no OpenAI audio"
 * because buildTrack has to ask api.php for the URL before mediaCache can be
 * consulted. Once a narration source can resolve URLs locally, this check has
 * to move behind it — offline with the chapter already downloaded should read
 * in the downloaded voice, not the device one.
 */
export function readingUsesBrowserVoice(): boolean {
  if (isBrowserVoice(effectiveReadingVoice())) return true;
  if (definitelyOffline()) {
    announceNarrationFallback();
    return true;
  }
  return false;
}

/**
 * Fires the first time a reading drops from OpenAI TTS to the device voice.
 * Mirrors client.ts's onUserKeyFailure so the notice doesn't have to be
 * threaded through every playback caller.
 *
 * Once per session on purpose: after the first explanation the fallback is
 * better off silent, and a banner per chapter would be noise.
 */
type NarrationFallbackListener = () => void;
const narrationFallbackListeners = new Set<NarrationFallbackListener>();
let narrationFallbackAnnounced = false;

export function onNarrationFallback(fn: NarrationFallbackListener): () => void {
  narrationFallbackListeners.add(fn);
  return () => narrationFallbackListeners.delete(fn);
}

function announceNarrationFallback(): void {
  if (narrationFallbackAnnounced) return;
  narrationFallbackAnnounced = true;
  for (const fn of narrationFallbackListeners) {
    try {
      fn();
    } catch {
      /* a bad listener must not break playback */
    }
  }
}

export async function startPlaybackForVerses(
  groupId: string,
  verses: VerseSummary[],
  startIndex = 0,
  startWordIndex?: number,
): Promise<void> {
  if (verses.length === 0) return;
  const settings = useSettingsStore.getState();
  audioPlayback.ensureContext();
  startAmbientIfEnabled();

  publishNowPlaying(verses, startIndex);

  const group = readingHosts.getGroup(groupId);
  const fullPlan = buildPlaybackPlan(verses, {
    locale: settings.locale,
    readChapterHeadings: settings.readChapterHeadings,
    readVerseNumbers: settings.readVerseNumbers,
    verseNumberStyle: settings.verseNumberStyle,
    pauseBetweenVersesMs: settings.pauseBetweenVersesMs,
    pauseBetweenChaptersMs: settings.pauseBetweenChaptersMs,
    wholeChapter: group?.wholeChapter ?? false,
  });
  const plan = sliceFromVerseIndex(fullPlan, startIndex);

  const readerVoice = effectiveReadingVoice();
  if (readingUsesBrowserVoice()) {
    const items = planToBrowserItems(plan, groupId);
    void browserTts.speakQueue(items);
    return;
  }

  // Stream so the requested verse starts playing after one TTS round-trip;
  // startWordIndex only applies when the first plan item is a verse track.
  // Awaited so startReadingPlaylist sequences subsequent readings AFTER this
  // one's stream rather than letting their feeds supersede it mid-build.
  const firstIsVerse = plan[0]?.kind === 'verse';
  await streamReading(
    plan,
    groupId,
    readerVoice as OpenAiVoiceId,
    effectiveVoiceStyle() || undefined,
    undefined,
    { mode: 'playQueue', startWordIndex: firstIsVerse ? startWordIndex : undefined },
  );
}

/**
 * Tap-to-play entry point. Plays the requested group's verses, then continues
 * into every subsequent group in the *same host* — so in chat the user can go
 * back to an earlier reading and the rest of the chat's readings still play in
 * order, and in the reader the following mounted chapters play on.
 *
 * `startIndex` / `startWordIndex` apply only to the primary group.
 */
export async function startReadingPlaylist(
  primaryGroupId: string,
  primaryVerses: VerseSummary[],
  startIndex = 0,
  startWordIndex?: number,
): Promise<void> {
  if (primaryVerses.length === 0) return;
  await startPlaybackForVerses(
    primaryGroupId,
    primaryVerses,
    startIndex,
    startWordIndex,
  );

  for (const group of readingHosts.groupsAfter(primaryGroupId)) {
    await enqueueReadingForGroup(group.id, group.verses);
  }
}

/** Append a group's audio behind whatever is already queued. */
async function enqueueReadingForGroup(
  groupId: string,
  verses: VerseSummary[],
): Promise<void> {
  const settings = useSettingsStore.getState();
  const group = readingHosts.getGroup(groupId);
  const plan = buildPlaybackPlan(verses, {
    locale: settings.locale,
    readChapterHeadings: settings.readChapterHeadings,
    readVerseNumbers: settings.readVerseNumbers,
    verseNumberStyle: settings.verseNumberStyle,
    pauseBetweenVersesMs: settings.pauseBetweenVersesMs,
    pauseBetweenChaptersMs: settings.pauseBetweenChaptersMs,
    wholeChapter: group?.wholeChapter ?? false,
  });
  const readerVoice = effectiveReadingVoice();
  if (readingUsesBrowserVoice()) {
    void browserTts.enqueue(planToBrowserItems(plan, groupId));
    return;
  }
  await streamReading(
    plan,
    groupId,
    readerVoice as OpenAiVoiceId,
    effectiveVoiceStyle() || undefined,
    undefined,
    { mode: 'enqueue' },
  );
}

export function planToBrowserItems(plan: PlanItem[], groupId: string): BrowserTtsItem[] {
  return plan.map((it) => ({
    groupId,
    verseIndex: it.verseIndex,
    text: itemText(it),
    translation: it.kind === 'verse' ? it.verse.translation : it.translation,
    pauseAfterMs: it.pauseAfterMs,
    isVerse: it.kind === 'verse',
  }));
}

// How many verse-TTS requests to generate in parallel. The old sequential
// loop meant a long passage (e.g. a whole 29-verse chapter) finished its LAST
// verse's TTS before the FIRST could play — a multi-second silent gap before
// a continuation, scaling with passage length. A small pool keeps generation
// well ahead of playback while staying within sane backend/OpenAI concurrency.
const TTS_BUILD_CONCURRENCY = 4;

/**
 * Why a track didn't build. The distinction matters: an abort is the user
 * stopping, while a failure means TTS is unreachable — and in a fresh reading
 * that is the difference between "stop" and "play the whole passage with the
 * device voice instead of nothing at all".
 */
type BuildOutcome =
  | { ok: true; track: PlaybackTrack }
  | { ok: false; aborted: boolean };

async function buildTrack(
  it: PlanItem,
  groupId: string,
  voice: OpenAiVoiceId,
  voiceStyle: string | undefined,
  signal?: AbortSignal,
): Promise<BuildOutcome> {
  try {
    const tts =
      it.kind === 'verse'
        ? await postTts(
            {
              text: it.verse.text,
              voice,
              voiceStyle,
              translation: it.verse.translation,
              bookId: it.verse.bookId,
              chapter: it.verse.chapter,
              verse: it.verse.verse,
            },
            { signal },
          )
        : await postTtsSpeak(
            {
              text: it.text,
              voice,
              voiceStyle,
              language: localeForTranslation(it.translation),
            },
            { signal },
          );
    return {
      ok: true,
      track: {
        groupId,
        verseIndex: it.verseIndex,
        audioUrl: tts.audioUrl,
        alignmentUrl: tts.alignmentUrl,
        pauseAfterMs: it.pauseAfterMs,
        highlightVerse: it.kind === 'verse',
      },
    };
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === 'AbortError';
    if (!aborted) console.warn('tts failed', it.kind, e);
    return { ok: false, aborted };
  }
}

export async function planToOpenAiTracks(
  plan: PlanItem[],
  groupId: string,
  voice: OpenAiVoiceId,
  voiceStyle: string | undefined,
  signal?: AbortSignal,
): Promise<PlaybackTrack[]> {
  // Generate with bounded concurrency, preserving plan order via indexed
  // writes. A failed/aborted item leaves a null hole that is filtered out.
  const results: (PlaybackTrack | null)[] = new Array(plan.length).fill(null);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      if (signal?.aborted) return;
      const i = cursor++;
      if (i >= plan.length) return;
      const out = await buildTrack(plan[i], groupId, voice, voiceStyle, signal);
      results[i] = out.ok ? out.track : null;
    }
  };
  const poolSize = Math.min(TTS_BUILD_CONCURRENCY, plan.length);
  await Promise.all(Array.from({ length: poolSize }, () => worker()));
  return results.filter((t): t is PlaybackTrack => t !== null);
}

type StreamStart =
  | { mode: 'playQueue'; startWordIndex?: number }
  | { mode: 'enqueue' };

/**
 * Stream a reading into playback: build each verse's TTS in order and start the
 * FIRST as soon as it's ready (so the user hears verse 1 in ~one round-trip
 * instead of after the whole passage is generated), appending the rest as they
 * build. This is what keeps a long reading — or an auto-play continuation into
 * a whole chapter — from sitting silent while every verse is generated up front
 * (and it works even on a single-threaded backend).
 *
 * `start.mode` picks how the first track begins: `playQueue` hard-starts
 * (interrupt / tap-to-play), `enqueue` appends after the current playlist.
 * The feed is opened only once the first track is ready, so a previous
 * reading ending during the build still soft-ends (and auto-continues) normally.
 */
export async function streamReading(
  plan: PlanItem[],
  groupId: string,
  voice: OpenAiVoiceId,
  voiceStyle: string | undefined,
  signal: AbortSignal | undefined,
  start: StreamStart,
): Promise<void> {
  if (plan.length === 0) return;
  // The AI read path never goes through startPlaybackForVerses, so the
  // lock-screen label has to be published here too.
  const group = readingHosts.getGroup(groupId);
  if (group?.verses.length) publishNowPlaying(group.verses);
  let gen = -1;
  let started = false;
  try {
    for (const it of plan) {
      if (signal?.aborted) break;
      if (started && !audioPlayback.isFeed(gen)) break; // superseded / stopped
      const out = await buildTrack(it, groupId, voice, voiceStyle, signal);
      if (!out.ok) {
        // Nothing has played yet, this is a fresh user-initiated reading, and
        // TTS is unreachable (offline, backend down, no key, quota) — so every
        // remaining item would fail identically and the reading would be
        // silent. Hand the whole plan to the device voice instead.
        //
        // Guarded three ways on purpose. Not on abort (that's the user
        // stopping); not once a track has started, and not in enqueue mode,
        // because switching engines with audio already queued would leave
        // audioPlayback and browserTts talking over each other. In those cases
        // keep the old behaviour of skipping the item.
        if (!out.aborted && !started && start.mode === 'playQueue') {
          announceNarrationFallback();
          void browserTts.speakQueue(planToBrowserItems(plan, groupId));
          return;
        }
        continue;
      }
      const track = out.track;
      if (signal?.aborted) break;
      if (!started) {
        started = true;
        gen = audioPlayback.beginFeed();
        if (start.mode === 'playQueue') {
          void audioPlayback.playQueue([track], 0, start.startWordIndex);
        } else {
          void audioPlayback.enqueue([track]);
        }
      } else {
        audioPlayback.appendTracks([track], gen);
      }
    }
  } finally {
    if (started) audioPlayback.endFeed(gen);
  }
}

function itemText(it: PlanItem): string {
  return it.kind === 'verse' ? it.verse.text : it.text;
}

/**
 * Tap-a-word: start (or move) playback to a specific word of a specific verse.
 * Shared by the chat reader and the reader screen — three cases, cheapest first:
 *
 * 1. Already on that verse's track → just seek within it.
 * 2. Same group, verse still in the live queue → jump to it.
 * 3. Otherwise → (re)start the group from that verse.
 *
 * Browser TTS is checked first because it has no seek and no per-word timing at
 * all: `seekToWord` / `goToVerseIndex` only ever touch the audioPlayback queue,
 * so on that engine the honest behaviour is "start at the verse".
 */
export function playFromVerseWord(
  groupId: string,
  verses: VerseSummary[],
  verseIndex: number,
  wordIndex?: number,
): void {
  if (verses.length === 0) return;

  if (browserTts.isActive() || isBrowserVoice(effectiveReadingVoice())) {
    void startPlaybackForVerses(groupId, verses, verseIndex);
    return;
  }

  const current = usePlaybackStore.getState().current;
  const sameGroup = current?.groupId === groupId;
  if (sameGroup && current.verseIndex === verseIndex && current.isVerse) {
    if (wordIndex !== undefined) audioPlayback.seekToWord(wordIndex);
    return;
  }
  if (sameGroup && audioPlayback.goToVerseIndex(verseIndex, wordIndex)) return;
  void startReadingPlaylist(groupId, verses, verseIndex, wordIndex);
}
