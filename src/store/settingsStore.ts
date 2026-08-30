import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Locale, VoiceId } from '@/types/domain';
import type { Translation } from '@/services/bible/bibleApi';
import type { ThemeChoice } from '@/lib/theme';
import {
  DEFAULT_READING_APPEARANCE,
  type ReadingAppearance,
} from '@/lib/readingAppearance';

export type MicCorner = 'tl' | 'tr' | 'bl' | 'br';
export type VerseNumberStyle = 'spoken' | 'plain';
export type AmbientSettings = {
  enabled: boolean;
  trackId: string | null;
  volume: number;
};

type SettingsState = {
  locale: Locale;
  /** 'system' follows the OS; 'light' / 'dark' override it. Defaults to 'dark',
   * which is what every existing install already looks like — the app was
   * dark-only until now, so anything else would restyle it underneath people. */
  theme: ThemeChoice;
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
  /** Chat view filter: when true, only reading (verse) messages render, for
   * a distraction-free reading view. */
  readingOnlyView: boolean;
  /** When true, the chat composer (text input + send) is hidden to free up
   * reading space; floaters drop down as bottomBarHeight goes to 0. */
  hideComposer: boolean;
  micSoundEnabled: boolean;
  /** The low drone under "the assistant is thinking". Off by default — it is a
   * deliberate ambience some people want and most don't, so it's opt-in.
   * Existing installs keep whatever they have: the v12 migration backfilled
   * `true` and is left alone, since there's no way to tell someone who chose it
   * from someone who just never turned it off. */
  thinkingSoundEnabled: boolean;
  readChapterHeadings: boolean;
  readVerseNumbers: boolean;
  /** 'spoken' → "Verse 16" / "Vers 16"; 'plain' → just "16". */
  verseNumberStyle: VerseNumberStyle;
  pauseBetweenVersesMs: number;
  pauseBetweenChaptersMs: number;
  /** When true, audio continues to the next chunk after a reading ends. */
  autoPlayReading: boolean;
  /** Reader screen: load the next/previous chapter as you scroll, instead of
   * turning one chapter at a time with the prev/next buttons. */
  readerEndlessScroll: boolean;
  /**
   * How the Bible text itself is printed — paper, ink, contrast, size, measure.
   * Applies to the reader column and to chat verse panels, never to app chrome:
   * the controls that undo an unreadable setting have to stay readable.
   *
   * Its default is a no-op (see DEFAULT_READING_APPEARANCE), so an install that
   * never opens the sheet looks exactly as it did before the feature existed.
   */
  readingAppearance: ReadingAppearance;
  /** Whether the server has a personal OpenAI key on file for this user.
   * Hydrated from auth.openaiKey.status on boot; transient (not persisted). */
  hasUserOpenAiKey: boolean;
  /** Masked preview of the stored key (e.g. "sk-…abc12"). Transient. */
  userOpenAiKeyMasked: string | null;
  /** Set when the user opts to fall back to the shared server key for this
   * session after their personal key failed. Transient — clears on reload. */
  sessionPreferSharedKey: boolean;
  /** True once the user has finished (or skipped) the first-run settings
   * wizard. Greenfield boots start at false; the v10→v11 migration
   * backfills true for existing installs so they never see the wizard. */
  onboardingComplete: boolean;
  /**
   * Whether the library is mirrored to the server for multi-device use and
   * backup. **Off by default** — the app is offline-first, and nothing is
   * stored server-side until the user asks for it (api.php creates the account
   * lazily, on the first write).
   *
   * Gates the network at two chokepoints only, libraryStore's flushQueue() and
   * pullFromServer(), plus whether local mutations are queued at all. Turning
   * it on later seeds the queue from what's already local — see
   * libraryStore.enableSync().
   *
   * The v13→v14 migration backfills `true`: every existing install already has
   * data on the server, and silently orphaning it would be the worst possible
   * reading of "offline-first".
   */
  syncEnabled: boolean;
  setLocale: (locale: Locale) => void;
  setTheme: (theme: ThemeChoice) => void;
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
  setReadingOnlyView: (v: boolean) => void;
  setHideComposer: (v: boolean) => void;
  setMicSoundEnabled: (v: boolean) => void;
  setThinkingSoundEnabled: (v: boolean) => void;
  setReadChapterHeadings: (v: boolean) => void;
  setReadVerseNumbers: (v: boolean) => void;
  setVerseNumberStyle: (v: VerseNumberStyle) => void;
  setPauseBetweenVersesMs: (v: number) => void;
  setPauseBetweenChaptersMs: (v: number) => void;
  setAutoPlayReading: (v: boolean) => void;
  setReaderEndlessScroll: (v: boolean) => void;
  setReadingAppearance: (patch: Partial<ReadingAppearance>) => void;
  resetReadingAppearance: () => void;
  setUserOpenAiKeyStatus: (hasKey: boolean, masked: string | null) => void;
  setSessionPreferSharedKey: (v: boolean) => void;
  setOnboardingComplete: (v: boolean) => void;
  setSyncEnabled: (v: boolean) => void;
};

/** Whether the user is currently using their own OpenAI key (server has it
 * on file, session hasn't opted into the shared fallback). Gates: which
 * voices appear in the Settings pickers, whether the voice-style input
 * shows, and what the runtime sends to OpenAI. */
export function hasActivePersonalKey(state: SettingsState): boolean {
  return state.hasUserOpenAiKey && !state.sessionPreferSharedKey;
}

/** Back-compat alias — older callers used readingVoicesUnlocked(). */
export const readingVoicesUnlocked = hasActivePersonalKey;

/** Reading-voice allowlist when locked (shared server key). Echo because
 * it's the canonical reading voice; browser for offline / API-free. */
const ALLOWED_READING_VOICES_SHARED: VoiceId[] = ['echo', 'browser'];

/** Assistant-voice allowlist when locked. Browser only — assistant chat
 * TTS via tts.speak is unbounded so we keep it free. */
const ALLOWED_ASSISTANT_VOICES_SHARED: VoiceId[] = ['browser'];

/** Pick the reading voice to use for an actual playback request. Returns
 * the stored value when unrestricted; otherwise force-resets the store to
 * 'echo' (per the user's preference: prune stale non-allowed values) and
 * returns 'echo'. Safe to call from outside React. */
export function effectiveReadingVoice(): VoiceId {
  const s = useSettingsStore.getState();
  if (hasActivePersonalKey(s)) return s.voice;
  if (ALLOWED_READING_VOICES_SHARED.includes(s.voice)) return s.voice;
  useSettingsStore.setState({ voice: 'echo' });
  return 'echo';
}

/** Counterpart for the assistant chat-reply voice. Force-resets to
 * 'browser' when locked, matching the picker's allowlist. */
export function effectiveAssistantVoice(): VoiceId {
  const s = useSettingsStore.getState();
  if (hasActivePersonalKey(s)) return s.assistantVoice;
  if (ALLOWED_ASSISTANT_VOICES_SHARED.includes(s.assistantVoice)) return s.assistantVoice;
  useSettingsStore.setState({ assistantVoice: 'browser' });
  return 'browser';
}

/** Voice-style is paid (OpenAI-only); we keep the stored value (typed
 * text is annoying to lose) but suppress it at runtime when locked so
 * nothing leaks into tts / tts.speak requests on the shared key. */
export function effectiveVoiceStyle(): string {
  const s = useSettingsStore.getState();
  return hasActivePersonalKey(s) ? s.voiceStyle : '';
}

const DEFAULT_AMBIENT: AmbientSettings = {
  enabled: false,
  trackId: null,
  volume: 0.3,
};

/**
 * Defaults to the two translations that ship inside the app, so a fresh
 * install can read scripture with no network and no download. Both are public
 * domain, which is also why they're the ones we're allowed to bundle.
 *
 * Existing users keep whatever they persisted — this only affects first run.
 * S00 / ESV remain one tap away in the translation picker.
 */
function defaultTranslationFor(locale: Locale): Translation {
  return locale === 'de' ? 'LUT' : 'KJV';
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
        theme: 'dark',
        translation: defaultTranslationFor(initialLocale),
        voice: 'echo',
        voiceStyle: '',
        // Defaults to 'browser' so fresh users on the shared key don't pay
        // for tts.speak. They can switch to an OpenAI voice once they
        // supply their own key.
        assistantVoice: 'browser',
        speakAssistant: true,
        useWhisperFallback: true,
        translationOverridden: false,
        micCorner: 'br',
        ambient: DEFAULT_AMBIENT,
        speechVolume: 1,
        autoScrollReader: true,
        readingOnlyView: false,
        hideComposer: false,
        micSoundEnabled: true,
        thinkingSoundEnabled: false,
        readChapterHeadings: false,
        readVerseNumbers: false,
        verseNumberStyle: 'spoken',
        pauseBetweenVersesMs: 0,
        pauseBetweenChaptersMs: 0,
        autoPlayReading: false,
        readerEndlessScroll: false,
        readingAppearance: DEFAULT_READING_APPEARANCE,
        hasUserOpenAiKey: false,
        userOpenAiKeyMasked: null,
        sessionPreferSharedKey: false,
        onboardingComplete: false,
        syncEnabled: false,
        setTheme: (theme) => set({ theme }),
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
        setReadingOnlyView: (readingOnlyView) => set({ readingOnlyView }),
        setHideComposer: (hideComposer) => set({ hideComposer }),
        setMicSoundEnabled: (micSoundEnabled) => set({ micSoundEnabled }),
        setThinkingSoundEnabled: (thinkingSoundEnabled) =>
          set({ thinkingSoundEnabled }),
        setReadChapterHeadings: (readChapterHeadings) =>
          set({ readChapterHeadings }),
        setReadVerseNumbers: (readVerseNumbers) => set({ readVerseNumbers }),
        setVerseNumberStyle: (verseNumberStyle) => set({ verseNumberStyle }),
        setPauseBetweenVersesMs: (v) =>
          set({ pauseBetweenVersesMs: Math.max(0, Math.min(6000, Math.round(v))) }),
        setPauseBetweenChaptersMs: (v) =>
          set({ pauseBetweenChaptersMs: Math.max(0, Math.min(10000, Math.round(v))) }),
        setAutoPlayReading: (autoPlayReading) => set({ autoPlayReading }),
        setReaderEndlessScroll: (readerEndlessScroll) =>
          set({ readerEndlessScroll }),
        // Patch-shaped like setAmbient: the sheet drives nine controls, and a
        // whole-object setter would make every one of them restate the rest.
        setReadingAppearance: (patch) =>
          set((s) => ({ readingAppearance: { ...s.readingAppearance, ...patch } })),
        resetReadingAppearance: () =>
          set({ readingAppearance: DEFAULT_READING_APPEARANCE }),
        setUserOpenAiKeyStatus: (hasKey, masked) =>
          set({ hasUserOpenAiKey: hasKey, userOpenAiKeyMasked: masked }),
        setSessionPreferSharedKey: (sessionPreferSharedKey) =>
          set({ sessionPreferSharedKey }),
        setOnboardingComplete: (onboardingComplete) =>
          set({ onboardingComplete }),
        // Callers should go through libraryStore.enableSync/disableSync, which
        // also seed or clear the queue — this only moves the flag.
        setSyncEnabled: (syncEnabled) => set({ syncEnabled }),
      };
    },
    {
      name: 'ba.settings',
      version: 16,
      // Don't persist server-derived state — hydrate fresh on every boot.
      // Otherwise an older "hasUserOpenAiKey: true" could outlive a key the
      // server has since cleared.
      partialize: (state) => {
        const { hasUserOpenAiKey, userOpenAiKeyMasked, sessionPreferSharedKey, ...rest } = state;
        void hasUserOpenAiKey;
        void userOpenAiKeyMasked;
        void sessionPreferSharedKey;
        return rest as SettingsState;
      },
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
        if (version < 9) {
          prev = {
            ...prev,
            readingOnlyView:
              typeof prev.readingOnlyView === 'boolean' ? prev.readingOnlyView : false,
          };
        }
        if (version < 10) {
          prev = {
            ...prev,
            hideComposer:
              typeof prev.hideComposer === 'boolean' ? prev.hideComposer : false,
          };
        }
        if (version < 11) {
          // Existing installs already chose their own settings; don't yank
          // them into the new wizard on first launch after upgrade.
          prev = { ...prev, onboardingComplete: true };
        }
        if (version < 12) {
          prev = {
            ...prev,
            thinkingSoundEnabled:
              typeof prev.thinkingSoundEnabled === 'boolean'
                ? prev.thinkingSoundEnabled
                : true,
          };
        }
        if (version < 13) {
          prev = {
            ...prev,
            readerEndlessScroll:
              typeof prev.readerEndlessScroll === 'boolean'
                ? prev.readerEndlessScroll
                : false,
          };
        }
        if (version < 14) {
          // Every install that reaches this migration predates the sync opt-in,
          // which means it already has cards and boards on the server. Default
          // it to on so nothing is orphaned; a fresh install starts at false.
          prev = { ...prev, syncEnabled: true };
        }
        if (version < 15) {
          // Explicitly 'dark', not 'system': the app had no light theme until
          // now, so every existing install is a dark-theme install. Defaulting
          // them to 'system' would repaint the app for anyone whose phone is in
          // light mode, which is not a change they asked for.
          prev = { ...prev, theme: 'dark' };
        }
        if (version < 16) {
          // Spread over the defaults rather than replacing, matching the v2
          // `ambient` block: a later build can add a field to the shape without
          // needing another migration to backfill it.
          prev = {
            ...prev,
            readingAppearance: {
              ...DEFAULT_READING_APPEARANCE,
              ...(prev.readingAppearance ?? {}),
            },
          };
        }
        return prev as SettingsState;
      },
    },
  ),
);
