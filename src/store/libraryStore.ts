import { create } from 'zustand';
import { db, type SyncOp } from '@/db/dexie';
import type { Card, Board } from '@/types/domain';
import { apiGetJson, apiPostJson, ApiError } from '@/services/api/client';
import { normalizeCardReferences } from '@/services/bible/cardReference';

type LibraryState = {
  cards: Card[];
  boards: Board[];
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
  deleteBoard: (id: string) => Promise<void>;
  reorderBoards: (fromId: string, toId: string) => Promise<void>;
  setBoardOrder: (order: string[]) => Promise<void>;
  setActiveBoardId: (id: string | null) => Promise<void>;
  setOnline: (value: boolean) => void;
  flushQueue: () => Promise<void>;
  pullFromServer: () => Promise<void>;
};

const CARD_ORDER_KEY = 'cardOrder';
const BOARD_ORDER_KEY = 'boardOrder';
const ACTIVE_BOARD_KEY = 'activeBoardId';

type StoredOrder = { order: string[]; updatedAt: number };

function nowId(): string {
  return crypto.randomUUID();
}

async function persistOrder(prefKey: string, order: string[], updatedAt: number): Promise<void> {
  await db.preferences.put({
    key: prefKey,
    value: { order, updatedAt } satisfies StoredOrder,
  });
}

// Order syncs as a whole-array set. Multiple pending sets collapse to the
// latest one — only the most recent order matters.
async function enqueueOrderSync(
  op: Extract<SyncOp['op'], 'cardOrder.set' | 'boardOrder.set'>,
  order: string[],
  updatedAt: number,
): Promise<void> {
  const pending = await db.syncQueue
    .where('op')
    .equals(op)
    .primaryKeys();
  if (pending.length > 0) {
    await db.syncQueue.bulkDelete(pending);
  }
  await db.syncQueue.add({
    op,
    payload: { order, updatedAt },
    createdAt: Date.now(),
    attempts: 0,
  });
}

function reconcileOrder(order: string[], items: { id: string }[]): string[] {
  const known = new Set(items.map((c) => c.id));
  const seen = new Set<string>();
  const kept = order.filter((id) => {
    if (!known.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  for (const c of items) {
    if (!seen.has(c.id)) {
      kept.push(c.id);
      seen.add(c.id);
    }
  }
  return kept;
}

function readStoredOrder(raw: unknown): StoredOrder {
  if (Array.isArray(raw)) {
    // Legacy shape (pre-sync): bare string[]. Adopt with a low timestamp so
    // the first remote pull on another device can override.
    return { order: raw.filter((v): v is string => typeof v === 'string'), updatedAt: 0 };
  }
  if (raw && typeof raw === 'object') {
    const obj = raw as Partial<StoredOrder>;
    const order = Array.isArray(obj.order)
      ? obj.order.filter((v): v is string => typeof v === 'string')
      : [];
    const updatedAt = typeof obj.updatedAt === 'number' ? obj.updatedAt : 0;
    return { order, updatedAt };
  }
  return { order: [], updatedAt: 0 };
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  cards: [],
  boards: [],
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
    const [cards, boards, pending, savedCardOrderRow, savedBoardOrderRow, activeRow] = await Promise.all([
      db.cards.filter((c) => c.deleted !== 1).toArray(),
      db.boards.filter((b) => b.deleted !== 1).toArray(),
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
      cardOrder: reconciledCardOrder,
      cardOrderUpdatedAt: storedCardOrder.updatedAt,
      boardOrder: reconciledBoardOrder,
      boardOrderUpdatedAt: storedBoardOrder.updatedAt,
      activeBoardId,
      pendingOps: pending,
      initialized: true,
    });
    if (navigator.onLine) {
      void get().pullFromServer().catch(() => {});
      void get().flushQueue().catch(() => {});
    }
  },

  upsertCard: async (card) => {
    const updated: Card = { ...card, updatedAt: Date.now() };
    await db.cards.put({ ...updated, dirty: 1 });
    await db.syncQueue.add({
      op: 'card.upsert',
      payload: updated,
      createdAt: Date.now(),
      attempts: 0,
    });
    const isNew = !get().cards.some((c) => c.id === updated.id);
    let nextOrder = get().cardOrder;
    let nextOrderUpdatedAt = get().cardOrderUpdatedAt;
    if (isNew) {
      nextOrder = [updated.id, ...nextOrder.filter((id) => id !== updated.id)];
      nextOrderUpdatedAt = Date.now();
      await persistOrder(CARD_ORDER_KEY, nextOrder, nextOrderUpdatedAt);
      await enqueueOrderSync('cardOrder.set', nextOrder, nextOrderUpdatedAt);
    }
    set((s) => ({
      cards: replaceOrAdd(s.cards, updated),
      cardOrder: nextOrder,
      cardOrderUpdatedAt: nextOrderUpdatedAt,
      pendingOps: isNew ? s.pendingOps + 2 : s.pendingOps + 1,
    }));
    if (get().online) void get().flushQueue();
  },

  deleteCard: async (id) => {
    await db.cards.update(id, { deleted: 1, dirty: 1 });
    await db.syncQueue.add({
      op: 'card.delete',
      payload: { id },
      createdAt: Date.now(),
      attempts: 0,
    });
    const prevOrder = get().cardOrder;
    const nextOrder = prevOrder.filter((cid) => cid !== id);
    const orderChanged = nextOrder.length !== prevOrder.length;
    let nextOrderUpdatedAt = get().cardOrderUpdatedAt;
    if (orderChanged) {
      nextOrderUpdatedAt = Date.now();
      await persistOrder(CARD_ORDER_KEY, nextOrder, nextOrderUpdatedAt);
      await enqueueOrderSync('cardOrder.set', nextOrder, nextOrderUpdatedAt);
    }
    set((s) => ({
      cards: s.cards.filter((c) => c.id !== id),
      cardOrder: nextOrder,
      cardOrderUpdatedAt: nextOrderUpdatedAt,
      pendingOps: orderChanged ? s.pendingOps + 2 : s.pendingOps + 1,
    }));
    if (get().online) void get().flushQueue();
  },

  reorderCards: async (fromId, toId) => {
    if (fromId === toId) return;
    const order = get().cardOrder;
    const fromIdx = order.indexOf(fromId);
    const toIdx = order.indexOf(toId);
    if (fromIdx === -1 || toIdx === -1) return;
    const next = order.slice();
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    await get().setCardOrder(next);
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
    await enqueueOrderSync('cardOrder.set', reconciled, updatedAt);
    if (!hadPending) {
      set((s) => ({ pendingOps: s.pendingOps + 1 }));
    }
    if (get().online) void get().flushQueue();
  },

  upsertBoard: async (board) => {
    const updated: Board = { ...board, updatedAt: Date.now() };
    await db.boards.put({ ...updated, dirty: 1 });
    await db.syncQueue.add({
      op: 'board.upsert',
      payload: updated,
      createdAt: Date.now(),
      attempts: 0,
    });
    const isNew = !get().boards.some((b) => b.id === updated.id);
    let nextOrder = get().boardOrder;
    let nextOrderUpdatedAt = get().boardOrderUpdatedAt;
    if (isNew) {
      nextOrder = [...nextOrder.filter((bid) => bid !== updated.id), updated.id];
      nextOrderUpdatedAt = Date.now();
      await persistOrder(BOARD_ORDER_KEY, nextOrder, nextOrderUpdatedAt);
      await enqueueOrderSync('boardOrder.set', nextOrder, nextOrderUpdatedAt);
    }
    set((s) => ({
      boards: replaceOrAdd(s.boards, updated),
      boardOrder: nextOrder,
      boardOrderUpdatedAt: nextOrderUpdatedAt,
      pendingOps: isNew ? s.pendingOps + 2 : s.pendingOps + 1,
    }));
    if (get().online) void get().flushQueue();
  },

  deleteBoard: async (id) => {
    await db.boards.update(id, { deleted: 1, dirty: 1 });
    await db.syncQueue.add({
      op: 'board.delete',
      payload: { id },
      createdAt: Date.now(),
      attempts: 0,
    });
    const wasActive = get().activeBoardId === id;
    if (wasActive) {
      await db.preferences.delete(ACTIVE_BOARD_KEY);
    }
    const prevOrder = get().boardOrder;
    const nextOrder = prevOrder.filter((bid) => bid !== id);
    const orderChanged = nextOrder.length !== prevOrder.length;
    let nextOrderUpdatedAt = get().boardOrderUpdatedAt;
    if (orderChanged) {
      nextOrderUpdatedAt = Date.now();
      await persistOrder(BOARD_ORDER_KEY, nextOrder, nextOrderUpdatedAt);
      await enqueueOrderSync('boardOrder.set', nextOrder, nextOrderUpdatedAt);
    }
    set((s) => ({
      boards: s.boards.filter((b) => b.id !== id),
      boardOrder: nextOrder,
      boardOrderUpdatedAt: nextOrderUpdatedAt,
      activeBoardId: wasActive ? null : s.activeBoardId,
      pendingOps: orderChanged ? s.pendingOps + 2 : s.pendingOps + 1,
    }));
    if (get().online) void get().flushQueue();
  },

  reorderBoards: async (fromId, toId) => {
    if (fromId === toId) return;
    const order = get().boardOrder;
    const fromIdx = order.indexOf(fromId);
    const toIdx = order.indexOf(toId);
    if (fromIdx === -1 || toIdx === -1) return;
    const next = order.slice();
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    await get().setBoardOrder(next);
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
    await enqueueOrderSync('boardOrder.set', reconciled, updatedAt);
    if (!hadPending) {
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

  setOnline: (value) => {
    set({ online: value });
    if (value) void get().flushQueue();
  },

  flushQueue: async () => {
    const ops = await db.syncQueue.orderBy('createdAt').toArray();
    for (const op of ops) {
      try {
        switch (op.op) {
          case 'card.upsert':
            await apiPostJson('cards.upsert', { card: op.payload });
            break;
          case 'card.delete':
            await apiPostJson('cards.delete', op.payload);
            break;
          case 'cardOrder.set':
            await apiPostJson('cards.order.set', op.payload);
            break;
          case 'board.upsert':
            await apiPostJson('boards.upsert', { board: op.payload });
            break;
          case 'board.delete':
            await apiPostJson('boards.delete', op.payload);
            break;
          case 'boardOrder.set':
            await apiPostJson('boards.order.set', op.payload);
            break;
        }
        await db.syncQueue.delete(op.id!);
        set((s) => ({ pendingOps: Math.max(0, s.pendingOps - 1) }));
      } catch (e) {
        if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 401) {
          // permanent failure — drop op
          await db.syncQueue.delete(op.id!);
          set((s) => ({ pendingOps: Math.max(0, s.pendingOps - 1) }));
          continue;
        }
        // network/server error — stop, retry later
        break;
      }
    }
  },

  pullFromServer: async () => {
    const [cardsResp, boardsResp, cardOrderResp, boardOrderResp] = await Promise.all([
      apiGetJson<{ cards: Card[] }>('cards.list'),
      apiGetJson<{ boards: Board[] }>('boards.list'),
      apiGetJson<{ order: string[]; updatedAt: number }>('cards.order.get').catch(
        () => ({ order: [], updatedAt: 0 }),
      ),
      apiGetJson<{ order: string[]; updatedAt: number }>('boards.order.get').catch(
        () => ({ order: [], updatedAt: 0 }),
      ),
    ]);
    const remoteCards = cardsResp.cards ?? [];
    const remoteBoards = boardsResp.boards ?? [];

    await db.transaction('rw', db.cards, db.boards, async () => {
      for (const c of remoteCards) {
        const local = await db.cards.get(c.id);
        if (!local || (!local.dirty && c.updatedAt > local.updatedAt)) {
          await db.cards.put({ ...c, dirty: 0, deleted: 0 });
        }
      }
      for (const b of remoteBoards) {
        const local = await db.boards.get(b.id);
        if (!local || (!local.dirty && b.updatedAt > local.updatedAt)) {
          await db.boards.put({ ...b, dirty: 0, deleted: 0 });
        }
      }
    });

    const [cards, boards] = await Promise.all([
      db.cards.filter((c) => c.deleted !== 1).toArray(),
      db.boards.filter((b) => b.deleted !== 1).toArray(),
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
      cardOrder: reconciledCardOrder,
      cardOrderUpdatedAt: nextCardOrderUpdatedAt,
      boardOrder: reconciledBoardOrder,
      boardOrderUpdatedAt: nextBoardOrderUpdatedAt,
      activeBoardId: nextActive,
    });
  },
}));

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

function replaceOrAdd<T extends { id: string }>(items: T[], next: T): T[] {
  const idx = items.findIndex((it) => it.id === next.id);
  if (idx === -1) return [...items, next];
  const copy = items.slice();
  copy[idx] = next;
  return copy;
}

export { nowId };
