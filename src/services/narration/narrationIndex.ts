import { db, type NarrationEntry } from '@/db/dexie';
import type { Translation } from '@/services/bible/bibleApi';
import { voiceKeyPart, type TtsVoice } from '@/services/voices/ttsVoice';

/**
 * Which narration audio the device already holds, and where it lives.
 *
 * Keyed by the *request* rather than the URL, because the request is what a
 * caller has in hand when it needs to know "can I play this without a network?".
 * The URLs are api.php's to define; recomputing its path scheme here would
 * duplicate it in two languages and break silently the day it changes. So they
 * are recorded verbatim after a successful download and read back as-is.
 *
 * The voice's part of every key is `voiceKeyPart` (services/voices/ttsVoice.ts),
 * which for an OpenAI voice is `${voice}|${style}` exactly as it always was —
 * so `v|echo||KJV|19|117|1` is still Psalm 117:1 in Echo, and every chapter
 * downloaded before voices had names still resolves. Announcement keys carry
 * the language too, because api.php hashes it into its own cache key.
 */

export function verseKey(
  voice: TtsVoice,
  translation: Translation,
  bookId: number,
  chapter: number,
  verse: number,
): string {
  return `v|${voiceKeyPart(voice)}|${translation}|${bookId}|${chapter}|${verse}`;
}

export function speakKey(voice: TtsVoice, language: string, text: string): string {
  return `s|${voiceKeyPart(voice)}|${language}|${text}`;
}

/** The key prefixes that are this voice's and nobody else's — for giving back
 * a voice's downloads when it is deleted. */
export function narrationKeyPrefixes(voice: TtsVoice): [string, string] {
  const part = voiceKeyPart(voice);
  return [`v|${part}|`, `s|${part}|`];
}

export async function getNarration(key: string): Promise<NarrationEntry | undefined> {
  try {
    return await db.narration.get(key);
  } catch {
    // A broken index must never break playback — the caller falls through to
    // the server, which is exactly what it would have done anyway.
    return undefined;
  }
}

export async function putNarration(
  key: string,
  audioUrl: string,
  alignmentUrl: string,
): Promise<void> {
  try {
    await db.narration.put({ key, audioUrl, alignmentUrl, savedAt: Date.now() });
  } catch {
    // Losing the index entry costs a re-download, not correctness.
  }
}

/** How many narration items are held — the count behind the Settings readout. */
export async function narrationCount(): Promise<number> {
  try {
    return await db.narration.count();
  } catch {
    return 0;
  }
}
