import { BLOCKED_PREF_KEY, db, REPORTED_PREF_KEY } from '@/db/dexie';
import { codeMatchesKey, parseSpaceCodeInput } from '@/lib/spaceCode';
import { communityTermsAccepted } from '@/lib/communityTerms';
import * as api from '@/services/api/community';
import { copyBoard, copyPlan } from '@/services/community/sharedItems';
import { useLibraryStore } from '@/store/libraryStore';
import type { BlockedAuthor, ReportReason, Subscription } from '@/types/domain';
import { flush, queued } from './communityOps';
import { isOwnCode } from './communityRows';
import type { CommunityState } from './communityStore';

/**
 * The reader's side: who the user follows, and who they refuse.
 *
 * Subscribing, blocking and reporting are one concern seen from three angles —
 * every one of them is a decision a *reader* makes about somebody else's
 * writing — which is why `blockAuthor` deletes subscriptions and
 * `reportContent` sits beside it rather than with the writing. Taking a copy
 * of somebody's plan or board is the fourth angle, and belongs here for the
 * same reason: nothing about it touches the user's own rooms.
 *
 * Two rules in here are the ones worth not breaking. A block is keyed by the
 * author's **signing key**, never by space or share code: that key comes from
 * their mnemonic, so it is the same in every space they own, which is what
 * lets one tap remove all of them. And `subscribe` refuses the user's own
 * spaces *before* the network, so it can explain — `space.request` refuses
 * again with 409, because a modified client would otherwise skip the first.
 *
 * A factory over `(set, get)`, so the action bodies moved verbatim.
 */

type SetState = (
  partial: Partial<CommunityState> | ((s: CommunityState) => Partial<CommunityState>),
) => void;
type GetState = () => CommunityState;


// Every parameter below is annotated. Inside `create<CommunityState>` these
// would be inferred from the state type; from a factory they are not, and an
// un-annotated one is an implicit `any` that `noImplicitAny` rejects. Same
// reason `communityFeed.markSeen(postId: string)` carries its type.
export function createCommunitySubscriptions(set: SetState, get: GetState) {
  return {
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
  subscribe: async (rawCode: string) => {
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

  unsubscribe: async (code: string) => {
    await db.subscriptions.update(code, { deleted: 1, dirty: 1 });
    await db.feedPosts.where('code').equals(code).delete();
    await db.feedItems.where('code').equals(code).delete();
    set((s) => {
      const feed = { ...s.feed };
      const feedItems = { ...s.feedItems };
      const feedState = { ...s.feedState };
      delete feed[code];
      delete feedItems[code];
      delete feedState[code];
      return {
        subscriptions: s.subscriptions.filter((x) => x.code !== code),
        feed,
        feedItems,
        feedState,
        // The mirrors are derived, so they are filtered rather than rebuilt:
        // the rows they came from are gone from Dexie a line above.
        mirroredLists: s.mirroredLists.filter((m) => m.code !== code),
        mirroredBoards: s.mirroredBoards.filter((m) => m.code !== code),
      };
    });
    await queued('subscription.delete', { code });
    flush();
  },

  codesOfAuthor: (authorKey: string) =>
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
  blockAuthor: async (authorKey: string, displayName: string) => {
    const entry: BlockedAuthor = { authorKey, displayName, blockedAt: Date.now() };
    const blocked = { ...get().blocked, [authorKey]: entry };
    await db.preferences.put({ key: BLOCKED_PREF_KEY, value: blocked });
    set({ blocked });
    for (const code of get().codesOfAuthor(authorKey)) {
      await get().unsubscribe(code);
    }
  },

  unblockAuthor: async (authorKey: string) => {
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
  /**
   * Fork somebody else's shared plan into the user's own library.
   *
   * The live mirror is read-only and stays that way — this is the escape
   * hatch, and it is a genuine fork: new ids at every level, no link back, and
   * the author's later edits never reach it.
   *
   * **Progress does not come with it**, which follows from the ids rather than
   * being a separate decision. `ReadingProgress` is keyed by list id and a tick
   * by entry id, so a copy that kept the author's ids would share one progress
   * row with the mirror and ticking one would tick the other.
   */
  copySharedList: async (listId: string) => {
    const mirror = get().mirroredLists.find((m) => m.list.id === listId);
    if (!mirror) return null;
    const copy = copyPlan(mirror.list, mirror.list.name);
    await useLibraryStore.getState().upsertReadingList(copy);
    return copy.id;
  },

  /** The same for a board — see `copyBoard` on why `cardIds` and `freeform`
   * both have to be remapped. */
  copySharedBoard: async (boardId: string) => {
    const mirror = get().mirroredBoards.find((m) => m.board.id === boardId);
    if (!mirror) return null;
    const copy = copyBoard(mirror, mirror.board.name);
    const lib = useLibraryStore.getState();
    // Cards first: a board naming ids that are not in the table yet renders as
    // an empty board for however long the writes take.
    for (const card of copy.cards) await lib.upsertCard(card);
    await lib.upsertBoard(copy.board);
    return copy.board.id;
  },

  reportContent: async ({
    code,
    postId,
    reason,
    note,
  }: {
    code: string;
    postId?: string;
    reason: ReportReason;
    note?: string;
  }) => {
    await api.reportContent({ code, postId, reason, note });
    const key = postId ?? code;
    const reported = { ...get().reported, [key]: Date.now() };
    await db.preferences.put({ key: REPORTED_PREF_KEY, value: reported });
    set({ reported });
  },
  };
}
