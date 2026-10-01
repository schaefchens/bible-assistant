import {
  ELEVEN_DEFAULTS,
  normalizeTtsVoice,
  type ElevenModel,
  type OpenAiVoiceId,
  type TtsVoice,
} from '@/services/voices/ttsVoice';
import type { VoiceProfile } from '@/services/voices/voiceProfiles';

/**
 * The voice editor's working copy — and the two pure questions asked of it.
 *
 * Holds *both* providers' fields at once, so switching OpenAI ⇄ ElevenLabs
 * and back loses nothing the user set; only the chosen provider's fields
 * become the saved config (`draftConfig`), and of those only the ones the
 * model uses (`normalizeTtsVoice` drops a v4 voice's style and speed).
 *
 * A `.ts` file because a `.tsx` may export components only.
 */
export type VoiceDraftState = {
  name: string;
  avatar?: string;
  provider: 'openai' | 'elevenlabs';
  openai: { voice: OpenAiVoiceId; style: string };
  elevenlabs: {
    /** Null until a voice is picked from the library or designed. */
    voiceId: string | null;
    sourceName: string;
    previewUrl: string | null;
    model: ElevenModel;
    stability: number;
    similarity: number;
    style: number;
    speed: number;
    /** A designed voice the user chose but that is not in their ElevenLabs
     * library yet — Save adds it there first, which yields the `voiceId`. */
    pendingDesign?: { generatedVoiceId: string; description: string; audioBase64: string };
  };
};

const EMPTY_ELEVENLABS: VoiceDraftState['elevenlabs'] = {
  voiceId: null,
  sourceName: '',
  previewUrl: null,
  model: 'eleven_v4',
  ...ELEVEN_DEFAULTS,
};

/** The draft for a voice being edited, or for a new one. A new voice starts
 * on marin — OpenAI's best — or on ElevenLabs when that is the only key. */
export function draftFrom(
  profile: VoiceProfile | undefined,
  startWith: 'openai' | 'elevenlabs' = 'openai',
): VoiceDraftState {
  if (!profile) {
    return {
      name: '',
      provider: startWith,
      openai: { voice: 'marin', style: '' },
      elevenlabs: EMPTY_ELEVENLABS,
    };
  }
  const c = profile.config;
  return {
    name: profile.name,
    avatar: profile.avatar,
    provider: c.provider,
    openai: c.provider === 'openai' ? { voice: c.voice, style: c.style } : { voice: 'marin', style: '' },
    elevenlabs:
      c.provider === 'elevenlabs'
        ? {
            ...EMPTY_ELEVENLABS,
            voiceId: c.voiceId,
            sourceName: profile.sourceName ?? '',
            model: c.model,
            stability: c.stability,
            similarity: c.similarity,
            ...(c.model === 'eleven_multilingual_v2' ? { style: c.style, speed: c.speed } : {}),
          }
        : EMPTY_ELEVENLABS,
  };
}

/**
 * The audible config the draft describes, or `null` when it does not describe
 * one yet (an ElevenLabs draft with no voice picked). A pending designed voice
 * has no id until Save, so it previews from its own sample instead.
 */
export function draftConfig(d: VoiceDraftState): TtsVoice | null {
  if (d.provider === 'openai') {
    return normalizeTtsVoice({ provider: 'openai', voice: d.openai.voice, style: d.openai.style });
  }
  const e = d.elevenlabs;
  if (!e.voiceId) return null;
  return normalizeTtsVoice({
    provider: 'elevenlabs',
    voiceId: e.voiceId,
    model: e.model,
    stability: e.stability,
    similarity: e.similarity,
    style: e.style,
    speed: e.speed,
  });
}
