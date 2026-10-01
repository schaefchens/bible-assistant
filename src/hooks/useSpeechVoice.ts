import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { SpeechVoice } from '@/services/voices/ttsVoice';
import {
  resolveVoice,
  selectedVoice,
  voiceAvailability,
  type VoiceAvailability,
  type VoiceResolutionInput,
  type VoiceRole,
} from '@/services/voices/voiceProfiles';

/**
 * The voice a role speaks in, reactively — lib/narrationVoice.ts for
 * components.
 *
 * Each store field is its own selector (primitives, or arrays and objects the
 * stores only replace on change), and the pure resolver runs during render.
 * It returns a shared constant or a profile's own config object, so the result
 * is reference-stable and safe in a dependency list.
 */
function useResolutionInput(): VoiceResolutionInput {
  const voices = useLibraryStore((s) => s.voices);
  const selection = useLibraryStore((s) => s.voiceSelection);
  const openAiKey = useSettingsStore((s) => s.hasUserOpenAiKey && !s.sessionPreferSharedKey);
  const elevenLabsKey = useSettingsStore((s) => s.hasUserElevenLabsKey);
  const elevenLabsFailure = useSettingsStore((s) => s.elevenLabsFailure);
  return { voices, selection, access: { openAiKey, elevenLabsKey, elevenLabsFailure } };
}

/** The voice that reads, right now. */
export function useNarrationVoice(): SpeechVoice {
  return resolveVoice('narration', useResolutionInput());
}

/** The voice that speaks replies, right now. */
export function useAssistantVoice(): SpeechVoice {
  return resolveVoice('assistant', useResolutionInput());
}

/**
 * Everything a voice picker needs about one role: the selected id, the voice
 * it names, whether it can speak right now, and what actually speaks instead.
 */
export function useVoiceSelection(role: VoiceRole): {
  id: string;
  chosen: SpeechVoice;
  availability: VoiceAvailability;
  speaking: SpeechVoice;
} {
  const input = useResolutionInput();
  const chosen = selectedVoice(role, input);
  return {
    id: input.selection[role],
    chosen,
    availability: voiceAvailability(role, chosen, input.access),
    speaking: resolveVoice(role, input),
  };
}
