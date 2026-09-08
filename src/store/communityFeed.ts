import { db, stripLocal } from '@/db/dexie';
import { verifyPost } from '@/lib/postSignature';
import * as api from '@/services/api/community';
import type { Post, Subscription } from '@/types/domain';
import { useSettingsStore } from '@/store/settingsStore';
import { byPublishedDesc, withoutSelf } from './communityRows';
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
