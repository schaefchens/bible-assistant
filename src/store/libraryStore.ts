import { create } from 'zustand';
import { db } from '@/db/dexie';
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
    const storedCardOrder = readStoredOrder(savedCardOrderRow?.value);
    const reconciledCardOrder = reconcileOrder(storedCardOrder.order, liveCards);
    if (reconciledCardOrder.join('|') !== storedCardOrder.order.join('|')) {
      void persistOrder(CARD_ORDER_KEY, reconciledCardOrder, storedCardOrder.updatedAt);
    }
    const storedBoardOrder = readStoredOrder(savedBoardOrderRow?.value);
    const reconciledBoardOrder = reconcileOrder(storedBoardOrder.order, liveBoards);
    if (reconciledBoardOrder.join('|') !== storedBoardOrder.order.join('|')) {
      void persistOrder(BOARD_ORDER_KEY, reconciledBoardOrder, storedBoardOrder.updatedAt);
    }
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
      cardOrder: reconciledCardOrder,
      cardOrderUpdatedAt: storedCardOrder.updatedAt,
      boardOrder: reconciledBoardOrder,
      boardOrderUpdatedAt: storedBoardOrder.updatedAt,
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
    const isNew = !get().cards.some((c) => c.id === updated.id);
    let nextOrder = get().cardOrder;
    let nextOrderUpdatedAt = get().cardOrderUpdatedAt;
    let orderQueued = false;
    if (isNew) {
      nextOrder = [updated.id, ...nextOrder.filter((id) => id !== updated.id)];
      nextOrderUpdatedAt = Date.now();
      await persistOrder(CARD_ORDER_KEY, nextOrder, nextOrderUpdatedAt);
      orderQueued = await enqueueOrderSync('cardOrder.set', nextOrder, nextOrderUpdatedAt);
    }
    set((s) => ({
      cards: replaceOrAdd(s.cards, updated),
      cardOrder: nextOrder,
      cardOrderUpdatedAt: nextOrderUpdatedAt,
      pendingOps: s.pendingOps + (queued ? 1 : 0) + (orderQueued ? 1 : 0),
    }));
    if (get().online) void get().flushQueue();
  },

  deleteCard: async (id) => {
    await db.cards.update(id, { deleted: 1, dirty: 1 });
    const queued = await enqueueOp('card.delete', { id });
    const prevOrder = get().cardOrder;
    const nextOrder = prevOrder.filter((cid) => cid !== id);
    const orderChanged = nextOrder.length !== prevOrder.length;
    let nextOrderUpdatedAt = get().cardOrderUpdatedAt;
    let orderQueued = false;
    if (orderChanged) {
      nextOrderUpdatedAt = Date.now();
      await persistOrder(CARD_ORDER_KEY, nextOrder, nextOrderUpdatedAt);
      orderQueued = await enqueueOrderSync('cardOrder.set', nextOrder, nextOrderUpdatedAt);
    }
    set((s) => ({
      cards: s.cards.filter((c) => c.id !== id),
      cardOrder: nextOrder,
      cardOrderUpdatedAt: nextOrderUpdatedAt,
      pendingOps: s.pendingOps + (queued ? 1 : 0) + (orderQueued ? 1 : 0),
    }));
    if (get().online) void get().flushQueue();
  },

  reorderCards: async (fromId, toId) => {
    // setCardOrder bails when the reconciled order is unchanged, so a no-op
    // move (same id / missing id) returning the original array is harmless.
    await get().setCardOrder(reorderInArray(get().cardOrder, fromId, toId));
  },

  setCardOrder: async (order) => {
    const reconciled = reconcileOrder(order, get().cards);
    if (reconciled.join('|') === get().cardOrder.join('|')) return;
    const updatedAt = Date.now();
    set({ cardOrder: reconciled, cardOrderUpdatedAt: updatedAt });
    await persistOrder(CARD_ORDER_KEY, reconciled, updatedAt);
    const hadPending = (await db.syncQueue
      .where('op')
      .equals('cardOrder.set')
      .count()) > 0;
    const queued = await enqueueOrderSync('cardOrder.set', reconciled, updatedAt);
    if (queued && !hadPending) {
      set((s) => ({ pendingOps: s.pendingOps + 1 }));
    }
    if (get().online) void get().flushQueue();
  },

  upsertBoard: async (board) => {
    const updated: Board = { ...board, updatedAt: Date.now() };
    await db.boards.put({ ...updated, dirty: 1 });
    const queued = await enqueueOp('board.upsert', updated);
    const isNew = !get().boards.some((b) => b.id === updated.id);
    let nextOrder = get().boardOrder;
    let nextOrderUpdatedAt = get().boardOrderUpdatedAt;
    let orderQueued = false;
    if (isNew) {
      nextOrder = [...nextOrder.filter((bid) => bid !== updated.id), updated.id];
      nextOrderUpdatedAt = Date.now();
      await persistOrder(BOARD_ORDER_KEY, nextOrder, nextOrderUpdatedAt);
      orderQueued = await enqueueOrderSync('boardOrder.set', nextOrder, nextOrderUpdatedAt);
    }
    set((s) => ({
      boards: replaceOrAdd(s.boards, updated),
      boardOrder: nextOrder,
      boardOrderUpdatedAt: nextOrderUpdatedAt,
      pendingOps: s.pendingOps + (queued ? 1 : 0) + (orderQueued ? 1 : 0),
    }));
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
    const wasActive = get().activeBoardId === id;
    if (wasActive) {
      await db.preferences.delete(ACTIVE_BOARD_KEY);
    }
    const prevOrder = get().boardOrder;
    const nextOrder = prevOrder.filter((bid) => bid !== id);
    const orderChanged = nextOrder.length !== prevOrder.length;
    let nextOrderUpdatedAt = get().boardOrderUpdatedAt;
    let orderQueued = false;
    if (orderChanged) {
      nextOrderUpdatedAt = Date.now();
      await persistOrder(BOARD_ORDER_KEY, nextOrder, nextOrderUpdatedAt);
      orderQueued = await enqueueOrderSync('boardOrder.set', nextOrder, nextOrderUpdatedAt);
    }
    set((s) => ({
      boards: s.boards.filter((b) => b.id !== id),
      boardOrder: nextOrder,
      boardOrderUpdatedAt: nextOrderUpdatedAt,
      activeBoardId: wasActive ? null : s.activeBoardId,
      pendingOps: s.pendingOps + (queued ? 1 : 0) + (orderQueued ? 1 : 0),
    }));
    if (get().online) void get().flushQueue();
  },

  reorderBoards: async (fromId, toId) => {
    await get().setBoardOrder(reorderInArray(get().boardOrder, fromId, toId));
  },

  setBoardOrder: async (order) => {
    const reconciled = reconcileOrder(order, get().boards);
    if (reconciled.join('|') === get().boardOrder.join('|')) return;
    const updatedAt = Date.now();
    set({ boardOrder: reconciled, boardOrderUpdatedAt: updatedAt });
    await persistOrder(BOARD_ORDER_KEY, reconciled, updatedAt);
    const hadPending = (await db.syncQueue
      .where('op')
      .equals('boardOrder.set')
      .count()) > 0;
    const queued = await enqueueOrderSync('boardOrder.set', reconciled, updatedAt);
    if (queued && !hadPending) {
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
        switch (op.op) {
          case 'card.upsert': {
            await apiPostJson('cards.upsert', { card: op.payload });
            // Mark the local row clean once synced, so future pulls can adopt
            // remote edits (last-write-wins). Guard on updatedAt so a newer
            // local edit made since this op was enqueued stays dirty.
            const c = op.payload as Card;
            const cur = await db.cards.get(c.id);
            if (cur && cur.updatedAt === c.updatedAt) {
              await db.cards.update(c.id, { dirty: 0 });
            }
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
            // Mark clean once synced so future pulls can adopt remote edits
            // (otherwise a device that has ever edited a board never pulls in
            // another device's changes to it — e.g. a background URL).
            const b = op.payload as Board;
            const cur = await db.boards.get(b.id);
            if (cur && cur.updatedAt === b.updatedAt) {
              await db.boards.update(b.id, { dirty: 0 });
            }
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
            const cur = await db.readingLists.get(l.id);
            if (cur && cur.updatedAt === l.updatedAt) {
              await db.readingLists.update(l.id, { dirty: 0 });
            }
            break;
          }
          case 'readingList.delete':
            await apiPostJson('readingLists.delete', op.payload);
            break;
          case 'readingProgress.set': {
            await apiPostJson('readingProgress.set', { progress: op.payload });
            const p = op.payload as ReadingProgress;
            const cur = await db.readingProgress.get(p.listId);
            if (cur && cur.updatedAt === p.updatedAt) {
              await db.readingProgress.update(p.listId, { dirty: 0 });
            }
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

    // A local row should only block adopting a newer remote if it has a
    // genuinely pending upsert in the queue. A leftover dirty flag with no
    // pending op is stale (its edit already synced) and must NOT freeze the
    // row forever — otherwise a device that has ever edited a board never
    // pulls in another device's changes to it (e.g. a background URL).
    const queued = await db.syncQueue.toArray();
    const pendingCardIds = new Set(
      queued.filter((o) => o.op === 'card.upsert').map((o) => (o.payload as Card).id),
    );
    const pendingBoardIds = new Set(
      queued.filter((o) => o.op === 'board.upsert').map((o) => (o.payload as Board).id),
    );
    const pendingListIds = new Set(
      queued
        .filter((o) => o.op === 'readingList.upsert')
        .map((o) => (o.payload as ReadingList).id),
    );

    await db.transaction('rw', db.cards, db.boards, db.readingLists, db.readingProgress, async () => {
      for (const c of remoteCards) {
        const local = await db.cards.get(c.id);
        const blocked = local?.dirty === 1 && pendingCardIds.has(c.id);
        if (!local || (!blocked && c.updatedAt > local.updatedAt)) {
          await db.cards.put({ ...c, dirty: 0, deleted: 0 });
        }
      }
      for (const b of remoteBoards) {
        const local = await db.boards.get(b.id);
        const blocked = local?.dirty === 1 && pendingBoardIds.has(b.id);
        if (!local || (!blocked && b.updatedAt > local.updatedAt)) {
          await db.boards.put({ ...b, dirty: 0, deleted: 0 });
        }
      }
      for (const l of remoteLists) {
        const local = await db.readingLists.get(l.id);
        const blocked = local?.dirty === 1 && pendingListIds.has(l.id);
        if (!local || (!blocked && l.updatedAt > local.updatedAt)) {
          await db.readingLists.put({ ...l, dirty: 0, deleted: 0 });
        }
      }
      // Progress needs no "blocked" case: the merge is a union, so adopting the
      // remote row can't drop a local tick. The dirty flag is carried over so a
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

    // Adopt remote order only if it's newer AND no local change is still
    // pending — otherwise an in-flight reorder could be clobbered.
    const remoteCardOrder = Array.isArray(cardOrderResp?.order) ? cardOrderResp.order : [];
    const remoteCardOrderUpdatedAt = typeof cardOrderResp?.updatedAt === 'number' ? cardOrderResp.updatedAt : 0;
    const pendingCardOrderCount = await db.syncQueue
      .where('op')
      .equals('cardOrder.set')
      .count();
    let nextCardOrder = get().cardOrder;
    let nextCardOrderUpdatedAt = get().cardOrderUpdatedAt;
    if (pendingCardOrderCount === 0 && remoteCardOrderUpdatedAt > nextCardOrderUpdatedAt) {
      nextCardOrder = remoteCardOrder;
      nextCardOrderUpdatedAt = remoteCardOrderUpdatedAt;
    }
    const reconciledCardOrder = reconcileOrder(nextCardOrder, liveCards);
    const cardOrderChanged =
      reconciledCardOrder.join('|') !== get().cardOrder.join('|') ||
      nextCardOrderUpdatedAt !== get().cardOrderUpdatedAt;
    if (cardOrderChanged) {
      void persistOrder(CARD_ORDER_KEY, reconciledCardOrder, nextCardOrderUpdatedAt);
    }

    const remoteBoardOrder = Array.isArray(boardOrderResp?.order) ? boardOrderResp.order : [];
    const remoteBoardOrderUpdatedAt = typeof boardOrderResp?.updatedAt === 'number' ? boardOrderResp.updatedAt : 0;
    const pendingBoardOrderCount = await db.syncQueue
      .where('op')
      .equals('boardOrder.set')
      .count();
    let nextBoardOrder = get().boardOrder;
    let nextBoardOrderUpdatedAt = get().boardOrderUpdatedAt;
    if (pendingBoardOrderCount === 0 && remoteBoardOrderUpdatedAt > nextBoardOrderUpdatedAt) {
      nextBoardOrder = remoteBoardOrder;
      nextBoardOrderUpdatedAt = remoteBoardOrderUpdatedAt;
    }
    const reconciledBoardOrder = reconcileOrder(nextBoardOrder, liveBoards);
    const boardOrderChanged =
      reconciledBoardOrder.join('|') !== get().boardOrder.join('|') ||
      nextBoardOrderUpdatedAt !== get().boardOrderUpdatedAt;
    if (boardOrderChanged) {
      void persistOrder(BOARD_ORDER_KEY, reconciledBoardOrder, nextBoardOrderUpdatedAt);
    }

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
      cardOrder: reconciledCardOrder,
      cardOrderUpdatedAt: nextCardOrderUpdatedAt,
      boardOrder: reconciledBoardOrder,
      boardOrderUpdatedAt: nextBoardOrderUpdatedAt,
      activeBoardId: nextActive,
    });
    void expandStoredSpans();
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
  for (const row of cardRows) {
    if (row.dirty !== 1) continue;
    if (row.deleted === 1) await enqueueOp('card.delete', { id: row.id });
    else await enqueueOp('card.upsert', stripLocal(row));
  }
  for (const row of boardRows) {
    if (row.dirty !== 1) continue;
    if (row.deleted === 1) await enqueueOp('board.delete', { id: row.id });
    else await enqueueOp('board.upsert', stripLocal(row));
  }
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
  for (const row of listRows) {
    if (row.dirty !== 1) continue;
    if (row.deleted === 1) await enqueueOp('readingList.delete', { id: row.id });
    else await enqueueOp('readingList.upsert', stripLocal(row));
  }
  for (const row of progressRows) {
    if (row.dirty !== 1) continue;
    await enqueueProgressSync(stripLocal(row));
  }
}

function stripLocal<T extends { dirty?: number; deleted?: number }>(local: T): Omit<T, 'dirty' | 'deleted'> {
  const { dirty: _d, deleted: _x, ...rest } = local;
  void _d;
  void _x;
  return rest;
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
