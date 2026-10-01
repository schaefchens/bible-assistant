import { apiPostJson } from './client';
import { serverUrl } from './origin';
import type { Translation } from '@/services/bible/bibleApi';
import { ttsSpeakBody, ttsVerseBody, type TtsVoice } from '@/services/voices/ttsVoice';

type TtsResponse = {
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

/**
 * Narrate one verse, keyed by its reference. The body is built by
 * `ttsVerseBody` — for an OpenAI voice it is byte for byte the body this app
 * has always sent, which is what keeps the server's warm cache warm.
 */
export function postTts(
  req: {
    text: string;
    voice: TtsVoice;
    translation: Translation;
    bookId: number;
    chapter: number;
    verse: number;
  },
  opts?: { signal?: AbortSignal },
): Promise<TtsResponse> {
  const { voice, ...verse } = req;
  return apiPostJson<TtsResponse>('tts', ttsVerseBody(voice, verse), opts).then(absolutize);
}

export function postTtsSpeak(
  req: {
    text: string;
    voice: TtsVoice;
    /** ISO-639-1 language code hint ("en" | "de"). Helps the model lock in
     * pronunciation on short announcements like "Vers 16". */
    language?: 'en' | 'de';
  },
  opts?: { signal?: AbortSignal },
): Promise<TtsResponse> {
  const { voice, ...speech } = req;
  return apiPostJson<TtsResponse>('tts.speak', ttsSpeakBody(voice, speech), opts).then(
    absolutize,
  );
}
