import { apiPostJson } from './client';
import type { ElevenLabsSubscription } from './auth';

/**
 * The user's ElevenLabs account, through api.php — which holds the key, so
 * the app never does. Every call here spends the *user's* account (designing a
 * voice costs credits; listing does not), and every one answers
 * `elevenlabs_key_missing` when no key is on file.
 */

/** One voice in the user's ElevenLabs library, as api.php whitelists it. */
export type ElevenLabsLibraryVoice = {
  voiceId: string;
  name: string;
  /** premade | cloned | generated | professional | … */
  category: string;
  labels: {
    accent?: string;
    age?: string;
    gender?: string;
    descriptive?: string;
    useCase?: string;
  };
  description: string | null;
  /** ElevenLabs' own sample, free to play (https only, or null). */
  previewUrl: string | null;
  languages: {
    language: string;
    accent?: string;
    locale?: string;
    modelId?: string;
    previewUrl?: string | null;
  }[];
  isOwner: boolean;
};

export type ElevenLabsVoicePage = {
  voices: ElevenLabsLibraryVoice[];
  hasMore: boolean;
  nextPageToken: string | null;
};

/** Credits left this billing period. Needs the key's "user read" permission
 * (a restricted key narrates fine but can't show this). */
export function getElevenLabsSubscription(): Promise<{ subscription: ElevenLabsSubscription }> {
  return apiPostJson('elevenlabs.subscription', {});
}

export function listElevenLabsVoices(query: {
  search?: string;
  pageSize?: number;
  nextPageToken?: string;
}): Promise<ElevenLabsVoicePage> {
  return apiPostJson('elevenlabs.voices', query);
}

/** One candidate voice from a description. Not a voice yet — it becomes one
 * in the user's library only when saved. */
export type DesignedVoicePreview = {
  generatedVoiceId: string;
  /** MP3, base64. */
  audioBase64: string;
  mediaType: string;
  durationSecs: number;
  language: string;
};

/**
 * Three candidate voices for a description ("a warm, elderly narrator with a
 * gentle voice"). api.php supplies the sample text (Psalm 23, in `language`),
 * so what you hear is what reading scripture in it will sound like. Costs the
 * user credits.
 */
export function designElevenLabsVoice(query: {
  description: string;
  language: 'en' | 'de';
}): Promise<{ previews: DesignedVoicePreview[]; text: string }> {
  return apiPostJson('elevenlabs.design', query);
}

/** Keep one designed preview as a permanent voice in the user's ElevenLabs
 * library; its `voiceId` is then usable like any other. */
export function saveDesignedVoice(query: {
  generatedVoiceId: string;
  name: string;
  description: string;
}): Promise<{ voice: { voiceId: string; name: string; category: string; previewUrl: string | null } }> {
  return apiPostJson('elevenlabs.design.save', query);
}
