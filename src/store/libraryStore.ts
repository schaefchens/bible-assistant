import { create } from 'zustand';
import { db } from '@/db/dexie';
import type { Card, Board } from '@/types/domain';
import { apiGetJson, apiPostJson, ApiError } from '@/services/api/client';

type LibraryState = {
  cards: Card[];
  boards: Board[];
  online: boolean;
  pendingOps: number;
  initialized: boolean;
  init: () => Promise<void>;
  upsertCard: (card: Card) => Promise<void>;
  deleteCard: (id: string) => Promise<void>;
  upsertBoard: (board: Board) => Promise<void>;
  deleteBoard: (id: string) => Promise<void>;
  setOnline: (value: boolean) => void;
  flushQueue: () => Promise<void>;
  pullFromServer: () => Promise<void>;
};

function nowId(): string {
  return crypto.randomUUID();
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  cards: [],
  boards: [],
  online: typeof navigator !== 'undefined' ? navigator.onLine : true,
  pendingOps: 0,
  initialized: false,

  init: async () => {
    if (get().initialized) return;
    const [cards, boards, pending] = await Promise.all([
      db.cards.filter((c) => c.deleted !== 1).toArray(),
      db.boards.filter((b) => b.deleted !== 1).toArray(),
      db.syncQueue.count(),
    ]);
    set({
      cards: cards.map(stripLocal),
      boards: boards.map(stripLocal),
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
    set((s) => ({
      cards: replaceOrAdd(s.cards, updated),
      pendingOps: s.pendingOps + 1,
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
    set((s) => ({
      cards: s.cards.filter((c) => c.id !== id),
      pendingOps: s.pendingOps + 1,
    }));
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
    set((s) => ({
      boards: s.boards.filter((b) => b.id !== id),
      pendingOps: s.pendingOps + 1,
    }));
    if (get().online) void get().flushQueue();
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
    const [cardsResp, boardsResp] = await Promise.all([
      apiGetJson<{ cards: Card[] }>('cards.list'),
      apiGetJson<{ boards: Board[] }>('boards.list'),
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
    set({
      cards: cards.map(stripLocal),
      boards: boards.map(stripLocal),
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
