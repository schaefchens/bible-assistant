import { db } from '@/db/dexie';
import { fetchCached, isCached } from '@/lib/mediaCache';
import { buildPlaybackPlan, type PlanItem } from '@/lib/playbackPlan';
import type { Translation } from '@/services/bible/bibleApi';
import { loadChapterSummaries } from '@/services/bible/verseSummaries';
import { useSettingsStore } from '@/store/settingsStore';
import type { OpenAiVoiceId } from '@/types/domain';
import { getNarration } from './narrationIndex';
import { narrationKeyFor, resolveNarrationFor } from './narrationRequest';

/**
 * Download one chapter's narration for offline listening.
 *
 * Chapter granularity, not book: a chapter averages ~26 verses (a few MB and a
 * few cents), while a book runs to 2,461 verses for Psalms — half an hour of
 * per-verse TTS plus forced alignment, and a bill to match. Reading happens a
 * chapter at a time anyway.
 *
 * What gets downloaded is exactly what the current settings would *play*,
 * announcements included. That keeps a user who reads without announcements
 * from paying to generate 27 clips they will never hear. The flip side is that
 * changing announcement settings afterwards leaves those few items to come from
 * the network; the verses, which is what "downloaded" means to anyone, are
 * unaffected.
 */

export type ChapterNarrationProgress = {
  done: number;
  total: number;
};

export type ChapterCoverage = 'missing' | 'partial' | 'installed';

/** Identity of a downloaded chapter. Includes the voice: narration is per-voice,
 * and a chapter held in Echo says nothing about the same chapter in Nova. */
export function chapterNarrationKey(
  voice: OpenAiVoiceId,
  translation: Translation,
  bookId: number,
  chapter: number,
): string {
  return `${voice}|${translation}|${bookId}|${chapter}`;
}

/** Build the plan for a whole chapter, the way playback would. */
async function planForChapter(
  translation: Translation,
  bookId: number,
  chapter: number,
): Promise<PlanItem[]> {
  const settings = useSettingsStore.getState();
  // getChapter beneath this is memoized and in-flight-deduped, so calling it
  // again for a coverage check right after a download costs nothing.
  const summaries = await loadChapterSummaries(translation, bookId, chapter, settings.locale);
  if (summaries.length === 0) return [];
  return buildPlaybackPlan(summaries, {
    locale: settings.locale,
    readChapterHeadings: settings.readChapterHeadings,
    readVerseNumbers: settings.readVerseNumbers,
    verseNumberStyle: settings.verseNumberStyle,
    pauseBetweenVersesMs: settings.pauseBetweenVersesMs,
    pauseBetweenChaptersMs: settings.pauseBetweenChaptersMs,
    wholeChapter: true,
  });
}

/**
 * How much of this chapter is already playable offline.
 *
 * Counts only the *verses*: they are what "downloaded" means to a reader, and
 * scoring announcements too would flip a fully-downloaded chapter to 'partial'
 * the moment someone toggled verse numbers on.
 */
export async function chapterCoverage(
  voice: OpenAiVoiceId,
  voiceStyle: string,
  translation: Translation,
  bookId: number,
  chapter: number,
): Promise<ChapterCoverage> {
  let plan: PlanItem[];
  try {
    plan = await planForChapter(translation, bookId, chapter);
  } catch {
    // Can't read the text (missing chapter, no pack, offline) — nothing to say.
    return 'missing';
  }
  const verses = plan.filter((it) => it.kind === 'verse');
  if (verses.length === 0) return 'missing';

  let have = 0;
  for (const it of verses) {
    const entry = await getNarration(narrationKeyFor(it, voice, voiceStyle));
    if (entry && (await isCached(entry.audioUrl))) have++;
  }
  if (have === 0) return 'missing';
  return have === verses.length ? 'installed' : 'partial';
}

/**
 * Generation runs one item at a time rather than the 4-wide pool playback uses.
 * Nothing is waiting to be heard here, and each item is a TTS call plus a forced
 * alignment on the shared backend — the polite choice is not to open four of
 * those per tap while someone else may be trying to listen.
 */
export async function downloadChapterNarration(
  voice: OpenAiVoiceId,
  voiceStyle: string,
  translation: Translation,
  bookId: number,
  chapter: number,
  onProgress: (p: ChapterNarrationProgress) => void,
  signal: AbortSignal,
): Promise<void> {
  const plan = await planForChapter(translation, bookId, chapter);
  if (plan.length === 0) throw new Error('chapter has no verses');

  let done = 0;
  onProgress({ done, total: plan.length });

  for (const it of plan) {
    if (signal.aborted) throw new DOMException('aborted', 'AbortError');
    const ref = await resolveNarrationFor(it, voice, voiceStyle, signal);
    // Pinning is the actual download: resolveItem may well have found the item
    // already cached from ordinary playback, in which case this just promotes
    // those bytes out of reach of the LRU sweep, with no network at all.
    await fetchCached(ref.audioUrl, { pin: true });
    await fetchCached(ref.alignmentUrl, { pin: true });
    done++;
    onProgress({ done, total: plan.length });
  }
}

/**
 * Give back the space: unpin and delete this chapter's audio, and drop its index
 * entries so nothing claims it is still playable offline.
 *
 * Announcement clips are left alone. They are shared across every chapter that
 * says "Verse 16", so deleting them here would silently degrade other
 * downloaded chapters to save a few kilobytes.
 */
export async function deleteChapterNarration(
  voice: OpenAiVoiceId,
  voiceStyle: string,
  translation: Translation,
  bookId: number,
  chapter: number,
): Promise<void> {
  const plan = await planForChapter(translation, bookId, chapter);
  const keys = plan.filter((it) => it.kind === 'verse').map((it) => narrationKeyFor(it, voice, voiceStyle));

  const urls: string[] = [];
  for (const key of keys) {
    const entry = await getNarration(key);
    if (entry) urls.push(entry.audioUrl, entry.alignmentUrl);
  }
  try {
    await db.mediaCache.bulkDelete(urls);
    await db.narration.bulkDelete(keys);
  } catch {
    // Nothing to recover from — the worst case is space we failed to reclaim.
  }
}
