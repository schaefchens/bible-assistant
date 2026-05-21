import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Locale, VoiceId } from '@/types/domain';
import type { Translation } from '@/services/bible/bibleApi';

export type MicCorner = 'tl' | 'tr' | 'bl' | 'br';
export type AmbientSettings = {
  enabled: boolean;
  trackId: string | null;
  volume: number;
};

type SettingsState = {
  locale: Locale;
  translation: Translation;
  voice: VoiceId;
  voiceStyle: string;
  assistantVoice: VoiceId;
  speakAssistant: boolean;
  useWhisperFallback: boolean;
  translationOverridden: boolean;
  micCorner: MicCorner;
  ambient: AmbientSettings;
  setLocale: (locale: Locale) => void;
  setTranslation: (translation: Translation, fromUser?: boolean) => void;
  setVoice: (voice: VoiceId) => void;
  setVoiceStyle: (style: string) => void;
  setAssistantVoice: (voice: VoiceId) => void;
  setSpeakAssistant: (value: boolean) => void;
  setUseWhisperFallback: (value: boolean) => void;
  setMicCorner: (corner: MicCorner) => void;
  setAmbient: (patch: Partial<AmbientSettings>) => void;
};

const DEFAULT_AMBIENT: AmbientSettings = {
  enabled: false,
  trackId: null,
  volume: 0.3,
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
        micCorner: 'br',
        ambient: DEFAULT_AMBIENT,
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
        setMicCorner: (micCorner) => set({ micCorner }),
        setAmbient: (patch) => set((s) => ({ ambient: { ...s.ambient, ...patch } })),
      };
    },
    {
      name: 'ba.settings',
      version: 2,
      migrate: (persisted, version) => {
        const prev = (persisted as Partial<SettingsState>) ?? {};
        if (version < 2) {
          return {
            ...prev,
            micCorner: (prev.micCorner as MicCorner | undefined) ?? 'br',
            ambient: { ...DEFAULT_AMBIENT, ...(prev.ambient ?? {}) },
          };
        }
        return prev as SettingsState;
      },
    },
  ),
);
