import { db, type SyncOp } from '@/db/dexie';
import { reconcileOrder } from '@/utils/orderingUtils';
import {
  enqueueOrderSync,
  persistOrder,
  readStoredOrder,
  type StoredOrder,
} from './syncQueueManager';

/**
 * The `preferences` rows the library keeps.
 *
 * Here because both halves clear them: a write does through `commitOrder` /
 * `deleteBoard`, and a pull does when it adopts a newer order or finds the
 * selected board gone. `activeBoardId` rides along rather than earning a
 * module of its own — three constants in one place beats a cycle.
 */
export const CARD_ORDER_KEY = 'cardOrder';
export const BOARD_ORDER_KEY = 'boardOrder';
export const ACTIVE_BOARD_KEY = 'activeBoardId';

/**
 * Card and board order: how it is persisted, queued, and reconciled after a
 * pull.
 *
 * Its own module because it is one of three things both halves of the library
 * need — `libraryStore`'s writes call `commitOrder`, `librarySync`'s pull calls
 * `adoptedOrder` — so leaving it in either would make the two import each
 * other. CLAUDE.md's "one copy of a rule" table records why it exists at all:
 * six writers, four of which mis-counted `pendingOps`.
 */

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

/** Orders are compared as whole arrays; this is the cheap way to say so. */
export const sameOrder = (a: string[], b: string[]): boolean => a.join('|') === b.join('|');

/** Read a persisted order and reconcile it against the rows that actually
 * exist, re-persisting it if reconciliation changed anything. */
export function reconcileStoredOrder(
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
export async function commitOrder(
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

/**
 * The order after a pull: the server's if it is newer *and* nothing local is
 * still pending, else the local one — then reconciled against the rows that
 * actually exist, and re-persisted if any of that changed it.
 *
 * Skipping the adoption while an op is pending is what stops an in-flight
 * reorder being clobbered by the very order it is about to replace.
 */
export async function adoptedOrder(
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
