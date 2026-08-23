import { postTts, postTtsSpeak } from '@/services/api/tts';
import { isCached } from '@/lib/mediaCache';
import type { Translation } from '@/services/bible/bibleApi';
import type { OpenAiVoiceId } from '@/types/domain';
import { getNarration, putNarration, speakKey, verseKey } from './narrationIndex';

/** Where a piece of narration's audio and word-alignment live. */
export type NarrationRef = { audioUrl: string; alignmentUrl: string };

export type VerseNarrationRequest = {
  voice: OpenAiVoiceId;
  voiceStyle: string;
  text: string;
  translation: Translation;
  bookId: number;
  chapter: number;
  verse: number;
};

export type SpeechNarrationRequest = {
  voice: OpenAiVoiceId;
  voiceStyle: string;
  language: 'en' | 'de';
  text: string;
};

/**
 * A place narration can come from.
 *
 * `null` means "I don't have this" — try the next source. A thrown error means
 * "I should have had this and failed", and is preserved so callers still see a
 * real ApiError. Same contract as `services/bible/chapterSources.ts`, on purpose:
 * this is the audio counterpart of that resolver.
 */
export interface NarrationSource {
  readonly name: string;
  getVerse(req: VerseNarrationRequest, signal?: AbortSignal): Promise<NarrationRef | null>;
  getSpeech(req: SpeechNarrationRequest, signal?: AbortSignal): Promise<NarrationRef | null>;
}

/* ------------------------------------------------------------------ cached -- */

/**
 * Narration already on the device, resolved with **no** call to api.php.
 *
 * This is the point of the whole seam. Previously every verse had to ask the
 * server for its URL before mediaCache could be consulted, so a chapter whose
 * audio was sitting in IndexedDB was still unplayable on a plane.
 *
 * Two conditions, both required: an index entry (so we know the URLs without
 * reinventing api.php's path scheme) and the bytes actually present (so a
 * cleared cache or an evicted row can't make us promise audio we don't have).
 */
async function fromIndex(key: string): Promise<NarrationRef | null> {
  const entry = await getNarration(key);
  if (!entry) return null;
  // Both files: playing audio whose alignment is missing would silently lose
  // word highlighting, which is most of the reason the alignment exists.
  const [audio, alignment] = await Promise.all([
    isCached(entry.audioUrl),
    isCached(entry.alignmentUrl),
  ]);
  if (!audio || !alignment) return null;
  return { audioUrl: entry.audioUrl, alignmentUrl: entry.alignmentUrl };
}

export const cachedNarrationSource: NarrationSource = {
  name: 'cached',
  getVerse(req) {
    return fromIndex(
      verseKey(req.voice, req.voiceStyle, req.translation, req.bookId, req.chapter, req.verse),
    );
  },
  getSpeech(req) {
    return fromIndex(speakKey(req.voice, req.voiceStyle, req.language, req.text));
  },
};

/* ------------------------------------------------------------------ server -- */

/**
 * Generate (or fetch the server's cached copy of) narration via api.php.
 *
 * Records what it learns in the narration index — the response is the only
 * authoritative source of these URLs, so this is the cheapest possible place to
 * capture them. The bytes stay *unpinned*: a verse played in passing is fair
 * game for LRU eviction, and the index entry is guarded by the isCached() check
 * above, so it can never outlive them into a false offline promise.
 */
export const serverTtsSource: NarrationSource = {
  name: 'server',
  async getVerse(req, signal) {
    const tts = await postTts(
      {
        text: req.text,
        voice: req.voice,
        voiceStyle: req.voiceStyle || undefined,
        translation: req.translation,
        bookId: req.bookId,
        chapter: req.chapter,
        verse: req.verse,
      },
      { signal },
    );
    await putNarration(
      verseKey(req.voice, req.voiceStyle, req.translation, req.bookId, req.chapter, req.verse),
      tts.audioUrl,
      tts.alignmentUrl,
    );
    return { audioUrl: tts.audioUrl, alignmentUrl: tts.alignmentUrl };
  },
  async getSpeech(req, signal) {
    const tts = await postTtsSpeak(
      {
        text: req.text,
        voice: req.voice,
        voiceStyle: req.voiceStyle || undefined,
        language: req.language,
      },
      { signal },
    );
    await putNarration(
      speakKey(req.voice, req.voiceStyle, req.language, req.text),
      tts.audioUrl,
      tts.alignmentUrl,
    );
    return { audioUrl: tts.audioUrl, alignmentUrl: tts.alignmentUrl };
  },
};

/* ---------------------------------------------------------------- resolver -- */

const SOURCES: NarrationSource[] = [cachedNarrationSource, serverTtsSource];

export async function resolveVerseNarration(
  req: VerseNarrationRequest,
  signal?: AbortSignal,
): Promise<NarrationRef> {
  return resolve((src) => src.getVerse(req, signal));
}

export async function resolveSpeechNarration(
  req: SpeechNarrationRequest,
  signal?: AbortSignal,
): Promise<NarrationRef> {
  return resolve((src) => src.getSpeech(req, signal));
}

async function resolve(
  get: (src: NarrationSource) => Promise<NarrationRef | null>,
): Promise<NarrationRef> {
  let lastError: unknown;
  for (const source of SOURCES) {
    try {
      const ref = await get(source);
      if (ref) return ref;
    } catch (e) {
      lastError = e;
    }
  }
  // Preserve the original failure (usually an ApiError, or an AbortError) so
  // startPlayback can still tell "the user stopped" from "TTS is unreachable".
  throw lastError ?? new Error('no narration source could resolve this item');
}
