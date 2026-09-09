import { db } from '@/db/dexie';
import { authorKey } from '@/lib/postSigning';
import { mintSpaceCode } from '@/lib/spaceCode';
import * as api from '@/services/api/community';
import { useLibraryStore, nowId } from '@/store/libraryStore';
import {
  buildBoardPayload,
  buildPlanPayload,
  payloadBytes,
  payloadHash,
} from '@/services/community/sharedPayload';
import type { Board, Card, Post, SharedItem, SharedItemKind, Space } from '@/types/domain';
import { byPublishedDesc, byUpdatedDesc, sourceIdOfPayload } from './communityRows';
import { useSettingsStore } from '@/store/settingsStore';
import { flush, queued } from './communityOps';
import type { CommunityState } from './communityStore';

/**
 * The user's **own** writing: their spaces, the pieces in them, and the plans
 * and boards they have shared there.
 *
 * The mirror of `communityFeed`, which owns everything that is somebody
 * else's. These rows have exactly one writer, so unlike the feed they play by
 * the ordinary rules — `dirty` / `deleted`, the sync queue, and `syncEnabled`.
 *
 * What holds this file together is the local-first ownership rule: the writing
 * lives in Dexie and the server holds a copy of what is currently *shared*.
 * Hence two different deletes (`deletePost` removes it everywhere;
 * `unpublishPost` drops only the `shared` claim and leaves the row readable),
 * and hence `publishedAt` being immutable — it is signed, so withdrawing and
 * re-sharing has to keep both the date and the original signature valid. A
 * shared item is the same pair under different names, `deleteItem` and
 * `withdrawItem`, which is why it belongs in this file rather than one of its
 * own: the split between these modules is ownership, not entity.
 *
 * A factory over `(set, get)` like `librarySync` and `createCommunityFeed`, so
 * every action body below moved verbatim.
 */

type SetState = (
  partial: Partial<CommunityState> | ((s: CommunityState) => Partial<CommunityState>),
) => void;
type GetState = () => CommunityState;

/** Sign a post for publishing. Imported lazily so tree-shaking keeps the
 * crypto out of bundles that never publish. */
async function signed(post: Post): Promise<Post> {
  const { signPost } = await import('@/lib/postSigning');
  const sig = signPost(post);
  return sig ? { ...post, ...sig } : post;
}


/**
 * The cards a board actually holds, in its own order.
 *
 * `board.cardIds` is resolved against the live cards rather than trusted:
 * deleting a card does not rewrite the boards holding it, so the stored ids
 * overcount. `buildBoardPayload` drops the danglers again, but resolving here
 * is what decides *which* cards travel.
 */
function boardCardsOf(board: Board, cards: Card[]): Card[] {
  const byId = new Map(cards.map((c) => [c.id, c]));
  return board.cardIds.map((id) => byId.get(id)).filter((c): c is Card => c !== undefined);
}

/**
 * Build, sign and queue one shared item — the body `shareList`, `shareBoard`
 * and `republishItem` all share.
 *
 * Moderation is asked first, exactly as `publishPost` does and for the same
 * reason: publishing rides the sync queue, where a 422 would otherwise surface
 * as an item that silently never shares. The server judges it again in the
 * write path, which is the check that actually counts.
 */
async function publishItem(
  set: SetState,
  get: GetState,
  kind: SharedItemKind,
  spaceId: string,
  title: string,
  payload: string,
  sourceUpdatedAt: number,
  sourceId: string,
  existing?: { id: string; publishedAt: number; createdAt: number },
): Promise<void> {
  if (!get().profile) return;
  // The app's language, the same source `write_post` uses. A plan carries one
  // because it is signed and the moderator is told which language to judge in;
  // the passages themselves have their own translation per entry.
  const language = useSettingsStore.getState().locale;

  try {
    const verdict = await api.checkModeration({ title, body: payload, language });
    if (!verdict.ok) {
      const err = new Error('content_refused');
      (err as Error & { reason?: string }).reason = verdict.reason;
      throw err;
    }
  } catch (e) {
    if (e instanceof Error && e.message === 'content_refused') throw e;
    // Offline, 5xx, no key — publish anyway; the server has the final say.
  }

  // Sharing the same list into the same room twice is an **update**, not a
  // second copy. `republishItem` passes the row it is refreshing, but
  // `shareList` cannot — and the assistant's `share_plan` has no sheet in front
  // of it to notice, so without this a second ask would leave two items in the
  // room with the same name. Matched on the source rather than the title,
  // because a renamed plan is still the same plan.
  const already =
    existing ??
    (await db.sharedItems.toArray()).find(
      (row) =>
        row.deleted !== 1 &&
        row.spaceId === spaceId &&
        row.kind === kind &&
        sourceIdOfPayload(row.kind, row.payload) === sourceId,
    );

  const now = Date.now();
  const base: SharedItem = {
    id: already?.id ?? nowId(),
    spaceId,
    kind,
    title: title.trim().slice(0, 200) || 'Untitled',
    language,
    payloadHash: payloadHash(payload),
    payloadBytes: payloadBytes(payload),
    // Immutable across a withdraw/re-share round trip, like a post's.
    publishedAt: already?.publishedAt || now,
    createdAt: already?.createdAt ?? now,
    updatedAt: now,
  };
  const { signItem } = await import('@/lib/postSigning');
  const sig = signItem(base);
  if (!sig) throw new Error('cannot sign: passphrase onboarding has not completed');
  const item: SharedItem = { ...base, ...sig };

  await db.sharedItems.put({ ...item, payload, sourceUpdatedAt, dirty: 1, shared: 1 });
  set((s) => ({
    items: [item, ...s.items.filter((i) => i.id !== item.id)].sort(byPublishedDesc),
    sharedClaims: { ...s.sharedClaims, [item.id]: true },
    itemSources: { ...s.itemSources, [item.id]: { sourceId, sourceUpdatedAt } },
  }));
  await queued('item.upsert', { id: item.id });
  flush();
}

// Every parameter below is annotated. Inside `create<CommunityState>` these
// would be inferred from the state type; from a factory they are not, and an
// un-annotated one is an implicit `any` that `noImplicitAny` rejects. Same
// reason `communityFeed.markSeen(postId: string)` carries its type.
export function createCommunityWriting(set: SetState, get: GetState) {
  return {
  createSpace: async (name: string) => {
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

  saveSpace: async (space: Space) => {
    const next: Space = { ...space, updatedAt: Date.now() };
    await db.spaces.put({ ...next, dirty: 1 });
    set((s) => ({ spaces: s.spaces.map((sp) => (sp.id === next.id ? next : sp)).sort(byUpdatedDesc) }));
    await queued('space.upsert', next);
    flush();
  },

  deleteSpace: async (id: string) => {
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
  shareSpace: async (spaceId: string, rotate = false) => {
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
  savePost: async (post: Post) => {
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

  publishPost: async (id: string) => {
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
  unpublishPost: async (id: string) => {
    const post = get().posts.find((p) => p.id === id);
    if (!post) return;
    await db.posts.update(id, { shared: 0, dirty: 0 });
    set((s) => ({ shared: { ...s.shared, [id]: false } }));
    await queued('post.delete', { id, spaceId: post.spaceId });
    flush();
  },

  /**
   * Publish a reading plan into one of the user's rooms.
   *
   * A **snapshot**, not a live link. The payload is built now, hashed, signed
   * and stored; editing the source afterwards changes nothing for subscribers
   * until `republishItem`. That is deliberate — see the note on `republishItem`
   * — and it has a second consequence worth knowing: the shared item outlives
   * the list it came from, exactly as a piece outlives nothing in particular.
   */
  shareList: async (listId: string, spaceId: string) => {
    const list = useLibraryStore.getState().readingLists.find((l) => l.id === listId);
    if (!list) return;
    await publishItem(set, get, 'plan', spaceId, list.name, buildPlanPayload(list), list.updatedAt, listId);
  },

  /** Publish a board, cards and all. */
  shareBoard: async (boardId: string, spaceId: string) => {
    const lib = useLibraryStore.getState();
    const board = lib.boards.find((b) => b.id === boardId);
    if (!board) return;
    const cards = boardCardsOf(board, lib.cards);
    await publishItem(
      set, get, 'board', spaceId, board.name, buildBoardPayload(board, cards), board.updatedAt, boardId,
    );
  },

  /**
   * Re-snapshot a shared item from its live source.
   *
   * **Offered, never automatic**, and the reason is the same family as
   * `publishedAt` being immutable: re-signing and re-moderating on every
   * keystroke would be wrong, and silently changing a plan that people are
   * forty days into is worse than a button. It also keeps `libraryStore` free
   * of any dependency on this store — the source is read here, on demand.
   *
   * A device that pulled the header but never had the payload cannot do this:
   * the source list or board is not on it either. It simply no-ops.
   */
  republishItem: async (itemId: string) => {
    const row = await db.sharedItems.get(itemId);
    if (!row || row.deleted === 1) return;
    const lib = useLibraryStore.getState();
    if (row.kind === 'plan') {
      const list = lib.readingLists.find((l) => l.id === sourceIdOfPayload(row.kind, row.payload));
      if (!list) return;
      await publishItem(set, get, 'plan', row.spaceId, list.name, buildPlanPayload(list), list.updatedAt, list.id, row);
      return;
    }
    const board = lib.boards.find((b) => b.id === sourceIdOfPayload(row.kind, row.payload));
    if (!board) return;
    await publishItem(
      set, get, 'board', row.spaceId, board.name,
      buildBoardPayload(board, boardCardsOf(board, lib.cards)), board.updatedAt, board.id, row,
    );
  },

  /**
   * Take a plan or board out of the room, keeping it on the device.
   *
   * The `unpublishPost` half of the pair: the row survives, so re-sharing it
   * later reuses the same `publishedAt` and the same id.
   */
  withdrawItem: async (itemId: string) => {
    const item = get().items.find((i) => i.id === itemId);
    if (!item) return;
    await db.sharedItems.update(itemId, { shared: 0, dirty: 0 });
    set((s) => ({ sharedClaims: { ...s.sharedClaims, [itemId]: false } }));
    await queued('item.delete', { id: itemId, spaceId: item.spaceId });
    flush();
  },

  /** The `deletePost` half: gone from the device as well as the room. */
  deleteItem: async (itemId: string) => {
    const item = get().items.find((i) => i.id === itemId);
    if (!item) return;
    await db.sharedItems.update(itemId, { deleted: 1, dirty: 1 });
    set((s) => ({ items: s.items.filter((i) => i.id !== itemId) }));
    await queued('item.delete', { id: itemId, spaceId: item.spaceId });
    flush();
  },

  /** An explicit delete: gone from the device as well as the server. */
  deletePost: async (id: string) => {
    const post = get().posts.find((p) => p.id === id);
    if (!post) return;
    await db.posts.update(id, { deleted: 1, dirty: 1 });
    set((s) => ({ posts: s.posts.filter((p) => p.id !== id) }));
    await queued('post.delete', { id, spaceId: post.spaceId });
    flush();
  },
  };
}
