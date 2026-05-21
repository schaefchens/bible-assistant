import { audioPlayback, type PlaybackTrack } from './audioPlaybackManager';
import { postTts } from '@/services/api/tts';
import { getAmbientTrackUrl } from '@/services/api/ambient';
import { useSettingsStore } from '@/store/settingsStore';
import type { VerseSummary } from '@/types/domain';

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
  const { voice, voiceStyle } = useSettingsStore.getState();
  audioPlayback.ensureContext();
  startAmbientIfEnabled();
  const tracks: PlaybackTrack[] = [];
  for (let i = 0; i < verses.length; i++) {
    const v = verses[i];
    try {
      const r = await postTts({
        text: v.text,
        voice,
        voiceStyle: voiceStyle || undefined,
        translation: v.translation,
        bookId: v.bookId,
        chapter: v.chapter,
        verse: v.verse,
      });
      tracks.push({
        messageId,
        verseIndex: i,
        audioUrl: r.audioUrl,
        alignmentUrl: r.alignmentUrl,
      });
    } catch (e) {
      console.warn('tts failed', e);
    }
  }
  if (tracks.length > 0) {
    void audioPlayback.playQueue(tracks, startIndex, startWordIndex);
  }
}
