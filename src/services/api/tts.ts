import { apiPostJson } from './client';
import { serverUrl } from './origin';
import type { Translation } from '@/services/bible/bibleApi';
import type { OpenAiVoiceId } from '@/types/domain';

export type TtsResponse = {
  audioUrl: string;
  alignmentUrl: string;
  cached: boolean;
};

/**
 * api.php returns root-relative media URLs ('/assistant/storage/audio/…'),
 * which don't resolve under capacitor://localhost. Absolutizing once here —
 * at the boundary where the URLs enter the app — means every consumer
 * (audioPlaybackManager, alignment, speakLabel, usePreviewVoice) keeps
 * fetching them verbatim. No-op on the web build.
 */
function absolutize(r: TtsResponse): TtsResponse {
  return {
    ...r,
    audioUrl: serverUrl(r.audioUrl),
    alignmentUrl: serverUrl(r.alignmentUrl),
  };
}

export function postTts(
  body: {
    text: string;
    voice: OpenAiVoiceId;
    voiceStyle?: string;
    translation: Translation;
    bookId: number;
    chapter: number;
    verse: number;
  },
  opts?: { signal?: AbortSignal },
): Promise<TtsResponse> {
  return apiPostJson<TtsResponse>('tts', body, opts).then(absolutize);
}

export function postTtsSpeak(
  body: {
    text: string;
    voice: OpenAiVoiceId;
    voiceStyle?: string;
    /** ISO-639-1 language code hint ("en" | "de"). Helps the model lock in
     * pronunciation on short announcements like "Vers 16". */
    language?: 'en' | 'de';
  },
  opts?: { signal?: AbortSignal },
): Promise<TtsResponse> {
  return apiPostJson<TtsResponse>('tts.speak', body, opts).then(absolutize);
}
