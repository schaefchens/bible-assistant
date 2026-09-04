import type { SegmentRef } from '@/services/reading/readingSequence';
import { isPostSegment } from '@/services/reading/readingSequence';
import {
  narrationTargetKey,
  useNarrationStore,
  type ChapterNarrationProgressMap,
  type NarrationStatus,
  type NarrationSubject,
  type NarrationTarget,
} from '@/store/narrationStore';
import type { OpenAiVoiceId } from '@/types/domain';

/**
 * Downloading a *set* of things — a day of a reading plan, a page of a plain
 * list, a room's pieces, everything you haven't read yet — as one action.
 *
 * Deliberately a coordinator over the per-item machinery rather than a third
 * kind of `NarrationTarget`: a chapter and a post are what get generated,
 * keyed, pinned and deleted, and a group is only ever "these, in order". That
 * is what lets the group button and the per-row buttons agree without either
 * being the other's source of truth — the group reads its state out of the
 * same `narrationStore` entries the rows show, so something downloaded on its
 * own already counts toward its day (or its selection), and mixing kinds in
 * one group costs nothing.
 */

/** Aggregate of a group's per-chapter statuses. Mirrors `NarrationStatus`
 * minus 'unknown', which is folded into 'missing': a group with nothing known
 * about it offers the same thing as an empty one — download. */
export type GroupNarrationStatus = 'missing' | 'partial' | 'installed' | 'downloading';

/**
 * What a run of reader segments is a download of.
 *
 * A post segment becomes a post subject and a scripture one becomes a chapter,
 * which is why a space's pieces and a plan's chapters can use one control.
 *
 * Two things about the scripture side: each segment carries **its own
 * translation**, which is what makes a list entry pinned to LUT download in
 * LUT rather than in whatever is globally selected; and verse ranges are
 * widened to their whole chapter, because the chapter is the unit
 * `downloadChapterNarration` deals in. A superset of what the entry needs is
 * the honest trade for not inventing a second key space — the alternative
 * quietly files a range's audio where playback would never look for it.
 */
export function subjectsForSegments(segments: SegmentRef[]): NarrationSubject[] {
  return segments.map((seg) =>
    isPostSegment(seg)
      ? { kind: 'post', spaceId: seg.spaceId!, postId: seg.postId! }
      : {
          kind: 'chapter',
          translation: seg.translation,
          bookId: seg.bookId,
          chapter: seg.chapter,
        },
  );
}

/** The group's targets: the voice applied, in order, without repeats. */
export function narrationTargetsFor(
  subjects: NarrationSubject[],
  voice: OpenAiVoiceId,
  voiceStyle: string,
): NarrationTarget[] {
  const out: NarrationTarget[] = [];
  const seen = new Set<string>();
  for (const subject of subjects) {
    const target: NarrationTarget = { ...subject, voice, voiceStyle };
    const key = narrationTargetKey(target);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(target);
  }
  return out;
}

export const narrationGroupKey = (targets: NarrationTarget[]): string =>
  targets.map(narrationTargetKey).join('\n');

/**
 * One in-flight run per group, held outside any component.
 *
 * The sheet a group button lives in can be closed and reopened mid-download,
 * which remounts the button — and a cancel from the *new* one has to stop the
 * loop started by the old one, or the run would carry on to the next chapter
 * after the current one was aborted. Keyed by the group, so the state survives
 * the component that started it.
 */
const runs = new Map<string, { cancelled: boolean }>();

/**
 * Fill in what isn't known yet, one chapter at a time.
 *
 * Sequential and skip-if-known, both for the same reason: each check loads a
 * chapter and reads the cache once per verse, and the passage rows are asking
 * the very same questions as this mounts. `narrationStore.check` collapses the
 * concurrent overlap; this skips the rest.
 */
export async function checkNarrationGroup(targets: NarrationTarget[]): Promise<void> {
  for (const target of targets) {
    const { status, check } = useNarrationStore.getState();
    if (status[narrationTargetKey(target)] !== undefined) continue;
    try {
      await check(target);
    } catch {
      // A chapter this translation lacks, or an unreadable cache. The status
      // stays unknown, which reads as "offer the download".
    }
  }
}

/**
 * Download every item of the group that isn't already installed.
 *
 * One at a time, extending the same courtesy `downloadChapterNarration` pays
 * per item: a day is up to four chapters of per-verse TTS plus forced
 * alignment on a shared backend, and firing them all at once would push the
 * queue in front of whoever is trying to listen right now.
 *
 * One item that fails is stepped over rather than ending the run — a plan can
 * legitimately name a chapter the chosen translation lacks (versification is
 * English), and a feed can name a piece its author has since withdrawn; one
 * gap must not cost the user the rest of the day. Two
 * failures in a row is a different thing: that is the backend or the network
 * being gone, and working through the rest of the day would be a dozen doomed
 * requests and a long wait for nothing.
 */
export async function downloadNarrationGroup(targets: NarrationTarget[]): Promise<void> {
  const groupKey = narrationGroupKey(targets);
  if (runs.has(groupKey)) return;
  const run = { cancelled: false };
  runs.set(groupKey, run);
  try {
    let failures = 0;
    for (const target of targets) {
      if (run.cancelled) return;
      const key = narrationTargetKey(target);
      if (useNarrationStore.getState().status[key] === 'installed') continue;
      await useNarrationStore.getState().download(target);
      // `download` records a failure rather than throwing, so this is the only
      // way to see one. An abort leaves `error` alone — that path is the
      // `run.cancelled` check above.
      if (useNarrationStore.getState().error[key]) {
        if (++failures >= 2) return;
      } else {
        failures = 0;
      }
    }
  } finally {
    runs.delete(groupKey);
  }
}

/** Stop the run and abort whichever chapter it was on. Whatever already landed
 * stays — a cancelled group is a partial one, not a failed one. */
export function cancelNarrationGroup(targets: NarrationTarget[]): void {
  const run = runs.get(narrationGroupKey(targets));
  if (run) run.cancelled = true;
  const { cancel } = useNarrationStore.getState();
  for (const target of targets) cancel(target);
}

/** Give back every item of the group. */
export async function removeNarrationGroup(targets: NarrationTarget[]): Promise<void> {
  cancelNarrationGroup(targets);
  const { remove } = useNarrationStore.getState();
  for (const target of targets) await remove(target);
}

// ─── Aggregate selectors ──────────────────────────────────────────────────
//
// Each returns a primitive, so a component can read it straight out of
// `useNarrationStore(...)`. A selector building an array or object would hand
// back a new reference on every store write — including the per-item progress
// ticks these very controls are subscribed to — and re-render on all of them.

export function groupStatus(
  status: Partial<Record<string, NarrationStatus>>,
  keys: string[],
): GroupNarrationStatus {
  if (keys.length === 0) return 'missing';
  let installed = 0;
  let touched = 0;
  for (const key of keys) {
    const st = status[key];
    if (st === 'downloading') return 'downloading';
    if (st === 'installed') installed++;
    if (st === 'installed' || st === 'partial') touched++;
  }
  if (installed === keys.length) return 'installed';
  return touched > 0 ? 'partial' : 'missing';
}

/** How many items of the group are fully downloaded. */
export function groupInstalledCount(
  status: Partial<Record<string, NarrationStatus>>,
  keys: string[],
): number {
  let n = 0;
  for (const key of keys) if (status[key] === 'installed') n++;
  return n;
}

/**
 * How far along the group is, 0–1, for the progress ring.
 *
 * Counts the item being generated as its own fraction rather than as nothing,
 * so a four-chapter day advances smoothly instead of in four jumps.
 */
export function groupFraction(
  status: Partial<Record<string, NarrationStatus>>,
  progress: ChapterNarrationProgressMap,
  keys: string[],
): number {
  if (keys.length === 0) return 0;
  let done = 0;
  for (const key of keys) {
    if (status[key] === 'installed') {
      done += 1;
      continue;
    }
    if (status[key] !== 'downloading') continue;
    const p = progress[key];
    if (p && p.total > 0) done += p.done / p.total;
  }
  return done / keys.length;
}
