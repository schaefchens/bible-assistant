import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Locale, VoiceId } from '@/types/domain';
import type { Translation } from '@/services/bible/bibleApi';
import { clamp, clamp01 } from '@/lib/math';
import type { ThemeChoice } from '@/lib/theme';
import {
  DEFAULT_READING_APPEARANCE,
  type ReadingAppearance,
} from '@/lib/readingAppearance';

/** The four free-floating slots. Still its own type: hit-testing a drop and
 * the corner anchoring genuinely only deal in these. */
export type MicCorner = 'tl' | 'tr' | 'bl' | 'br';
/** Where the mic dock lives. `'bar'` is the docked, full-width strip above the
 * bottom nav — in flow rather than floating, so it covers no content. The
 * persisted field is still called `micCorner`; renaming it would cost a
 * migration and buy nothing. */
export type MicPosition = MicCorner | 'bar';

/**
 * Where a *new* install puts the dock: docked, not floating. It covers no
 * content, its controls are laid out for a thumb, and it doesn't have to be
 * discovered — a floating capsule in a corner does.
 *
 * Deliberately not applied to existing installs. `micCorner` has been persisted
 * since v1 and is in `partialize`, so rehydration keeps whatever they chose (or
 * silently accepted) and no migration touches it — the same reasoning as the
 * v15 theme backfill: following a new default would rearrange the app for people
 * who never asked. The v<2 backfill below stays on `'br'` for that reason too.
 */
export const DEFAULT_MIC_POSITION: MicPosition = 'bar';
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
  micCorner: MicPosition;
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
  /**
   * Which version of the community content standards the user has accepted; 0
   * = never. Deliberately **not** backfilled by a migration: an install that
   * enabled the community before the standards existed has not seen them, and
   * the community screens gate on this rather than assume consent.
   */
  communityTermsVersion: number;
  /**
   * Whether the floating bug button is shown. **On by default**, including for
   * every existing install: the button is how the app asks for the feedback it
   * needs while it is being tested, and an off-by-default report channel
   * gathers nothing.
   *
   * No migration backfills it and the persist version is unchanged — zustand's
   * default merge is shallow, so a field absent from persisted state simply
   * keeps the initializer's value. A migration would have written `true` over
   * `true`.
   */
  feedbackEnabled: boolean;
  setLocale: (locale: Locale) => void;
  setTheme: (theme: ThemeChoice) => void;
  setTranslation: (translation: Translation, fromUser?: boolean) => void;
  setVoice: (voice: VoiceId) => void;
  setVoiceStyle: (style: string) => void;
  setAssistantVoice: (voice: VoiceId) => void;
  setSpeakAssistant: (value: boolean) => void;
  setUseWhisperFallback: (value: boolean) => void;
  setMicCorner: (position: MicPosition) => void;
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
  acceptCommunityTerms: (version: number) => void;
  setFeedbackEnabled: (v: boolean) => void;
};

/** Whether the user is currently using their own OpenAI key (server has it
 * on file, session hasn't opted into the shared fallback). Gates: which
 * voices appear in the Settings pickers, whether the voice-style input
 * shows, and what the runtime sends to OpenAI. */
export function hasActivePersonalKey(state: SettingsState): boolean {
  return state.hasUserOpenAiKey && !state.sessionPreferSharedKey;
}


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
        micCorner: DEFAULT_MIC_POSITION,
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
        communityTermsVersion: 0,
        feedbackEnabled: true,
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
        setSpeechVolume: (v) => set({ speechVolume: clamp01(v) }),
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
          set({ pauseBetweenVersesMs: clamp(Math.round(v), 0, 6000) }),
        setPauseBetweenChaptersMs: (v) =>
          set({ pauseBetweenChaptersMs: clamp(Math.round(v), 0, 10000) }),
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

        acceptCommunityTerms: (communityTermsVersion) => set({ communityTermsVersion }),

        setFeedbackEnabled: (feedbackEnabled) => set({ feedbackEnabled }),
      };
    },
    {
      name: 'ba.settings',
      version: 17,
      // Don't persist server-derived state — hydrate fresh on every boot.
      // Otherwise an older "hasUserOpenAiKey: true" could outlive a key the
      // server has since cleared.
      // `ignoreRestSiblings` (on in the recommended eslint preset) is what lets
      // these three be named only to be dropped.
      partialize: ({ hasUserOpenAiKey, userOpenAiKeyMasked, sessionPreferSharedKey, ...rest }) =>
        rest as SettingsState,
      /**
       * **Only fields whose default changed need a block here.**
       *
       * zustand's default `merge` is shallow, so a field that is simply absent
       * from persisted state already keeps the initializer's value — a
       * migration that backfills the same default writes `false` over `false`.
       * Eleven of these had accumulated (v3–v10, v12, v13, v15), one per field
       * added, all no-ops; they are gone, and the version number is not
       * rewound because the surviving blocks below are keyed off it.
       *
       * So: add a block when an *existing* install must end up with something
       * other than what a *fresh* install gets. Otherwise add the field to the
       * initializer and stop.
       */
      migrate: (persisted, version) => {
        let prev = (persisted as Partial<SettingsState>) ?? {};
        if (version < 2) {
          // Fresh installs dock the mic (DEFAULT_MIC_POSITION = 'bar'); an
          // install from before that keeps the corner it has always had.
          prev = {
            ...prev,
            micCorner: (prev.micCorner as MicPosition | undefined) ?? 'br',
            // Spread rather than replaced, so a later build can add a field to
            // the shape without needing another migration to backfill it.
            ambient: { ...DEFAULT_AMBIENT, ...(prev.ambient ?? {}) },
          };
        }
        if (version < 11) {
          // Existing installs already chose their own settings; don't yank
          // them into the new wizard on first launch after upgrade.
          prev = { ...prev, onboardingComplete: true };
        }
        if (version < 12) {
          // The one field an existing install gets *on* and a fresh one gets
          // off. Left alone since: there's no way to tell someone who chose the
          // thinking drone from someone who just never turned it off.
          prev = {
            ...prev,
            thinkingSoundEnabled:
              typeof prev.thinkingSoundEnabled === 'boolean'
                ? prev.thinkingSoundEnabled
                : true,
          };
        }
        if (version < 14) {
          // Every install that reaches this migration predates the sync opt-in,
          // which means it already has cards and boards on the server. Default
          // it to on so nothing is orphaned; a fresh install starts at false.
          prev = { ...prev, syncEnabled: true };
        }
        if (version < 16) {
          // Same spread-over-defaults reasoning as `ambient` above.
          prev = {
            ...prev,
            readingAppearance: {
              ...DEFAULT_READING_APPEARANCE,
              ...(prev.readingAppearance ?? {}),
            },
          };
        }
        if (version < 17) {
          // The two hue sliders became one colour per chip. Nothing to carry
          // over: a hue with no chroma to sit on described a different model,
          // and the chips' own defaults are a better starting point than a
          // half-translated one. Only the colour fields reset; size, spacing,
          // typeface, measure, columns and contrast are all kept.
          const { paperHue, inkHue, ...kept } =
            (prev.readingAppearance ?? {}) as ReadingAppearance & {
              paperHue?: unknown;
              inkHue?: unknown;
            };
          prev = {
            ...prev,
            readingAppearance: {
              ...DEFAULT_READING_APPEARANCE,
              ...kept,
              paperColors: {},
            },
          };
        }
        return prev as SettingsState;
      },
    },
  ),
);
