import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The sync queue is where this codebase's bug history is densest. CLAUDE.md's
 * "one copy of a rule" table records card/board order as "six writers, four of
 * which mis-counted `pendingOps`", and the most recent fix on main is
 * `25cf098 fix(sync): pendingOps counted an order op that replaced one`.
 *
 * This is an *integration* spec, not a unit one: the property under test spans
 * the store, Dexie and the wire, and none of the three is interesting alone.
 * Only the outermost edge — `apiPostJson` — is faked, which is exactly where a
 * fake belongs.
 */

vi.mock('@/services/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/api/client')>()),
  apiPostJson: vi.fn(async () => ({})),
  apiGetJson: vi.fn(async () => ({})),
}));

const { apiPostJson, apiGetJson, ApiError } = await import('@/services/api/client');
const { db } = await import('@/db/dexie');
const { useLibraryStore } = await import('@/store/libraryStore');
const { useSettingsStore } = await import('@/store/settingsStore');
const { enqueueOp, enqueueOrderSync, enqueueProgressSync, shouldDropSyncOp } = await import(
  '@/store/syncQueueManager'
);
const posted = vi.mocked(apiPostJson);
const fetched = vi.mocked(apiGetJson);

const card = (id: string, updatedAt = 1) => ({
  id,
  title: `Card ${id}`,
  references: [],
  createdAt: 1,
  updatedAt,
});

/** The ops on the queue, oldest first — what a flush would actually send. */
const queued = async () =>
  (await db.syncQueue.orderBy('createdAt').toArray()).map((o) => o.op);

const setSync = (on: boolean) => useSettingsStore.setState({ syncEnabled: on });

beforeEach(async () => {
  await Promise.all([
    db.syncQueue.clear(),
    db.cards.clear(),
    db.boards.clear(),
    db.readingLists.clear(),
    db.readingProgress.clear(),
    db.preferences.clear(),
  ]);
  posted.mockReset();
  posted.mockResolvedValue({});
  fetched.mockReset();
  fetched.mockResolvedValue({});
  useLibraryStore.setState({
    cards: [], boards: [], readingLists: [], readingProgress: {},
    cardOrder: [], cardOrderUpdatedAt: 0, boardOrder: [], boardOrderUpdatedAt: 0,
    pendingOps: 0, online: true,
  });
  setSync(true);
});

/**
 * The opt-in is enforced at the queueing chokepoint rather than at the ~10 call
 * sites, so a new caller cannot bypass it by forgetting. With sync off the op
 * is *dropped*, not queued — an unbounded queue on a device that may never sync
 * is worse than one explicit catch-up pass when it is switched on.
 */
describe('the syncEnabled chokepoint', () => {
  it('drops every kind of op while sync is off, and says it did', async () => {
    setSync(false);
    expect(await enqueueOp('card.upsert', card('c1'))).toBe(false);
    expect(await enqueueOrderSync('cardOrder.set', ['c1'], 1)).toBe(false);
    expect(await enqueueProgressSync({ listId: 'L1', completed: [], updatedAt: 1 })).toBe(false);
    expect(await db.syncQueue.count()).toBe(0);
  });

  it('queues once sync is on', async () => {
    expect(await enqueueOp('card.upsert', card('c1'))).toBe(true);
    expect(await queued()).toEqual(['card.upsert']);
  });

  it('never pushes while sync is off, even with a queue already there', async () => {
    await enqueueOp('card.upsert', card('c1'));
    setSync(false);
    await useLibraryStore.getState().flushQueue();
    expect(posted).not.toHaveBeenCalled();
    expect(await db.syncQueue.count()).toBe(1);
  });

  it('a write through the store leaves pendingOps at 0 with sync off', async () => {
    setSync(false);
    await useLibraryStore.getState().upsertCard(card('c1'));
    expect(useLibraryStore.getState().pendingOps).toBe(0);
    expect(await db.syncQueue.count()).toBe(0);
  });

  /** The third chokepoint. Guarding here rather than at the ~10 call sites is
   * what makes the opt-in truthful: a user who only reads scripture and asks
   * the assistant questions leaves nothing on the server. */
  it('never reads from the server while sync is off', async () => {
    setSync(false);
    await useLibraryStore.getState().pullFromServer();
    expect(fetched).not.toHaveBeenCalled();
  });

  it('does read once sync is on', async () => {
    fetched.mockResolvedValue({ cards: [], boards: [], order: [], updatedAt: 0 });
    await useLibraryStore.getState().pullFromServer();
    expect(fetched).toHaveBeenCalled();
  });

  /** Turning sync off drops the queue rather than leaving ops behind a flush
   * that will never run — the same reasoning as dropping them at enqueue. */
  it('disableSync clears the queue and the count together', async () => {
    useLibraryStore.setState({ online: false });
    await useLibraryStore.getState().upsertCard(card('c1'));
    expect(await db.syncQueue.count()).toBeGreaterThan(0);

    await useLibraryStore.getState().disableSync();

    expect(await db.syncQueue.count()).toBe(0);
    expect(useLibraryStore.getState().pendingOps).toBe(0);
    expect(useSettingsStore.getState().syncEnabled).toBe(false);
  });
});

/**
 * Order syncs collapse — only the newest order matters — which is precisely
 * what made the count wrong: a writer that adds +1 per call walks `pendingOps`
 * above the real queue length, and the status bar then shows pending work that
 * does not exist.
 */
describe('order syncs collapse, and the count follows', () => {
  it('keeps one op holding the newest order, however many times you reorder', async () => {
    await enqueueOrderSync('cardOrder.set', ['a', 'b'], 1);
    await enqueueOrderSync('cardOrder.set', ['b', 'a'], 2);
    await enqueueOrderSync('cardOrder.set', ['a', 'b'], 3);
    const ops = await db.syncQueue.toArray();
    expect(ops).toHaveLength(1);
    expect(ops[0].payload).toEqual({ order: ['a', 'b'], updatedAt: 3 });
  });

  it('collapses cards and boards independently', async () => {
    await enqueueOrderSync('cardOrder.set', ['a'], 1);
    await enqueueOrderSync('boardOrder.set', ['x'], 1);
    await enqueueOrderSync('cardOrder.set', ['b'], 2);
    expect((await queued()).sort()).toEqual(['boardOrder.set', 'cardOrder.set']);
  });

  /**
   * `25cf098`, asserted the way it actually shows up.
   *
   * Offline on purpose: the store flushes after every write when online, so an
   * online run leaves both numbers at 0 and agrees for the wrong reason. The
   * miscount is only visible while the queue is still standing.
   *
   * The cards have to exist first, too — `setCardOrder` reconciles the order
   * against the rows it actually has and early-returns when that changes
   * nothing, so ordering ids with no cards behind them is correctly a no-op.
   */
  it('does not count a replaced order op twice', async () => {
    useLibraryStore.setState({ online: false });
    const store = useLibraryStore.getState();
    await store.upsertCard(card('a'));
    await store.upsertCard(card('b'));

    // The invariant, checked after every single write rather than at the end:
    // `pendingOps` is a running count of a queue that collapses underneath it,
    // so the only honest statement is that the two never drift apart.
    const agrees = async () =>
      expect(useLibraryStore.getState().pendingOps).toBe(await db.syncQueue.count());

    for (const order of [['b', 'a'], ['a', 'b'], ['b', 'a']]) {
      await store.setCardOrder(order);
      await agrees();
    }

    // However many times you reorder, exactly one order op is ever waiting.
    expect((await db.syncQueue.toArray()).filter((o) => o.op === 'cardOrder.set')).toHaveLength(1);
  });

  it('keeps pendingOps equal to the queue through a mixed run of writes', async () => {
    useLibraryStore.setState({ online: false });
    const store = useLibraryStore.getState();
    await store.upsertCard(card('c1'));
    await store.upsertCard(card('c2', 2));
    await store.setCardOrder(['c2', 'c1']);
    await store.setCardOrder(['c1', 'c2']);
    await store.deleteCard('c1');
    expect(useLibraryStore.getState().pendingOps).toBe(await db.syncQueue.count());
  });

  /** An order that names rows the device does not have is not a change. */
  it('ignores an order referencing cards that do not exist', async () => {
    useLibraryStore.setState({ online: false });
    await useLibraryStore.getState().setCardOrder(['ghost']);
    expect(await db.syncQueue.count()).toBe(0);
    expect(useLibraryStore.getState().pendingOps).toBe(0);
  });

  it('and the count is right again after the queue drains', async () => {
    const store = useLibraryStore.getState();
    await store.setCardOrder(['a', 'b']);
    await store.setCardOrder(['b', 'a']);
    await useLibraryStore.getState().flushQueue();
    expect(await db.syncQueue.count()).toBe(0);
    expect(useLibraryStore.getState().pendingOps).toBe(0);
  });
});

/**
 * Progress collapses too, but *per list*: working through a plan produces one
 * op per entry finished and only the newest matters — while another list's
 * pending progress must survive, or a device working two plans loses one.
 */
describe('progress syncs collapse per list', () => {
  it('replaces its own list’s pending op', async () => {
    await enqueueProgressSync({ listId: 'L1', completed: ['e1'], updatedAt: 1 });
    await enqueueProgressSync({ listId: 'L1', completed: ['e1', 'e2'], updatedAt: 2 });
    const ops = await db.syncQueue.toArray();
    expect(ops).toHaveLength(1);
    expect(ops[0].payload).toMatchObject({ completed: ['e1', 'e2'], updatedAt: 2 });
  });

  it('leaves another list’s pending progress alone', async () => {
    await enqueueProgressSync({ listId: 'L1', completed: ['e1'], updatedAt: 1 });
    await enqueueProgressSync({ listId: 'L2', completed: ['x1'], updatedAt: 1 });
    await enqueueProgressSync({ listId: 'L1', completed: ['e1', 'e2'], updatedAt: 2 });
    const byList = (await db.syncQueue.toArray()).map(
      (o) => (o.payload as { listId: string }).listId,
    );
    expect(byList.sort()).toEqual(['L1', 'L2']);
  });
});

describe('flushQueue — what reaches the wire', () => {
  it('sends oldest first, so a create precedes the order that references it', async () => {
    // Op ordering is not cosmetic. verifyBackend.mjs:261 records the sharp
    // case: a `spaceCode.set` that overtakes its `space.upsert` 404s, and a
    // 404 is treated as permanent — so the share code is lost for good.
    await db.syncQueue.bulkAdd([
      { op: 'card.upsert', payload: card('c1'), createdAt: 10, attempts: 0 },
      { op: 'cardOrder.set', payload: { order: ['c1'], updatedAt: 11 }, createdAt: 11, attempts: 0 },
      { op: 'card.delete', payload: { id: 'c1' }, createdAt: 12, attempts: 0 },
    ]);
    await useLibraryStore.getState().flushQueue();
    expect(posted.mock.calls.map((c) => c[0])).toEqual([
      'cards.upsert', 'cards.order.set', 'cards.delete',
    ]);
  });

  it('empties the queue and the count together on success', async () => {
    const store = useLibraryStore.getState();
    await store.upsertCard(card('c1'));
    await store.setCardOrder(['c1']);
    await useLibraryStore.getState().flushQueue();
    expect(await db.syncQueue.count()).toBe(0);
    expect(useLibraryStore.getState().pendingOps).toBe(0);
  });

  it('maps each op to its own action and payload shape', async () => {
    await db.syncQueue.add({ op: 'card.upsert', payload: card('c1'), createdAt: 1, attempts: 0 });
    await useLibraryStore.getState().flushQueue();
    expect(posted).toHaveBeenCalledWith('cards.upsert', { card: card('c1') });
  });

  /** Being clean is what lets a future pull adopt a remote edit to the same
   * row; a leftover dirty flag would freeze it forever. */
  it('marks a row clean once the server has it', async () => {
    await db.cards.put({ ...card('c1'), dirty: 1, deleted: 0 });
    await db.syncQueue.add({ op: 'card.upsert', payload: card('c1'), createdAt: 1, attempts: 0 });
    await useLibraryStore.getState().flushQueue();
    expect((await db.cards.get('c1'))?.dirty).toBe(0);
  });

  it('leaves a row dirty if it was edited again while the op was in flight', async () => {
    // The updatedAt guard: marking it clean would lose the newer local edit.
    await db.cards.put({ ...card('c1', 99), dirty: 1, deleted: 0 });
    await db.syncQueue.add({ op: 'card.upsert', payload: card('c1', 1), createdAt: 1, attempts: 0 });
    await useLibraryStore.getState().flushQueue();
    expect((await db.cards.get('c1'))?.dirty).toBe(1);
  });
});

/**
 * The retry policy decides whether a failure costs one op or stalls the queue.
 * Getting it backwards is expensive in both directions: dropping a transient
 * failure loses the user's work, and retrying a permanent one stalls
 * everything behind it forever.
 */
describe('flushQueue — the retry policy', () => {
  it.each([
    { status: 400, drop: true, why: 'a malformed op is permanent' },
    { status: 404, drop: true, why: 'a missing target is permanent' },
    { status: 422, drop: true, why: 'a refused op is permanent' },
    { status: 401, drop: false, why: 'auth may recover — deliberately not a 4xx drop' },
    { status: 500, drop: false, why: 'a server error is transient' },
    { status: 503, drop: false, why: 'so is being unavailable' },
  ])('$why (status $status)', ({ status, drop }) => {
    expect(shouldDropSyncOp(new ApiError('nope', status, null))).toBe(drop);
  });

  it('treats a network error (no status) as transient', () => {
    expect(shouldDropSyncOp(new Error('offline'))).toBe(false);
  });

  it('drops a permanently-failing op and carries on with the rest', async () => {
    await db.syncQueue.bulkAdd([
      { op: 'card.upsert', payload: card('bad'), createdAt: 1, attempts: 0 },
      { op: 'card.upsert', payload: card('good'), createdAt: 2, attempts: 0 },
    ]);
    posted.mockRejectedValueOnce(new ApiError('rejected', 422, null));
    await useLibraryStore.getState().flushQueue();
    expect(await db.syncQueue.count()).toBe(0);
    expect(useLibraryStore.getState().pendingOps).toBe(0);
    expect(posted).toHaveBeenCalledTimes(2);
  });

  it('stops at a transient failure and keeps it *and* everything after it', async () => {
    await db.syncQueue.bulkAdd([
      { op: 'card.upsert', payload: card('c1'), createdAt: 1, attempts: 0 },
      { op: 'card.upsert', payload: card('c2'), createdAt: 2, attempts: 0 },
    ]);
    posted.mockRejectedValue(new ApiError('down', 503, null));
    await useLibraryStore.getState().flushQueue();
    // Stopping rather than skipping is what preserves order for the retry.
    expect(await db.syncQueue.count()).toBe(2);
    expect(posted).toHaveBeenCalledTimes(1);
  });

  it('never drives pendingOps below zero', async () => {
    useLibraryStore.setState({ pendingOps: 0 });
    await db.syncQueue.add({ op: 'card.delete', payload: { id: 'x' }, createdAt: 1, attempts: 0 });
    await useLibraryStore.getState().flushQueue();
    expect(useLibraryStore.getState().pendingOps).toBe(0);
  });
});

/**
 * Turning sync on is the catch-up pass that dropping ops buys. Without it,
 * everything created before the opt-in would exist only on this device.
 */
describe('enableSync seeds the queue from local state', () => {
  it('queues every dirty row, and a tombstone as a delete', async () => {
    setSync(false);
    await db.cards.bulkPut([
      { ...card('c1'), dirty: 1, deleted: 0 },
      { ...card('c2'), dirty: 1, deleted: 1 },
      { ...card('c3'), dirty: 0, deleted: 0 },
    ]);
    posted.mockResolvedValue({ cards: [] });

    await useLibraryStore.getState().enableSync();

    // c3 is already clean, so it needs no op. c2's tombstone must travel, or a
    // card deleted offline is resurrected by the first pull from elsewhere.
    const actions = posted.mock.calls.map((c) => c[0]);
    expect(actions).toContain('cards.upsert');
    expect(actions).toContain('cards.delete');
    expect(useSettingsStore.getState().syncEnabled).toBe(true);
  });
});
