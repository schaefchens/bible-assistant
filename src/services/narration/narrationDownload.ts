import { db } from '@/db/dexie';
import { fetchCached, isCached } from '@/lib/mediaCache';
import { buildPlaybackPlan, type PlanItem } from '@/lib/playbackPlan';
import type { Translation } from '@/services/bible/bibleApi';
import { spacePostUnits } from '@/services/community/spaceReading';
import { loadChapterSummaries } from '@/services/bible/verseSummaries';
import { useSettingsStore } from '@/store/settingsStore';
import type { OpenAiVoiceId } from '@/types/domain';
import { getNarration } from './narrationIndex';
import { narrationKeyFor, resolveNarrationFor } from './narrationRequest';

/**
 * Download narration for offline listening — one Bible chapter, or one
 * user-written post.
 *
 * **One module for both kinds on purpose.** They were two files of the same
 * shape (`downloadChapter.ts`, `downloadPost.ts`), and everything except
 * "which text is this?" was duplicated: the coverage loop, the one-at-a-time
 * generation loop, the pin, the delete. Two copies of that is two places to
 * fix a cache bug in, and only `planFor()` below ever genuinely differed.
 *
 * Chapter granularity, not book: a chapter averages ~26 verses (a few MB and a
 * few cents), while Psalms runs to 2,461 verses — half an hour of per-verse TTS
 * plus forced alignment, and a bill to match. Reading happens a chapter at a
 * time anyway.
 *
 * What gets downloaded is exactly what the current settings would *play*,
 * announcements included. That keeps a user who reads without announcements
 * from paying to generate 27 clips they will never hear. The flip side is that
 * changing announcement settings afterwards leaves those few items to come from
 * the network; the verses, which is what "downloaded" means to anyone, are
 * unaffected.
 *
 * "Downloading" is mostly *pinning*: bytes already in `mediaCache` from
 * ordinary playback are promoted out of reach of the LRU sweep, with no network
 * at all. For a post there is a second reason to do it beyond offline reading —
 * api.php caches generated speech under a sha256 of the text in a directory
 * shared by every user, so an author who narrates their own piece at publish
 * time is warming it for their subscribers, whose first listen is then instant
 * and free. That is the whole of the "cache post audio on the server" design:
 * no new server storage, no upload step.
 */

/** One chapter of one translation. */
export type ChapterSubject = {
  kind: 'chapter';
  translation: Translation;
  bookId: number;
  chapter: number;
};

/** One piece of writing in one space. */
export type PostSubject = { kind: 'post'; spaceId: string; postId: string };

/**
 * What a download is *of*, minus the voice — which is what every caller
 * actually has in hand. Narration is per-voice, but a chapter row or a post
 * knows nothing about that; the control that renders it supplies the voice
 * (`effectiveReadingVoice`) and hands over a full `NarrationTarget`.
 */
export type NarrationSubject = ChapterSubject | PostSubject;

/** A subject plus the voice it is narrated in. */
export type NarrationTarget = NarrationSubject & {
  voice: OpenAiVoiceId;
  voiceStyle: string;
};

export type NarrationCoverage = 'missing' | 'partial' | 'installed';

export type NarrationProgress = { done: number; total: number };

/**
 * Identity of a downloaded item. Includes the voice: narration is per-voice,
 * and a chapter held in Echo says nothing about the same chapter in Nova.
 *
 * Only ever a key into `narrationStore`'s transient maps — the Dexie keys are
 * `narrationKeyFor`'s, per plan item — so its shape is free to change.
 */
export function narrationTargetKey(t: NarrationTarget): string {
  return t.kind === 'post'
    ? `post|${t.voice}|${t.spaceId}|${t.postId}`
    : `${t.voice}|${t.translation}|${t.bookId}|${t.chapter}`;
}

/**
 * The plan for this subject, built the way playback would build it — the one
 * place the two kinds differ.
 *
 * A post has no verse numbers to announce; `buildPlaybackPlan` suppresses them
 * for post units anyway, so the real setting is passed either way and the plan
 * stays identical to the one playback builds.
 */
async function planFor(subject: NarrationSubject): Promise<PlanItem[]> {
  const settings = useSettingsStore.getState();
  const units =
    subject.kind === 'post'
      ? spacePostUnits(subject.spaceId, subject.postId)
      : // getChapter beneath this is memoized and in-flight-deduped, so calling
        // it again for a coverage check right after a download costs nothing.
        await loadChapterSummaries(
          subject.translation,
          subject.bookId,
          subject.chapter,
          settings.locale,
        );
  if (units.length === 0) return [];
  return buildPlaybackPlan(units, {
    locale: settings.locale,
    readChapterHeadings: settings.readChapterHeadings,
    readVerseNumbers: settings.readVerseNumbers,
    verseNumberStyle: settings.verseNumberStyle,
    pauseBetweenVersesMs: settings.pauseBetweenVersesMs,
    pauseBetweenChaptersMs: settings.pauseBetweenChaptersMs,
    wholeChapter: true,
  });
}

/** The items that count as "the text": verses, or a post's paragraphs. */
async function textItems(target: NarrationTarget): Promise<PlanItem[]> {
  return (await planFor(target)).filter((it) => it.kind === 'verse');
}

/**
 * How much of this item is already playable offline.
 *
 * Counts only the text — the verses, or the post's paragraphs — never the
 * spoken heading: scoring announcements too would flip a fully-downloaded
 * chapter to 'partial' the moment someone toggled verse numbers on.
 */
export async function narrationCoverage(
  target: NarrationTarget,
): Promise<NarrationCoverage> {
  let items: PlanItem[];
  try {
    items = await textItems(target);
  } catch {
    // Can't read the text (missing chapter, no pack, offline) — nothing to say.
    return 'missing';
  }
  if (items.length === 0) return 'missing';

  let have = 0;
  for (const it of items) {
    const entry = await getNarration(narrationKeyFor(it, target.voice, target.voiceStyle));
    if (entry && (await isCached(entry.audioUrl))) have++;
  }
  if (have === 0) return 'missing';
  return have === items.length ? 'installed' : 'partial';
}

/**
 * Generation runs one item at a time rather than the 4-wide pool playback uses.
 * Nothing is waiting to be heard here, and each item is a TTS call plus a forced
 * alignment on the shared backend — the polite choice is not to open four of
 * those per tap while someone else may be trying to listen.
 */
export async function downloadNarration(
  target: NarrationTarget,
  onProgress: (p: NarrationProgress) => void,
  signal: AbortSignal,
): Promise<void> {
  const plan = await planFor(target);
  if (plan.length === 0) {
    throw new Error(target.kind === 'post' ? 'post has no text' : 'chapter has no verses');
  }

  let done = 0;
  onProgress({ done, total: plan.length });

  for (const it of plan) {
    if (signal.aborted) throw new DOMException('aborted', 'AbortError');
    const ref = await resolveNarrationFor(it, target.voice, target.voiceStyle, signal);
    // Pinning is the actual download: resolveNarrationFor may well have found
    // the item already cached from ordinary playback, in which case this just
    // promotes those bytes out of reach of the LRU sweep, with no network.
    await fetchCached(ref.audioUrl, { pin: true });
    await fetchCached(ref.alignmentUrl, { pin: true });
    done++;
    onProgress({ done, total: plan.length });
  }
}

/**
 * Give back the space: unpin and delete this item's audio, and drop its index
 * entries so nothing claims it is still playable offline.
 *
 * Announcement clips are left alone. They are text-addressed and shared with
 * every other item that says "Verse 16" (or bears the same title), so deleting
 * them here would silently degrade other downloads to save a few kilobytes.
 */
export async function deleteNarration(target: NarrationTarget): Promise<void> {
  const keys = (await textItems(target)).map((it) =>
    narrationKeyFor(it, target.voice, target.voiceStyle),
  );

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
