import { useCommunityStore } from '@/store/communityStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { sharedRefOf, type SpeechVoice } from '@/services/voices/ttsVoice';
import { voiceCoversSubject } from '@/services/voices/voiceSharing';
import type { NarrationSubject } from '@/services/narration/narrationDownload';
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
  const shared = useCommunityStore((s) => s.mirroredVoices);
  const selection = useLibraryStore((s) => s.voiceSelection);
  const openAiKey = useSettingsStore((s) => s.hasUserOpenAiKey && !s.sessionPreferSharedKey);
  const elevenLabsKey = useSettingsStore((s) => s.hasUserElevenLabsKey);
  const elevenLabsFailure = useSettingsStore((s) => s.elevenLabsFailure);
  const sharedFailures = useSettingsStore((s) => s.sharedVoiceFailures);
  return {
    voices,
    shared,
    selection,
    access: { openAiKey, elevenLabsKey, elevenLabsFailure, sharedFailures },
  };
}

/** The voice that reads, right now. */
export function useNarrationVoice(): SpeechVoice {
  return resolveVoice('narration', useResolutionInput());
}

/**
 * Which voice would narrate a download, reactively: the narration voice —
 * unless it is a voice somebody shared that was not lent for this subject (a
 * piece, on a voice shared for scripture), in which case what would read
 * without it. A function, because one group download covers chapters and
 * pieces alike; call it during render.
 */
export function useNarrationVoiceFor(): (subject: NarrationSubject) => SpeechVoice {
  const input = useResolutionInput();
  const voice = resolveVoice('narration', input);
  return (subject) => {
    const ref = sharedRefOf(voice);
    if (!ref || voiceCoversSubject(ref, subject)) return voice;
    return resolveVoice('narration', { ...input, shared: input.shared.filter((m) => m.itemId !== ref.itemId) });
  };
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
