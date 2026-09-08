import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The half of `libraryStore` that `syncQueue.test.ts` does not cover.
 *
 * That spec is 28 tests deep on the sync engine — the chokepoint, order
 * collapse, flush ordering, the retry policy. The CRUD half had exactly two
 * assertions anywhere (`toolDispatch.test.ts` creating a card and listing it
 * back), and three rules in it are load-bearing enough that CLAUDE.md
 * describes each as deliberate behaviour:
 *
 *   - `activeBoardId === null` *is* the All-cards tab, so a board that no
 *     longer exists must read as All cards rather than as a blank screen;
 *   - a legacy multi-chapter entry is repaired on load, **carrying its tick to
 *     every chapter**, because progress is per entry and a four-chapter entry
 *     could only ever be all-read or all-unread;
 *   - a pull never deletes a local row the server omits.
 *
 * Integration, not unit: all three span the store, Dexie and the wire. Only
 * `apiGetJson` / `apiPostJson` are faked — the same edge `syncQueue.test.ts`
 * fakes, and for the same reason.
 */

vi.mock('@/services/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/api/client')>()),
  apiPostJson: vi.fn(async () => ({})),
  apiGetJson: vi.fn(async () => ({})),
}));

const { apiGetJson, apiPostJson } = await import('@/services/api/client');
const { db } = await import('@/db/dexie');
const { useLibraryStore } = await import('@/store/libraryStore');
const { useSettingsStore } = await import('@/store/settingsStore');
const fetched = vi.mocked(apiGetJson);
const posted = vi.mocked(apiPostJson);

const ACTIVE_BOARD_KEY = 'activeBoardId';

const board = (id: string, updatedAt = 1) => ({
  id,
  name: `Board ${id}`,
  cardIds: [],
  createdAt: 1,
  updatedAt,
});

const card = (id: string, updatedAt = 1) => ({
  id,
  title: `Card ${id}`,
  references: [],
  createdAt: 1,
  updatedAt,
});

/**
 * What each pull endpoint answers. `cards.list` / `boards.list` and the two
 * order reads are always asked for; the reading-list pair is swallowed on
 * failure, so an absent key here is the same as an old api.php.
 */
function serverHas(rows: {
  cards?: unknown[];
  boards?: unknown[];
  readingLists?: unknown[];
  progress?: unknown[];
}) {
  fetched.mockImplementation(async (action: string) => {
    if (action === 'cards.list') return { cards: rows.cards ?? [] };
    if (action === 'boards.list') return { boards: rows.boards ?? [] };
    if (action === 'readingLists.list') return { readingLists: rows.readingLists ?? [] };
    if (action === 'readingProgress.list') return { progress: rows.progress ?? [] };
    return { order: [], updatedAt: 0 };
  });
}

/** `expandStoredSpans` is fired and not awaited, so poll for its effect. */
async function until(pred: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`timed out waiting for: ${what}`);
}

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
  serverHas({});
  useLibraryStore.setState({
    cards: [], boards: [], readingLists: [], readingProgress: {},
    cardOrder: [], cardOrderUpdatedAt: 0, boardOrder: [], boardOrderUpdatedAt: 0,
    activeBoardId: null, pendingOps: 0, online: true,
  });
  useSettingsStore.setState({ syncEnabled: true });
});

describe('activeBoardId never points at a board that is gone', () => {
  it('deleting the selected board falls back to All cards, not to another board', async () => {
    await db.boards.bulkPut([
      { ...board('b1'), dirty: 0, deleted: 0 },
      { ...board('b2'), dirty: 0, deleted: 0 },
    ]);
    useLibraryStore.setState({
      boards: [board('b1'), board('b2')],
      boardOrder: ['b1', 'b2'],
      activeBoardId: 'b1',
    });

    await useLibraryStore.getState().deleteBoard('b1');

    expect(useLibraryStore.getState().activeBoardId).toBeNull();
    // Not 'b2': `null` is the All-cards tab, and silently landing the user on
    // somebody else's board is the behaviour this replaced.
    expect(useLibraryStore.getState().boards.map((b) => b.id)).toEqual(['b2']);
  });

  it('forgets the stored preference too, so a reload agrees', async () => {
    await db.preferences.put({ key: ACTIVE_BOARD_KEY, value: 'b1' });
    await db.boards.put({ ...board('b1'), dirty: 0, deleted: 0 });
    useLibraryStore.setState({ boards: [board('b1')], activeBoardId: 'b1' });

    await useLibraryStore.getState().deleteBoard('b1');

    expect(await db.preferences.get(ACTIVE_BOARD_KEY)).toBeUndefined();
  });

  it('leaves the selection alone when a different board is deleted', async () => {
    await db.boards.bulkPut([
      { ...board('b1'), dirty: 0, deleted: 0 },
      { ...board('b2'), dirty: 0, deleted: 0 },
    ]);
    await db.preferences.put({ key: ACTIVE_BOARD_KEY, value: 'b2' });
    useLibraryStore.setState({ boards: [board('b1'), board('b2')], activeBoardId: 'b2' });

    await useLibraryStore.getState().deleteBoard('b1');

    expect(useLibraryStore.getState().activeBoardId).toBe('b2');
    expect(await db.preferences.get(ACTIVE_BOARD_KEY)).toMatchObject({ value: 'b2' });
  });

  it('a pull drops a selection whose board is no longer live', async () => {
    // The reachable shape: the board is tombstoned locally and the flush has
    // not landed yet, so the preference still names it. `liveBoards` excludes
    // a tombstone, and without the guard the page would render a board that
    // is not in its own tab strip.
    await db.boards.put({ ...board('b1'), dirty: 1, deleted: 1 });
    await db.preferences.put({ key: ACTIVE_BOARD_KEY, value: 'b1' });
    useLibraryStore.setState({ activeBoardId: 'b1' });

    await useLibraryStore.getState().pullFromServer();

    expect(useLibraryStore.getState().activeBoardId).toBeNull();
    expect(await db.preferences.get(ACTIVE_BOARD_KEY)).toBeUndefined();
  });

  it('a pull keeps a selection the server still knows about', async () => {
    serverHas({ boards: [board('b1', 5)] });
    useLibraryStore.setState({ activeBoardId: 'b1' });

    await useLibraryStore.getState().pullFromServer();

    expect(useLibraryStore.getState().activeBoardId).toBe('b1');
  });
});

describe('a legacy multi-chapter entry is repaired, and keeps its tick', () => {
  /** How such an entry reaches disk: written before `expandEntryToChapters`. */
  const legacy = {
    id: 'list-1',
    name: 'Jonah',
    days: [{ id: 'd1', entries: [{ id: 'e-span', bookId: 32, chapter: 1, chapterEnd: 4 }] }],
    createdAt: 1,
    updatedAt: 1,
  };

  it('splits it into one entry per chapter', async () => {
    serverHas({ readingLists: [legacy] });
    await useLibraryStore.getState().pullFromServer();

    await until(
      () => (useLibraryStore.getState().readingLists[0]?.days[0]?.entries.length ?? 0) === 4,
      'the span to expand into four entries',
    );
    const entries = useLibraryStore.getState().readingLists[0].days[0].entries;
    expect(entries.map((e) => e.chapter)).toEqual([1, 2, 3, 4]);
    // Every one is a single chapter now — that is the point. Progress is per
    // entry, so a span could only ever be all-read or all-unread while the
    // picker showed four separately tickable rows.
    expect(entries.every((e) => e.chapterEnd === undefined)).toBe(true);
  });

  it('carries the parent tick to every chapter, so no progress is lost', async () => {
    serverHas({
      readingLists: [legacy],
      progress: [{ listId: 'list-1', completed: ['e-span'], updatedAt: 9 }],
    });
    await useLibraryStore.getState().pullFromServer();

    await until(() => {
      const entries = useLibraryStore.getState().readingLists[0]?.days[0]?.entries ?? [];
      const done = useLibraryStore.getState().readingProgress['list-1']?.completed ?? [];
      return entries.length === 4 && entries.every((e) => done.includes(e.id));
    }, 'all four chapters to inherit the tick');

    const { readingLists, readingProgress } = useLibraryStore.getState();
    const ids = readingLists[0].days[0].entries.map((e) => e.id);
    expect(readingProgress['list-1'].completed).toEqual(expect.arrayContaining(ids));
  });

  it('leaves an untouched span untouched, rather than ticking it', async () => {
    serverHas({ readingLists: [legacy] });
    await useLibraryStore.getState().pullFromServer();

    await until(
      () => (useLibraryStore.getState().readingLists[0]?.days[0]?.entries.length ?? 0) === 4,
      'the span to expand',
    );
    expect(useLibraryStore.getState().readingProgress['list-1']?.completed ?? []).toEqual([]);
  });

  it('does not rewrite a list that is already one entry per chapter', async () => {
    const clean = {
      id: 'list-2',
      name: 'Psalms',
      days: [{ id: 'd1', entries: [{ id: 'e1', bookId: 19, chapter: 1 }] }],
      createdAt: 1,
      updatedAt: 1,
    };
    serverHas({ readingLists: [clean] });
    await useLibraryStore.getState().pullFromServer();
    await new Promise((r) => setTimeout(r, 40));

    // A rewrite would queue a readingList.upsert and bump updatedAt for a list
    // nobody edited, which would then win over another device's real change.
    const ops = (await db.syncQueue.toArray()).map((o) => o.op);
    expect(ops).not.toContain('readingList.upsert');
    expect(useLibraryStore.getState().readingLists[0].updatedAt).toBe(1);
  });
});

describe('a pull never deletes what the server merely omits', () => {
  it('keeps a card the server has never seen', async () => {
    // The server holds only what it has been sent. A card created offline is
    // legitimately absent from it, and treating "missing" as "deleted" would
    // destroy the user's own work.
    await db.cards.put({ ...card('local-1'), dirty: 1, deleted: 0 });
    serverHas({ cards: [] });

    await useLibraryStore.getState().pullFromServer();

    expect(useLibraryStore.getState().cards.map((c) => c.id)).toEqual(['local-1']);
    expect(await db.cards.get('local-1')).toBeDefined();
  });

  it('keeps a board the server has never seen', async () => {
    await db.boards.put({ ...board('local-b'), dirty: 1, deleted: 0 });
    serverHas({ boards: [] });

    await useLibraryStore.getState().pullFromServer();

    expect(useLibraryStore.getState().boards.map((b) => b.id)).toEqual(['local-b']);
  });

  it('keeps a reading list the server has never seen', async () => {
    await db.readingLists.put({
      id: 'local-l',
      name: 'Mine',
      days: [{ id: 'd1', entries: [] }],
      createdAt: 1,
      updatedAt: 1,
      dirty: 1,
      deleted: 0,
    });
    serverHas({ readingLists: [] });

    await useLibraryStore.getState().pullFromServer();

    expect(useLibraryStore.getState().readingLists.map((l) => l.id)).toEqual(['local-l']);
  });

  it('still adopts a remote row that is newer', async () => {
    // The other half: "never delete" must not become "never update".
    await db.cards.put({ ...card('c1', 1), dirty: 0, deleted: 0 });
    serverHas({ cards: [{ ...card('c1', 50), title: 'From the server' }] });

    await useLibraryStore.getState().pullFromServer();

    expect(useLibraryStore.getState().cards[0].title).toBe('From the server');
  });

  it('does not resurrect a card the user deleted locally', async () => {
    // A tombstone outranks the server's copy until the delete is flushed —
    // otherwise the first pull from another device brings it back.
    await db.cards.put({ ...card('c1', 1), dirty: 1, deleted: 1 });
    serverHas({ cards: [card('c1', 1)] });

    await useLibraryStore.getState().pullFromServer();

    expect(useLibraryStore.getState().cards).toEqual([]);
  });
});
