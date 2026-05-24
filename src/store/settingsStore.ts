import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Locale, VoiceId } from '@/types/domain';
import type { Translation } from '@/services/bible/bibleApi';

export type MicCorner = 'tl' | 'tr' | 'bl' | 'br';
export type VerseNumberStyle = 'spoken' | 'plain';
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
  speechVolume: number;
  autoScrollReader: boolean;
  micSoundEnabled: boolean;
  readChapterHeadings: boolean;
  readVerseNumbers: boolean;
  /** 'spoken' → "Verse 16" / "Vers 16"; 'plain' → just "16". */
  verseNumberStyle: VerseNumberStyle;
  pauseBetweenVersesMs: number;
  pauseBetweenChaptersMs: number;
  /** When true, audio continues to the next chunk after a reading ends. */
  autoPlayReading: boolean;
  setLocale: (locale: Locale) => void;
  setTranslation: (translation: Translation, fromUser?: boolean) => void;
  setVoice: (voice: VoiceId) => void;
  setVoiceStyle: (style: string) => void;
  setAssistantVoice: (voice: VoiceId) => void;
  setSpeakAssistant: (value: boolean) => void;
  setUseWhisperFallback: (value: boolean) => void;
  setMicCorner: (corner: MicCorner) => void;
  setAmbient: (patch: Partial<AmbientSettings>) => void;
  setSpeechVolume: (v: number) => void;
  setAutoScrollReader: (v: boolean) => void;
  setMicSoundEnabled: (v: boolean) => void;
  setReadChapterHeadings: (v: boolean) => void;
  setReadVerseNumbers: (v: boolean) => void;
  setVerseNumberStyle: (v: VerseNumberStyle) => void;
  setPauseBetweenVersesMs: (v: number) => void;
  setPauseBetweenChaptersMs: (v: number) => void;
  setAutoPlayReading: (v: boolean) => void;
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
        voice: 'echo',
        voiceStyle: '',
        assistantVoice: 'echo',
        speakAssistant: true,
        useWhisperFallback: true,
        translationOverridden: false,
        micCorner: 'br',
        ambient: DEFAULT_AMBIENT,
        speechVolume: 1,
        autoScrollReader: true,
        micSoundEnabled: true,
        readChapterHeadings: false,
        readVerseNumbers: false,
        verseNumberStyle: 'spoken',
        pauseBetweenVersesMs: 0,
        pauseBetweenChaptersMs: 0,
        autoPlayReading: false,
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
        setSpeechVolume: (v) =>
          set({ speechVolume: Math.max(0, Math.min(1, v)) }),
        setAutoScrollReader: (autoScrollReader) => set({ autoScrollReader }),
        setMicSoundEnabled: (micSoundEnabled) => set({ micSoundEnabled }),
        setReadChapterHeadings: (readChapterHeadings) =>
          set({ readChapterHeadings }),
        setReadVerseNumbers: (readVerseNumbers) => set({ readVerseNumbers }),
        setVerseNumberStyle: (verseNumberStyle) => set({ verseNumberStyle }),
        setPauseBetweenVersesMs: (v) =>
          set({ pauseBetweenVersesMs: Math.max(0, Math.min(6000, Math.round(v))) }),
        setPauseBetweenChaptersMs: (v) =>
          set({ pauseBetweenChaptersMs: Math.max(0, Math.min(10000, Math.round(v))) }),
        setAutoPlayReading: (autoPlayReading) => set({ autoPlayReading }),
      };
    },
    {
      name: 'ba.settings',
      version: 8,
      migrate: (persisted, version) => {
        let prev = (persisted as Partial<SettingsState>) ?? {};
        if (version < 2) {
          prev = {
            ...prev,
            micCorner: (prev.micCorner as MicCorner | undefined) ?? 'br',
            ambient: { ...DEFAULT_AMBIENT, ...(prev.ambient ?? {}) },
          };
        }
        if (version < 3) {
          prev = {
            ...prev,
            speechVolume: typeof prev.speechVolume === 'number' ? prev.speechVolume : 1,
          };
        }
        if (version < 4) {
          prev = {
            ...prev,
            autoScrollReader:
              typeof prev.autoScrollReader === 'boolean' ? prev.autoScrollReader : true,
          };
        }
        if (version < 5) {
          prev = {
            ...prev,
            micSoundEnabled:
              typeof prev.micSoundEnabled === 'boolean' ? prev.micSoundEnabled : true,
          };
        }
        if (version < 6) {
          prev = {
            ...prev,
            readChapterHeadings:
              typeof prev.readChapterHeadings === 'boolean' ? prev.readChapterHeadings : false,
            readVerseNumbers:
              typeof prev.readVerseNumbers === 'boolean' ? prev.readVerseNumbers : false,
            pauseBetweenVersesMs:
              typeof prev.pauseBetweenVersesMs === 'number' ? prev.pauseBetweenVersesMs : 0,
            pauseBetweenChaptersMs:
              typeof prev.pauseBetweenChaptersMs === 'number' ? prev.pauseBetweenChaptersMs : 0,
          };
        }
        if (version < 7) {
          prev = {
            ...prev,
            verseNumberStyle:
              prev.verseNumberStyle === 'plain' || prev.verseNumberStyle === 'spoken'
                ? prev.verseNumberStyle
                : 'spoken',
          };
        }
        if (version < 8) {
          prev = {
            ...prev,
            autoPlayReading:
              typeof prev.autoPlayReading === 'boolean' ? prev.autoPlayReading : false,
          };
        }
        return prev as SettingsState;
      },
    },
  ),
);
