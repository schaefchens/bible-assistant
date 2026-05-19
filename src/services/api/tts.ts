import { apiPostJson } from './client';
import type { Translation } from '@/services/bible/bibleApi';
import type { VoiceId } from '@/types/domain';

export type TtsResponse = {
  audioUrl: string;
  alignmentUrl: string;
  cached: boolean;
};

export function postTts(body: {
  text: string;
  voice: VoiceId;
  voiceStyle?: string;
  translation: Translation;
  bookId: number;
  chapter: number;
  verse: number;
}): Promise<TtsResponse> {
  return apiPostJson<TtsResponse>('tts', body);
}

export function postTtsSpeak(body: {
  text: string;
  voice: VoiceId;
  voiceStyle?: string;
}): Promise<TtsResponse> {
  return apiPostJson<TtsResponse>('tts.speak', body);
}
