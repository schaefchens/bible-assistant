import { create } from 'zustand';
import {
  BLOCKED_PREF_KEY,
  db,
  PROFILE_PREF_KEY,
  REPORTED_PREF_KEY,
  type LocalProfile,
} from '@/db/dexie';
import { authorKey } from '@/lib/postSigning';
import { verifyPost } from '@/lib/postSignature';
import {
  codeCarriesFingerprint,
  codeMatchesKey,
  mintSpaceCode,
  parseSpaceCodeInput,
} from '@/lib/spaceCode';
import { communityTermsAccepted } from '@/lib/communityTerms';
import { getIdentity } from '@/lib/identity';
import * as api from '@/services/api/community';
import { onCommunityPulled } from '@/services/community/communitySync';
import { useLibraryStore, nowId } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { enqueueOp } from '@/store/syncQueueManager';
import type {
  BlockedAuthor,
  Membership,
  Post,
  Profile,
  ReportReason,
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
 * `feedPosts` cache. That is not sync: nothing about it is ever pushed, and
 * remote rows carry no `dirty` flag because they have no local writer.
 */

const TODAY_WINDOW_HOURS = 24;

export type FeedState = {
  status: api.MembershipStatus;
  /** Posts that failed signature verification, surfaced once per space. */
  refused: number;
  /** The pinned key no longer matches what the server returns. */
  keyChanged: boolean;
  fetchedAt: number;
};

type CommunityState = {
  profile: Profile | null;
  /** The user's own spaces. */
  spaces: Space[];
  /** The user's own posts, drafts included. */
  posts: Post[];
  /** Which of those currently have a copy on the server. */
  shared: Record<string, boolean>;
  subscriptions: Subscription[];
  /** Subscribers of the user's spaces. */
  memberships: Membership[];
  /** Cached posts of subscribed spaces, keyed by share code. */
  feed: Record<string, Post[]>;
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

function online(): boolean {
  return useLibraryStore.getState().online;
}

function flush(): void {
  if (online()) void useLibraryStore.getState().flushQueue();
}

/**
 * Enqueue one op and keep the pending count honest.
 *
 * `libraryStore`'s own writers adjust `pendingOps` inline from `enqueueOp`'s
 * return value; from out here a recount is simpler and cannot drift. Note that
 * `enqueueOp` drops the op entirely when sync is off, which is why the count
 * has to come from the queue rather than from the number of calls.
 */
async function queued(op: Parameters<typeof enqueueOp>[0], payload: unknown): Promise<void> {
  await enqueueOp(op, payload);
  await useLibraryStore.getState().refreshPendingOps();
}

/**
 * Is this share code one of the user's **own** spaces?
 *
 * You cannot read your own writing as a subscriber. Asking to anyway appends a
 * membership request to your own file — an invitation from yourself, sitting in
 * your own inbox — and then the space is listed twice everywhere a space can be
 * listed: the picker, `/spaces`, and the assistant's `read_space` lookup, where
 * two identical names are also an ambiguity error.
 *
 * Two tests, because the obvious one is not enough. The stored `shareCode`
 * catches the code as it is today; the fingerprint catches every other code
 * that was ever *theirs* — one they have since rotated away, or one minted for a
 * space that only exists on another device — because it commits to the signing
 * key, and that key is the same for every space one author owns.
 * `codeCarriesFingerprint` guards the second test: `codeMatchesKey` is
 * vacuously true for a code that carries none.
 *
 * **Exported because `/subscribe/:code` has to reach the same answer.** That
 * route used to ask the question its own way — the stored `shareCode`, or the
 * author key the *server* reported for the code — which meant a code the server
 * no longer resolves (rotated away, or minted on another device that has not
 * synced) failed its lookup and was reported as a malformed code, while the
 * Rooms field refused the very same code as the user's own. One question, one
 * answer.
 */
export function isOwnCode(code: string, profile: Profile | null, spaces: Space[]): boolean {
  if (spaces.some((sp) => sp.shareCode === code)) return true;
  return !!profile && codeCarriesFingerprint(code) && codeMatchesKey(code, profile.authorKey);
}

/**
 * Drop a membership request the user made to their own space.
 *
 * Older installs have one: asking to read your own space used to be allowed,
 * and it left a request from yourself sitting in your own inbox — a decision
 * nobody can sensibly make, and a "1 pending" badge that never clears. The row
 * stays in the owner's file on the server (nothing here deletes another
 * record's history); it is simply not a request, so it is not shown as one.
 */
function withoutSelf(rows: Membership[]): Membership[] {
  const me = getIdentity()?.userId;
  return me ? rows.filter((m) => m.userId !== me) : rows;
}

/** The same question about a subscription already on the device. `pinnedKey` is
 * the owner's key as the server reported it, so it answers directly. */
function isOwnSubscription(sub: Subscription, profile: Profile | null, spaces: Space[]): boolean {
  if (profile && sub.pinnedKey === profile.authorKey) return true;
  return isOwnCode(sub.code, profile, spaces);
}

function stripLocalPost(row: Post & { dirty?: number; deleted?: number; shared?: number }): Post {
  const { dirty: _d, deleted: _x, shared: _s, ...rest } = row;
  void _d;
  void _x;
  void _s;
  return rest;
}

export const useCommunityStore = create<CommunityState>((set, get) => ({
  profile: null,
  spaces: [],
  posts: [],
  shared: {},
  subscriptions: [],
  memberships: [],
  feed: {},
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
      subRows,
      memberRows,
      feedRows,
      seenRows,
      blockedRow,
      reportedRow,
    ] = await Promise.all([
      db.preferences.get(PROFILE_PREF_KEY),
      db.spaces.toArray(),
      db.posts.toArray(),
      db.subscriptions.toArray(),
      db.memberships.toArray(),
      db.feedPosts.toArray(),
      db.seenPosts.toArray(),
      db.preferences.get(BLOCKED_PREF_KEY),
      db.preferences.get(REPORTED_PREF_KEY),
    ]);
    const blocked = (blockedRow?.value as Record<string, BlockedAuthor> | undefined) ?? {};

    const livePosts = postRows.filter((p) => p.deleted !== 1);
    const feed: Record<string, Post[]> = {};
    for (const row of feedRows) {
      // A cached post that failed verification should never have been stored,
      // but a build that changed the canonicalization could leave one behind.
      if (!row.verified) continue;
      (feed[row.code] ??= []).push(stripLocalPost(row));
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

    set({
      profile,
      spaces: liveSpaces.sort(byUpdatedDesc),
      posts: livePosts.map(stripLocalPost).sort(byPublishedDesc),
      shared: Object.fromEntries(livePosts.map((p) => [p.id, p.shared === 1])),
      subscriptions: liveSubs,
      memberships: withoutSelf(memberRows),
      feed,
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

  createSpace: async (name) => {
    const key = authorKey();
    if (!get().profile || !key) return null;
    const now = Date.now();
    const space: Space = {
      id: nowId(),
      name: name.trim().slice(0, 120) || 'Untitled',
      kind: 'custom',
      approval: 'manual',
      // Minted here rather than behind a button. A code is an address, not a
      // key (lib/spaceCode.ts), so a space having one costs nothing and
      // "create a code" was a step between the user and sharing.
      shareCode: mintSpaceCode(key),
      createdAt: now,
      updatedAt: now,
    };
    await db.spaces.put({ ...space, dirty: 1 });
    set((s) => ({ spaces: [space, ...s.spaces] }));
    // Order matters: `spaces.upsert` deliberately ignores shareCode, so the
    // code needs its own op — and `spaces.code.set` 404s if the space is not
    // there yet, which `shouldDropSyncOp` would treat as permanent and drop.
    // The queue is ordered by createdAt and flushed sequentially, so enqueuing
    // the upsert first is what keeps this correct.
    await queued('space.upsert', space);
    await queued('spaceCode.set', { spaceId: space.id, code: space.shareCode });
    flush();
    return space;
  },

  saveSpace: async (space) => {
    const next: Space = { ...space, updatedAt: Date.now() };
    await db.spaces.put({ ...next, dirty: 1 });
    set((s) => ({ spaces: s.spaces.map((sp) => (sp.id === next.id ? next : sp)).sort(byUpdatedDesc) }));
    await queued('space.upsert', next);
    flush();
  },

  deleteSpace: async (id) => {
    const space = get().spaces.find((s) => s.id === id);
    // The one space nobody gets to delete: it is where a new profile writes.
    if (!space || space.kind === 'today') return;
    await db.spaces.update(id, { deleted: 1, dirty: 1 });
    const doomed = get().posts.filter((p) => p.spaceId === id);
    for (const post of doomed) await db.posts.update(post.id, { deleted: 1, dirty: 1 });
    set((s) => ({
      spaces: s.spaces.filter((sp) => sp.id !== id),
      posts: s.posts.filter((p) => p.spaceId !== id),
      memberships: s.memberships.filter((m) => m.spaceId !== id),
    }));
    await queued('space.delete', { id });
    flush();
  },

  /**
   * Publish (or rotate) a space's share code.
   *
   * Minted here rather than on the server because the second half of a code is
   * a fingerprint of this user's public key — see `lib/spaceCode.ts`. Rotating
   * revokes every existing subscriber, which is the only revocation mechanism
   * there is.
   */
  shareSpace: async (spaceId, rotate = false) => {
    const key = authorKey();
    const space = get().spaces.find((s) => s.id === spaceId);
    if (!key || !space) return null;
    if (space.shareCode && !rotate) return space.shareCode;

    const code = mintSpaceCode(key);
    const next: Space = { ...space, shareCode: code, updatedAt: Date.now() };
    await db.spaces.put({ ...next, dirty: 0 });
    set((s) => ({ spaces: s.spaces.map((sp) => (sp.id === spaceId ? next : sp)) }));
    if (rotate) {
      // Rotating invalidates every membership of this space server-side.
      await db.memberships.where('spaceId').equals(spaceId).delete();
      set((s) => ({ memberships: s.memberships.filter((m) => m.spaceId !== spaceId) }));
    }
    await queued('spaceCode.set', { spaceId, code });
    flush();
    return code;
  },

  /** Save a draft or an edit. Never publishes; `publishPost` does that. */
  savePost: async (post) => {
    const next: Post = { ...post, updatedAt: Date.now() };
    const wasShared = get().shared[post.id] === true;
    // An edit to a published post has to be re-signed: the signature covers
    // `updatedAt`, the title and the body.
    const republished = wasShared ? await signed(next) : next;
    await db.posts.put({ ...republished, dirty: 1, shared: wasShared ? 1 : 0 });
    set((s) => ({
      posts: [...s.posts.filter((p) => p.id !== post.id), republished].sort(byPublishedDesc),
    }));
    if (wasShared) {
      await queued('post.upsert', republished);
      flush();
    }
  },

  publishPost: async (id) => {
    const post = get().posts.find((p) => p.id === id);
    if (!post || !get().profile) return;

    // Judged before it is signed and queued. `posts.upsert` judges it again on
    // the server — this call is what turns that refusal into something the
    // author can read at the moment they pressed publish, because the publish
    // itself rides the sync queue and a refusal there would only drop the op.
    //
    // A transport failure is not a refusal: offline publishing has to keep
    // working, and the server has the final say either way.
    try {
      const verdict = await api.checkModeration({
        title: post.title,
        body: post.body,
        language: post.language,
      });
      if (!verdict.ok) {
        const err = new Error('content_refused');
        (err as Error & { reason?: string }).reason = verdict.reason;
        throw err;
      }
    } catch (e) {
      if (e instanceof Error && e.message === 'content_refused') throw e;
      // Anything else (offline, 5xx, no key) falls through to publishing.
    }

    const now = Date.now();
    // publishedAt is immutable once set — it is signed, and re-publishing after
    // a withdrawal must keep the original date.
    const stamped: Post = { ...post, publishedAt: post.publishedAt || now, updatedAt: now };
    const out = await signed(stamped);
    if (!out.signature) throw new Error('cannot sign: passphrase onboarding has not completed');
    await db.posts.put({ ...out, dirty: 1, shared: 1 });
    set((s) => ({
      posts: s.posts.map((p) => (p.id === id ? out : p)).sort(byPublishedDesc),
      shared: { ...s.shared, [id]: true },
    }));
    await queued('post.upsert', out);
    flush();
  },

  /** Withdraw one post from the server, keeping it on the device. */
  unpublishPost: async (id) => {
    const post = get().posts.find((p) => p.id === id);
    if (!post) return;
    await db.posts.update(id, { shared: 0, dirty: 0 });
    set((s) => ({ shared: { ...s.shared, [id]: false } }));
    await queued('post.delete', { id, spaceId: post.spaceId });
    flush();
  },

  /** An explicit delete: gone from the device as well as the server. */
  deletePost: async (id) => {
    const post = get().posts.find((p) => p.id === id);
    if (!post) return;
    await db.posts.update(id, { deleted: 1, dirty: 1 });
    set((s) => ({ posts: s.posts.filter((p) => p.id !== id) }));
    await queued('post.delete', { id, spaceId: post.spaceId });
    flush();
  },

  /**
   * Ask to read a space, from a code someone gave you.
   *
   * The code only *locates* the space — this call creates a request, and the
   * owner accepting it is what grants access (`status` comes back `'pending'`
   * unless they set the space to auto-approval). So a subscription row can
   * exist for a while with nothing readable behind it, which is why
   * `refreshSubscriptions` retries.
   *
   * The key we pin is a separate question from access. When the code carries a
   * fingerprint (every generated one does) it is checked first, which ties the
   * key to the person who sent the code over a channel the server does not
   * control; a mismatch throws, because there is no benign reading of it. A
   * code with no fingerprint — a future named one — pins on first contact
   * instead, and the author's fingerprint is comparable by hand in Settings.
   */
  subscribe: async (rawCode) => {
    // Tolerant on the way in: a bare code, a link in either shape, or the whole
    // message they were sent. See parseSpaceCodeInput.
    const code = parseSpaceCodeInput(rawCode);
    if (!code) throw new Error('invalid_code');
    const me = get().profile;
    if (!me) throw new Error('profile_required');
    if (!communityTermsAccepted()) throw new Error('terms_required');
    // Before the network, so a request from the owner never reaches their own
    // members file. api.php refuses it too — this is the half that can explain
    // itself, and the half that works offline.
    if (isOwnCode(code, me, get().spaces)) throw new Error('own_space');
    // A code that carries a fingerprint can be matched against the block list
    // *before* asking, so a blocked author never even gets a membership row
    // appended in their file. A code without one is caught after the response.
    for (const b of Object.values(get().blocked)) {
      if (codeMatchesKey(code, b.authorKey)) throw new Error('author_blocked');
    }

    const res = await api.requestSpace(code);
    if (res.owner.authorKey && get().blocked[res.owner.authorKey]) {
      throw new Error('author_blocked');
    }
    // api.php refuses a space whose owner has no published key (409
    // space_not_ready), so this is a backstop against an older backend that
    // does not — there is nothing to pin, so nothing could ever be verified.
    if (!res.owner.authorKey) throw new Error('space_not_ready');
    if (!codeMatchesKey(code, res.owner.authorKey)) throw new Error('key_mismatch');

    const now = Date.now();
    const existing = get().subscriptions.find((s) => s.code === code);
    const sub: Subscription = {
      code,
      spaceName: res.space.name,
      spaceEmoji: res.space.emoji ?? undefined,
      spaceKind: res.space.kind,
      spaceEphemeralHours: res.space.ephemeralHours ?? undefined,
      ownerName: res.owner.displayName,
      ownerAvatarUrl: res.owner.avatarUrl ?? undefined,
      status: res.status === 'blocked' ? 'revoked' : res.status,
      // Pinned once, on first contact. A later change is a re-pin decision the
      // user makes, never a silent adoption — see refreshSubscriptions.
      pinnedKey: existing?.pinnedKey ?? res.owner.authorKey,
      keyPinnedAt: existing?.keyPinnedAt ?? now,
      addedAt: existing?.addedAt ?? now,
      updatedAt: now,
    };
    await db.subscriptions.put({ ...sub, dirty: 1 });
    set((s) => ({
      subscriptions: [...s.subscriptions.filter((x) => x.code !== code), sub],
    }));
    await queued('subscription.upsert', sub);
    flush();

    if (sub.status === 'accepted') await get().refreshSubscriptions();
    return res.status;
  },

  unsubscribe: async (code) => {
    await db.subscriptions.update(code, { deleted: 1, dirty: 1 });
    await db.feedPosts.where('code').equals(code).delete();
    set((s) => {
      const feed = { ...s.feed };
      const feedState = { ...s.feedState };
      delete feed[code];
      delete feedState[code];
      return { subscriptions: s.subscriptions.filter((x) => x.code !== code), feed, feedState };
    });
    await queued('subscription.delete', { code });
    flush();
  },

  codesOfAuthor: (authorKey) =>
    get()
      .subscriptions.filter((s) => s.pinnedKey === authorKey)
      .map((s) => s.code),

  /**
   * Refuse an author entirely.
   *
   * Blocking is keyed by the author's **signing key**, which is derived from
   * their mnemonic and therefore the same in every space they own — so one tap
   * takes out every space of theirs at once, which is what a block has to mean.
   * The share code couldn't do this: one author hands out one code per space.
   *
   * It needs no server support, and that is not a shortcut. Nobody can push
   * anything at a reader here — a subscriber *pulls* `space.feed` — so removing
   * the subscriptions and refusing to add them back is a complete block from
   * the reading side. What it deliberately does not do is tell the author, who
   * simply stops being read.
   *
   * The block list is local: the subscription deletes sync (so the spaces
   * disappear on the user's other devices too), but "don't let them back in"
   * is remembered per device. Syncing it would need a server action and a
   * merge rule for a list whose whole purpose is to be enforced offline.
   */
  blockAuthor: async (authorKey, displayName) => {
    const entry: BlockedAuthor = { authorKey, displayName, blockedAt: Date.now() };
    const blocked = { ...get().blocked, [authorKey]: entry };
    await db.preferences.put({ key: BLOCKED_PREF_KEY, value: blocked });
    set({ blocked });
    for (const code of get().codesOfAuthor(authorKey)) {
      await get().unsubscribe(code);
    }
  },

  unblockAuthor: async (authorKey) => {
    const blocked = { ...get().blocked };
    delete blocked[authorKey];
    await db.preferences.put({ key: BLOCKED_PREF_KEY, value: blocked });
    set({ blocked });
  },

  /**
   * Report a piece, or a whole space, to the app's moderators.
   *
   * Recorded locally as well, keyed by post id (or by share code for a space),
   * so the UI can say "reported" rather than invite a second one — the report
   * itself is idempotent per reporter and target on the server for the same
   * reason.
   */
  reportContent: async ({ code, postId, reason, note }) => {
    await api.reportContent({ code, postId, reason, note });
    const key = postId ?? code;
    const reported = { ...get().reported, [key]: Date.now() };
    await db.preferences.put({ key: REPORTED_PREF_KEY, value: reported });
    set({ reported });
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

  /**
   * Re-read who is asking to read the user's spaces.
   *
   * Cheap — one small JSON file — which is why it can be polled while the
   * community screens are open. Without it an author sits looking at a request
   * list from whenever the app last booted, and a subscriber who just pasted
   * their code appears not to have.
   *
   * Held back while a decision of ours is still queued, for the same reason
   * `pullCommunity` holds back: it would be visibly undone and then redone.
   */
  refreshMembers: async () => {
    if (!get().profile || !useSettingsStore.getState().syncEnabled) return;
    const queued = await db.syncQueue.toArray();
    if (queued.some((q) => q.op === 'membership.decide')) return;
    try {
      const { members } = await api.listMembers();
      const rows = withoutSelf(members ?? []).map((m) => ({ ...m, dirty: 0 as const }));
      await db.transaction('rw', [db.memberships], async () => {
        await db.memberships.clear();
        await db.memberships.bulkPut(rows);
      });
      set({ memberships: withoutSelf(members ?? []) });
    } catch (e) {
      // Warned rather than swallowed: this runs once per poll and its failure
      // means the author's request inbox is quietly stale, which is invisible
      // otherwise. (`refreshSubscriptions` below stays silent on purpose — it
      // runs per subscription and being offline is a normal state there, so a
      // warning would be per-space console spam.)
      console.warn('[community] refreshMembers failed', e);
    }
  },

  /**
   * Refresh every subscribed space.
   *
   * Not part of `pullFromServer`, because this reads other people's data into a
   * cache rather than syncing the user's own — but gated the same way, on the
   * profile *and* on `syncEnabled`: someone who has turned syncing off has said
   * they want the app off the network.
   *
   * Every post is verified against the subscription's pinned key before it is
   * stored. A failure is dropped and counted, never rendered with a caveat, and
   * a *key* that no longer matches stops the whole space rather than silently
   * adopting the new one.
   */
  refreshSubscriptions: async () => {
    if (!get().profile || !useSettingsStore.getState().syncEnabled) return;

    for (const sub of get().subscriptions) {
      if (sub.status === 'revoked') continue;
      try {
        const res = await api.getSpaceFeed(sub.code);
        const fetchedAt = Date.now();

        if (res.owner.authorKey && res.owner.authorKey !== sub.pinnedKey) {
          set((s) => ({
            feedState: {
              ...s.feedState,
              [sub.code]: { status: res.status, refused: 0, keyChanged: true, fetchedAt },
            },
          }));
          continue;
        }

        const accepted: Post[] = [];
        let refused = 0;
        for (const post of res.posts ?? []) {
          if (!verifyPost(post, sub.pinnedKey)) {
            refused++;
            continue;
          }
          const cached = await db.feedPosts.get(post.id);
          // Never go backwards: `updatedAt` is signed, so a server replaying an
          // older-but-valid version is detectable exactly here.
          if (cached && cached.updatedAt > post.updatedAt) {
            accepted.push(stripLocalPost(cached));
            continue;
          }
          accepted.push(post);
          await db.feedPosts.put({ ...post, code: sub.code, verified: true, fetchedAt });
        }

        // Drop cached posts the space no longer serves (deleted, or expired).
        const live = new Set(accepted.map((p) => p.id));
        const stale = (await db.feedPosts.where('code').equals(sub.code).toArray()).filter(
          (p) => !live.has(p.id),
        );
        for (const p of stale) await db.feedPosts.delete(p.id);

        accepted.sort(byPublishedDesc);
        // Every refresh restates what the space is, so a renamed space, a
        // renamed author, or a space that became ephemeral stays current
        // without a re-subscribe. Deliberately not marked dirty: this is the
        // owner's data arriving, not a local edit to push back.
        const restated: Partial<Subscription> = {
          spaceName: res.space.name,
          spaceEmoji: res.space.emoji ?? undefined,
          spaceKind: res.space.kind,
          spaceEphemeralHours: res.space.ephemeralHours ?? undefined,
          ownerName: res.owner.displayName,
          ownerAvatarUrl: res.owner.avatarUrl ?? undefined,
          ...(res.status !== 'blocked' ? { status: res.status } : {}),
        };
        await db.subscriptions.update(sub.code, restated);
        set((s) => ({
          feed: { ...s.feed, [sub.code]: accepted },
          feedState: {
            ...s.feedState,
            [sub.code]: { status: res.status, refused, keyChanged: false, fetchedAt },
          },
          subscriptions: s.subscriptions.map((x) =>
            x.code === sub.code ? { ...x, ...restated } : x,
          ),
        }));
      } catch {
        // Offline, revoked, or an api.php that predates this feature. The
        // cached posts stay readable, which is the point of caching them.
      }
    }
  },

  markSeen: async (postId) => {
    if (get().seen[postId]) return;
    const seenAt = Date.now();
    await db.seenPosts.put({ id: postId, seenAt });
    set((s) => ({ seen: { ...s.seen, [postId]: seenAt } }));
  },
}));

/** Sign a post for publishing. Imported lazily so tree-shaking keeps the
 * crypto out of bundles that never publish. */
async function signed(post: Post): Promise<Post> {
  const { signPost } = await import('@/lib/postSigning');
  const sig = signPost(post);
  return sig ? { ...post, ...sig } : post;
}

function byUpdatedDesc(a: { updatedAt: number }, b: { updatedAt: number }): number {
  return b.updatedAt - a.updatedAt;
}

function byPublishedDesc(a: Post, b: Post): number {
  // Drafts (publishedAt 0) sort to the top: they are what the author is
  // working on, and they are the only rows the author can act on next.
  const ak = a.publishedAt || Number.MAX_SAFE_INTEGER;
  const bk = b.publishedAt || Number.MAX_SAFE_INTEGER;
  return bk - ak;
}

// Adopt whatever `libraryStore.pullFromServer()` brought back. Registered here
// rather than imported there, so the dependency runs one way only.
onCommunityPulled(() => {
  void useCommunityStore.getState().init();
});
