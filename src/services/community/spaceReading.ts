import { useCommunityStore } from '@/store/communityStore';
import type { Post, Profile, Space, Subscription, VerseSummary } from '@/types/domain';
import {
  postSegmentRef,
  type ReaderSource,
  type SegmentRef,
} from '@/services/reading/readingSequence';
import type { Translation } from '@/services/bible/bibleApi';
import { postToUnits } from './postUnits';
import { spaceDisplayName, spaceLabel } from './spaceName';

/**
 * The seam between community data and the reading machinery.
 *
 * The reader, the sequence and auto-play all need the same three answers —
 * which posts a space holds, in what order, and what one post's units are —
 * and they must give identical answers or "what plays next" and "what the pager
 * shows next" drift apart. So they ask here.
 *
 * A space is identified by its `spaceId` whether the user owns it or subscribes
 * to it: ids are uuids minted by the author, and a subscribed feed reports the
 * owner's own id, so one namespace covers both. That is what lets a post's
 * playback group id (`reader:sp:<spaceId>:<postId>`) stay stable no matter
 * which side of the share code you are on.
 */

export type ResolvedSpace = {
  spaceId: string;
  /** Display name of the space — localized for the built-in "Today" space. */
  name: string;
  emoji?: string;
  /** Who wrote it — the profile's display name, or the subscription's owner. */
  author: string;
  /** True when the user owns this space, i.e. can write in it. */
  mine: boolean;
  /** The share code, when the space is one the user subscribes to. */
  code?: string;
  posts: Post[];
};

/**
 * The slice of community state the resolvers read.
 *
 * Named so React can pass a selected snapshot in: `resolveSpace()` reads it via
 * `getState()`, which is right for the store and for `lib/`, but a hook needs
 * the values as real dependencies or `exhaustive-deps` cannot see them and the
 * memo goes stale when a feed refreshes.
 */
export type SpaceSnapshot = {
  profile: Profile | null;
  spaces: Space[];
  posts: Post[];
  subscriptions: Subscription[];
  feed: Record<string, Post[]>;
};

function snapshot(): SpaceSnapshot {
  const { profile, spaces, posts, subscriptions, feed } = useCommunityStore.getState();
  return { profile, spaces, posts, subscriptions, feed };
}

/**
 * Resolve whatever a `{kind:'space'}` reader source points at.
 *
 * Returns null when the space is gone — unsubscribed, deleted, or a stale
 * persisted position from before a factory reset. Every caller treats that as
 * "fall back to the Bible" rather than as an error, the same way a deleted
 * reading list is handled.
 */
export function resolveSpace(
  source: Extract<ReaderSource, { kind: 'space' }>,
): ResolvedSpace | null {
  return resolveSpaceFrom(source, snapshot());
}

/** The pure form. See {@link SpaceSnapshot} for why both exist. */
export function resolveSpaceFrom(
  source: Extract<ReaderSource, { kind: 'space' }>,
  state: SpaceSnapshot,
): ResolvedSpace | null {
  if (source.code) {
    const sub = state.subscriptions.find((s) => s.code === source.code);
    if (!sub) return null;
    const posts = state.feed[source.code] ?? [];
    // The feed's own posts name the space, so no separate record is needed for
    // one we do not own.
    const spaceId = posts[0]?.spaceId ?? `code:${source.code}`;
    return {
      spaceId,
      name: sub.spaceName,
      emoji: sub.spaceEmoji,
      author: sub.ownerName,
      mine: false,
      code: source.code,
      posts,
    };
  }

  if (!source.spaceId) return null;
  const space = state.spaces.find((s) => s.id === source.spaceId);
  if (!space) return null;
  return {
    spaceId: space.id,
    // A display name, so the reader header, the picker and its sheet title all
    // agree about what the "Today" space is called.
    name: spaceDisplayName(space),
    emoji: space.emoji,
    author: state.profile?.displayName ?? '',
    mine: true,
    code: space.shareCode,
    // Drafts are the author's business but not part of a reading sequence —
    // nothing has been written to be read yet.
    posts: state.posts.filter((p) => p.spaceId === space.id && p.publishedAt > 0),
  };
}

/**
 * A space's posts in reading order (newest first), looked up by space id alone.
 *
 * Used by auto-play, which knows only what a post's provenance told it. Checks
 * the user's own spaces first, then every subscribed feed.
 */
export function spacePosts(spaceId: string): Post[] {
  const state = snapshot();
  if (state.spaces.some((s) => s.id === spaceId)) {
    return state.posts.filter((p) => p.spaceId === spaceId && p.publishedAt > 0);
  }
  for (const posts of Object.values(state.feed)) {
    if (posts.some((p) => p.spaceId === spaceId)) {
      return posts.filter((p) => p.spaceId === spaceId);
    }
  }
  return [];
}

export function findSpacePost(spaceId: string, postId: string): Post | null {
  const state = snapshot();
  const own = state.posts.find((p) => p.id === postId && p.spaceId === spaceId);
  if (own) return own;
  for (const posts of Object.values(state.feed)) {
    const hit = posts.find((p) => p.id === postId && p.spaceId === spaceId);
    if (hit) return hit;
  }
  return null;
}

/** Who to credit for a post, for the heading and the lock screen. */
function authorOf(spaceId: string): string {
  const state = snapshot();
  if (state.spaces.some((s) => s.id === spaceId)) return state.profile?.displayName ?? '';
  for (const [code, posts] of Object.entries(state.feed)) {
    if (posts.some((p) => p.spaceId === spaceId)) {
      return state.subscriptions.find((s) => s.code === code)?.ownerName ?? '';
    }
  }
  return '';
}

/**
 * One post as reading units. Empty when the post has gone, which the reader
 * reports as an unavailable segment rather than throwing.
 */
export function spacePostUnits(spaceId: string, postId: string): VerseSummary[] {
  const post = findSpacePost(spaceId, postId);
  return post ? postToUnits(post, spaceId, authorOf(spaceId)) : [];
}

/* ------------------------------------------------------------------ *
 * Reading across spaces
 *
 * "Everything new" and "today, from everyone I follow" are not spaces — they
 * are *selections* of pieces drawn from several. They cover only spaces the
 * user subscribes to: their own writing is not new to them.
 * ------------------------------------------------------------------ */

/** One piece and the space it belongs to, looked up by post id alone. */
export type LocatedPost = { post: Post; spaceId: string; code: string };

/**
 * The share code a *subscribed* space is known by, from its space id.
 *
 * Needed because a reader's segments carry `spaceId` while every action that
 * names a space to the server takes a code — reporting a piece, above all.
 * Answered from the feed cache rather than from `Subscription`, which stores no
 * space id: the code is the only handle the subscriber was ever given.
 *
 * Undefined for the user's own space (it is not subscribed to) and for a space
 * whose feed has not been fetched.
 */
export function subscribedCodeForSpace(
  feed: Record<string, Post[]>,
  spaceId: string | undefined,
): string | undefined {
  if (!spaceId) return undefined;
  for (const [code, posts] of Object.entries(feed)) {
    if (posts.some((p) => p.spaceId === spaceId)) return code;
  }
  return undefined;
}

/**
 * The code a space can be passed on by — whichever side of it you are on.
 *
 * A reader always has one: it is how they got in. An owner has one only once
 * they have shared the space, and `undefined` there is the honest answer rather
 * than a reason to mint one behind their back — creating the first code is a
 * decision, and it belongs on the space's own screen.
 *
 * Own spaces are checked first: if the user somehow both owns a space and has a
 * subscription row for it, their own code is the authoritative one.
 */
export function shareCodeForSpace(
  state: SpaceSnapshot,
  spaceId: string | undefined,
): string | undefined {
  if (!spaceId) return undefined;
  const own = state.spaces.find((s) => s.id === spaceId);
  if (own) return own.shareCode;
  return subscribedCodeForSpace(state.feed, spaceId);
}

/**
 * How to name a space to whoever is about to share it — `Christoph / Heute`.
 *
 * Returns a plain string so it can be selected straight out of the store
 * without re-rendering on every feed refresh, the same trick
 * `subscribedCodeForSpace` is used for in `SegmentBlock`.
 */
export function shareLabelForSpace(state: SpaceSnapshot, spaceId: string | undefined): string {
  if (!spaceId) return '';
  const own = state.spaces.find((s) => s.id === spaceId);
  if (own) return spaceLabel(state.profile?.displayName ?? '', own);
  const code = subscribedCodeForSpace(state.feed, spaceId);
  const sub = code ? state.subscriptions.find((s) => s.code === code) : undefined;
  if (!sub) return '';
  return spaceLabel(sub.ownerName, { kind: sub.spaceKind ?? 'custom', name: sub.spaceName });
}

/** Several spaces by one author, in the order they were first subscribed to. */
export type AuthorSubscriptions = {
  /** The author's signing key — see below for why it, and not their name. */
  authorKey: string;
  ownerName: string;
  subs: Subscription[];
};

/**
 * Group subscriptions by who wrote them.
 *
 * A flat list is fine until someone follows a few prolific authors: every row
 * then begins with the same name, and finding a space means reading past the
 * repeats. Grouping is presentation, so it stays out of the store — but *how* to
 * group is a correctness question, and it belongs here with the rest of what a
 * space is.
 *
 * **Keyed by the pinned signing key, never by the display name.** A name is
 * neither unique nor claimed — two people can both be "Christoph", and merging
 * them would put one author's spaces under another's heading, which for a
 * feature whose whole point is knowing whose writing you are reading is the one
 * mistake not to make. It is the same identity `blockAuthor` keys on, and for
 * the same reason.
 *
 * Order is preserved: first appearance decides where a group sits, so nothing
 * jumps around as feeds refresh.
 */
export function groupSubscriptionsByAuthor(subs: Subscription[]): AuthorSubscriptions[] {
  const out: AuthorSubscriptions[] = [];
  const byKey = new Map<string, AuthorSubscriptions>();
  for (const sub of subs) {
    const existing = byKey.get(sub.pinnedKey);
    if (existing) {
      existing.subs.push(sub);
      continue;
    }
    const group: AuthorSubscriptions = {
      authorKey: sub.pinnedKey,
      ownerName: sub.ownerName,
      subs: [sub],
    };
    byKey.set(sub.pinnedKey, group);
    out.push(group);
  }
  return out;
}

/**
 * Every accepted subscription's pieces, newest first across all of them.
 *
 * Flat rather than grouped by space: this is a "what's new" reading order, and
 * each piece states its own author in the byline, so the source is never in
 * doubt while reading.
 */
export function subscribedPosts(state: SpaceSnapshot = snapshot()): LocatedPost[] {
  const out: LocatedPost[] = [];
  for (const sub of state.subscriptions) {
    if (sub.status !== 'accepted') continue;
    for (const post of state.feed[sub.code] ?? []) {
      out.push({ post, spaceId: post.spaceId, code: sub.code });
    }
  }
  return out.sort((a, b) => b.post.publishedAt - a.post.publishedAt);
}

/**
 * Pieces the user has not seen yet.
 *
 * `seen` is read here rather than being part of {@link SpaceSnapshot} on
 * purpose: the snapshot is what `useReaderSequence` memoizes on, and pulling
 * `seen` in would rebuild the reader's sequence every time a piece is marked —
 * which for an unread reading would reshuffle the very list being read. These
 * selectors are only ever called imperatively, to *build* a selection.
 */
export function unseenPosts(state: SpaceSnapshot = snapshot()): LocatedPost[] {
  const { seen } = useCommunityStore.getState();
  return subscribedPosts(state).filter(({ post }) => !seen[post.id]);
}

/**
 * Pieces from the ephemeral "Today" spaces of everyone the user follows —
 * whether seen or not, because "read today's" is a request for today's, not
 * for what is left of it.
 */
export function todayPosts(state: SpaceSnapshot = snapshot()): LocatedPost[] {
  const ephemeral = new Set(
    state.subscriptions
      .filter((s) => s.spaceKind === 'today' || (s.spaceEphemeralHours ?? 0) > 0)
      .map((s) => s.code),
  );
  return subscribedPosts(state).filter(({ code }) => ephemeral.has(code));
}

/** Resolve a post by id alone, across the user's own writing and every feed. */
export function findPostById(postId: string): LocatedPost | null {
  const state = snapshot();
  const own = state.posts.find((p) => p.id === postId);
  if (own) return { post: own, spaceId: own.spaceId, code: '' };
  for (const [code, posts] of Object.entries(state.feed)) {
    const hit = posts.find((p) => p.id === postId);
    if (hit) return { post: hit, spaceId: hit.spaceId, code };
  }
  return null;
}

/**
 * The segments a `{kind:'selection'}` source reads, in the order it fixed.
 *
 * Ids whose piece has gone are skipped — a Today piece can expire between the
 * moment the user asked for "everything new" and the moment they reach it.
 */
export function selectionSegments(postIds: string[], translation: Translation): SegmentRef[] {
  const out: SegmentRef[] = [];
  for (const id of postIds) {
    const located = findPostById(id);
    if (located) out.push(postSegmentRef(located.post, located.spaceId, translation));
  }
  return out;
}
