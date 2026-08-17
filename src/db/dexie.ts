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

/** One cached media file (verse mp3 or word-alignment json), keyed by its
 * absolute URL. See src/lib/mediaCache.ts. */
export type CachedMedia = {
  url: string;
  body: ArrayBuffer;
  contentType: string;
  size: number;
  createdAt: number;
  /** Drives LRU eviction. */
  lastUsedAt: number;
};

class BibleAssistantDb extends Dexie {
  cards!: Table<LocalCard, string>;
  boards!: Table<LocalBoard, string>;
  syncQueue!: Table<SyncOp, number>;
  preferences!: Table<Preference, string>;
  mediaCache!: Table<CachedMedia, string>;

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
    // v6 adds the optional `freeform` layout map and `orientation` on Board
    // (corkboard per-card position/size/rotation + portrait/landscape).
    // Not indexed; schema string unchanged.
    this.version(6).stores({
      cards: 'id, title, updatedAt, dirty',
      boards: 'id, name, updatedAt, dirty',
      syncQueue: '++id, op, createdAt',
      preferences: '&key',
    });
    // v7 adds a persistent media cache. The native builds have no service
    // worker, so Workbox's CacheFirst rule on /storage/audio/* — previously
    // the app's ONLY persistent audio cache — is gone there. Without this,
    // every verse re-downloads on each cold start and offline reading is
    // impossible. Keyed by absolute URL, LRU-evicted on lastUsedAt.
    this.version(7).stores({
      cards: 'id, title, updatedAt, dirty',
      boards: 'id, name, updatedAt, dirty',
      syncQueue: '++id, op, createdAt',
      preferences: '&key',
      mediaCache: '&url, lastUsedAt',
    });
  }
}

export const db = new BibleAssistantDb();
