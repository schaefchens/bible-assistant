import { apiPostForm } from './client';
import { micFileNameFor } from '@/lib/micRecord';

export async function postTranscribe(audio: Blob, locale: 'en' | 'de'): Promise<{ text: string }> {
  const form = new FormData();
  form.append('audio', audio, micFileNameFor(audio.type));
  form.append('language', locale);
  return apiPostForm<{ text: string }>('transcribe', form);
}
