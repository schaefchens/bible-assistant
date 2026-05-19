import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Locale, VoiceId } from '@/types/domain';
import type { Translation } from '@/services/bible/bibleApi';

type SettingsState = {
  locale: Locale;
  translation: Translation;
  voice: VoiceId;
  voiceStyle: string;
  assistantVoice: VoiceId;
  speakAssistant: boolean;
  useWhisperFallback: boolean;
  translationOverridden: boolean;
  setLocale: (locale: Locale) => void;
  setTranslation: (translation: Translation, fromUser?: boolean) => void;
  setVoice: (voice: VoiceId) => void;
  setVoiceStyle: (style: string) => void;
  setAssistantVoice: (voice: VoiceId) => void;
  setSpeakAssistant: (value: boolean) => void;
  setUseWhisperFallback: (value: boolean) => void;
};

function defaultTranslationFor(locale: Locale): Translation {
  return locale === 'de' ? 'S00' : 'ESV';
}

function detectLocale(): Locale {
  if (typeof navigator !== 'undefined') {
    const code = navigator.language.toLowerCase();
    if (code.startsWith('de')) return 'de';
  }
  return 'en';
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => {
      const initialLocale = detectLocale();
      return {
        locale: initialLocale,
        translation: defaultTranslationFor(initialLocale),
        voice: 'alloy',
        voiceStyle: '',
        assistantVoice: 'sage',
        speakAssistant: true,
        useWhisperFallback: true,
        translationOverridden: false,
        setLocale: (locale) =>
          set((s) => ({
            locale,
            translation: s.translationOverridden ? s.translation : defaultTranslationFor(locale),
          })),
        setTranslation: (translation, fromUser = true) =>
          set(() => ({
            translation,
            translationOverridden: fromUser,
          })),
        setVoice: (voice) => set({ voice }),
        setVoiceStyle: (voiceStyle) => set({ voiceStyle }),
        setAssistantVoice: (assistantVoice) => set({ assistantVoice }),
        setSpeakAssistant: (speakAssistant) => set({ speakAssistant }),
        setUseWhisperFallback: (useWhisperFallback) => set({ useWhisperFallback }),
      };
    },
    {
      name: 'ba.settings',
    },
  ),
);
