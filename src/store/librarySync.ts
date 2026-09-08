import { db, stripLocal, type SyncOp } from '@/db/dexie';
import {
  flushCommunityOp,
  isCommunityOp,
  pullCommunity,
  seedCommunityQueue,
} from '@/services/community/communitySync';
import type { Board, Card, ReadingList, ReadingProgress } from '@/types/domain';
import { apiGetJson, apiPostJson } from '@/services/api/client';
import {
  expandEntryToChapters,
  listEntries,
  normalizeReadingList,
  spansChapters,
} from '@/services/reading/readingEntries';
import {
  mergeReadingProgress,
  normalizeReadingProgress,
} from '@/services/reading/readingProgress';
import { useSettingsStore } from '@/store/settingsStore';
import {
  enqueueOp,
  enqueueOrderSync,
  enqueueProgressSync,
  shouldDropSyncOp,
  syncEnabled,
} from './syncQueueManager';
import {
  ACTIVE_BOARD_KEY,
  BOARD_ORDER_KEY,
  CARD_ORDER_KEY,
  adoptedOrder,
} from './libraryOrder';
import { indexProgress, normalizeCard, normalizeList, sortLists } from './libraryRows';
import type { LibraryState } from './libraryStore';

/**
 * The two paths that talk to the server, and nothing else.
 *
 * `libraryStore` was 903 lines because this lived inside it. The CRUD half and
 * the sync half share state but almost no code, and the sync half is where
 * this codebase's bug history is densest.
 *
 * Two of the three `syncEnabled` chokepoints are here: `flushQueue` is the
 * only path that pushes and `pullFromServer` the only one that reads. Moving
 * them did not spread the opt-in — it is still enforced in exactly three
 * places, and a new caller cannot bypass it by forgetting.
 *
 * A factory rather than free functions taking `(set, get)`, so the four action
 * bodies moved **verbatim**: they already closed over zustand's `set` and
 * `get`, which are now this function's parameters. Nothing inside them was
 * rewritten, which is what lets 42 integration tests stand as the net.
 *
 * `expandStoredSpans` and `seedSyncQueue` take `get` for the same reason: they
 * reached the store through its own module import, which from here is a cycle.
 */

type SetState = (
  partial: Partial<LibraryState> | ((s: LibraryState) => Partial<LibraryState>),
) => void;
type GetState = () => LibraryState;

// Dexie's own generics fight a `T & LocalFlags` parameter (its `UpdateSpec`
// key paths can't be resolved through the intersection), and every row table
// here answers these shapes. Two types, not one, so each helper asks only for
// the methods it uses — `markSynced` never puts, and inferring `T` from a
// `put` it doesn't call is what makes the call sites stop compiling.

/** A table of rows carrying the local `dirty` flag. */
type DirtyFlaggedTable = {
  get(id: string): Promise<{ updatedAt: number } | undefined>;
  update(id: string, changes: { dirty: 0 }): Promise<number>;
};

/** A table of `T` rows carrying the local flags. */
type SyncedTable<T> = {
  get(id: string): Promise<(T & { dirty?: 0 | 1; deleted?: 0 | 1 }) | undefined>;
  put(row: T & { dirty: 0; deleted: 0 }): Promise<string>;
};

/**
 * Adopt every remote row newer than its local counterpart.
 *
 * A local row only blocks the adoption if it has a genuinely pending upsert in
 * the queue. A leftover `dirty` flag with no pending op is stale — its edit
 * already synced — and must NOT freeze the row forever, or a device that has
 * ever edited a board never pulls in another device's changes to it (a
 * background URL, say).
 */
async function adoptRemoteRows<T extends { id: string; updatedAt: number }>(
  table: SyncedTable<T>,
  remote: T[],
  pendingUpsertIds: Set<string>,
): Promise<void> {
  for (const row of remote) {
    const local = await table.get(row.id);
    const blocked = local?.dirty === 1 && pendingUpsertIds.has(row.id);
    if (!local || (!blocked && row.updatedAt > local.updatedAt)) {
      await table.put({ ...row, dirty: 0, deleted: 0 });
    }
  }
}

/** The ids carrying a still-unsent upsert of `op`. */
function pendingUpsertIds(queued: SyncOp[], op: SyncOp['op']): Set<string> {
  return new Set(
    queued.filter((o) => o.op === op).map((o) => (o.payload as { id: string }).id),
  );
}

/**
 * Mark a row clean now that the server has it — but only if it hasn't been
 * edited again since the op was queued, or a newer local edit would be lost.
 *
 * Being clean is what lets a future pull adopt a remote edit to the same row.
 */
async function markSynced(
  table: DirtyFlaggedTable,
  id: string,
  updatedAt: number,
): Promise<void> {
  const cur = await table.get(id);
  if (cur && cur.updatedAt === updatedAt) await table.update(id, { dirty: 0 });
}

/** Queue every dirty row of one table — an upsert, or a delete for a
 * tombstone. Without the tombstones, a card deleted offline would be
 * resurrected by the first pull from another device. */
async function seedRows<T extends { id: string; dirty?: 0 | 1; deleted?: 0 | 1 }>(
  rows: T[],
  upsertOp: SyncOp['op'],
  deleteOp: SyncOp['op'],
): Promise<void> {
  for (const row of rows) {
    if (row.dirty !== 1) continue;
    if (row.deleted === 1) await enqueueOp(deleteOp, { id: row.id });
    else await enqueueOp(upsertOp, stripLocal(row));
  }
}

/**
 * Split any stored multi-chapter entry into one entry per chapter.
 *
 * Progress is per entry, so an entry covering four chapters could only be all
 * read or all unread — which is why ticking Jonah 1 ticked all of Jonah. Entries
 * are created per chapter now (see `expandEntryToChapters`); this repairs the
 * ones written before that, and the ones a device still on the old build sends.
 *
 * A tick on the parent carries to every chapter, so the migration never costs
 * the user progress. `expandEntryToChapters` keeps the first chapter's id, so
 * that one is already covered; only the rest need adding.
 *
 * Idempotent by construction: afterwards nothing spans chapters, so the next
 * pass finds nothing to do.
 */
export async function expandStoredSpans(get: GetState): Promise<void> {
  const store = get();
  const stale = store.readingLists.filter((l) => listEntries(l).some(spansChapters));
  for (const list of stale) {
    const wasDone = new Set(store.readingProgress[list.id]?.completed ?? []);
    const inherited: string[] = [];
    const days = list.days.map((day) => ({
      ...day,
      entries: day.entries.flatMap((entry) => {
        const parts = expandEntryToChapters(entry);
        if (parts.length > 1 && wasDone.has(entry.id)) {
          inherited.push(...parts.slice(1).map((p) => p.id));
        }
        return parts;
      }),
    }));
    await get().upsertReadingList({ ...list, days });
    for (const entryId of inherited) {
      await get().setEntryDone(list.id, entryId, true);
    }
  }
}

/**
 * Queue every local row the server has never accepted.
 *
 * `dirty === 1` is exactly that set: it's set by every local mutation and
 * cleared only by a successful flush or an adopted pull — so while sync was off
 * nothing ever cleared it. Tombstones (deleted === 1) are queued as deletes,
 * without which a card deleted offline would be resurrected by the first pull
 * from another device.
 *
 * Orders are pushed whenever one has ever been set; api.php's handleOrderSet
 * ignores a stale timestamp, so a local order that predates the server's cannot
 * clobber it.
 */
async function seedSyncQueue(get: GetState): Promise<void> {
  const [cardRows, boardRows, listRows, progressRows] = await Promise.all([
    db.cards.toArray(),
    db.boards.toArray(),
    db.readingLists.toArray(),
    db.readingProgress.toArray(),
  ]);
  await seedRows(cardRows, 'card.upsert', 'card.delete');
  await seedRows(boardRows, 'board.upsert', 'board.delete');
  await seedRows(listRows, 'readingList.upsert', 'readingList.delete');
  const { cardOrder, cardOrderUpdatedAt, boardOrder, boardOrderUpdatedAt } = get();
  // An order that has never been set has nothing to say, and pushing it would
  // create the account purely to record two empty arrays — exactly the eager
  // account creation the lazy-dir work removed. It syncs with the first card.
  if (cardOrder.length > 0 || cardOrderUpdatedAt > 0) {
    await enqueueOrderSync('cardOrder.set', cardOrder, cardOrderUpdatedAt);
  }
  if (boardOrder.length > 0 || boardOrderUpdatedAt > 0) {
    await enqueueOrderSync('boardOrder.set', boardOrder, boardOrderUpdatedAt);
  }
  for (const row of progressRows) {
    if (row.dirty !== 1) continue;
    await enqueueProgressSync(stripLocal(row));
  }
  await seedCommunityQueue(enqueueOp);
}

export function createLibrarySync(set: SetState, get: GetState) {
  return {
    // The one client-side path that pushes to the server. Guarded here rather
    // than at each of its seven callers, so a new caller can't accidentally
    // bypass the opt-in. With sync off the queue is empty anyway — this makes
    // that a property of the design rather than a coincidence.
    flushQueue: async () => {
      if (!syncEnabled()) return;
      const ops = await db.syncQueue.orderBy('createdAt').toArray();
      for (const op of ops) {
        try {
          // Community ops (profile, spaces, posts, subscriptions, memberships)
          // route through one table in services/community/communitySync.ts
          // rather than growing this switch by ten cases. They still travel on
          // this queue and through this flush, so `syncEnabled` keeps gating
          // them and the retry/drop handling below is unchanged.
          if (isCommunityOp(op.op)) {
            await flushCommunityOp(op.op, op.payload);
            await db.syncQueue.delete(op.id!);
            set((s) => ({ pendingOps: Math.max(0, s.pendingOps - 1) }));
            continue;
          }
          // `markSynced` is what lets a future pull adopt a remote edit to the
          // same row; see its comment for the updatedAt guard.
          switch (op.op) {
            case 'card.upsert': {
              await apiPostJson('cards.upsert', { card: op.payload });
              const c = op.payload as Card;
              await markSynced(db.cards, c.id, c.updatedAt);
              break;
            }
            case 'card.delete':
              await apiPostJson('cards.delete', op.payload);
              break;
            case 'cardOrder.set':
              await apiPostJson('cards.order.set', op.payload);
              break;
            case 'board.upsert': {
              await apiPostJson('boards.upsert', { board: op.payload });
              const b = op.payload as Board;
              await markSynced(db.boards, b.id, b.updatedAt);
              break;
            }
            case 'board.delete':
              await apiPostJson('boards.delete', op.payload);
              break;
            case 'boardOrder.set':
              await apiPostJson('boards.order.set', op.payload);
              break;
            case 'readingList.upsert': {
              await apiPostJson('readingLists.upsert', { readingList: op.payload });
              const l = op.payload as ReadingList;
              await markSynced(db.readingLists, l.id, l.updatedAt);
              break;
            }
            case 'readingList.delete':
              await apiPostJson('readingLists.delete', op.payload);
              break;
            case 'readingProgress.set': {
              await apiPostJson('readingProgress.set', { progress: op.payload });
              const p = op.payload as ReadingProgress;
              await markSynced(db.readingProgress, p.listId, p.updatedAt);
              break;
            }
          }
          await db.syncQueue.delete(op.id!);
          set((s) => ({ pendingOps: Math.max(0, s.pendingOps - 1) }));
        } catch (e) {
          if (shouldDropSyncOp(e)) {
            // permanent client error (4xx except 401) — drop op
            await db.syncQueue.delete(op.id!);
            set((s) => ({ pendingOps: Math.max(0, s.pendingOps - 1) }));
            continue;
          }
          // network/server error (401, 5xx, offline) — stop, retry later
          break;
        }
      }
    },

    // Counterpart to flushQueue: the one path that reads from the server.
    /**
     * Turn on server sync and catch the server up.
     *
     * Pull first: the merge rules already prefer remote only for rows this device
     * has never edited, so a user enabling sync after recovering their passphrase
     * on a new device gets their library back rather than overwriting it with an
     * empty one.
     *
     * Then seed the queue from local state, because mutations made while sync was
     * off were deliberately never queued (see syncQueueManager.enqueueOp) — this
     * is the one catch-up pass that trade-off costs.
     */
    enableSync: async () => {
      useSettingsStore.getState().setSyncEnabled(true);
      try {
        await get().pullFromServer();
      } catch {
        // Offline, or the account doesn't exist yet. Seeding below still queues
        // everything, and the flush retries when the connection comes back.
      }
      await seedSyncQueue(get);
      set({ pendingOps: await db.syncQueue.count() });
      await get().flushQueue().catch(() => {});
    },

    /**
     * Stop syncing. Local data is untouched — this only severs the mirror.
     *
     * The pending queue is dropped rather than parked: it can only contain ops
     * the user has now decided shouldn't leave the device, and keeping them would
     * mean re-enabling sync silently uploads edits made while it was off.
     * enableSync's seed pass reconstructs whatever is genuinely unsynced anyway.
     */
    disableSync: async () => {
      useSettingsStore.getState().setSyncEnabled(false);
      await db.syncQueue.clear();
      set({ pendingOps: 0 });
    },

    pullFromServer: async () => {
      if (!syncEnabled()) return;
      const [cardsResp, boardsResp, cardOrderResp, boardOrderResp, listsResp, progressResp] =
        await Promise.all([
          apiGetJson<{ cards: Card[] }>('cards.list'),
          apiGetJson<{ boards: Board[] }>('boards.list'),
          apiGetJson<{ order: string[]; updatedAt: number }>('cards.order.get').catch(
            () => ({ order: [], updatedAt: 0 }),
          ),
          apiGetJson<{ order: string[]; updatedAt: number }>('boards.order.get').catch(
            () => ({ order: [], updatedAt: 0 }),
          ),
          // Swallowed rather than allowed to reject the whole pull: the client
          // can ship before api.php is redeployed, and an unknown action must not
          // cost the user their cards.
          apiGetJson<{ readingLists: unknown[] }>('readingLists.list').catch(() => ({
            readingLists: [],
          })),
          apiGetJson<{ progress: unknown[] }>('readingProgress.list').catch(() => ({
            progress: [],
          })),
        ]);
      const remoteCards = cardsResp.cards ?? [];
      const remoteBoards = boardsResp.boards ?? [];
      const remoteLists = (listsResp.readingLists ?? [])
        .map(normalizeReadingList)
        .filter((l): l is ReadingList => l !== null);
      const remoteProgress = (progressResp.progress ?? [])
        .map(normalizeReadingProgress)
        .filter((p): p is ReadingProgress => p !== null);

      const queued = await db.syncQueue.toArray();
      await db.transaction('rw', db.cards, db.boards, db.readingLists, db.readingProgress, async () => {
        await adoptRemoteRows(db.cards, remoteCards, pendingUpsertIds(queued, 'card.upsert'));
        await adoptRemoteRows(db.boards, remoteBoards, pendingUpsertIds(queued, 'board.upsert'));
        await adoptRemoteRows(
          db.readingLists,
          remoteLists,
          pendingUpsertIds(queued, 'readingList.upsert'),
        );
        // Progress is the one collection that merges rather than races, so it
        // needs no "blocked" case: the merge is a union, and adopting the remote
        // row can't drop a local tick. The dirty flag is carried over so a
        // still-pending push happens anyway.
        for (const p of remoteProgress) {
          const local = await db.readingProgress.get(p.listId);
          const merged = mergeReadingProgress(local ? stripLocal(local) : undefined, p);
          if (merged) {
            await db.readingProgress.put({ ...merged, dirty: local?.dirty ?? 0 });
          }
        }
      });

      const [cards, boards, listRows, progressRows] = await Promise.all([
        db.cards.filter((c) => c.deleted !== 1).toArray(),
        db.boards.filter((b) => b.deleted !== 1).toArray(),
        db.readingLists.filter((l) => l.deleted !== 1).toArray(),
        db.readingProgress.toArray(),
      ]);
      const liveCards = cards.map(stripLocal).map(normalizeCard);
      const liveBoards = boards.map(stripLocal);

      const cardOrder = await adoptedOrder(
        CARD_ORDER_KEY,
        'cardOrder.set',
        cardOrderResp,
        { order: get().cardOrder, updatedAt: get().cardOrderUpdatedAt },
        liveCards,
      );
      const boardOrder = await adoptedOrder(
        BOARD_ORDER_KEY,
        'boardOrder.set',
        boardOrderResp,
        { order: get().boardOrder, updatedAt: get().boardOrderUpdatedAt },
        liveBoards,
      );

      const currentActive = get().activeBoardId;
      const nextActive =
        currentActive && liveBoards.some((b) => b.id === currentActive)
          ? currentActive
          : null;
      if (nextActive !== currentActive) {
        await db.preferences.delete(ACTIVE_BOARD_KEY);
      }
      set({
        cards: liveCards,
        boards: liveBoards,
        readingLists: sortLists(listRows.map(stripLocal).map(normalizeList)),
        readingProgress: indexProgress(progressRows.map(stripLocal)),
        cardOrder: cardOrder.order,
        cardOrderUpdatedAt: cardOrder.updatedAt,
        boardOrder: boardOrder.order,
        boardOrderUpdatedAt: boardOrder.updatedAt,
        activeBoardId: nextActive,
      });
      void expandStoredSpans(get);

      // Community spaces ride along on this one read path so `syncEnabled` keeps
      // gating them. Swallowed on failure for the same reason the reading-list
      // requests above are: an api.php that predates this feature answers
      // "unknown action", and that must not cost the user their cards.
      // communityStore adopts the result through onCommunityPulled().
      await pullCommunity().catch(() => {});
    },
  };
}
