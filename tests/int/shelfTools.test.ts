import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The shelf tools — the assistant's half of the community feature.
 *
 * The app's claim is that it can be driven without looking at it, so a shelf's
 * whole life is callable: make one, rename it, put a plan on it, take it off,
 * publish a piece, let a reader in, let go of somebody else's shelf. That is
 * eleven new tools, and **almost every one of them is a name resolver in front
 * of a store action the store's own spec already covers**. So what is pinned
 * here is the resolving, not the storing — the layer where a mistake acts on
 * the wrong thing.
 *
 * Three rules earn a test, by what a mistake costs:
 *
 *   - **an ambiguous name is a question, not a guess.** The model is handed
 *     whatever was said out loud; picking one of two plans called "Jona" and
 *     publishing it to strangers is not recoverable by saying sorry.
 *   - **removing is not destroying.** A piece taken off a shelf goes back to
 *     being a draft; `delete_piece` is the one that destroys writing. The app
 *     draws that line and the tools have to draw the same one, or a misheard
 *     verb costs somebody their text.
 *   - **the Today shelf survives.** It is created with the profile and every
 *     resolver in the app assumes it is there.
 *
 * Same mocks as `communityStore.test.ts`, and for the same reason: signing and
 * share codes are exercised for real by `community:verify`, so what is under
 * test here is the dispatch layer's own judgement.
 */

vi.mock('@/services/api/community', () => ({
  requestSpace: vi.fn(async () => {
    throw new Error('the network should not have been reached');
  }),
  getSpaceFeed: vi.fn(async () => ({ posts: [] })),
  checkModeration: vi.fn(async () => ({ ok: true })),
  listMembers: vi.fn(async () => ({ memberships: [] })),
  reportContent: vi.fn(async () => ({})),
  uploadAvatar: vi.fn(async () => ({ url: '' })),
}));

vi.mock('@/lib/postSigning', () => ({
  authorKey: vi.fn(() => AUTHOR_KEY),
  signPost: vi.fn(() => ({ signature: 'sig', sigVersion: 1 })),
  signItem: vi.fn(() => ({ signature: 'sig', authorKey: AUTHOR_KEY, sigVersion: 'ba.item.v1' })),
}));

const AUTHOR_KEY = 'a'.repeat(64);

const { dispatchTool } = await import('@/services/ai/dispatch');
const { db } = await import('@/db/dexie');
const { useCommunityStore } = await import('@/store/communityStore');
const { useLibraryStore } = await import('@/store/libraryStore');
const { useSettingsStore } = await import('@/store/settingsStore');

const ctx = { messageId: 'm1', signal: new AbortController().signal };
const call = (name: string, args: Record<string, unknown> = {}) =>
  dispatchTool(name as Parameters<typeof dispatchTool>[0], JSON.stringify(args), ctx);

const shelf = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id,
  name,
  kind: 'custom' as const,
  approval: 'manual' as const,
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

const piece = (id: string, title: string, over: Record<string, unknown> = {}) => ({
  id,
  spaceId: 's1',
  title,
  body: 'A thought about the word of the Lord.',
  language: 'en' as const,
  publishedAt: 0,
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

const plan = (id: string, name: string) => ({
  id,
  name,
  days: [{ id: `${id}d`, entries: [{ id: `${id}e`, bookId: 1, chapter: 1 }] }],
  createdAt: 1,
  updatedAt: 1,
});

beforeEach(async () => {
  await Promise.all([
    db.syncQueue.clear(), db.spaces.clear(), db.posts.clear(),
    db.sharedItems.clear(), db.readingLists.clear(), db.boards.clear(), db.cards.clear(),
    db.memberships.clear(), db.preferences.clear(),
  ]);
  useCommunityStore.setState({
    profile: { displayName: 'Me', authorKey: AUTHOR_KEY, updatedAt: 1 },
    spaces: [shelf('s1', 'Werkstatt'), shelf('today', 'Today', { kind: 'today' })],
    posts: [], shared: {}, subscriptions: [], memberships: [],
    feed: {}, seen: {}, blocked: {}, reported: {},
    items: [], sharedClaims: {}, itemSources: {},
    feedItems: {}, mirroredLists: [], mirroredBoards: [],
    initialized: true,
  });
  useLibraryStore.setState({
    readingLists: [], cards: [], boards: [], readingProgress: {},
    cardOrder: [], boardOrder: [], online: false, pendingOps: 0,
  });
  // Off, so nothing here reaches a network the mocks would have to answer for.
  useSettingsStore.setState({ syncEnabled: false, locale: 'en' });
});

/**
 * The failure text is not decoration: it is the model's next turn. A resolver
 * that answers "not found" and stops leaves the model guessing again, which is
 * how a shelf name became a hunt for a book of the Bible called Christoph.
 */
describe('a name the user said resolves, or says what there is', () => {
  it('makes a shelf and finds it again by name', async () => {
    expect((await call('create_shelf', { name: 'Gedanken' })).ok).toBe(true);
    const listed = await call('list_shelves');
    expect(JSON.stringify(listed.data)).toContain('Gedanken');
  });

  it('refuses a second shelf with the same name, where the ambiguity would start', async () => {
    await call('create_shelf', { name: 'Gedanken' });
    const again = await call('create_shelf', { name: 'gedanken' });
    expect(again.ok).toBe(false);
    expect(again.error).toContain('already has a shelf');
  });

  it('names the shelves that do exist when one does not', async () => {
    const r = await call('update_shelf', { shelf: 'Keller', name: 'x' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('Werkstatt');
  });

  it('asks which rather than picking one, when the name matches several', async () => {
    useLibraryStore.setState({ readingLists: [plan('l1', 'Jona lang'), plan('l2', 'Jona kurz')] });
    const r = await call('add_to_shelf', { plan: 'Jona', shelf: 'Werkstatt' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('ask which');
    // And nothing was published on the way to asking.
    expect(useCommunityStore.getState().items).toHaveLength(0);
  });

  it('asks which shelf when the user has several and named none', async () => {
    useLibraryStore.setState({ readingLists: [plan('l1', 'Jona')] });
    const r = await call('add_to_shelf', { plan: 'Jona' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('Werkstatt');
  });

  it('takes exactly one kind of thing at a time', async () => {
    expect((await call('add_to_shelf', {})).error).toContain('plan or board');
    expect((await call('add_to_shelf', { plan: 'a', board: 'b' })).error).toContain('only one');
  });
});

/**
 * The distinction the app already draws, now drawn by the tools: a shared item
 * is a snapshot of something that lives in the library, and a piece lives only
 * on the device. Removing neither destroys anything; `delete_piece` does.
 */
describe('taking something off a shelf is not destroying it', () => {
  it('sends a published piece back to being a draft, text intact', async () => {
    useCommunityStore.setState({
      posts: [piece('p1', 'Am Fluss', { publishedAt: 100 })],
      shared: { p1: true },
    });
    const r = await call('remove_from_shelf', { piece: 'Am Fluss' });
    expect(r.ok).toBe(true);

    const post = useCommunityStore.getState().posts.find((p) => p.id === 'p1');
    expect(post?.body).toContain('word of the Lord');
    // publishedAt is signed and immutable, so re-sharing stays lossless.
    expect(post?.publishedAt).toBe(100);
    expect(useCommunityStore.getState().shared.p1).toBeFalsy();
  });

  it('refuses to remove a draft, which nobody can see anyway', async () => {
    useCommunityStore.setState({ posts: [piece('p1', 'Entwurf')] });
    const r = await call('remove_from_shelf', { piece: 'Entwurf' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('draft');
  });

  it('delete_piece is the one that destroys the writing', async () => {
    useCommunityStore.setState({ posts: [piece('p1', 'Am Fluss', { publishedAt: 100 })] });
    expect((await call('delete_piece', { piece: 'Am Fluss' })).ok).toBe(true);
    expect(useCommunityStore.getState().posts).toHaveLength(0);
  });

  it('leaves the source list alone when a plan comes off a shelf', async () => {
    useLibraryStore.setState({ readingLists: [plan('l1', 'Jona')] });
    expect((await call('add_to_shelf', { plan: 'Jona', shelf: 'Werkstatt' })).ok).toBe(true);
    expect(useCommunityStore.getState().items).toHaveLength(1);

    expect((await call('remove_from_shelf', { plan: 'Jona' })).ok).toBe(true);
    expect(useCommunityStore.getState().items).toHaveLength(0);
    expect(useLibraryStore.getState().readingLists).toHaveLength(1);
  });
});

/** Created with the profile, assumed everywhere, and named in one place. */
describe('the Today shelf survives the assistant', () => {
  it('cannot be renamed', async () => {
    const r = await call('update_shelf', { shelf: 'Today', name: 'Gestern' });
    expect(r.ok).toBe(false);
    expect(useCommunityStore.getState().spaces.some((s) => s.kind === 'today')).toBe(true);
  });

  it('cannot be deleted', async () => {
    const r = await call('delete_shelf', { shelf: 'Today' });
    expect(r.ok).toBe(false);
    expect(useCommunityStore.getState().spaces.some((s) => s.kind === 'today')).toBe(true);
  });

  it('but another shelf can be', async () => {
    expect((await call('delete_shelf', { shelf: 'Werkstatt' })).ok).toBe(true);
    expect(useCommunityStore.getState().spaces.map((s) => s.kind)).toEqual(['today']);
  });
});

/** The author's half: who is waiting, and letting them in. */
describe('readers', () => {
  beforeEach(() => {
    useCommunityStore.setState({
      memberships: [
        { userId: 'u1', spaceId: 's1', status: 'pending', displayName: 'Anna', requestedAt: 1 },
      ],
    });
  });

  it('are reported by list_shelves, so the model knows the name to use', async () => {
    expect(JSON.stringify((await call('list_shelves')).data)).toContain('Anna');
  });

  it('are let in by name', async () => {
    expect((await call('decide_reader', { reader: 'Anna', decision: 'accept' })).ok).toBe(true);
    expect(useCommunityStore.getState().memberships[0].status).toBe('accepted');
  });

  it('cannot be decided on when nobody has asked', async () => {
    useCommunityStore.setState({ memberships: [] });
    const r = await call('decide_reader', { reader: 'Anna', decision: 'accept' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('nobody');
  });
});
