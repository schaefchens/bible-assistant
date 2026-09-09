import { db, stripLocal } from '@/db/dexie';
import { verifyItem, verifyPost } from '@/lib/postSignature';
import * as api from '@/services/api/community';
import { payloadHash } from '@/services/community/sharedPayload';
import type { Post, SharedItem, Subscription } from '@/types/domain';
import { useSettingsStore } from '@/store/settingsStore';
import { byPublishedDesc, mirrorsFrom, withoutSelf } from './communityRows';
import type { CommunityState } from './communityStore';

/**
 * Reading **other people's** writing: the cached feeds, who is subscribed to
 * you, and which pieces you have seen.
 *
 * Its own module because it is the one part of the community store that is not
 * the user's own data, and it plays by different rules for that reason.
 * CLAUDE.md puts it plainly: this "sits outside the machinery entirely",
 * because `dirty` / `deleted` and the pull's `pending*Ids` all assume one
 * writer per row and somebody else's writing has none. Nothing here rides the
 * sync queue, and nothing here is `syncEnabled`'s business.
 *
 * These are also the app's only *polled* reads — there is no push channel — so
 * they are what `useCommunityRefresh` repeats, and the reason `refreshMembers`
 * warns on failure where `refreshSubscriptions` stays silent: one runs once
 * per poll, where a silent failure is a quietly stale request inbox, and the
 * other runs per subscription, where offline is a normal state.
 *
 * A factory over `(set, get)` like `librarySync`, so the three action bodies
 * moved verbatim.
 */

type SetState = (
  partial: Partial<CommunityState> | ((s: CommunityState) => Partial<CommunityState>),
) => void;
type GetState = () => CommunityState;

/**
 * How long a room whose payload pass failed is left alone.
 *
 * The whole refresh runs on a 15-second timer while *any* subscription is
 * pending, so without this one unreachable item would be retried four times a
 * minute for as long as that lasts.
 */
const PAYLOAD_RETRY_MS = 60_000;
const payloadFailedAt = new Map<string, number>();

/**
 * Fetch the payloads of a room's shared items — the ones that are missing, or
 * whose content changed.
 *
 * `space.feed` carries headers only, so this is what actually makes a shared
 * plan renderable. It is a no-op after the first pass, which is what makes it
 * safe to hang off a poll: a header's `payloadHash` is signed, so "has this
 * changed?" is a string comparison against what is already stored.
 *
 * Sequential, and it gives up after two consecutive failures — the rule
 * `narrationGroup` uses, for the same reason: one item a room cannot serve must
 * not cost the rest of them, and two in a row is the network being gone rather
 * than one bad row.
 */
async function fetchPayloads(code: string, headers: SharedItem[]): Promise<void> {
  const failedAt = payloadFailedAt.get(code);
  if (failedAt !== undefined && Date.now() - failedAt < PAYLOAD_RETRY_MS) return;

  let consecutiveFailures = 0;
  for (const header of headers) {
    const cached = await db.feedItems.get(header.id);
    if (cached?.payload && cached.payloadHash === header.payloadHash) continue;
    try {
      const res = await api.getSpaceItem(code, header.id);
      // The header is signed and commits to this hash, so a payload that does
      // not match it is a server substitution — refused, not shown with a
      // caveat, exactly as a bad signature is.
      if (payloadHash(res.payload) !== header.payloadHash) {
        consecutiveFailures = 0;
        continue;
      }
      await db.feedItems.update(header.id, { payload: res.payload });
      consecutiveFailures = 0;
    } catch {
      if (++consecutiveFailures >= 2) {
        payloadFailedAt.set(code, Date.now());
        return;
      }
    }
  }
  payloadFailedAt.delete(code);
}

export function createCommunityFeed(set: SetState, get: GetState) {
  return {
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
     * Every post and every shared-item header is verified against the
     * subscription's pinned key before it is stored. A failure is dropped and
     * counted, never rendered with a caveat, and a *key* that no longer matches
     * stops the whole space rather than silently adopting the new one.
     *
     * Item **payloads** are a second round trip (see `fetchPayloads`), because
     * the feed is polled and a year-long plan is ~100KB.
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
              accepted.push(stripLocal(cached));
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

          // Shared plans and boards, on the same three rules: verify, refuse a
          // rollback, drop what the room no longer serves. `items` is optional
          // on the wire — an api.php older than this client answers without it,
          // and losing the shelf is a better failure than losing the feed.
          const acceptedItems: SharedItem[] = [];
          for (const item of res.items ?? []) {
            if (!verifyItem(item, sub.pinnedKey)) {
              refused++;
              continue;
            }
            const cachedItem = await db.feedItems.get(item.id);
            if (cachedItem && cachedItem.updatedAt > item.updatedAt) {
              acceptedItems.push(stripLocal(cachedItem));
              continue;
            }
            acceptedItems.push(item);
            await db.feedItems.put({
              ...item,
              code: sub.code,
              verified: true,
              fetchedAt,
              // A changed hash means a republish: drop the stale payload so the
              // pass below refetches rather than rendering the old plan under
              // the new header.
              payload: cachedItem?.payloadHash === item.payloadHash ? cachedItem.payload : undefined,
            });
          }
          const liveItems = new Set(acceptedItems.map((i) => i.id));
          const staleItems = (await db.feedItems.where('code').equals(sub.code).toArray()).filter(
            (i) => !liveItems.has(i.id),
          );
          for (const i of staleItems) await db.feedItems.delete(i.id);

          await fetchPayloads(sub.code, acceptedItems);

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
          // Rebuilt from Dexie rather than from `acceptedItems`, because the
          // payload pass above wrote there and this is the only read that sees
          // both halves. One derived array per kind — see `mirroredLists`.
          const subs = get().subscriptions.map((x) =>
            x.code === sub.code ? { ...x, ...restated } : x,
          );
          const mirrors = mirrorsFrom(await db.feedItems.toArray(), subs);
          set((s) => ({
            feed: { ...s.feed, [sub.code]: accepted },
            feedItems: mirrors.feedItems,
            mirroredLists: mirrors.mirroredLists,
            mirroredBoards: mirrors.mirroredBoards,
            feedState: {
              ...s.feedState,
              [sub.code]: { status: res.status, refused, keyChanged: false, fetchedAt },
            },
            subscriptions: subs,
          }));
        } catch {
          // Offline, revoked, or an api.php that predates this feature. The
          // cached posts and plans stay readable, which is the point of
          // caching them.
        }
      }
    },

    // Annotated because a factory's object literal has no contextual type to
    // infer from, unlike the same line inside `create<CommunityState>`.
    markSeen: async (postId: string) => {
      if (get().seen[postId]) return;
      const seenAt = Date.now();
      await db.seenPosts.put({ id: postId, seenAt });
      set((s) => ({ seen: { ...s.seen, [postId]: seenAt } }));
    },
  };
}
