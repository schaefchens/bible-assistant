import { db, PROFILE_PREF_KEY, stripLocal, type LocalProfile, type SyncOp } from '@/db/dexie';
import * as api from '@/services/api/community';
import { ApiError } from '@/services/api/client';
import type { Membership, Post, Space, Subscription } from '@/types/domain';

/**
 * The community half of the sync engine.
 *
 * `libraryStore.flushQueue()` and `pullFromServer()` stay "the one path that
 * pushes / reads" — that contract is documented on `settings.syncEnabled` and
 * is what makes the opt-in truthful, so this module deliberately does not open
 * its own. It supplies a routing table and a pull step, and `libraryStore`
 * gains three small hooks.
 *
 * Reading *other people's* spaces is not here at all: that is
 * `refreshSubscriptions()` in the store, which writes only to the `feedPosts`
 * cache and never to the queue.
 */

const COMMUNITY_OPS = [
  'profile.set',
  'profile.delete',
  'space.upsert',
  'space.delete',
  'spaceCode.set',
  'post.upsert',
  'post.delete',
  'subscription.upsert',
  'subscription.delete',
  'membership.decide',
] as const;

export type CommunityOp = (typeof COMMUNITY_OPS)[number];

const OP_SET = new Set<string>(COMMUNITY_OPS);

export function isCommunityOp(op: SyncOp['op']): op is CommunityOp {
  return OP_SET.has(op);
}

/**
 * Clear `dirty` only if the row still matches what we pushed.
 *
 * Same guard as the card and board cases in `flushQueue`: a newer local edit
 * made between enqueue and flush must stay dirty, or it would never be sent.
 */
async function settleIfUnchanged(
  table: 'spaces' | 'posts',
  id: string,
  updatedAt: number,
): Promise<void> {
  const cur = await db[table].get(id);
  if (cur && cur.updatedAt === updatedAt) await db[table].update(id, { dirty: 0 });
}

/**
 * Push one queued community op. Throws on failure so `flushQueue`'s existing
 * drop-or-retry logic (`shouldDropSyncOp`) applies unchanged.
 */
export async function flushCommunityOp(op: CommunityOp, payload: unknown): Promise<void> {
  switch (op) {
    case 'profile.set': {
      const profile = payload as LocalProfile;
      await api.setProfile(profile);
      const cur = (await db.preferences.get(PROFILE_PREF_KEY))?.value as LocalProfile | undefined;
      if (cur && cur.updatedAt === profile.updatedAt) {
        await db.preferences.put({ key: PROFILE_PREF_KEY, value: { ...cur, dirty: 0 } });
      }
      break;
    }
    case 'profile.delete':
      await api.deleteProfile();
      break;
    case 'space.upsert': {
      const space = payload as Space;
      await api.upsertSpace(space);
      await settleIfUnchanged('spaces', space.id, space.updatedAt);
      break;
    }
    case 'space.delete':
      await api.deleteSpace((payload as { id: string }).id);
      break;
    case 'spaceCode.set': {
      const { spaceId, code } = payload as { spaceId: string; code: string };
      await api.setSpaceCode(spaceId, code);
      break;
    }
    case 'post.upsert': {
      const post = payload as Post;
      try {
        await api.upsertPost(post);
      } catch (e) {
        // The server judges every publish against the content standards, and
        // the client asked first — so this only fires for a publish that was
        // queued offline, or a client that skipped the ask. The op is about to
        // be dropped as a permanent 4xx either way; drop the *claim* with it,
        // or the piece shows as published while no copy exists anywhere.
        if (e instanceof ApiError && e.message === 'content_refused') {
          await db.posts.update(post.id, { shared: 0, dirty: 0 });
        }
        throw e;
      }
      await settleIfUnchanged('posts', post.id, post.updatedAt);
      break;
    }
    case 'post.delete': {
      const { id, spaceId } = payload as { id: string; spaceId: string };
      await api.deletePost(id, spaceId);
      break;
    }
    case 'subscription.upsert': {
      const sub = payload as Subscription;
      await api.upsertSubscription(sub);
      const cur = await db.subscriptions.get(sub.code);
      if (cur && cur.updatedAt === sub.updatedAt) {
        await db.subscriptions.update(sub.code, { dirty: 0 });
      }
      break;
    }
    case 'subscription.delete':
      await api.deleteSubscription((payload as { code: string }).code);
      break;
    case 'membership.decide': {
      const m = payload as { userId: string; spaceId: string; status: 'accepted' | 'blocked' };
      await api.decideMember(m.userId, m.spaceId, m.status);
      await db.memberships.update([m.userId, m.spaceId], { dirty: 0 });
      break;
    }
  }
}

/**
 * Where a completed pull is delivered.
 *
 * A callback rather than an import so this module stays free of store
 * dependencies: `libraryStore` imports only this file, `communityStore`
 * imports this file *and* `libraryStore`, and nothing is circular.
 */
let onPulled: ((pulled: PulledCommunity) => void) | null = null;

export function onCommunityPulled(fn: (pulled: PulledCommunity) => void): void {
  onPulled = fn;
}

export type PulledCommunity = {
  profile: LocalProfile | null;
  spaces: Space[];
  posts: Post[];
  subscriptions: Subscription[];
  members: Membership[];
};

/**
 * Adopt the server's copy of the user's own community data.
 *
 * Every request is individually `.catch()`ed to a neutral default, the habit
 * `libraryStore` established for reading lists: a client can ship before
 * api.php is redeployed, and an unknown action must not cost the user
 * everything else in the pull.
 *
 * The merge rules match the rest of the store — a local row blocks a remote one
 * only while it has a genuinely pending op — with **one asymmetry that matters**:
 * posts absent from the server are never deleted locally. The server holds only
 * what is currently *shared*, so a draft, or a post withdrawn by leaving the
 * community, legitimately has no remote counterpart. Treating "missing" as
 * "deleted" here would quietly destroy the user's own writing, which is the one
 * outcome this feature must never produce.
 */
export async function pullCommunity(): Promise<PulledCommunity> {
  const [profileResp, spacesResp, subsResp, membersResp] = await Promise.all([
    api.getProfile().catch(() => ({ profile: null })),
    api.listSpaces().catch(() => ({ spaces: [] as Space[] })),
    api.listSubscriptions().catch(() => ({ subscriptions: [] as Subscription[] })),
    api.listMembers().catch(() => ({ members: [] as Membership[] })),
  ]);

  const remoteSpaces = spacesResp.spaces ?? [];
  // Posts are per space, so this has to follow the spaces round trip.
  const postLists = await Promise.all(
    remoteSpaces.map((s) => api.listPosts(s.id).catch(() => ({ posts: [] as Post[] }))),
  );
  const remotePosts = postLists.flatMap((r) => r.posts ?? []);

  const queued = await db.syncQueue.toArray();
  const pending = (op: CommunityOp, idOf: (payload: unknown) => string | undefined) => {
    const ids = new Set<string>();
    for (const q of queued) {
      if (q.op !== op) continue;
      const id = idOf(q.payload);
      if (id) ids.add(id);
    }
    return ids;
  };
  const pendingSpaces = pending('space.upsert', (p) => (p as Space | null)?.id);
  const pendingPosts = pending('post.upsert', (p) => (p as Post | null)?.id);
  const pendingSubs = pending('subscription.upsert', (p) => (p as Subscription | null)?.code);
  const profileBlocked = queued.some((q) => q.op === 'profile.set' || q.op === 'profile.delete');
  const membersBlocked = queued.some((q) => q.op === 'membership.decide');

  await db.transaction(
    'rw',
    [db.preferences, db.spaces, db.posts, db.subscriptions, db.memberships],
    async () => {
      const localProfile = (await db.preferences.get(PROFILE_PREF_KEY))?.value as
        | LocalProfile
        | undefined;
      const remoteProfile = profileResp.profile;
      if (
        remoteProfile &&
        !profileBlocked &&
        (!localProfile || remoteProfile.updatedAt > localProfile.updatedAt)
      ) {
        await db.preferences.put({
          key: PROFILE_PREF_KEY,
          value: { ...remoteProfile, dirty: 0 } satisfies LocalProfile,
        });
      }

      for (const space of remoteSpaces) {
        const local = await db.spaces.get(space.id);
        const blocked = local?.dirty === 1 && pendingSpaces.has(space.id);
        if (!local || (!blocked && space.updatedAt > local.updatedAt)) {
          await db.spaces.put({ ...space, dirty: 0, deleted: 0 });
        }
      }

      for (const post of remotePosts) {
        const local = await db.posts.get(post.id);
        const blocked = local?.dirty === 1 && pendingPosts.has(post.id);
        if (!local || (!blocked && post.updatedAt > local.updatedAt)) {
          // Present on the server => shared, by definition.
          await db.posts.put({ ...post, dirty: 0, deleted: 0, shared: 1 });
        }
      }

      for (const sub of subsResp.subscriptions ?? []) {
        const local = await db.subscriptions.get(sub.code);
        const blocked = local?.dirty === 1 && pendingSubs.has(sub.code);
        if (!local || (!blocked && sub.updatedAt > local.updatedAt)) {
          await db.subscriptions.put({ ...sub, dirty: 0, deleted: 0 });
        }
      }

      // Memberships are the server's to state — who has asked, and what the
      // owner decided — so a pull replaces them wholesale rather than merging.
      // Held back only while a decision of ours is still queued, which would
      // otherwise be visibly undone and then redone.
      if (!membersBlocked) {
        await db.memberships.clear();
        await db.memberships.bulkPut(
          (membersResp.members ?? []).map((m) => ({ ...m, dirty: 0 as const })),
        );
      }
    },
  );

  const pulled: PulledCommunity = {
    profile: profileResp.profile ? { ...profileResp.profile, dirty: 0 } : null,
    spaces: remoteSpaces,
    posts: remotePosts,
    subscriptions: subsResp.subscriptions ?? [],
    members: membersResp.members ?? [],
  };
  onPulled?.(pulled);
  return pulled;
}

/**
 * Queue everything community-side that has not reached the server.
 *
 * The catch-up pass `enableSync()` runs, and the price of dropping ops while
 * sync is off (see `syncQueueManager.enqueueOp`). Posts are the interesting
 * case: only `shared === 1` rows belong on the server, so a draft and a
 * deliberately withdrawn piece are both correctly left alone.
 */
export async function seedCommunityQueue(
  enqueue: (op: CommunityOp, payload: unknown) => Promise<boolean>,
): Promise<void> {
  const profile = (await db.preferences.get(PROFILE_PREF_KEY))?.value as LocalProfile | undefined;
  if (profile && profile.dirty === 1) {
    await enqueue('profile.set', stripLocal(profile));
  }

  for (const row of await db.spaces.toArray()) {
    if (row.dirty !== 1) continue;
    if (row.deleted === 1) {
      await enqueue('space.delete', { id: row.id });
      continue;
    }
    await enqueue('space.upsert', stripLocal(row));
    // `spaces.upsert` ignores shareCode on purpose (a stale client must not be
    // able to resurrect a retired code), so a code only reaches the server
    // through its own op — and only *after* the upsert above, since
    // `spaces.code.set` 404s on a space that isn't there and a 404 is dropped
    // as permanent. This is also the catch-up path for a space created while
    // sync was off, whose code was never pushed.
    if (row.shareCode) {
      await enqueue('spaceCode.set', { spaceId: row.id, code: row.shareCode });
    }
  }

  for (const row of await db.posts.toArray()) {
    if (row.dirty !== 1 || row.shared !== 1) continue;
    if (row.deleted === 1) await enqueue('post.delete', { id: row.id, spaceId: row.spaceId });
    else await enqueue('post.upsert', stripLocal(row));
  }

  for (const row of await db.subscriptions.toArray()) {
    if (row.dirty !== 1) continue;
    if (row.deleted === 1) await enqueue('subscription.delete', { code: row.code });
    else await enqueue('subscription.upsert', stripLocal(row));
  }

  for (const row of await db.memberships.toArray()) {
    if (row.dirty !== 1) continue;
    if (row.status === 'pending') continue; // not a decision
    await enqueue('membership.decide', {
      userId: row.userId,
      spaceId: row.spaceId,
      status: row.status,
    });
  }
}

