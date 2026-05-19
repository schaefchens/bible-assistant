import { audioPlayback, type PlaybackTrack } from './audioPlaybackManager';
import { postTts } from '@/services/api/tts';
import { useSettingsStore } from '@/store/settingsStore';
import type { VerseSummary } from '@/types/domain';

export async function startPlaybackForVerses(
  messageId: string,
  verses: VerseSummary[],
  startIndex = 0,
): Promise<void> {
  if (verses.length === 0) return;
  const { voice, voiceStyle } = useSettingsStore.getState();
  audioPlayback.ensureContext();
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
    void audioPlayback.playQueue(tracks, startIndex);
  }
}
