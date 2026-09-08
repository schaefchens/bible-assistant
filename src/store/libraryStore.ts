import { create } from 'zustand';
import {
  ACTIVE_BOARD_KEY,
  BOARD_ORDER_KEY,
  CARD_ORDER_KEY,
  commitOrder,
  reconcileStoredOrder,
  sameOrder,
} from './libraryOrder';
import { indexProgress, normalizeCard, normalizeList, sortLists } from './libraryRows';
import { createLibrarySync, expandStoredSpans } from './librarySync';
import { db, stripLocal } from '@/db/dexie';
import type {
  Card,
  Board,
  FreeformCardLayout,
  ReadingList,
  ReadingProgress,
} from '@/types/domain';
import {
  emptyReadingProgress,
} from '@/services/reading/readingProgress';
import { reconcileOrder, reorderInArray } from '@/utils/orderingUtils';
import {
  enqueueOp,
  enqueueProgressSync,
} from './syncQueueManager';

export type LibraryState = {
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


function nowId(): string {
  return crypto.randomUUID();
}

export const useLibraryStore = create<LibraryState>((set, get) => {
  // The server-facing half — see librarySync.ts, which holds two of the three
  // `syncEnabled` chokepoints.
  const sync = createLibrarySync(set, get);
  return {
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
    void expandStoredSpans(get);
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

    ...sync,
  };
});

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

function replaceOrAdd<T extends { id: string }>(items: T[], next: T): T[] {
  const idx = items.findIndex((it) => it.id === next.id);
  if (idx === -1) return [...items, next];
  const copy = items.slice();
  copy[idx] = next;
  return copy;
}

export { nowId };
