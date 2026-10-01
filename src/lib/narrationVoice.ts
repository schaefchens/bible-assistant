import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { SpeechVoice } from '@/services/voices/ttsVoice';
import {
  resolveVoice,
  selectedVoice,
  voiceAccessOf,
  type VoiceResolutionInput,
} from '@/services/voices/voiceProfiles';

/**
 * Which voice speaks, for code outside React — playback, auto-play, the
 * assistant's spoken replies, the eyes-free labels.
 *
 * The *choice* lives in the library (it syncs); what this session may *spend*
 * lives in settings (key status, a failure this session). The rule that joins
 * them is pure and lives in services/voices/voiceProfiles.ts; this reads both
 * stores and asks it. Components use hooks/useSpeechVoice.ts instead, for the
 * reactivity.
 *
 * Nothing here writes. The voice settings this replaced used to *reset* the
 * stored choice whenever the key looked unavailable — which on an offline
 * cold start, before key status arrives, forgot a custom voice for good.
 */

function resolutionInput(): VoiceResolutionInput {
  const library = useLibraryStore.getState();
  return {
    voices: library.voices,
    selection: library.voiceSelection,
    access: voiceAccessOf(useSettingsStore.getState()),
  };
}

/** The voice that reads scripture, posts and announcements right now. */
export function currentNarrationVoice(): SpeechVoice {
  return resolveVoice('narration', resolutionInput());
}

/** The voice that speaks the assistant's replies and the eyes-free labels. */
export function currentAssistantVoice(): SpeechVoice {
  return resolveVoice('assistant', resolutionInput());
}

/**
 * The narration voice the user *chose*, whether or not this session can pay
 * for it. Only for playing what is already downloaded: a chapter held in that
 * voice costs nothing to play, so it should play even before key status
 * arrives, or offline. See `readingTtsVoice`.
 */
export function selectedNarrationVoice(): SpeechVoice {
  return selectedVoice('narration', resolutionInput());
}
