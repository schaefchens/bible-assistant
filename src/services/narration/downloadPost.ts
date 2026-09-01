import { db } from '@/db/dexie';
import { fetchCached, isCached } from '@/lib/mediaCache';
import { buildPlaybackPlan, type PlanItem } from '@/lib/playbackPlan';
import { spacePostUnits } from '@/services/community/spaceReading';
import { useSettingsStore } from '@/store/settingsStore';
import type { OpenAiVoiceId } from '@/types/domain';
import { getNarration } from './narrationIndex';
import { narrationKeyFor, resolveNarrationFor } from './narrationRequest';

/**
 * Download one post's narration for offline listening — the counterpart of
 * `downloadChapter.ts`, and deliberately the same shape.
 *
 * There is a second reason to do this beyond offline reading. api.php caches
 * generated speech under a sha256 of the text, in a directory shared by every
 * user, so the first person to hear a paragraph pays for it and everyone after
 * gets a cache hit. An author who narrates their own piece at publish time is
 * therefore also warming it for their subscribers, whose first listen is then
 * instant and free. That is the whole of the "cache post audio on the server"
 * design: no new server storage, no upload step.
 *
 * As with a chapter, "downloading" is mostly *pinning*: bytes already in
 * `mediaCache` from ordinary playback are promoted out of reach of the LRU
 * sweep, with no network at all.
 */

export type PostNarrationProgress = { done: number; total: number };

export type PostCoverage = 'missing' | 'partial' | 'installed';

/** Identity of a downloaded post. Per voice, like a chapter: a piece held in
 * Echo says nothing about the same piece in Nova. */
export function postNarrationKey(
  voice: OpenAiVoiceId,
  spaceId: string,
  postId: string,
): string {
  return `post|${voice}|${spaceId}|${postId}`;
}

/** Build the plan for a post, the way playback would. */
function planForPost(spaceId: string, postId: string): PlanItem[] {
  const units = spacePostUnits(spaceId, postId);
  if (units.length === 0) return [];
  const settings = useSettingsStore.getState();
  return buildPlaybackPlan(units, {
    locale: settings.locale,
    readChapterHeadings: settings.readChapterHeadings,
    // A post has no verse numbers to announce; buildPlaybackPlan suppresses
    // them for post units anyway, and passing the real setting keeps the plan
    // identical to the one playback builds.
    readVerseNumbers: settings.readVerseNumbers,
    verseNumberStyle: settings.verseNumberStyle,
    pauseBetweenVersesMs: settings.pauseBetweenVersesMs,
    pauseBetweenChaptersMs: settings.pauseBetweenChaptersMs,
    wholeChapter: true,
  });
}

/**
 * How much of this post is already playable offline.
 *
 * Counts only the paragraphs, not the spoken title — the same reasoning as
 * chapters: scoring the announcement too would flip a fully-downloaded post to
 * 'partial' the moment someone turned headings on.
 */
export async function postCoverage(
  voice: OpenAiVoiceId,
  voiceStyle: string,
  spaceId: string,
  postId: string,
): Promise<PostCoverage> {
  const paragraphs = planForPost(spaceId, postId).filter((it) => it.kind === 'verse');
  if (paragraphs.length === 0) return 'missing';

  let have = 0;
  for (const it of paragraphs) {
    const entry = await getNarration(narrationKeyFor(it, voice, voiceStyle));
    if (entry && (await isCached(entry.audioUrl))) have++;
  }
  if (have === 0) return 'missing';
  return have === paragraphs.length ? 'installed' : 'partial';
}

/** One item at a time, for the same reason chapters are: each is a TTS call
 * plus a forced alignment on a shared backend, and nothing is waiting to be
 * heard. */
export async function downloadPostNarration(
  voice: OpenAiVoiceId,
  voiceStyle: string,
  spaceId: string,
  postId: string,
  onProgress: (p: PostNarrationProgress) => void,
  signal: AbortSignal,
): Promise<void> {
  const plan = planForPost(spaceId, postId);
  if (plan.length === 0) throw new Error('post has no text');

  let done = 0;
  onProgress({ done, total: plan.length });

  for (const it of plan) {
    if (signal.aborted) throw new DOMException('aborted', 'AbortError');
    const ref = await resolveNarrationFor(it, voice, voiceStyle, signal);
    await fetchCached(ref.audioUrl, { pin: true });
    await fetchCached(ref.alignmentUrl, { pin: true });
    done++;
    onProgress({ done, total: plan.length });
  }
}

/**
 * Give back the space: unpin and delete this post's audio.
 *
 * The spoken title is left alone — it is text-addressed and could be shared
 * with anything else bearing the same words, so deleting it here could silently
 * degrade another download to save a few kilobytes.
 */
export async function deletePostNarration(
  voice: OpenAiVoiceId,
  voiceStyle: string,
  spaceId: string,
  postId: string,
): Promise<void> {
  const keys = planForPost(spaceId, postId)
    .filter((it) => it.kind === 'verse')
    .map((it) => narrationKeyFor(it, voice, voiceStyle));

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
