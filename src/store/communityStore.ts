import { create } from 'zustand';
import { createCommunityFeed } from './communityFeed';
import {
  byPublishedDesc,
  byUpdatedDesc,
  isOwnCode,
  itemHeader,
  mirrorsFrom,
  sourceIdOfPayload,
  withoutSelf,
} from './communityRows';
// Re-exported: `/subscribe/:code` has always asked the store this, and the
// store is still the natural place to ask it from. It *answers* from
// `communityRows` now, because `communitySubscriptions` needs it too and a
// value import from here would be a genuine cycle rather than an erased one.
export { isOwnCode } from './communityRows';
import { flush, online, queued } from './communityOps';
import { createCommunitySubscriptions } from './communitySubscriptions';
import { createCommunityWriting } from './communityWriting';
import {
  BLOCKED_PREF_KEY,
  db,
  PROFILE_PREF_KEY,
  REPORTED_PREF_KEY,
  stripLocal,
  type LocalProfile,
} from '@/db/dexie';
import { authorKey } from '@/lib/postSigning';
import {
  mintSpaceCode,
} from '@/lib/spaceCode';
import { communityTermsAccepted } from '@/lib/communityTerms';
import * as api from '@/services/api/community';
import { onCommunityPulled } from '@/services/community/communitySync';
import { useLibraryStore, nowId } from '@/store/libraryStore';
import type {
  BlockedAuthor,
  Membership,
  Post,
  Profile,
  MirroredBoard,
  MirroredList,
  ReportReason,
  SharedItem,
  Space,
  Subscription,
} from '@/types/domain';

/**
 * Community spaces: the user's own writing, who may read it, and the spaces
 * they read.
 *
 * Kept out of `libraryStore` — which is already 800 lines and owns cards,
 * boards, lists, progress and the queue — but it does **not** open its own
 * network path. Every push goes through `libraryStore.flushQueue()` and every
 * pull of the user's own data through `pullFromServer()`, so the `syncEnabled`
 * opt-in keeps meaning what it says.
 *
 * The one thing that talks to the network from here is
 * {@link refreshSubscriptions}, which reads *other people's* spaces into the
 * `feedPosts` and `feedItems` caches. That is not sync: nothing about it is
 * ever pushed, and remote rows carry no `dirty` flag because they have no
 * local writer.
 */

const TODAY_WINDOW_HOURS = 24;

type FeedState = {
  status: api.MembershipStatus;
  /** Posts that failed signature verification, surfaced once per space. */
  refused: number;
  /** The pinned key no longer matches what the server returns. */
  keyChanged: boolean;
  fetchedAt: number;
};

export type CommunityState = {
  profile: Profile | null;
  /** The user's own spaces. */
  spaces: Space[];
  /** The user's own posts, drafts included. */
  posts: Post[];
  /** Which of those currently have a copy on the server. */
  shared: Record<string, boolean>;
  /**
   * The plans and boards the user has published into their own rooms.
   * Headers only — the payload stays in Dexie, where a year-long plan's ~100KB
   * is not re-read on every render.
   */
  items: SharedItem[];
  /** Which of those currently have a copy on the server — `shared`, for items. */
  sharedClaims: Record<string, boolean>;
  /**
   * What each shared item was snapshotted from, and when.
   *
   * The source id is inside the payload and the timestamp is a local-only
   * column, so this is the cheap answer to "is the shared copy out of date?" —
   * a number comparison against the live list or board, rather than rebuilding
   * and hashing a payload on every render of the room screen.
   */
  itemSources: Record<string, { sourceId: string; sourceUpdatedAt: number }>;
  subscriptions: Subscription[];
  /** Subscribers of the user's spaces. */
  memberships: Membership[];
  /** Cached posts of subscribed spaces, keyed by share code. */
  feed: Record<string, Post[]>;
  /** Cached item headers of subscribed rooms, keyed by share code. */
  feedItems: Record<string, SharedItem[]>;
  /**
   * Other people's plans and boards, parsed and ready to render.
   *
   * Derived from `feedItems` plus the payloads in Dexie, and rebuilt wherever
   * either is written — **one array per kind**, deliberately. Exposing the
   * headers and payloads raw would take `useReaderSequence`'s memo from eight
   * dependencies to eleven and make every consumer do the join itself.
   *
   * An item whose payload has not been fetched yet is simply absent here: its
   * header is known-genuine but there is nothing to show.
   */
  mirroredLists: MirroredList[];
  mirroredBoards: MirroredBoard[];
  feedState: Record<string, FeedState>;
  seen: Record<string, number>;
  /**
   * Authors this device refuses to read, by signing key. Local by design — see
   * `blockAuthor`.
   */
  blocked: Record<string, BlockedAuthor>;
  /** What this device has already reported, by post id (or share code for a
   * whole space), so the UI can say so instead of inviting a second report. */
  reported: Record<string, number>;
  initialized: boolean;
  busy: boolean;

  init: () => Promise<void>;
  enableCommunity: (displayName: string) => Promise<void>;
  disableCommunity: () => Promise<void>;
  saveProfile: (patch: Partial<Omit<Profile, 'authorKey' | 'updatedAt'>>) => Promise<void>;
  setAvatar: (file: Blob, filename: string) => Promise<void>;

  createSpace: (name: string) => Promise<Space | null>;
  saveSpace: (space: Space) => Promise<void>;
  deleteSpace: (id: string) => Promise<void>;
  shareSpace: (spaceId: string, rotate?: boolean) => Promise<string | null>;

  savePost: (post: Post) => Promise<void>;
  publishPost: (id: string) => Promise<void>;
  unpublishPost: (id: string) => Promise<void>;
  deletePost: (id: string) => Promise<void>;

  /** Publish a plan or a board into one of the user's own rooms. */
  shareList: (listId: string, spaceId: string) => Promise<void>;
  shareBoard: (boardId: string, spaceId: string) => Promise<void>;
  /** Re-snapshot from the live source. Offered, never automatic. */
  republishItem: (itemId: string) => Promise<void>;
  /** Out of the room, still on the device. */
  withdrawItem: (itemId: string) => Promise<void>;
  deleteItem: (itemId: string) => Promise<void>;
  /** Fork somebody else's plan or board into the user's own library. */
  copySharedList: (listId: string) => Promise<string | null>;
  copySharedBoard: (boardId: string) => Promise<string | null>;

  subscribe: (rawCode: string) => Promise<api.MembershipStatus>;
  unsubscribe: (code: string) => Promise<void>;
  /** Refuse an author entirely: every space of theirs goes, and no code of
   * theirs can be added again while the block stands. */
  blockAuthor: (authorKey: string, displayName: string) => Promise<void>;
  unblockAuthor: (authorKey: string) => Promise<void>;
  /** Which of the user's subscriptions belong to this author. */
  codesOfAuthor: (authorKey: string) => string[];
  reportContent: (input: {
    code: string;
    postId?: string;
    reason: ReportReason;
    note?: string;
  }) => Promise<void>;
  decideMember: (userId: string, spaceId: string, status: 'accepted' | 'blocked') => Promise<void>;
  refreshMembers: () => Promise<void>;
  refreshSubscriptions: () => Promise<void>;
  markSeen: (postId: string) => Promise<void>;
};

/** The same question about a subscription already on the device. `pinnedKey` is
 * the owner's key as the server reported it, so it answers directly. */
function isOwnSubscription(sub: Subscription, profile: Profile | null, spaces: Space[]): boolean {
  if (profile && sub.pinnedKey === profile.authorKey) return true;
  return isOwnCode(sub.code, profile, spaces);
}

export const useCommunityStore = create<CommunityState>((set, get) => {
  // Reading other people's writing — see communityFeed.ts. Outside the sync
  // machinery on purpose: those rows have no single writer.
  const feedReads = createCommunityFeed(set, get);
  // The user's own spaces and posts, and the reader's side of the feature.
  // Both ordinary sync-queue writers, unlike the feed above.
  const writing = createCommunityWriting(set, get);
  const reading = createCommunitySubscriptions(set, get);
  return {
  profile: null,
  spaces: [],
  posts: [],
  shared: {},
  items: [],
  sharedClaims: {},
  itemSources: {},
  subscriptions: [],
  memberships: [],
  feed: {},
  feedItems: {},
  mirroredLists: [],
  mirroredBoards: [],
  feedState: {},
  seen: {},
  blocked: {},
  reported: {},
  initialized: false,
  busy: false,

  init: async () => {
    const [
      profileRow,
      spaceRows,
      postRows,
      itemRows,
      subRows,
      memberRows,
      feedRows,
      feedItemRows,
      seenRows,
      blockedRow,
      reportedRow,
    ] = await Promise.all([
      db.preferences.get(PROFILE_PREF_KEY),
      db.spaces.toArray(),
      db.posts.toArray(),
      db.sharedItems.toArray(),
      db.subscriptions.toArray(),
      db.memberships.toArray(),
      db.feedPosts.toArray(),
      db.feedItems.toArray(),
      db.seenPosts.toArray(),
      db.preferences.get(BLOCKED_PREF_KEY),
      db.preferences.get(REPORTED_PREF_KEY),
    ]);
    const blocked = (blockedRow?.value as Record<string, BlockedAuthor> | undefined) ?? {};

    const livePosts = postRows.filter((p) => p.deleted !== 1);
    const liveItems = itemRows.filter((i) => i.deleted !== 1);
    const feed: Record<string, Post[]> = {};
    for (const row of feedRows) {
      // A cached post that failed verification should never have been stored,
      // but a build that changed the canonicalization could leave one behind.
      if (!row.verified) continue;
      (feed[row.code] ??= []).push(stripLocal(row));
    }
    for (const posts of Object.values(feed)) posts.sort((a, b) => b.publishedAt - a.publishedAt);

    const profile = (profileRow?.value as LocalProfile | undefined) ?? null;
    const liveSpaces = spaceRows.filter((s) => s.deleted !== 1);

    // A blocked author's spaces are dropped on the way in, not filtered at every
    // read site: a pull can legitimately hand back a subscription row the block
    // has already deleted (the delete op may still be queued), and one place
    // that enforces the block beats a dozen that remember to.
    //
    // A subscription to the user's *own* space is dropped the same way, and for
    // the same reason: `subscribe` now refuses to make one, but installs that
    // already have one (and a sync that hands it back) need it gone rather than
    // hidden — a filtered row is a duplicate waiting to reappear on the next
    // device. `init` is the one place this has to happen, since a completed
    // pull re-runs it.
    const unwanted = (r: (typeof subRows)[number]) =>
      r.deleted !== 1 && (!!blocked[r.pinnedKey] || isOwnSubscription(r, profile, liveSpaces));
    const liveSubs = subRows.filter((r) => r.deleted !== 1 && !unwanted(r));
    for (const row of subRows) {
      if (unwanted(row)) void get().unsubscribe(row.code);
    }

    // Rebuilt from Dexie rather than kept, for the reason `mirrorsFrom`
    // records: three shapes that must agree about which items made the cut.
    const mirrors = mirrorsFrom(feedItemRows, liveSubs);

    set({
      profile,
      spaces: liveSpaces.sort(byUpdatedDesc),
      posts: livePosts.map(stripLocal).sort(byPublishedDesc),
      shared: Object.fromEntries(livePosts.map((p) => [p.id, p.shared === 1])),
      items: liveItems.map(itemHeader).sort(byPublishedDesc),
      sharedClaims: Object.fromEntries(liveItems.map((i) => [i.id, i.shared === 1])),
      itemSources: Object.fromEntries(
        liveItems.flatMap((i) => {
          const sourceId = sourceIdOfPayload(i.kind, i.payload);
          return sourceId === null || i.sourceUpdatedAt === undefined
            ? []
            : [[i.id, { sourceId, sourceUpdatedAt: i.sourceUpdatedAt }] as const];
        }),
      ),
      subscriptions: liveSubs,
      memberships: withoutSelf(memberRows),
      feed,
      feedItems: mirrors.feedItems,
      mirroredLists: mirrors.mirroredLists,
      mirroredBoards: mirrors.mirroredBoards,
      seen: Object.fromEntries(seenRows.map((r) => [r.id, r.seenAt])),
      blocked,
      reported: (reportedRow?.value as Record<string, number> | undefined) ?? {},
      initialized: true,
    });

    // Reading someone else's space needs the network; do it opportunistically.
    if (get().profile && online()) void get().refreshSubscriptions();
  },

  /**
   * Create the profile — the single community opt-in.
   *
   * Also turns on server sync, because publishing and subscribing are
   * inherently server-side and a second switch would only be a second thing to
   * explain. `enableSync()` pulls before it seeds, so a user who recovered
   * their passphrase gets their existing spaces back rather than overwriting
   * them.
   *
   * The "Today" space is created here rather than lazily so that a brand-new
   * profile has somewhere to write immediately.
   */
  enableCommunity: async (displayName: string) => {
    const key = authorKey();
    if (!key) throw new Error('no signing key: passphrase onboarding has not completed');
    // Guarded here as well as in the UI, for the reason the syncEnabled
    // chokepoints exist: a future caller cannot switch the feature on by
    // forgetting to ask. The two opt-in screens accept the standards first.
    if (!communityTermsAccepted()) throw new Error('terms_required');

    set({ busy: true });
    try {
      const profile: Profile = {
        displayName: displayName.trim().slice(0, 120),
        authorKey: key,
        updatedAt: Date.now(),
      };
      await db.preferences.put({ key: PROFILE_PREF_KEY, value: { ...profile, dirty: 1 } });
      set({ profile });

      if (!get().spaces.some((s) => s.kind === 'today')) {
        const now = Date.now();
        const today: Space = {
          id: nowId(),
          name: 'Today',
          kind: 'today',
          ephemeralHours: TODAY_WINDOW_HOURS,
          approval: 'manual',
          shareCode: mintSpaceCode(key),
          createdAt: now,
          updatedAt: now,
        };
        await db.spaces.put({ ...today, dirty: 1 });
        set((s) => ({ spaces: [today, ...s.spaces] }));
      }

      // enableSync seeds the queue from every dirty row, which picks up the
      // profile and the space written above — so they need no explicit enqueue.
      // `seedCommunityQueue` also publishes the space's freshly minted code,
      // after its upsert, for the ordering reason described in `createSpace`.
      await useLibraryStore.getState().enableSync();
    } finally {
      set({ busy: false });
    }
  },

  /**
   * Leave the community.
   *
   * Removes the *server* copies and keeps the writing: every published post
   * drops back to unshared with its row, `publishedAt` and signature intact,
   * so re-joining republishes it unchanged. Only a factory reset removes the
   * writing itself.
   *
   * `syncEnabled` is deliberately left alone. Creating the profile turned it
   * on, but cards and reading lists may now depend on it, and leaving the
   * community is not a request to stop syncing everything else.
   */
  disableCommunity: async () => {
    set({ busy: true });
    try {
      for (const post of get().posts) {
        if (!get().shared[post.id]) continue;
        await db.posts.update(post.id, { shared: 0, dirty: 0 });
        await queued('post.delete', { id: post.id, spaceId: post.spaceId });
      }
      for (const space of get().spaces) {
        await db.spaces.update(space.id, { shareCode: undefined, dirty: 0 });
        await queued('space.delete', { id: space.id });
      }
      await queued('profile.delete', {});

      await db.preferences.delete(PROFILE_PREF_KEY);
      await db.memberships.clear();
      // Somebody else's writing, and it goes stale the moment access ends.
      await db.feedPosts.clear();
      await db.feedItems.clear();
      // Subscriptions are kept, marked revoked: re-joining restores them.
      for (const sub of get().subscriptions) {
        await db.subscriptions.update(sub.code, { status: 'revoked', dirty: 0 });
      }

      set((s) => ({
        profile: null,
        spaces: s.spaces.map((sp) => ({ ...sp, shareCode: undefined })),
        shared: {},
        memberships: [],
        feed: {},
        feedItems: {},
        mirroredLists: [],
        mirroredBoards: [],
        feedState: {},
        subscriptions: s.subscriptions.map((sub) => ({ ...sub, status: 'revoked' as const })),
      }));

      flush();
    } finally {
      set({ busy: false });
    }
  },

  saveProfile: async (patch) => {
    const current = get().profile;
    if (!current) return;
    const next: Profile = { ...current, ...patch, updatedAt: Date.now() };
    await db.preferences.put({ key: PROFILE_PREF_KEY, value: { ...next, dirty: 1 } });
    set({ profile: next });
    await queued('profile.set', next);
    flush();
  },

  setAvatar: async (file, filename) => {
    const url = await api.uploadAvatar(file, filename);
    await get().saveProfile({ avatarUrl: url });
  },

  decideMember: async (userId, spaceId, status) => {
    await db.memberships.update([userId, spaceId], {
      status,
      decidedAt: Date.now(),
      dirty: 1,
    });
    set((s) => ({
      memberships: s.memberships.map((m) =>
        m.userId === userId && m.spaceId === spaceId ? { ...m, status, decidedAt: Date.now() } : m,
      ),
    }));
    await queued('membership.decide', { userId, spaceId, status });
    flush();
  },

    ...feedReads,
    ...writing,
    ...reading,
  };
});

// Adopt whatever `libraryStore.pullFromServer()` brought back. Registered here
// rather than imported there, so the dependency runs one way only.
onCommunityPulled(() => {
  void useCommunityStore.getState().init();
});
