import type { TFunction } from 'i18next';
import type { SpeechVoice } from '@/services/voices/ttsVoice';
import { defaultVoiceName, type VoiceAvailability } from '@/services/voices/voiceProfiles';

/**
 * The second line under a voice's name — what it *is*: "OpenAI · Marin",
 * "ElevenLabs · George · v4", "On this device · works offline".
 *
 * Takes `t` from the calling component rather than importing i18n, so it
 * follows that component's language re-render. A `.ts` file because a `.tsx`
 * may export components only.
 */
export function voiceSubtitle(voice: SpeechVoice, sourceName: string | undefined, t: TFunction): string {
  if (voice.provider === 'device') return t('narrationVoices.subtitle.device');
  if (voice.provider === 'openai') {
    const base = defaultVoiceName(voice);
    return voice.style
      ? t('narrationVoices.subtitle.openaiStyled', { voice: base })
      : t('narrationVoices.subtitle.openai', { voice: base });
  }
  return t('narrationVoices.subtitle.elevenlabs', {
    voice: sourceName || 'ElevenLabs',
    model: voice.model === 'eleven_v4' ? 'v4' : 'Multilingual v2',
  });
}

/** Why a chosen voice is not the one speaking, said plainly — or null. */
export function unavailableReason(availability: VoiceAvailability, t: TFunction): string | null {
  switch (availability) {
    case 'ok':
      return null;
    case 'needs-openai-key':
      return t('narrationVoices.locked.openai');
    case 'needs-elevenlabs-key':
      return t('narrationVoices.locked.elevenlabs');
    case 'elevenlabs-failed':
      return t('narrationVoices.locked.failed');
  }
}
