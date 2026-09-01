import { useCommunityStore } from '@/store/communityStore';
import type { Post, Profile, Space, Subscription, VerseSummary } from '@/types/domain';
import type { ReaderSource } from '@/services/reading/readingSequence';
import { postToUnits } from './postUnits';
import { spaceDisplayName } from './spaceName';

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
