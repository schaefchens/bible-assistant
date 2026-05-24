import { audioPlayback, type PlaybackTrack } from './audioPlaybackManager';
import { browserTts, type BrowserTtsItem } from './browserTts';
import { postTts, postTtsSpeak } from '@/services/api/tts';
import { getAmbientTrackUrl } from '@/services/api/ambient';
import { useChatStore } from '@/store/chatStore';
import { useSettingsStore } from '@/store/settingsStore';
import { isBrowserVoice, type OpenAiVoiceId, type VerseSummary } from '@/types/domain';
import {
  buildPlaybackPlan,
  sliceFromVerseIndex,
  type PlanItem,
} from './playbackPlan';

/**
 * Fire-and-forget: if the user has ambient music enabled, load the selected
 * track (cached after first run) and start it. Safe to call repeatedly —
 * `_ambientPlay()` no-ops while a source is already running.
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

  const fullPlan = buildPlaybackPlan(verses, {
    locale: settings.locale,
    readChapterHeadings: settings.readChapterHeadings,
    readVerseNumbers: settings.readVerseNumbers,
    verseNumberStyle: settings.verseNumberStyle,
    pauseBetweenVersesMs: settings.pauseBetweenVersesMs,
    pauseBetweenChaptersMs: settings.pauseBetweenChaptersMs,
  });
  const plan = sliceFromVerseIndex(fullPlan, startIndex);

  if (isBrowserVoice(settings.voice)) {
    const items = planToBrowserItems(plan, messageId);
    void browserTts.speakQueue(items);
    return;
  }

  const tracks = await planToOpenAiTracks(
    plan,
    messageId,
    settings.voice as OpenAiVoiceId,
    settings.voiceStyle || undefined,
    undefined,
  );
  if (tracks.length > 0) {
    // The plan's first item is the requested start verse (or its
    // announcement) so the queue starts at index 0; startWordIndex only
    // applies if that first item is a verse track.
    const firstIsVerse = plan[0]?.kind === 'verse';
    void audioPlayback.playQueue(
      tracks,
      0,
      firstIsVerse ? startWordIndex : undefined,
    );
  }
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
  const plan = buildPlaybackPlan(verses, {
    locale: settings.locale,
    readChapterHeadings: settings.readChapterHeadings,
    readVerseNumbers: settings.readVerseNumbers,
    verseNumberStyle: settings.verseNumberStyle,
    pauseBetweenVersesMs: settings.pauseBetweenVersesMs,
    pauseBetweenChaptersMs: settings.pauseBetweenChaptersMs,
  });
  if (isBrowserVoice(settings.voice)) {
    void browserTts.enqueue(planToBrowserItems(plan, messageId));
    return;
  }
  const tracks = await planToOpenAiTracks(
    plan,
    messageId,
    settings.voice as OpenAiVoiceId,
    settings.voiceStyle || undefined,
    undefined,
  );
  if (tracks.length > 0) {
    void audioPlayback.enqueue(tracks);
  }
}

export function planToBrowserItems(plan: PlanItem[], messageId: string): BrowserTtsItem[] {
  return plan.map((it) => ({
    messageId,
    verseIndex: it.verseIndex,
    text: itemText(it),
    translation: it.kind === 'verse' ? it.verse.translation : it.translation,
    pauseAfterMs: it.pauseAfterMs,
  }));
}

export async function planToOpenAiTracks(
  plan: PlanItem[],
  messageId: string,
  voice: OpenAiVoiceId,
  voiceStyle: string | undefined,
  signal?: AbortSignal,
): Promise<PlaybackTrack[]> {
  const tracks: PlaybackTrack[] = [];
  for (const it of plan) {
    if (signal?.aborted) break;
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
          : await postTtsSpeak({ text: it.text, voice, voiceStyle }, { signal });
      tracks.push({
        messageId,
        verseIndex: it.verseIndex,
        audioUrl: tts.audioUrl,
        alignmentUrl: tts.alignmentUrl,
        pauseAfterMs: it.pauseAfterMs,
        highlightVerse: it.kind === 'verse',
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') break;
      console.warn('tts failed', it.kind, e);
    }
  }
  return tracks;
}

function itemText(it: PlanItem): string {
  return it.kind === 'verse' ? it.verse.text : it.text;
}
