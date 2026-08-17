import { audioPlayback, type PlaybackTrack } from './audioPlaybackManager';
import { browserTts, type BrowserTtsItem } from './browserTts';
import { postTts, postTtsSpeak } from '@/services/api/tts';
import { getAmbientTrackUrl } from '@/services/api/ambient';
import { useChatStore } from '@/store/chatStore';
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

export async function startPlaybackForVerses(
  messageId: string,
  verses: VerseSummary[],
  startIndex = 0,
  startWordIndex?: number,
): Promise<void> {
  if (verses.length === 0) return;
  const settings = useSettingsStore.getState();
  audioPlayback.ensureContext();
  startAmbientIfEnabled();

  publishNowPlaying(verses, startIndex);

  const msg = useChatStore.getState().messages.find((m) => m.id === messageId);
  const fullPlan = buildPlaybackPlan(verses, {
    locale: settings.locale,
    readChapterHeadings: settings.readChapterHeadings,
    readVerseNumbers: settings.readVerseNumbers,
    verseNumberStyle: settings.verseNumberStyle,
    pauseBetweenVersesMs: settings.pauseBetweenVersesMs,
    pauseBetweenChaptersMs: settings.pauseBetweenChaptersMs,
    wholeChapter: msg?.headingWholeChapter ?? false,
  });
  const plan = sliceFromVerseIndex(fullPlan, startIndex);

  const readerVoice = effectiveReadingVoice();
  if (isBrowserVoice(readerVoice)) {
    const items = planToBrowserItems(plan, messageId);
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
    messageId,
    readerVoice as OpenAiVoiceId,
    effectiveVoiceStyle() || undefined,
    undefined,
    { mode: 'playQueue', startWordIndex: firstIsVerse ? startWordIndex : undefined },
  );
}

/**
 * Tap-to-play entry point used by the message bubbles. Plays the requested
 * message's verses, then continues into every subsequent message in the
 * chat that has verses — so the user can go back to an earlier reading and
 * the rest of the chat's readings still play in order, as a playlist.
 *
 * `startIndex` / `startWordIndex` apply only to the primary message.
 */
export async function startReadingPlaylist(
  primaryMessageId: string,
  primaryVerses: VerseSummary[],
  startIndex = 0,
  startWordIndex?: number,
): Promise<void> {
  if (primaryVerses.length === 0) return;
  await startPlaybackForVerses(
    primaryMessageId,
    primaryVerses,
    startIndex,
    startWordIndex,
  );

  const messages = useChatStore.getState().messages;
  const startMsgIdx = messages.findIndex((m) => m.id === primaryMessageId);
  if (startMsgIdx < 0) return;
  for (let i = startMsgIdx + 1; i < messages.length; i++) {
    const m = messages[i];
    if (!m.verses || m.verses.length === 0) continue;
    await enqueueReadingForMessage(m.id, m.verses);
  }
}

async function enqueueReadingForMessage(
  messageId: string,
  verses: VerseSummary[],
): Promise<void> {
  const settings = useSettingsStore.getState();
  const msg = useChatStore.getState().messages.find((m) => m.id === messageId);
  const plan = buildPlaybackPlan(verses, {
    locale: settings.locale,
    readChapterHeadings: settings.readChapterHeadings,
    readVerseNumbers: settings.readVerseNumbers,
    verseNumberStyle: settings.verseNumberStyle,
    pauseBetweenVersesMs: settings.pauseBetweenVersesMs,
    pauseBetweenChaptersMs: settings.pauseBetweenChaptersMs,
    wholeChapter: msg?.headingWholeChapter ?? false,
  });
  const readerVoice = effectiveReadingVoice();
  if (isBrowserVoice(readerVoice)) {
    void browserTts.enqueue(planToBrowserItems(plan, messageId));
    return;
  }
  await streamReading(
    plan,
    messageId,
    readerVoice as OpenAiVoiceId,
    effectiveVoiceStyle() || undefined,
    undefined,
    { mode: 'enqueue' },
  );
}

export function planToBrowserItems(plan: PlanItem[], messageId: string): BrowserTtsItem[] {
  return plan.map((it) => ({
    messageId,
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

async function buildTrack(
  it: PlanItem,
  messageId: string,
  voice: OpenAiVoiceId,
  voiceStyle: string | undefined,
  signal?: AbortSignal,
): Promise<PlaybackTrack | null> {
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
      messageId,
      verseIndex: it.verseIndex,
      audioUrl: tts.audioUrl,
      alignmentUrl: tts.alignmentUrl,
      pauseAfterMs: it.pauseAfterMs,
      highlightVerse: it.kind === 'verse',
    };
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return null;
    console.warn('tts failed', it.kind, e);
    return null;
  }
}

export async function planToOpenAiTracks(
  plan: PlanItem[],
  messageId: string,
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
      results[i] = await buildTrack(plan[i], messageId, voice, voiceStyle, signal);
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
  messageId: string,
  voice: OpenAiVoiceId,
  voiceStyle: string | undefined,
  signal: AbortSignal | undefined,
  start: StreamStart,
): Promise<void> {
  if (plan.length === 0) return;
  // The AI read path never goes through startPlaybackForVerses, so the
  // lock-screen label has to be published here too. The verses live on the
  // chat message this reading belongs to.
  const readingMsg = useChatStore.getState().messages.find((m) => m.id === messageId);
  if (readingMsg?.verses?.length) publishNowPlaying(readingMsg.verses);
  let gen = -1;
  let started = false;
  try {
    for (const it of plan) {
      if (signal?.aborted) break;
      if (started && !audioPlayback.isFeed(gen)) break; // superseded / stopped
      const track = await buildTrack(it, messageId, voice, voiceStyle, signal);
      if (!track) continue;
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
