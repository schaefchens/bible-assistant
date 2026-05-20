import { create } from 'zustand';
import { db } from '@/db/dexie';
import type { Card, Board } from '@/types/domain';
import { apiGetJson, apiPostJson, ApiError } from '@/services/api/client';

type LibraryState = {
  cards: Card[];
  boards: Board[];
  cardOrder: string[];
  cardOrderUpdatedAt: number;
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
  setActiveBoardId: (id: string | null) => Promise<void>;
  setOnline: (value: boolean) => void;
  flushQueue: () => Promise<void>;
  pullFromServer: () => Promise<void>;
};

const CARD_ORDER_KEY = 'cardOrder';
const ACTIVE_BOARD_KEY = 'activeBoardId';

type StoredCardOrder = { order: string[]; updatedAt: number };

function nowId(): string {
  return crypto.randomUUID();
}

async function persistCardOrder(order: string[], updatedAt: number): Promise<void> {
  await db.preferences.put({
    key: CARD_ORDER_KEY,
    value: { order, updatedAt } satisfies StoredCardOrder,
  });
}

// Card-order syncs as a whole-array set. Multiple pending sets collapse to
// the latest one — only the most recent order matters.
async function enqueueCardOrderSync(order: string[], updatedAt: number): Promise<void> {
  const pending = await db.syncQueue
    .where('op')
    .equals('cardOrder.set')
    .primaryKeys();
  if (pending.length > 0) {
    await db.syncQueue.bulkDelete(pending);
  }
  await db.syncQueue.add({
    op: 'cardOrder.set',
    payload: { order, updatedAt },
    createdAt: Date.now(),
    attempts: 0,
  });
}

function reconcileOrder(order: string[], cards: Card[]): string[] {
  const known = new Set(cards.map((c) => c.id));
  const seen = new Set<string>();
  const kept = order.filter((id) => {
    if (!known.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  for (const c of cards) {
    if (!seen.has(c.id)) {
      kept.push(c.id);
      seen.add(c.id);
    }
  }
  return kept;
}

function readStoredCardOrder(raw: unknown): StoredCardOrder {
  if (Array.isArray(raw)) {
    // Legacy shape (pre-sync): bare string[]. Adopt with a low timestamp so
    // the first remote pull on another device can override.
    return { order: raw.filter((v): v is string => typeof v === 'string'), updatedAt: 0 };
  }
  if (raw && typeof raw === 'object') {
    const obj = raw as Partial<StoredCardOrder>;
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
  activeBoardId: null,
  online: typeof navigator !== 'undefined' ? navigator.onLine : true,
  pendingOps: 0,
  initialized: false,

  init: async () => {
    if (get().initialized) return;
    const [cards, boards, pending, savedOrderRow, activeRow] = await Promise.all([
      db.cards.filter((c) => c.deleted !== 1).toArray(),
      db.boards.filter((b) => b.deleted !== 1).toArray(),
      db.syncQueue.count(),
      db.preferences.get(CARD_ORDER_KEY),
      db.preferences.get(ACTIVE_BOARD_KEY),
    ]);
    const liveCards = cards.map(stripLocal);
    const liveBoards = boards.map(stripLocal);
    const stored = readStoredCardOrder(savedOrderRow?.value);
    const reconciled = reconcileOrder(stored.order, liveCards);
    if (reconciled.join('|') !== stored.order.join('|')) {
      void persistCardOrder(reconciled, stored.updatedAt);
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
      cardOrder: reconciled,
      cardOrderUpdatedAt: stored.updatedAt,
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
      await persistCardOrder(nextOrder, nextOrderUpdatedAt);
      await enqueueCardOrderSync(nextOrder, nextOrderUpdatedAt);
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
      await persistCardOrder(nextOrder, nextOrderUpdatedAt);
      await enqueueCardOrderSync(nextOrder, nextOrderUpdatedAt);
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
    await persistCardOrder(reconciled, updatedAt);
    const hadPending = (await db.syncQueue
      .where('op')
      .equals('cardOrder.set')
      .count()) > 0;
    await enqueueCardOrderSync(reconciled, updatedAt);
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
    set((s) => ({
      boards: replaceOrAdd(s.boards, updated),
      pendingOps: s.pendingOps + 1,
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
    set((s) => ({
      boards: s.boards.filter((b) => b.id !== id),
      activeBoardId: wasActive ? null : s.activeBoardId,
      pendingOps: s.pendingOps + 1,
    }));
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
    const [cardsResp, boardsResp, orderResp] = await Promise.all([
      apiGetJson<{ cards: Card[] }>('cards.list'),
      apiGetJson<{ boards: Board[] }>('boards.list'),
      apiGetJson<{ order: string[]; updatedAt: number }>('cards.order.get').catch(
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
    const liveCards = cards.map(stripLocal);

    // Adopt remote cardOrder only if it's newer AND no local change is still
    // pending — otherwise an in-flight reorder could be clobbered.
    const remoteOrder = Array.isArray(orderResp?.order) ? orderResp.order : [];
    const remoteOrderUpdatedAt = typeof orderResp?.updatedAt === 'number' ? orderResp.updatedAt : 0;
    const pendingOrderCount = await db.syncQueue
      .where('op')
      .equals('cardOrder.set')
      .count();
    let nextOrder = get().cardOrder;
    let nextOrderUpdatedAt = get().cardOrderUpdatedAt;
    if (pendingOrderCount === 0 && remoteOrderUpdatedAt > nextOrderUpdatedAt) {
      nextOrder = remoteOrder;
      nextOrderUpdatedAt = remoteOrderUpdatedAt;
    }
    const reconciled = reconcileOrder(nextOrder, liveCards);
    const orderChanged =
      reconciled.join('|') !== get().cardOrder.join('|') ||
      nextOrderUpdatedAt !== get().cardOrderUpdatedAt;
    if (orderChanged) {
      void persistCardOrder(reconciled, nextOrderUpdatedAt);
    }
    const liveBoards = boards.map(stripLocal);
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
      cardOrder: reconciled,
      cardOrderUpdatedAt: nextOrderUpdatedAt,
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

function replaceOrAdd<T extends { id: string }>(items: T[], next: T): T[] {
  const idx = items.findIndex((it) => it.id === next.id);
  if (idx === -1) return [...items, next];
  const copy = items.slice();
  copy[idx] = next;
  return copy;
}

export { nowId };
