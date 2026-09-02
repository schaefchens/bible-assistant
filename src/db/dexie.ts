import Dexie, { type Table } from 'dexie';
import type {
  Board,
  Card,
  Membership,
  Post,
  Profile,
  ReadingList,
  ReadingProgress,
  Space,
  Subscription,
} from '@/types/domain';

export type LocalCard = Card & {
  dirty?: 0 | 1;
  deleted?: 0 | 1;
};

export type LocalBoard = Board & {
  dirty?: 0 | 1;
  deleted?: 0 | 1;
};

export type LocalReadingList = ReadingList & {
  dirty?: 0 | 1;
  deleted?: 0 | 1;
};

/** No `deleted` flag: progress dies with its list, and a tombstone would
 * outlive the only thing that gives it meaning. */
export type LocalReadingProgress = ReadingProgress & {
  dirty?: 0 | 1;
};

/**
 * The community profile lives as one row in `preferences` under
 * {@link PROFILE_PREF_KEY} rather than in a table of its own — there is only
 * ever one, and a table for a single record would buy nothing.
 */
export const PROFILE_PREF_KEY = 'profile';

/**
 * Authors this device refuses to read, and the pieces this device has already
 * reported — both `preferences` rows rather than tables, and both deliberately
 * local: see "Moderation" in CLAUDE.md.
 */
export const BLOCKED_PREF_KEY = 'blockedAuthors';
export const REPORTED_PREF_KEY = 'reportedContent';

export type LocalProfile = Profile & {
  dirty?: 0 | 1;
};

export type LocalSpace = Space & {
  dirty?: 0 | 1;
  deleted?: 0 | 1;
};

/**
 * One of the user's own posts.
 *
 * `shared` is the whole of "local-first ownership" and is deliberately not a
 * second tombstone state:
 *
 * - **Deleting** a post is `deleted: 1` — an explicit delete, gone from the
 *   device and the server, like every other entity here.
 * - **Withdrawing** from the server (leaving the community, or deleting the
 *   server account) sets `shared: 0` and queues `post.delete`. The row
 *   survives untouched, so the writing stays readable on the device until the
 *   user wipes it. Re-sharing later flips it back with the original
 *   `publishedAt` and the original signature still valid.
 *
 * Local-only, so `stripLocal()` drops it along with `dirty` and `deleted`.
 */
export type LocalPost = Post & {
  dirty?: 0 | 1;
  deleted?: 0 | 1;
  shared?: 0 | 1;
};

export type LocalSubscription = Subscription & {
  dirty?: 0 | 1;
  deleted?: 0 | 1;
};

/** A subscriber of one of my spaces. Server-side truth; decisions are pushed
 * through the `membership.decide` sync op, hence the dirty flag. */
export type LocalMembership = Membership & {
  dirty?: 0 | 1;
};

/**
 * One post from a space someone else owns.
 *
 * Outside the sync machinery on purpose: `dirty` / `deleted` / the pull's
 * `pending*Ids` sets all assume exactly one writer per row, and somebody
 * else's writing has none. This is a cache, refreshed by
 * `refreshSubscriptions()`, and nothing here is ever pushed.
 */
export type FeedPost = Post & {
  /** The subscription (share code) it arrived under. */
  code: string;
  /** Verified against the subscription's pinned key before being stored. */
  verified: boolean;
  fetchedAt: number;
};

/** Local-only "I have seen this post" marker, driving the unread dot. */
export type SeenPost = { id: string; seenAt: number };

export type SyncOp = {
  id?: number;
  op:
    | 'card.upsert'
    | 'card.delete'
    | 'cardOrder.set'
    | 'board.upsert'
    | 'board.delete'
    | 'boardOrder.set'
    | 'readingList.upsert'
    | 'readingList.delete'
    | 'readingProgress.set'
    | 'profile.set'
    | 'profile.delete'
    | 'space.upsert'
    | 'space.delete'
    | 'spaceCode.set'
    | 'post.upsert'
    | 'post.delete'
    | 'subscription.upsert'
    | 'subscription.delete'
    | 'membership.decide';
  payload: unknown;
  createdAt: number;
  attempts: number;
};

export type Preference = { key: string; value: unknown };

/** One cached media file (verse mp3 or word-alignment json), keyed by its
 * absolute URL. See src/lib/mediaCache.ts. */
export type CachedMedia = {
  url: string;
  body: ArrayBuffer;
  contentType: string;
  size: number;
  createdAt: number;
  /** Drives LRU eviction. */
  lastUsedAt: number;
  /** 1 for a file the user deliberately downloaded, which LRU eviction must
   * never reclaim — otherwise a chapter downloaded for a flight quietly
   * disappears behind whatever was played since. Indexed so the sweep can
   * exclude them without loading every row's body. */
  pinned?: 0 | 1;
};

/**
 * One resolved narration item: where its audio and word-alignment live.
 *
 * This exists so a downloaded chapter can be played with **no** call to
 * api.php. The URLs are api.php's to define — recomputing them client-side
 * would duplicate its path scheme and silently break the day it changes — so
 * they are recorded here when the download succeeds and read back verbatim.
 *
 * `key` identifies the *request*, not the URL: see narrationIndex.ts.
 */
export type NarrationEntry = {
  key: string;
  audioUrl: string;
  alignmentUrl: string;
  savedAt: number;
};

class BibleAssistantDb extends Dexie {
  cards!: Table<LocalCard, string>;
  boards!: Table<LocalBoard, string>;
  syncQueue!: Table<SyncOp, number>;
  preferences!: Table<Preference, string>;
  mediaCache!: Table<CachedMedia, string>;
  narration!: Table<NarrationEntry, string>;
  readingLists!: Table<LocalReadingList, string>;
  readingProgress!: Table<LocalReadingProgress, string>;
  spaces!: Table<LocalSpace, string>;
  posts!: Table<LocalPost, string>;
  subscriptions!: Table<LocalSubscription, string>;
  memberships!: Table<LocalMembership, [string, string]>;
  feedPosts!: Table<FeedPost, string>;
  seenPosts!: Table<SeenPost, string>;

  constructor() {
    super('bible-assistant');
    this.version(1).stores({
      cards: 'id, title, updatedAt, dirty',
      boards: 'id, name, updatedAt, dirty',
      syncQueue: '++id, op, createdAt',
    });
    // v2 adds optional `tags` and `color` fields on Card. Schema string is
    // unchanged (we don't need them indexed); the bump exists so Dexie
    // recognizes the entity shape change.
    this.version(2).stores({
      cards: 'id, title, updatedAt, dirty',
      boards: 'id, name, updatedAt, dirty',
      syncQueue: '++id, op, createdAt',
    });
    // v3 adds optional `emoji` field on Card.
    this.version(3).stores({
      cards: 'id, title, updatedAt, dirty',
      boards: 'id, name, updatedAt, dirty',
      syncQueue: '++id, op, createdAt',
    });
    // v4 adds a generic key/value preferences table (e.g. user-controlled
    // card order on the /cards screen).
    this.version(4).stores({
      cards: 'id, title, updatedAt, dirty',
      boards: 'id, name, updatedAt, dirty',
      syncQueue: '++id, op, createdAt',
      preferences: '&key',
    });
    // v5 adds optional `color` and `emoji` fields on Board.
    this.version(5).stores({
      cards: 'id, title, updatedAt, dirty',
      boards: 'id, name, updatedAt, dirty',
      syncQueue: '++id, op, createdAt',
      preferences: '&key',
    });
    // v6 adds the optional `freeform` layout map and `orientation` on Board
    // (corkboard per-card position/size/rotation + portrait/landscape).
    // Not indexed; schema string unchanged.
    this.version(6).stores({
      cards: 'id, title, updatedAt, dirty',
      boards: 'id, name, updatedAt, dirty',
      syncQueue: '++id, op, createdAt',
      preferences: '&key',
    });
    // v7 adds a persistent media cache. The native builds have no service
    // worker, so Workbox's CacheFirst rule on /storage/audio/* — previously
    // the app's ONLY persistent audio cache — is gone there. Without this,
    // every verse re-downloads on each cold start and offline reading is
    // impossible. Keyed by absolute URL, LRU-evicted on lastUsedAt.
    this.version(7).stores({
      cards: 'id, title, updatedAt, dirty',
      boards: 'id, name, updatedAt, dirty',
      syncQueue: '++id, op, createdAt',
      preferences: '&key',
      mediaCache: '&url, lastUsedAt',
    });
    // v8 adds deliberately-downloaded narration: the `narration` index of which
    // (voice, reference) maps to which audio/alignment URL, and a `pinned` flag
    // on mediaCache so the LRU sweep can't reclaim what the user asked to keep.
    // Existing mediaCache rows have no `pinned` and stay evictable, which is
    // right — they arrived as a side effect of playback, not as a download.
    this.version(8).stores({
      cards: 'id, title, updatedAt, dirty',
      boards: 'id, name, updatedAt, dirty',
      syncQueue: '++id, op, createdAt',
      preferences: '&key',
      mediaCache: '&url, lastUsedAt, pinned',
      narration: '&key',
    });
    // v9 adds reading lists (user-compiled sequences of passages — plans and
    // custom lists) and their progress. Progress is a separate table rather
    // than a field on the list because it is written far more often than the
    // list itself and merges differently: `completed` unions across devices
    // while the list is last-write-wins.
    this.version(9).stores({
      cards: 'id, title, updatedAt, dirty',
      boards: 'id, name, updatedAt, dirty',
      syncQueue: '++id, op, createdAt',
      preferences: '&key',
      mediaCache: '&url, lastUsedAt, pinned',
      narration: '&key',
      readingLists: 'id, name, updatedAt, dirty',
      readingProgress: '&listId, updatedAt, dirty',
    });
    // v10 adds community spaces: the user's own spaces and posts, the spaces
    // they subscribe to, the subscribers of theirs, and a cache of other
    // people's posts.
    //
    // `feedPosts` and `seenPosts` sit outside the sync machinery on purpose —
    // see the FeedPost docblock. The profile itself is one row in
    // `preferences` under the key 'profile'; a table for a single record would
    // buy nothing.
    this.version(10).stores({
      cards: 'id, title, updatedAt, dirty',
      boards: 'id, name, updatedAt, dirty',
      syncQueue: '++id, op, createdAt',
      preferences: '&key',
      mediaCache: '&url, lastUsedAt, pinned',
      narration: '&key',
      readingLists: 'id, name, updatedAt, dirty',
      readingProgress: '&listId, updatedAt, dirty',
      spaces: 'id, updatedAt, dirty',
      posts: 'id, spaceId, publishedAt, updatedAt, dirty, shared',
      subscriptions: '&code, updatedAt, dirty',
      memberships: '[userId+spaceId], spaceId, status, dirty',
      feedPosts: 'id, code, publishedAt',
      seenPosts: '&id',
    });
  }
}

export const db = new BibleAssistantDb();
