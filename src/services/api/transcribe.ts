import { apiPostForm } from './client';

export async function postTranscribe(audio: Blob, locale: 'en' | 'de'): Promise<{ text: string }> {
  const form = new FormData();
  form.append('audio', audio, 'speech.webm');
  form.append('language', locale);
  return apiPostForm<{ text: string }>('transcribe', form);
}
