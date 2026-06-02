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
  op:
    | 'card.upsert'
    | 'card.delete'
    | 'cardOrder.set'
    | 'board.upsert'
    | 'board.delete'
    | 'boardOrder.set';
  payload: unknown;
  createdAt: number;
  attempts: number;
};

export type Preference = { key: string; value: unknown };

class BibleAssistantDb extends Dexie {
  cards!: Table<LocalCard, string>;
  boards!: Table<LocalBoard, string>;
  syncQueue!: Table<SyncOp, number>;
  preferences!: Table<Preference, string>;

  constructor() {
    super('bible-assistant');
    this.version(1).stores({
      cards: 'id, title, updatedAt, dirty',
      boards: 'id, name, updatedAt, dirty',
      syncQueue: '++id, op, createdAt',
    });
    // v2 adds optional `tags` and `color` fields on Card. Schema string is
    // unchanged (we don't need them indexed); the bump exists so Dexie
    // recognizes the entity shape change.
    this.version(2).stores({
      cards: 'id, title, updatedAt, dirty',
      boards: 'id, name, updatedAt, dirty',
      syncQueue: '++id, op, createdAt',
    });
    // v3 adds optional `emoji` field on Card.
    this.version(3).stores({
      cards: 'id, title, updatedAt, dirty',
      boards: 'id, name, updatedAt, dirty',
      syncQueue: '++id, op, createdAt',
    });
    // v4 adds a generic key/value preferences table (e.g. user-controlled
    // card order on the /cards screen).
    this.version(4).stores({
      cards: 'id, title, updatedAt, dirty',
      boards: 'id, name, updatedAt, dirty',
      syncQueue: '++id, op, createdAt',
      preferences: '&key',
    });
    // v5 adds optional `color` and `emoji` fields on Board.
    this.version(5).stores({
      cards: 'id, title, updatedAt, dirty',
      boards: 'id, name, updatedAt, dirty',
      syncQueue: '++id, op, createdAt',
      preferences: '&key',
    });
    // v6 adds the optional `freeform` layout map on Board (per-card position/
    // size/rotation for the corkboard view). Not indexed; schema unchanged.
    this.version(6).stores({
      cards: 'id, title, updatedAt, dirty',
      boards: 'id, name, updatedAt, dirty',
      syncQueue: '++id, op, createdAt',
      preferences: '&key',
    });
  }
}

export const db = new BibleAssistantDb();
