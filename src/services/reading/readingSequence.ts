import type { Post, ReadingList, VerseRange } from '@/types/domain';
import type { Translation } from '@/services/bible/bibleApi';
import { formatRangeList, formatReference, getBookById } from '@/services/bible/bookCatalog';
import { nextChapterRef, prevChapterRef } from '@/services/bible/chapterNavigation';
import { isFlatList, listEntries } from './readingEntries';

/**
 * What the reader (and playback) walks through: the whole Bible in canonical
 * order, a reading list's entries in list order, or one person's space of
 * writing, newest first.
 *
 * This module is the **single answer to "what comes after this?"**. Before it,
 * that rule lived in autoPlay (next chunk), readerStore (prev/next chapter) and
 * useContinueReading, and a reading list would have made a fourth copy.
 * Everything here is pure: no stores, no fetches.
 */

/**
 * Where a reader unit lives. A list-sourced reader is walking `listId`; a
 * space-sourced one is walking one space of user-written posts.
 *
 * A space carries both identifiers because the two cases genuinely differ:
 * somebody else's space is only ever reachable by its share `code`, while the
 * user's own is addressed by `spaceId` and may not have a code at all yet.
 * Exactly one is set — see `spaceSourceKey`.
 */
export type ReaderSource =
  | { kind: 'bible' }
  | { kind: 'list'; listId: string }
  | { kind: 'space'; spaceId?: string; code?: string }
  /**
   * A reading drawn from *several* spaces — "everything new", or "today from
   * everyone I follow".
   *
   * It carries the post ids themselves rather than a filter, and that is the
   * whole point: a filter would be re-evaluated as pieces are marked seen, so
   * the list would shrink underneath the pager while it was being read and
   * `next()` would start returning the wrong piece. A snapshot is fixed from
   * the moment the user asked for it.
   *
   * `label` is stored with it because the reader header has nothing else to
   * name it by — there is no space to look up.
   */
  | { kind: 'selection'; label: string; postIds: string[] };

export const BIBLE_SOURCE: ReaderSource = { kind: 'bible' };

/** A stable string for a space source, for comparison and for React keys. */
export function spaceSourceKey(source: Extract<ReaderSource, { kind: 'space' }>): string {
  return source.code ? `c:${source.code}` : `s:${source.spaceId ?? ''}`;
}

export function sameSource(a: ReaderSource, b: ReaderSource): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'list' && b.kind === 'list') return a.listId === b.listId;
  if (a.kind === 'space' && b.kind === 'space') return spaceSourceKey(a) === spaceSourceKey(b);
  if (a.kind === 'selection' && b.kind === 'selection') {
    // Asking for "everything new" again after reading some of it is a *new*
    // request, even under the same label — so two selections are the same only
    // if they hold the same pieces.
    return a.postIds.length === b.postIds.length && a.postIds.every((id, i) => id === b.postIds[i]);
  }
  return true;
}

/**
 * One reader/playback unit — usually a whole chapter, and for a list entry with
 * verse ranges, part of one.
 *
 * `entryId`/`listId` are the provenance that lets playback keep following the
 * list across chunks (see `lib/readingContinuation.ts`). A list entry spanning
 * several chapters expands to one segment *per chapter*, all sharing one
 * `entryId`, because a chapter is the unit audio and the highlighter work in.
 */
export type SegmentRef = {
  translation: Translation;
  bookId: number;
  chapter: number;
  /** `undefined` → the whole chapter. */
  ranges?: VerseRange[];
  /**
   * True when `translation` came from the list entry's own override rather than
   * from the active setting — so switching translations must leave this segment
   * alone. Without it the reader "corrects" a deliberately German entry into
   * whatever is globally selected, and the group id stops matching the
   * sequence's, which quietly breaks prev/next around it.
   */
  translationPinned?: boolean;
  listId?: string;
  entryId?: string;
  /** The entry's own note ("Morning"). */
  label?: string;
  /** 0-based day index within the list, for grouping in the picker. */
  dayIndex?: number;
  dayTitle?: string;
  /**
   * Set together, and only for a user-written post — see "Community spaces" in
   * CLAUDE.md. A post segment is not scripture, so `bookId` and `chapter` are 0
   * and every display path has to ask `isPostSegment()` before reaching for the
   * book catalog.
   *
   * Post refs are always created with `translationPinned: true`, which is not a
   * trick so much as the truth: a post has no translation, so a change of the
   * active one must leave it alone. That reuses the exemption the reader and
   * `reloadForTranslation` already honour.
   */
  spaceId?: string;
  postId?: string;
  /** The post's title, so the heading needs no store lookup. */
  postTitle?: string;
};

/** True for a segment that is one user-written post rather than scripture. */
export function isPostSegment(ref: SegmentRef): boolean {
  return ref.spaceId !== undefined && ref.postId !== undefined;
}

/**
 * The playback group id for a segment. **Deterministic**, which is what lets
 * scrolling away and back — or replaying — re-bind the highlighter to tracks
 * that are already queued.
 *
 * Three shapes, and the Bible one is byte-identical to what shipped before, so
 * nothing about ordinary chapter reading changes:
 *   `reader:LUT:43:3`                     a chapter of the Bible
 *   `reader:LUT:l:<listId>:<entryId>:3`   a chapter of a reading list
 *   `reader:sp:<spaceId>:<postId>`        one user-written post
 *
 * The translation is in the first two because a translation switch has to
 * invalidate the group: word counts differ between texts, so letting queued TTS
 * play on against re-rendered verses desyncs the highlight with no way back. A
 * post has no translation, so it has none — and needs none, since nothing can
 * re-render its words underneath the audio.
 *
 * All three stay under the `reader:` namespace, so `readingHosts` dispatch, the
 * transport, autoPlay and the lock screen keep working untouched.
 */
export function segmentId(ref: SegmentRef): string {
  if (ref.spaceId && ref.postId) {
    return `reader:sp:${ref.spaceId}:${ref.postId}`;
  }
  if (ref.listId && ref.entryId) {
    return `reader:${ref.translation}:l:${ref.listId}:${ref.entryId}:${ref.chapter}`;
  }
  return `reader:${ref.translation}:${ref.bookId}:${ref.chapter}`;
}

export type ReadingSequence = {
  /** Every segment, for the picker. `null` for the Bible — 1,189 chapters is a
   * book/chapter grid, not a list. */
  all(): SegmentRef[] | null;
  first(): SegmentRef | null;
  next(cur: SegmentRef): SegmentRef | null;
  prev(cur: SegmentRef): SegmentRef | null;
};

/** Canonical order: one chapter forward, rolling books, stopping at Rev 22. */
export function bibleSequence(translation: Translation): ReadingSequence {
  return {
    all: () => null,
    first: () => ({ translation, bookId: 1, chapter: 1 }),
    next: (cur) => {
      const ref = nextChapterRef(cur.bookId, cur.chapter);
      return ref ? { translation, bookId: ref.bookId, chapter: ref.chapter } : null;
    },
    prev: (cur) => {
      const ref = prevChapterRef(cur.bookId, cur.chapter);
      return ref ? { translation, bookId: ref.bookId, chapter: ref.chapter } : null;
    },
  };
}

/**
 * Flatten a list into the segments it plays as.
 *
 * A whole-book entry fans out using the catalog's chapter count, which is
 * *English* versification — so for the German texts a segment can name a
 * chapter that edition genuinely lacks (LUT has no Malachi 4). That miss is
 * absorbed where it matters, at load and continuation time, rather than by
 * pretending here that we know each translation's shape.
 */
export function expandList(list: ReadingList, activeTranslation: Translation): SegmentRef[] {
  const out: SegmentRef[] = [];
  // A plain list has no day structure, so its segments carry none: "Day 1" over
  // a collection of favourite psalms is a label nobody asked for, and this is
  // the one place that decides it — the reader's heading and the picker's
  // grouping both follow from it.
  const flat = isFlatList(list);
  list.days.forEach((day, dayIndex) => {
    for (const entry of day.entries) {
      const translation = entry.translation ?? activeTranslation;
      const common = {
        translation,
        translationPinned: entry.translation !== undefined ? true : undefined,
        bookId: entry.bookId,
        listId: list.id,
        entryId: entry.id,
        label: entry.label,
        dayIndex: flat ? undefined : dayIndex,
        dayTitle: flat ? undefined : day.title,
      };
      if (entry.chapter === undefined) {
        const count = getBookById(entry.bookId)?.chapters ?? 0;
        for (let c = 1; c <= count; c++) out.push({ ...common, chapter: c });
        continue;
      }
      const end = entry.chapterEnd && entry.chapterEnd > entry.chapter ? entry.chapterEnd : entry.chapter;
      for (let c = entry.chapter; c <= end; c++) {
        // Ranges only apply to a single-chapter entry — "Genesis 1-3:5" is not a
        // thing the parser can produce, and applying one chapter's ranges to
        // three would silently read the wrong verses.
        out.push({ ...common, chapter: c, ranges: end === entry.chapter ? entry.ranges : undefined });
      }
    }
  });
  return out;
}

/** List order. Ends hard at both edges: a plan that looped back to its start
 * would never be finishable. */
export function listSequence(
  list: ReadingList,
  activeTranslation: Translation,
): ReadingSequence {
  const segments = expandList(list, activeTranslation);
  const indexOf = (cur: SegmentRef) => {
    const id = segmentId(cur);
    return segments.findIndex((s) => segmentId(s) === id);
  };
  return {
    all: () => segments,
    first: () => segments[0] ?? null,
    next: (cur) => {
      const i = indexOf(cur);
      return i === -1 ? null : segments[i + 1] ?? null;
    },
    prev: (cur) => {
      const i = indexOf(cur);
      return i <= 0 ? null : segments[i - 1] ?? null;
    },
  };
}

/**
 * The segment for one post.
 *
 * `translation` is filled in only because `SegmentRef` requires it; nothing
 * reads it for a post, and `translationPinned` stops the reader acting on it.
 */
export function postSegmentRef(
  post: Post,
  spaceId: string,
  translation: Translation,
): SegmentRef {
  return {
    translation,
    translationPinned: true,
    bookId: 0,
    chapter: 0,
    spaceId,
    postId: post.id,
    postTitle: post.title,
  };
}

/**
 * One space's posts, newest first — which is the order a blog is read in, and
 * the order the picker lists them.
 *
 * `all()` is non-null, so the picker's "list of passages" presentation works
 * for a space with no changes. Ends hard at both edges, like a reading list:
 * a space is a finite collection, not a canonical sequence to walk on from.
 */
export function spaceSequence(
  spaceId: string,
  posts: Post[],
  translation: Translation,
): ReadingSequence {
  const segments = posts.map((p) => postSegmentRef(p, spaceId, translation));
  const indexOf = (cur: SegmentRef) => segments.findIndex((s) => s.postId === cur.postId);
  return {
    all: () => segments,
    first: () => segments[0] ?? null,
    next: (cur) => {
      const i = indexOf(cur);
      return i === -1 ? null : segments[i + 1] ?? null;
    },
    prev: (cur) => {
      const i = indexOf(cur);
      return i <= 0 ? null : segments[i - 1] ?? null;
    },
  };
}

/**
 * A reading built from pieces drawn across spaces, in the order the selection
 * fixed. Pieces that have since gone (deleted, or expired out of a Today space)
 * are dropped rather than left as holes.
 *
 * Ends hard at both edges, like a list and like a single space: a selection is
 * a finite thing the user asked for.
 */
export function selectionSequence(
  refs: SegmentRef[],
): ReadingSequence {
  const indexOf = (cur: SegmentRef) => refs.findIndex((r) => r.postId === cur.postId);
  return {
    all: () => refs,
    first: () => refs[0] ?? null,
    next: (cur) => {
      const i = indexOf(cur);
      return i === -1 ? null : refs[i + 1] ?? null;
    },
    prev: (cur) => {
      const i = indexOf(cur);
      return i <= 0 ? null : refs[i - 1] ?? null;
    },
  };
}

/**
 * The list's own segment for `(entryId, chapter)`.
 *
 * The way to get a `SegmentRef` for a passage you only know the provenance of —
 * a continuation about to be appended, say. Look it up rather than rebuilding
 * it: a reconstructed ref drifts from the sequence's (it silently lost
 * `translationPinned` once, which made the reader "correct" a deliberately
 * German entry to the active translation mid-playback), and a ref that doesn't
 * match the sequence's has no neighbours.
 */
export function findListSegment(
  list: ReadingList,
  activeTranslation: Translation,
  entryId: string,
  chapter: number,
): SegmentRef | null {
  return (
    expandList(list, activeTranslation).find(
      (s) => s.entryId === entryId && s.chapter === chapter,
    ) ?? null
  );
}

/** True when the segment covers a whole chapter — which is what decides the
 * heading phrasing ("John, chapter 3" vs "John 3:16-18"). */
export function isWholeChapter(ref: SegmentRef): boolean {
  return ref.ranges === undefined || ref.ranges.length === 0;
}

/**
 * A segment's reference as text: "John 3", or "Psalms 23:1-6" when the segment
 * is only part of a chapter — a partial segment labelled with the bare chapter
 * would misdescribe what is on the page.
 */
export function formatSegment(ref: SegmentRef, lang: 'en' | 'de'): string {
  // A post has no book and no chapter; its title is its reference.
  if (isPostSegment(ref)) return ref.postTitle ?? '';
  return isWholeChapter(ref)
    ? formatReference(ref.bookId, ref.chapter, undefined, undefined, lang)
    : formatRangeList(ref.bookId, ref.chapter, ref.ranges ?? [], lang);
}

export function sameSegment(a: SegmentRef | null, b: SegmentRef | null): boolean {
  if (!a || !b) return a === b;
  return segmentId(a) === segmentId(b);
}

/** How many entries of `list` precede `entryId`, for "3 of 21" style progress
 * without re-expanding the list. */
export function entryIndex(list: ReadingList, entryId: string): number {
  return listEntries(list).findIndex((e) => e.id === entryId);
}
