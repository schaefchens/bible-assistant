import { audioPlayback, type PlaybackTrack } from './audioPlaybackManager';
import { browserTts, type BrowserTtsItem } from './browserTts';
import {
  cachedNarrationFor,
  resolveNarrationFor,
} from '@/services/narration/narrationRequest';
import { getAmbientTrackUrl } from '@/services/api/ambient';
import { readingHosts } from './readingHosts';
import { usePlaybackStore } from '@/store/playbackStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { VerseSummary } from '@/types/domain';
import {
  isDeviceVoice,
  sameTtsVoice,
  ttsConcurrency,
  type TtsVoice,
} from '@/services/voices/ttsVoice';
import { providerFailureOf } from '@/services/api/client';
import { currentNarrationVoice, selectedNarrationVoice } from './narrationVoice';
import {
  buildPlaybackPlan,
  sliceFromVerseIndex,
  type PlanItem,
} from './playbackPlan';
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
 * the translation as the subtitle — or a post's title and author.
 *
 * Called from both reading entry points — `startPlaybackForVerses` (taps, the
 * transport, resume-last-reading) and `streamReading` (the AI `read_verses`
 * tool, which builds tracks from a plan and never goes through the former).
 */
export function publishNowPlaying(verses: VerseSummary[], startIndex = 0): void {
  const first = verses[startIndex] ?? verses[0];
  if (!first) return;
  // A post is titled, not referenced, and its subtitle is the person who wrote
  // it — `first.translation` is a stand-in for the voice language there (see
  // postUnits.ts) and would put "King James Version" under a blog post.
  if (first.unit) {
    audioPlayback.setNowPlaying(first.unit.title, first.unit.author || undefined);
    return;
  }
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
 * Whether every item in `plan` can be narrated with no network at all.
 *
 * All-or-nothing on purpose: a partial hit would read the downloaded verses in
 * the premium voice and skip the rest, leaving holes in the middle of a chapter.
 * Reading all of it in the device voice is worse-sounding but whole.
 */
async function planFullyCached(plan: PlanItem[], voice: TtsVoice): Promise<boolean> {
  for (const it of plan) {
    if (!(await cachedNarrationFor(it, voice))) return false;
  }
  return true;
}

/**
 * Which voice reads this plan — a narration voice, or `null` for the device
 * voice.
 *
 * In order:
 *
 * 1. **The voice the user chose, if the whole plan is already downloaded in
 *    it.** Playing what is on the device costs nothing, so it plays even when
 *    this session could not *generate* in that voice: offline, or in the
 *    moment after boot before the key status has arrived — which would
 *    otherwise read a chapter someone downloaded in their own voice in Echo.
 * 2. Otherwise the voice this session resolves to (the chosen one if it can
 *    speak, else its fallback), when online.
 * 3. Offline, that voice still — if the plan is fully downloaded in it.
 * 4. Otherwise the device voice. Being offline with nothing downloaded would
 *    make every `buildTrack()` fail and the reading play *nothing at all*; the
 *    device voice is worse-sounding but whole.
 *
 * All-or-nothing on purpose (see `planFullyCached`): a partial hit would read
 * the downloaded verses in one voice and skip the rest.
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
 */
export async function readingTtsVoice(plan: PlanItem[]): Promise<TtsVoice | null> {
  const chosen = selectedNarrationVoice();
  const resolved = currentNarrationVoice();
  if (!isDeviceVoice(chosen) && chosen !== resolved && (await planFullyCached(plan, chosen))) {
    return chosen;
  }
  if (isDeviceVoice(resolved)) return null;
  if (!definitelyOffline()) return resolved;
  if (await planFullyCached(plan, resolved)) return resolved;
  announceNarrationFallback();
  return null;
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

  const voice = await readingTtsVoice(plan);
  if (!voice) {
    const items = planToBrowserItems(plan, groupId);
    void browserTts.speakQueue(items);
    return;
  }

  // Stream so the requested verse starts playing after one TTS round-trip;
  // startWordIndex only applies when the first plan item is a verse track.
  // Awaited so startReadingPlaylist sequences subsequent readings AFTER this
  // one's stream rather than letting their feeds supersede it mid-build.
  const firstIsVerse = plan[0]?.kind === 'verse';
  await streamReading(plan, groupId, voice, undefined, {
    mode: 'playQueue',
    startWordIndex: firstIsVerse ? startWordIndex : undefined,
  });
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
  const voice = await readingTtsVoice(plan);
  if (!voice) {
    void browserTts.enqueue(planToBrowserItems(plan, groupId));
    return;
  }
  await streamReading(plan, groupId, voice, undefined, { mode: 'enqueue' });
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

/**
 * Why a track didn't build. The distinction matters: an abort is the user
 * stopping, while a failure means TTS is unreachable — and in a fresh reading
 * that is the difference between "stop" and "play the whole passage with the
 * device voice instead of nothing at all". A *provider* failure (the ElevenLabs
 * key refused, the credits gone, the voice missing) is a third case: the voice
 * cannot speak this session, but its fallback can, so the reading continues in
 * that instead of skipping every remaining verse.
 */
type BuildOutcome =
  | { ok: true; track: PlaybackTrack }
  | { ok: false; aborted: boolean; providerFailure: boolean };

async function buildTrack(
  it: PlanItem,
  groupId: string,
  voice: TtsVoice,
  signal?: AbortSignal,
): Promise<BuildOutcome> {
  try {
    // Through the narration resolver, not straight to api.php: an already-
    // downloaded verse resolves from the local index with no request at all,
    // which is what makes a downloaded chapter playable offline.
    // Which narration path an item takes — reference-keyed for scripture,
    // text-keyed for a post paragraph or an announcement — lives in
    // services/narration/narrationRequest.ts, because the offline download has
    // to make exactly the same choice or the two disagree about cache keys.
    //
    // Note `highlightVerse` stays `kind === 'verse'`, which now includes post
    // paragraphs. That flag suppresses the per-word tick for *announcements*,
    // whose alignment maps onto nothing rendered; a post paragraph is rendered
    // verbatim, so its highlighting is exactly as valid as a verse's.
    const ref = await resolveNarrationFor(it, voice, signal);
    return {
      ok: true,
      track: {
        groupId,
        verseIndex: it.verseIndex,
        audioUrl: ref.audioUrl,
        alignmentUrl: ref.alignmentUrl,
        pauseAfterMs: it.pauseAfterMs,
        highlightVerse: it.kind === 'verse',
      },
    };
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === 'AbortError';
    if (!aborted) console.warn('tts failed', it.kind, e);
    return { ok: false, aborted, providerFailure: providerFailureOf(e) !== null };
  }
}

/**
 * Build a whole plan's tracks at once — the prefetch and the mid-reading
 * rebuild, where nothing plays until all of it is ready.
 *
 * Bounded concurrency (`ttsConcurrency`): the old sequential loop meant a long
 * passage finished its LAST verse's TTS before the FIRST could play, and an
 * unbounded one would trip the smaller ElevenLabs tiers' concurrency limits —
 * a refused request is a silent hole in a chapter.
 */
export async function planToTtsTracks(
  plan: PlanItem[],
  groupId: string,
  voice: TtsVoice,
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
      const out = await buildTrack(plan[i], groupId, voice, signal);
      results[i] = out.ok ? out.track : null;
    }
  };
  const poolSize = Math.min(ttsConcurrency(voice), plan.length);
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
  voice: TtsVoice,
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
  // The voice can change once, mid-reading: when the provider refuses it
  // (ElevenLabs credits run out halfway through a chapter, say), the failure
  // watcher has already recorded why by the time the error reaches here, so
  // re-resolving yields the fallback — and the rest of the chapter is read in
  // that rather than skipped verse by verse. Once, because a second refusal
  // means the fallback is not the answer either.
  let speaking = voice;
  let rerouted = false;
  try {
    for (const it of plan) {
      if (signal?.aborted) break;
      if (started && !audioPlayback.isFeed(gen)) break; // superseded / stopped
      let out = await buildTrack(it, groupId, speaking, signal);
      if (!out.ok && out.providerFailure && !rerouted) {
        rerouted = true;
        const fallback = currentNarrationVoice();
        if (!isDeviceVoice(fallback) && !sameTtsVoice(fallback, speaking)) {
          speaking = fallback;
          out = await buildTrack(it, groupId, speaking, signal);
        }
      }
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

  if (browserTts.isActive() || isDeviceVoice(currentNarrationVoice())) {
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
