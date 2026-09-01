import { localeForTranslation } from '@/lib/translationLocaleMap';
import type { PlanItem } from '@/lib/playbackPlan';
import type { OpenAiVoiceId } from '@/types/domain';
import { speakKey, verseKey } from './narrationIndex';
import {
  cachedNarrationSource,
  resolveSpeechNarration,
  resolveVerseNarration,
  type NarrationRef,
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

export function narrationKeyFor(
  it: PlanItem,
  voice: OpenAiVoiceId,
  voiceStyle: string,
): string {
  if (it.kind === 'verse' && !isPostItem(it)) {
    return verseKey(
      voice,
      voiceStyle,
      it.verse.translation,
      it.verse.bookId,
      it.verse.chapter,
      it.verse.verse,
    );
  }
  const text = it.kind === 'verse' ? it.verse.text : it.text;
  return speakKey(voice, voiceStyle, languageOf(it), text);
}

export function resolveNarrationFor(
  it: PlanItem,
  voice: OpenAiVoiceId,
  voiceStyle: string,
  signal?: AbortSignal,
): Promise<NarrationRef> {
  if (it.kind === 'verse' && !isPostItem(it)) {
    return resolveVerseNarration(
      {
        voice,
        voiceStyle,
        text: it.verse.text,
        translation: it.verse.translation,
        bookId: it.verse.bookId,
        chapter: it.verse.chapter,
        verse: it.verse.verse,
      },
      signal,
    );
  }
  return resolveSpeechNarration(
    {
      voice,
      voiceStyle,
      language: languageOf(it),
      text: it.kind === 'verse' ? it.verse.text : it.text,
    },
    signal,
  );
}

/**
 * Is this item already in the local cache, with no request?
 *
 * The same three-way branch as {@link resolveNarrationFor}, and it has to be:
 * `readingUsesBrowserVoice` uses this to decide "offline, but fully downloaded,
 * so play the premium narration anyway". Asking the *verse* source about a post
 * paragraph misses every time, and a downloaded post would silently drop to the
 * device voice the moment the network went away.
 */
export async function cachedNarrationFor(
  it: PlanItem,
  voice: OpenAiVoiceId,
  voiceStyle: string,
): Promise<NarrationRef | null> {
  if (it.kind === 'verse' && !isPostItem(it)) {
    return cachedNarrationSource.getVerse({
      voice,
      voiceStyle,
      text: it.verse.text,
      translation: it.verse.translation,
      bookId: it.verse.bookId,
      chapter: it.verse.chapter,
      verse: it.verse.verse,
    });
  }
  return cachedNarrationSource.getSpeech({
    voice,
    voiceStyle,
    language: languageOf(it),
    text: it.kind === 'verse' ? it.verse.text : it.text,
  });
}
