import { localeForTranslation } from '@/lib/translationLocaleMap';
import type { PlanItem } from '@/lib/playbackPlan';
import type { OpenAiVoiceId } from '@/types/domain';
import { speakKey, verseKey } from './narrationIndex';
import {
  cachedNarrationSource,
  resolveSpeechNarration,
  resolveVerseNarration,
  type NarrationRef,
  type SpeechNarrationRequest,
  type VerseNarrationRequest,
} from './narrationSources';

/**
 * How one plan item is addressed in the narration cache, and how it is fetched.
 *
 * There are three kinds of item and they do not map onto `PlanItem['kind']`:
 *
 * - a **Bible verse** is keyed by its reference, which is what lets a
 *   downloaded chapter resolve offline with no call to api.php;
 * - a **post paragraph** is also `kind: 'verse'` — it is a `VerseSummary`, the
 *   currency of the whole playback path — but it has no reference to be keyed
 *   by. It goes down the text-addressed speech path, which is also why one
 *   reader's narration is free for the next: api.php caches speech under a
 *   sha256 of the text, shared across users, exactly as it does verse audio;
 * - an **announcement** (a heading, a verse number) is text with no reference
 *   at all.
 *
 * Playback and the offline download both need this distinction, and they must
 * agree: a key computed one way here and another way there means a chapter the
 * user downloaded is silently re-fetched, or worse, a post's audio is filed
 * under a scripture reference that does not exist. So it lives once.
 */

/** True when this item is a paragraph of user-written prose. */
export function isPostItem(it: PlanItem): boolean {
  return it.kind === 'verse' && it.verse.unit !== undefined;
}

/** The language to speak an item in. A post carries its own; scripture takes
 * the language of its translation, not the UI locale. */
function languageOf(it: PlanItem): 'en' | 'de' {
  if (it.kind === 'verse') {
    return it.verse.unit?.language ?? localeForTranslation(it.verse.translation);
  }
  return localeForTranslation(it.translation);
}

/**
 * **The one place a plan item is classified**, as a request one of the two
 * narration sources can take directly.
 *
 * The three functions below — the cache key, the fetch, the offline check —
 * used to open with the same `it.kind === 'verse' && !isPostItem(it)` test and
 * then rebuild the same request object by hand. Three copies of a rule whose
 * whole job is that playback, the download and the coverage check agree: a key
 * computed one way in one of them means a downloaded chapter is silently
 * re-fetched, or a post's audio is filed under a scripture reference that does
 * not exist. Now they share a `switch` and can't drift.
 */
export type NarrationRequest =
  /** Keyed by its reference — what lets a downloaded chapter resolve offline. */
  | { addressed: 'reference'; verse: VerseNarrationRequest }
  /** Keyed by a sha256 of the text: a post paragraph, or an announcement. */
  | { addressed: 'text'; speech: SpeechNarrationRequest };

export function narrationRequestFor(
  it: PlanItem,
  voice: OpenAiVoiceId,
  voiceStyle: string,
): NarrationRequest {
  if (it.kind === 'verse' && !isPostItem(it)) {
    return {
      addressed: 'reference',
      verse: {
        voice,
        voiceStyle,
        text: it.verse.text,
        translation: it.verse.translation,
        bookId: it.verse.bookId,
        chapter: it.verse.chapter,
        verse: it.verse.verse,
      },
    };
  }
  return {
    addressed: 'text',
    speech: {
      voice,
      voiceStyle,
      language: languageOf(it),
      text: it.kind === 'verse' ? it.verse.text : it.text,
    },
  };
}

/** How this item is addressed in the narration index. */
export function narrationKeyFor(
  it: PlanItem,
  voice: OpenAiVoiceId,
  voiceStyle: string,
): string {
  const req = narrationRequestFor(it, voice, voiceStyle);
  return req.addressed === 'reference'
    ? verseKey(
        voice,
        voiceStyle,
        req.verse.translation,
        req.verse.bookId,
        req.verse.chapter,
        req.verse.verse,
      )
    : speakKey(voice, voiceStyle, req.speech.language, req.speech.text);
}

/** Fetch it, generating on the server if it isn't cached anywhere. */
export function resolveNarrationFor(
  it: PlanItem,
  voice: OpenAiVoiceId,
  voiceStyle: string,
  signal?: AbortSignal,
): Promise<NarrationRef> {
  const req = narrationRequestFor(it, voice, voiceStyle);
  return req.addressed === 'reference'
    ? resolveVerseNarration(req.verse, signal)
    : resolveSpeechNarration(req.speech, signal);
}

/**
 * Is this item already in the local cache, with no request?
 *
 * `readingUsesBrowserVoice` uses this to decide "offline, but fully
 * downloaded, so play the premium narration anyway" — which is why it has to
 * classify the item exactly as the fetch does. Asking the *verse* source about
 * a post paragraph misses every time, and a downloaded post would silently
 * drop to the device voice the moment the network went away.
 */
export function cachedNarrationFor(
  it: PlanItem,
  voice: OpenAiVoiceId,
  voiceStyle: string,
): Promise<NarrationRef | null> {
  const req = narrationRequestFor(it, voice, voiceStyle);
  return req.addressed === 'reference'
    ? cachedNarrationSource.getVerse(req.verse)
    : cachedNarrationSource.getSpeech(req.speech);
}
