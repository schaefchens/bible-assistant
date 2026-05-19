import Dexie, { type Table } from 'dexie';
import type { Card, Board } from '@/types/domain';

export type LocalCard = Card & {
  dirty?: 0 | 1;
  deleted?: 0 | 1;
};

export type LocalBoard = Board & {
  dirty?: 0 | 1;
  deleted?: 0 | 1;
};

export type SyncOp = {
  id?: number;
  op: 'card.upsert' | 'card.delete' | 'board.upsert' | 'board.delete';
  payload: unknown;
  createdAt: number;
  attempts: number;
};

class BibleAssistantDb extends Dexie {
  cards!: Table<LocalCard, string>;
  boards!: Table<LocalBoard, string>;
  syncQueue!: Table<SyncOp, number>;

  constructor() {
    super('bible-assistant');
    this.version(1).stores({
      cards: 'id, title, updatedAt, dirty',
      boards: 'id, name, updatedAt, dirty',
      syncQueue: '++id, op, createdAt',
    });
  }
}

export const db = new BibleAssistantDb();
