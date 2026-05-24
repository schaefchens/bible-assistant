import { apiPostJson } from './client';
import type { Translation } from '@/services/bible/bibleApi';
import type { OpenAiVoiceId } from '@/types/domain';

export type TtsResponse = {
  audioUrl: string;
  alignmentUrl: string;
  cached: boolean;
};

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
  return apiPostJson<TtsResponse>('tts', body, opts);
}

export function postTtsSpeak(
  body: {
    text: string;
    voice: OpenAiVoiceId;
    voiceStyle?: string;
  },
  opts?: { signal?: AbortSignal },
): Promise<TtsResponse> {
  return apiPostJson<TtsResponse>('tts.speak', body, opts);
}
