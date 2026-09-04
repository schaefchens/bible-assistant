import { create } from 'zustand';
import { db, stripLocal, type SyncOp } from '@/db/dexie';
import {
  flushCommunityOp,
  isCommunityOp,
  pullCommunity,
  seedCommunityQueue,
} from '@/services/community/communitySync';
import type {
  Card,
  Board,
  FreeformCardLayout,
  ReadingList,
  ReadingProgress,
} from '@/types/domain';
import { apiGetJson, apiPostJson } from '@/services/api/client';
import { normalizeCardReferences } from '@/services/bible/cardReference';
import {
  expandEntryToChapters,
  listEntries,
  newReadingDay,
  normalizeReadingList,
  spansChapters,
} from '@/services/reading/readingEntries';
import {
  emptyReadingProgress,
  mergeReadingProgress,
  normalizeReadingProgress,
} from '@/services/reading/readingProgress';
import { reconcileOrder, reorderInArray } from '@/utils/orderingUtils';
import { useSettingsStore } from '@/store/settingsStore';
import {
  enqueueOp,
  enqueueOrderSync,
  enqueueProgressSync,
  persistOrder,
  readStoredOrder,
  shouldDropSyncOp,
  syncEnabled,
  type StoredOrder,
} from './syncQueueManager';

type LibraryState = {
  cards: Card[];
  boards: Board[];
  /**
   * Reading lists, newest-touched first. No user-controlled order array (unlike
   * cards and boards): a list's *entries* carry the order that matters, and a
   * second orderable collection would be two sync ops for no user benefit.
   */
  readingLists: ReadingList[];
  /** Progress per list id. Absent = nothing read yet. */
  readingProgress: Record<string, ReadingProgress>;
  cardOrder: string[];
  cardOrderUpdatedAt: number;
  boardOrder: string[];
  boardOrderUpdatedAt: number;
  activeBoardId: string | null;
  online: boolean;
  pendingOps: number;
  /** Re-read the queue length. For writers outside this store (communityStore),
   * which enqueue through syncQueueManager and so can't adjust the count
   * inline the way the writers here do. */
  refreshPendingOps: () => Promise<void>;
  initialized: boolean;
  init: () => Promise<void>;
  upsertCard: (card: Card) => Promise<void>;
  deleteCard: (id: string) => Promise<void>;
  reorderCards: (fromId: string, toId: string) => Promise<void>;
  setCardOrder: (order: string[]) => Promise<void>;
  upsertBoard: (board: Board) => Promise<void>;
  setCardLayout: (boardId: string, cardId: string, layout: FreeformCardLayout) => Promise<void>;
  deleteBoard: (id: string) => Promise<void>;
  reorderBoards: (fromId: string, toId: string) => Promise<void>;
  setBoardOrder: (order: string[]) => Promise<void>;
  setActiveBoardId: (id: string | null) => Promise<void>;
  upsertReadingList: (list: ReadingList) => Promise<void>;
  deleteReadingList: (id: string) => Promise<void>;
  /** Tick or untick one entry. */
  setEntryDone: (listId: string, entryId: string, done: boolean) => Promise<void>;
  /** Record where the user is in a list, without changing what's ticked. */
  setCurrentEntry: (listId: string, entryId: string | undefined) => Promise<void>;
  setOnline: (value: boolean) => void;
  flushQueue: () => Promise<void>;
  pullFromServer: () => Promise<void>;
  enableSync: () => Promise<void>;
  disableSync: () => Promise<void>;
};

const CARD_ORDER_KEY = 'cardOrder';
const BOARD_ORDER_KEY = 'boardOrder';
const ACTIVE_BOARD_KEY = 'activeBoardId';

function nowId(): string {
  return crypto.randomUUID();
}

// ─── The two ordered collections ──────────────────────────────────────────
//
// Cards and boards are the same machinery twice: a Dexie table, a state array,
// a user-controlled order array with its own logical clock, and one sync op
// each for a row and for the order. Every step below used to exist in two
// copies — which is how `setCardOrder` and `setBoardOrder` came to be
// byte-identical apart from their names, and how four of the six writers came
// to skip the `hadPending` accounting the fifth does. The steps live here once
// now; what stays duplicated in the actions is a name, which the compiler
// checks.

type OrderOp = Extract<SyncOp['op'], 'cardOrder.set' | 'boardOrder.set'>;

// Both helpers below take a table structurally rather than as `Table<T>`:
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

/** Orders are compared as whole arrays; this is the cheap way to say so. */
const sameOrder = (a: string[], b: string[]): boolean => a.join('|') === b.join('|');

/**
 * The order-side of a write: persist it locally, and queue it for the server.
 *
 * Takes the timestamp rather than minting one, so the caller can put the new
 * order in the store **first**. That matters: the card list renders straight
 * from `cardOrder`, and dnd-kit resets its transforms the instant a card is
 * dropped — a store update that lands a frame later shows the *old* order for
 * that frame.
 *
 * Returns whether the queue actually *grew*. `enqueueOrderSync` replaces a
 * pending op of the same kind rather than adding to it (only the newest order
 * matters), so counting every call as +1 walks `pendingOps` above the real
 * queue length — the same accounting `updateProgress` does for progress ops.
 */
async function commitOrder(
  prefKey: string,
  op: OrderOp,
  order: string[],
  updatedAt: number,
): Promise<boolean> {
  await persistOrder(prefKey, order, updatedAt);
  const hadPending = (await db.syncQueue.where('op').equals(op).count()) > 0;
  const queued = await enqueueOrderSync(op, order, updatedAt);
  return queued && !hadPending;
}

/** Read a persisted order and reconcile it against the rows that actually
 * exist, re-persisting it if reconciliation changed anything. */
function reconcileStoredOrder(
  prefKey: string,
  raw: unknown,
  live: { id: string }[],
): StoredOrder {
  const stored = readStoredOrder(raw);
  const order = reconcileOrder(stored.order, live);
  if (!sameOrder(order, stored.order)) void persistOrder(prefKey, order, stored.updatedAt);
  return { order, updatedAt: stored.updatedAt };
}

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
 * The order after a pull: the server's if it is newer *and* nothing local is
 * still pending, else the local one — then reconciled against the rows that
 * actually exist, and re-persisted if any of that changed it.
 *
 * Skipping the adoption while an op is pending is what stops an in-flight
 * reorder being clobbered by the very order it is about to replace.
 */
async function adoptedOrder(
  prefKey: string,
  op: OrderOp,
  remote: { order?: unknown; updatedAt?: unknown } | undefined,
  local: StoredOrder,
  live: { id: string }[],
): Promise<StoredOrder> {
  const remoteUpdatedAt = typeof remote?.updatedAt === 'number' ? remote.updatedAt : 0;
  const pending = (await db.syncQueue.where('op').equals(op).count()) > 0;
  const adopted =
    !pending && remoteUpdatedAt > local.updatedAt
      ? {
          order: Array.isArray(remote?.order) ? (remote.order as string[]) : [],
          updatedAt: remoteUpdatedAt,
        }
      : local;
  const order = reconcileOrder(adopted.order, live);
  if (!sameOrder(order, local.order) || adopted.updatedAt !== local.updatedAt) {
    void persistOrder(prefKey, order, adopted.updatedAt);
  }
  return { order, updatedAt: adopted.updatedAt };
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

export const useLibraryStore = create<LibraryState>((set, get) => ({
  cards: [],
  boards: [],
  readingLists: [],
  readingProgress: {},
  cardOrder: [],
  cardOrderUpdatedAt: 0,
  boardOrder: [],
  boardOrderUpdatedAt: 0,
  activeBoardId: null,
  online: typeof navigator !== 'undefined' ? navigator.onLine : true,
  pendingOps: 0,
  refreshPendingOps: async () => {
    set({ pendingOps: await db.syncQueue.count() });
  },
  initialized: false,

  init: async () => {
    if (get().initialized) return;
    const [
      cards,
      boards,
      readingListRows,
      progressRows,
      pending,
      savedCardOrderRow,
      savedBoardOrderRow,
      activeRow,
    ] = await Promise.all([
      db.cards.filter((c) => c.deleted !== 1).toArray(),
      db.boards.filter((b) => b.deleted !== 1).toArray(),
      db.readingLists.filter((l) => l.deleted !== 1).toArray(),
      db.readingProgress.toArray(),
      db.syncQueue.count(),
      db.preferences.get(CARD_ORDER_KEY),
      db.preferences.get(BOARD_ORDER_KEY),
      db.preferences.get(ACTIVE_BOARD_KEY),
    ]);
    const liveCards = cards.map(stripLocal).map(normalizeCard);
    const liveBoards = boards.map(stripLocal);
    const cardOrder = reconcileStoredOrder(CARD_ORDER_KEY, savedCardOrderRow?.value, liveCards);
    const boardOrder = reconcileStoredOrder(BOARD_ORDER_KEY, savedBoardOrderRow?.value, liveBoards);
    const storedActiveId =
      typeof activeRow?.value === 'string' ? activeRow.value : null;
    const activeBoardId =
      storedActiveId && liveBoards.some((b) => b.id === storedActiveId)
        ? storedActiveId
        : null;
    set({
      cards: liveCards,
      boards: liveBoards,
      readingLists: sortLists(readingListRows.map(stripLocal).map(normalizeList)),
      readingProgress: indexProgress(progressRows.map(stripLocal)),
      cardOrder: cardOrder.order,
      cardOrderUpdatedAt: cardOrder.updatedAt,
      boardOrder: boardOrder.order,
      boardOrderUpdatedAt: boardOrder.updatedAt,
      activeBoardId,
      pendingOps: pending,
      initialized: true,
    });
    void expandStoredSpans();
    if (navigator.onLine) {
      void get().pullFromServer().catch(() => {});
      void get().flushQueue().catch(() => {});
    }
  },

  upsertCard: async (card) => {
    const updated: Card = { ...card, updatedAt: Date.now() };
    await db.cards.put({ ...updated, dirty: 1 });
    const queued = await enqueueOp('card.upsert', updated);
    // A new card joins at the *front*: the stack reads newest-first.
    const isNew = !get().cards.some((c) => c.id === updated.id);
    const order = isNew
      ? [updated.id, ...get().cardOrder.filter((cid) => cid !== updated.id)]
      : null;
    const orderAt = Date.now();
    set((s) => ({
      cards: replaceOrAdd(s.cards, updated),
      cardOrder: order ?? s.cardOrder,
      cardOrderUpdatedAt: order ? orderAt : s.cardOrderUpdatedAt,
      pendingOps: s.pendingOps + (queued ? 1 : 0),
    }));
    if (order && (await commitOrder(CARD_ORDER_KEY, 'cardOrder.set', order, orderAt))) {
      set((s) => ({ pendingOps: s.pendingOps + 1 }));
    }
    if (get().online) void get().flushQueue();
  },

  deleteCard: async (id) => {
    await db.cards.update(id, { deleted: 1, dirty: 1 });
    const queued = await enqueueOp('card.delete', { id });
    const without = get().cardOrder.filter((cid) => cid !== id);
    const order = without.length === get().cardOrder.length ? null : without;
    const orderAt = Date.now();
    set((s) => ({
      cards: s.cards.filter((c) => c.id !== id),
      cardOrder: order ?? s.cardOrder,
      cardOrderUpdatedAt: order ? orderAt : s.cardOrderUpdatedAt,
      pendingOps: s.pendingOps + (queued ? 1 : 0),
    }));
    if (order && (await commitOrder(CARD_ORDER_KEY, 'cardOrder.set', order, orderAt))) {
      set((s) => ({ pendingOps: s.pendingOps + 1 }));
    }
    if (get().online) void get().flushQueue();
  },

  reorderCards: async (fromId, toId) => {
    // setCardOrder bails when the reconciled order is unchanged, so a no-op
    // move (same id / missing id) returning the original array is harmless.
    await get().setCardOrder(reorderInArray(get().cardOrder, fromId, toId));
  },

  setCardOrder: async (order) => {
    const reconciled = reconcileOrder(order, get().cards);
    if (sameOrder(reconciled, get().cardOrder)) return;
    const updatedAt = Date.now();
    set({ cardOrder: reconciled, cardOrderUpdatedAt: updatedAt });
    if (await commitOrder(CARD_ORDER_KEY, 'cardOrder.set', reconciled, updatedAt)) {
      set((s) => ({ pendingOps: s.pendingOps + 1 }));
    }
    if (get().online) void get().flushQueue();
  },

  upsertBoard: async (board) => {
    const updated: Board = { ...board, updatedAt: Date.now() };
    await db.boards.put({ ...updated, dirty: 1 });
    const queued = await enqueueOp('board.upsert', updated);
    // A new board joins at the *end* — the tab strip reads left to right, and
    // the tabs are folders, not a stack. The one asymmetry with cards.
    const isNew = !get().boards.some((b) => b.id === updated.id);
    const order = isNew
      ? [...get().boardOrder.filter((bid) => bid !== updated.id), updated.id]
      : null;
    const orderAt = Date.now();
    set((s) => ({
      boards: replaceOrAdd(s.boards, updated),
      boardOrder: order ?? s.boardOrder,
      boardOrderUpdatedAt: order ? orderAt : s.boardOrderUpdatedAt,
      pendingOps: s.pendingOps + (queued ? 1 : 0),
    }));
    if (order && (await commitOrder(BOARD_ORDER_KEY, 'boardOrder.set', order, orderAt))) {
      set((s) => ({ pendingOps: s.pendingOps + 1 }));
    }
    if (get().online) void get().flushQueue();
  },

  setCardLayout: async (boardId, cardId, layout) => {
    const board = get().boards.find((b) => b.id === boardId);
    // Spatial only — never create an orphan layout for a non-member card.
    if (!board || !board.cardIds.includes(cardId)) return;
    await get().upsertBoard({
      ...board,
      freeform: { ...(board.freeform ?? {}), [cardId]: layout },
    });
  },

  deleteBoard: async (id) => {
    await db.boards.update(id, { deleted: 1, dirty: 1 });
    const queued = await enqueueOp('board.delete', { id });
    // Deleting the selected board falls back to All cards, not to another
    // board — see CardsPage: `activeBoardId === null` *is* the All-cards tab.
    const wasActive = get().activeBoardId === id;
    if (wasActive) await db.preferences.delete(ACTIVE_BOARD_KEY);
    const without = get().boardOrder.filter((bid) => bid !== id);
    const order = without.length === get().boardOrder.length ? null : without;
    const orderAt = Date.now();
    set((s) => ({
      boards: s.boards.filter((b) => b.id !== id),
      boardOrder: order ?? s.boardOrder,
      boardOrderUpdatedAt: order ? orderAt : s.boardOrderUpdatedAt,
      activeBoardId: wasActive ? null : s.activeBoardId,
      pendingOps: s.pendingOps + (queued ? 1 : 0),
    }));
    if (order && (await commitOrder(BOARD_ORDER_KEY, 'boardOrder.set', order, orderAt))) {
      set((s) => ({ pendingOps: s.pendingOps + 1 }));
    }
    if (get().online) void get().flushQueue();
  },

  reorderBoards: async (fromId, toId) => {
    await get().setBoardOrder(reorderInArray(get().boardOrder, fromId, toId));
  },

  setBoardOrder: async (order) => {
    const reconciled = reconcileOrder(order, get().boards);
    if (sameOrder(reconciled, get().boardOrder)) return;
    const updatedAt = Date.now();
    set({ boardOrder: reconciled, boardOrderUpdatedAt: updatedAt });
    if (await commitOrder(BOARD_ORDER_KEY, 'boardOrder.set', reconciled, updatedAt)) {
      set((s) => ({ pendingOps: s.pendingOps + 1 }));
    }
    if (get().online) void get().flushQueue();
  },

  setActiveBoardId: async (id) => {
    if (get().activeBoardId === id) return;
    if (id === null) {
      await db.preferences.delete(ACTIVE_BOARD_KEY);
    } else {
      await db.preferences.put({ key: ACTIVE_BOARD_KEY, value: id });
    }
    set({ activeBoardId: id });
  },

  upsertReadingList: async (list) => {
    const updated: ReadingList = { ...list, updatedAt: Date.now() };
    await db.readingLists.put({ ...updated, dirty: 1 });
    const queued = await enqueueOp('readingList.upsert', updated);
    set((s) => ({
      readingLists: sortLists(replaceOrAdd(s.readingLists, updated)),
      pendingOps: s.pendingOps + (queued ? 1 : 0),
    }));
    if (get().online) void get().flushQueue();
  },

  deleteReadingList: async (id) => {
    await db.readingLists.update(id, { deleted: 1, dirty: 1 });
    // Progress is deleted outright rather than tombstoned: it means nothing
    // without its list, and the server drops it with the list too.
    await db.readingProgress.delete(id);
    const queued = await enqueueOp('readingList.delete', { id });
    set((s) => {
      const readingProgress = { ...s.readingProgress };
      delete readingProgress[id];
      return {
        readingLists: s.readingLists.filter((l) => l.id !== id),
        readingProgress,
        pendingOps: s.pendingOps + (queued ? 1 : 0),
      };
    });
    if (get().online) void get().flushQueue();
  },

  setEntryDone: async (listId, entryId, done) => {
    await updateProgress(set, get, listId, (current) => {
      const completed = done
        ? Array.from(new Set([...current.completed, entryId]))
        : current.completed.filter((id) => id !== entryId);
      if (completed.length === current.completed.length) return current;
      return { ...current, completed, updatedAt: Date.now() };
    });
  },

  setCurrentEntry: async (listId, entryId) => {
    await updateProgress(set, get, listId, (current) =>
      current.currentEntryId === entryId
        ? current
        : { ...current, currentEntryId: entryId, updatedAt: Date.now() },
    );
  },

  setOnline: (value) => {
    set({ online: value });
    if (value) void get().flushQueue();
  },

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
    await seedSyncQueue();
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
    void expandStoredSpans();

    // Community spaces ride along on this one read path so `syncEnabled` keeps
    // gating them. Swallowed on failure for the same reason the reading-list
    // requests above are: an api.php that predates this feature answers
    // "unknown action", and that must not cost the user their cards.
    // communityStore adopts the result through onCommunityPulled().
    await pullCommunity().catch(() => {});
  },
}));

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
async function expandStoredSpans(): Promise<void> {
  const store = useLibraryStore.getState();
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
    await useLibraryStore.getState().upsertReadingList({ ...list, days });
    for (const entryId of inherited) {
      await useLibraryStore.getState().setEntryDone(list.id, entryId, true);
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
async function seedSyncQueue(): Promise<void> {
  const [cardRows, boardRows, listRows, progressRows] = await Promise.all([
    db.cards.toArray(),
    db.boards.toArray(),
    db.readingLists.toArray(),
    db.readingProgress.toArray(),
  ]);
  await seedRows(cardRows, 'card.upsert', 'card.delete');
  await seedRows(boardRows, 'board.upsert', 'board.delete');
  await seedRows(listRows, 'readingList.upsert', 'readingList.delete');
  const { cardOrder, cardOrderUpdatedAt, boardOrder, boardOrderUpdatedAt } =
    useLibraryStore.getState();
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


// Normalize a card read from storage/server into the current shape. Migrates
// legacy `references: string[]` (and any partial structured data) into
// CardReference[] on read, so old local rows and remote payloads both work.
function normalizeCard(card: Card): Card {
  return { ...card, references: normalizeCardReferences(card.references) };
}

/**
 * Read-modify-write one list's progress: Dexie, the sync queue, and the store.
 *
 * Takes a patch rather than a finished record, and reads the current value
 * *inside* this function, because progress has two writers that fire in the same
 * tick — finishing an entry ticks it off while the continuation marks the next
 * one current. With the read outside, the second writer computes from a record
 * that predates the first and its whole-record write silently drops the tick.
 *
 * The store is updated **synchronously**, before the Dexie put, for the same
 * reason: it is what the next writer reads.
 *
 * Returning the same record from `patch` means "nothing changed" and skips the
 * write entirely — no bumped timestamp, no sync op.
 */
async function updateProgress(
  set: (fn: (s: LibraryState) => Partial<LibraryState>) => void,
  get: () => LibraryState,
  listId: string,
  patch: (current: ReadingProgress) => ReadingProgress,
): Promise<void> {
  const current = get().readingProgress[listId] ?? emptyReadingProgress(listId);
  const next = patch(current);
  if (next === current) return;

  set((s) => ({ readingProgress: { ...s.readingProgress, [listId]: next } }));
  await db.readingProgress.put({ ...next, dirty: 1 });
  const hadPending = (await db.syncQueue.where('op').equals('readingProgress.set').count()) > 0;
  const queued = await enqueueProgressSync(next);
  // A collapsed op replaced one already counted, so only count a genuinely new
  // queue entry.
  if (queued && !hadPending) {
    set((s) => ({ pendingOps: s.pendingOps + 1 }));
  }
  if (get().online) void get().flushQueue();
}

/** Most-recently-touched first — "continue what I was reading" without a
 * user-maintained order array. */
function sortLists(lists: ReadingList[]): ReadingList[] {
  return lists.slice().sort((a, b) => b.updatedAt - a.updatedAt);
}

function indexProgress(rows: ReadingProgress[]): Record<string, ReadingProgress> {
  const out: Record<string, ReadingProgress> = {};
  for (const row of rows) out[row.listId] = row;
  return out;
}

/** A stored row that predates a field (or a hand-edited server file) must not
 * crash the reader. normalizeReadingList only rejects a row with no id, which a
 * Dexie row keyed by id cannot be — the fallback just keeps the
 * "at least one day" invariant true if that ever changes. */
function normalizeList(list: ReadingList): ReadingList {
  return (
    normalizeReadingList(list) ?? {
      ...list,
      days: list.days?.length ? list.days : [newReadingDay()],
    }
  );
}

function replaceOrAdd<T extends { id: string }>(items: T[], next: T): T[] {
  const idx = items.findIndex((it) => it.id === next.id);
  if (idx === -1) return [...items, next];
  const copy = items.slice();
  copy[idx] = next;
  return copy;
}

export { nowId };
