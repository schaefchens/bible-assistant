import { db, type NarrationEntry } from '@/db/dexie';
import type { Translation } from '@/services/bible/bibleApi';
import type { OpenAiVoiceId } from '@/types/domain';

/**
 * Which narration audio the device already holds, and where it lives.
 *
 * Keyed by the *request* rather than the URL, because the request is what a
 * caller has in hand when it needs to know "can I play this without a network?".
 * The URLs are api.php's to define; recomputing its path scheme here would
 * duplicate it in two languages and break silently the day it changes. So they
 * are recorded verbatim after a successful download and read back as-is.
 *
 * Announcement keys carry the voice style and language because api.php hashes
 * both into its own cache key — two readings of "Verse 16" with different styles
 * are different audio.
 */

export function verseKey(
  voice: OpenAiVoiceId,
  voiceStyle: string,
  translation: Translation,
  bookId: number,
  chapter: number,
  verse: number,
): string {
  return `v|${voice}|${voiceStyle}|${translation}|${bookId}|${chapter}|${verse}`;
}

export function speakKey(
  voice: OpenAiVoiceId,
  voiceStyle: string,
  language: string,
  text: string,
): string {
  return `s|${voice}|${voiceStyle}|${language}|${text}`;
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
