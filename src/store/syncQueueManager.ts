import { db, type SyncOp } from '@/db/dexie';
import { ApiError } from '@/services/api/client';

/** Persisted order pref: the array plus a logical clock so a remote pull can
 * tell whether its order is newer than the local one. */
export type StoredOrder = { order: string[]; updatedAt: number };

/** Persist a card/board order array under `prefKey` with its timestamp. */
export async function persistOrder(
  prefKey: string,
  order: string[],
  updatedAt: number,
): Promise<void> {
  await db.preferences.put({
    key: prefKey,
    value: { order, updatedAt } satisfies StoredOrder,
  });
}

/**
 * Enqueue a whole-array order sync. Order syncs COLLAPSE: only the most recent
 * order matters, so any pending op of the same type is deleted before the new
 * one is queued — this keeps the queue bounded and never sends a stale order.
 */
export async function enqueueOrderSync(
  op: Extract<SyncOp['op'], 'cardOrder.set' | 'boardOrder.set'>,
  order: string[],
  updatedAt: number,
): Promise<void> {
  const pending = await db.syncQueue.where('op').equals(op).primaryKeys();
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

/** Parse a stored order pref value, tolerating the legacy bare-`string[]`
 * shape (adopted with updatedAt:0 so any remote pull overrides it). */
export function readStoredOrder(raw: unknown): StoredOrder {
  if (Array.isArray(raw)) {
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

/** Sync-queue retry policy: a 4xx (other than 401) is a permanent client error
 * — drop the op. Anything else (401, 5xx, network) is transient — stop the
 * flush and retry the whole queue later. */
export function shouldDropSyncOp(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 401
  );
}
