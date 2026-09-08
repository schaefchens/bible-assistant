import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `communityStore` had no coverage at all — the one int spec that imported it
 * used it to seed state. That matters more than its 881 lines, because three of
 * its rules sit in CLAUDE.md's "always test" rows:
 *
 *   - **access control.** `subscribe` refuses a blocked author and refuses your
 *     own code *before the network*, so a blocked author never even gets a
 *     membership row appended in their file.
 *   - **a persisted shape.** `publishedAt` is immutable because it is signed:
 *     withdrawing and re-sharing has to be lossless, or every previously
 *     published post fails verification.
 *   - **a sync op sequence.** A self-subscription is *tombstoned*, not
 *     filtered, so the delete syncs and the row cannot reappear on the next
 *     device.
 *
 * `community:verify` already exercises the signing and share-code properties
 * against the real modules, so the crypto is stubbed here: what is under test
 * is the store's own refusals and bookkeeping, not Ed25519.
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
}));

const AUTHOR_KEY = 'a'.repeat(64);
const OTHER_KEY = 'b'.repeat(64);

const api = await import('@/services/api/community');
const { db } = await import('@/db/dexie');
const { useCommunityStore } = await import('@/store/communityStore');
const { useSettingsStore } = await import('@/store/settingsStore');
const { mintSpaceCode } = await import('@/lib/spaceCode');
const requested = vi.mocked(api.requestSpace);

const COMMUNITY_TERMS_VERSION = (await import('@/lib/communityTerms')).COMMUNITY_TERMS_VERSION;

const profile = () => ({ displayName: 'Me', authorKey: AUTHOR_KEY, updatedAt: 1 });

const space = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: `Space ${id}`,
  kind: 'custom' as const,
  approval: 'manual' as const,
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

const post = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  spaceId: 's1',
  title: `Post ${id}`,
  body: 'A thought.',
  language: 'en' as const,
  publishedAt: 0,
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

/**
 * The ops on the queue, oldest first, as `op:code` — the code matters here.
 * `init` fires its healing `unsubscribe` without awaiting it, so asserting on
 * the op name alone lets one test's tail land in the next one's queue and read
 * as a failure there.
 */
const queued = async () =>
  (await db.syncQueue.orderBy('createdAt').toArray()).map(
    (o) => `${o.op}:${(o.payload as { code?: string }).code ?? ''}`,
  );

async function until(pred: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`timed out waiting for: ${what}`);
}

beforeEach(async () => {
  await Promise.all([
    db.syncQueue.clear(), db.spaces.clear(), db.posts.clear(),
    db.subscriptions.clear(), db.memberships.clear(), db.feedPosts.clear(),
    db.seenPosts.clear(), db.preferences.clear(),
  ]);
  requested.mockReset();
  requested.mockRejectedValue(new Error('the network should not have been reached'));
  useCommunityStore.setState({
    profile: null, spaces: [], posts: [], shared: {}, subscriptions: [],
    memberships: [], feed: {}, seen: {}, blocked: {}, reported: {},
    initialized: false,
  });
  useSettingsStore.setState({
    syncEnabled: true,
    communityTermsVersion: COMMUNITY_TERMS_VERSION,
  });
});

describe('subscribe refuses before it reaches the network', () => {
  /** Every refusal below must also have sent nothing. */
  const refuses = async (code: string, why: string) => {
    await expect(useCommunityStore.getState().subscribe(code)).rejects.toThrow(why);
    expect(requested).not.toHaveBeenCalled();
  };

  it('rejects something that is not a code at all', async () => {
    useCommunityStore.setState({ profile: profile() });
    await refuses('hello there', 'invalid_code');
  });

  it('rejects without a profile — `space.request` needs one', async () => {
    await refuses(mintSpaceCode(OTHER_KEY), 'profile_required');
  });

  it('rejects until the content standards are accepted', async () => {
    useCommunityStore.setState({ profile: profile() });
    useSettingsStore.setState({ communityTermsVersion: 0 });
    await refuses(mintSpaceCode(OTHER_KEY), 'terms_required');
  });

  it('rejects your own space by its stored code', async () => {
    const code = mintSpaceCode(AUTHOR_KEY);
    useCommunityStore.setState({
      profile: profile(),
      spaces: [space('s1', { shareCode: code })],
    });
    await refuses(code, 'own_space');
  });

  it('rejects your own space by fingerprint, even from a code you have rotated away', async () => {
    // The fingerprint commits to the signing key, so it catches every code
    // that was ever yours — one since replaced, or one minted on another
    // device. Matching only the stored `shareCode` would let those through,
    // and the result is an invitation from yourself sitting in your own inbox.
    const rotatedAway = mintSpaceCode(AUTHOR_KEY);
    useCommunityStore.setState({
      profile: profile(),
      spaces: [space('s1', { shareCode: mintSpaceCode(AUTHOR_KEY) })],
    });
    await refuses(rotatedAway, 'own_space');
  });

  it('rejects a blocked author by the code’s own fingerprint', async () => {
    // The point of doing it here: a blocked author must not even learn that
    // somebody asked. A membership row appended in their file would.
    useCommunityStore.setState({
      profile: profile(),
      blocked: { [OTHER_KEY]: { authorKey: OTHER_KEY, displayName: 'Them', blockedAt: 1 } },
    });
    await refuses(mintSpaceCode(OTHER_KEY), 'author_blocked');
  });

  it('does reach the network for a code it cannot refuse locally', async () => {
    // The other half: "refuses early" must not become "refuses everything".
    useCommunityStore.setState({ profile: profile() });
    requested.mockRejectedValue(new Error('not_found'));
    await expect(
      useCommunityStore.getState().subscribe(mintSpaceCode(OTHER_KEY)),
    ).rejects.toThrow('not_found');
    expect(requested).toHaveBeenCalledOnce();
  });
});

describe('publishedAt is immutable, so withdraw and re-share is lossless', () => {
  beforeEach(async () => {
    useCommunityStore.setState({
      profile: profile(),
      spaces: [space('s1')],
      posts: [post('p1')],
      shared: {},
    });
    await db.posts.put({ ...post('p1'), dirty: 0, deleted: 0, shared: 0 });
  });

  it('stamps publishedAt on the first publish', async () => {
    await useCommunityStore.getState().publishPost('p1');
    const p = useCommunityStore.getState().posts.find((x) => x.id === 'p1')!;
    expect(p.publishedAt).toBeGreaterThan(0);
    expect(useCommunityStore.getState().shared.p1).toBe(true);
  });

  it('keeps the original date through a withdraw and a re-share', async () => {
    await useCommunityStore.getState().publishPost('p1');
    const first = useCommunityStore.getState().posts.find((x) => x.id === 'p1')!.publishedAt;

    await useCommunityStore.getState().unpublishPost('p1');
    expect(useCommunityStore.getState().shared.p1).toBe(false);
    // Withdrawing is local-only: the writing is the user's and stays readable.
    expect(useCommunityStore.getState().posts.some((x) => x.id === 'p1')).toBe(true);

    await new Promise((r) => setTimeout(r, 5));
    await useCommunityStore.getState().publishPost('p1');
    const again = useCommunityStore.getState().posts.find((x) => x.id === 'p1')!;

    // The date is signed. A new one on re-share would invalidate every
    // signature the original was published with.
    expect(again.publishedAt).toBe(first);
    expect(useCommunityStore.getState().shared.p1).toBe(true);
  });

  it('withdraw keeps the row and only drops the shared claim', async () => {
    await useCommunityStore.getState().publishPost('p1');
    await useCommunityStore.getState().unpublishPost('p1');

    const row = await db.posts.get('p1');
    expect(row).toBeDefined();
    expect(row!.shared).toBe(0);
    expect(row!.deleted).not.toBe(1);
    // Deleting is the *other* action, and it is the one that tombstones.
    await useCommunityStore.getState().deletePost('p1');
    expect((await db.posts.get('p1'))!.deleted).toBe(1);
  });
});

describe('a self-subscription is tombstoned, not filtered', () => {
  it('drops it from state and queues the delete', async () => {
    // An install from before `subscribe` refused this has one. Filtering it at
    // read sites would leave the row on disk, and the next device's pull would
    // hand it straight back.
    const code = mintSpaceCode(AUTHOR_KEY);
    await db.preferences.put({ key: 'communityProfile', value: profile() });
    await db.spaces.put({ ...space('s1', { shareCode: code }), dirty: 0, deleted: 0 });
    await db.subscriptions.put({
      code,
      spaceName: 'Mine',
      ownerName: 'Me',
      status: 'accepted',
      pinnedKey: AUTHOR_KEY,
      keyPinnedAt: 1,
      addedAt: 1,
      updatedAt: 1,
      dirty: 0,
      deleted: 0,
    });

    await useCommunityStore.getState().init();

    expect(useCommunityStore.getState().subscriptions).toEqual([]);
    let ops: string[] = [];
    await until(() => {
      void db.syncQueue.orderBy('createdAt').toArray().then((rows) => {
        ops = rows.map((o) => `${o.op}:${(o.payload as { code?: string }).code ?? ''}`);
      });
      return ops.includes(`subscription.delete:${code}`);
    }, `subscription.delete:${code} to be queued, saw ${JSON.stringify(ops)}`);
    expect(await db.subscriptions.get(code)).toMatchObject({ deleted: 1, dirty: 1 });
  });

  it('leaves somebody else’s subscription alone', async () => {
    const code = mintSpaceCode(OTHER_KEY);
    await db.preferences.put({ key: 'communityProfile', value: profile() });
    await db.subscriptions.put({
      code, spaceName: 'Theirs', ownerName: 'Them', status: 'accepted',
      pinnedKey: OTHER_KEY, keyPinnedAt: 1, addedAt: 1, updatedAt: 1,
      dirty: 0, deleted: 0,
    });

    await useCommunityStore.getState().init();

    expect(useCommunityStore.getState().subscriptions.map((s) => s.code)).toEqual([code]);
    // Specifically not *this* code — see the note on `queued`.
    await new Promise((r) => setTimeout(r, 20));
    expect(await queued()).not.toContain(`subscription.delete:${code}`);
    expect(await db.subscriptions.get(code)).toMatchObject({ deleted: 0 });
  });

  it('drops a blocked author’s subscription the same way', async () => {
    const code = mintSpaceCode(OTHER_KEY);
    await db.preferences.put({ key: 'communityProfile', value: profile() });
    await db.preferences.put({
      key: 'blockedAuthors',
      value: { [OTHER_KEY]: { authorKey: OTHER_KEY, displayName: 'Them', blockedAt: 1 } },
    });
    await db.subscriptions.put({
      code, spaceName: 'Theirs', ownerName: 'Them', status: 'accepted',
      pinnedKey: OTHER_KEY, keyPinnedAt: 1, addedAt: 1, updatedAt: 1,
      dirty: 0, deleted: 0,
    });

    await useCommunityStore.getState().init();

    expect(useCommunityStore.getState().subscriptions).toEqual([]);
  });
});

describe('init never destroys the user’s own writing', () => {
  it('keeps a draft the server has never seen', async () => {
    // The server holds only what is shared, so a draft legitimately has no
    // remote counterpart. This is the one outcome the feature must never
    // produce.
    await db.preferences.put({ key: 'communityProfile', value: profile() });
    await db.posts.put({ ...post('draft'), dirty: 1, deleted: 0, shared: 0 });

    await useCommunityStore.getState().init();

    expect(useCommunityStore.getState().posts.map((p) => p.id)).toContain('draft');
    expect(useCommunityStore.getState().shared.draft).toBe(false);
  });

  it('keeps a withdrawn post, and remembers it is not shared', async () => {
    await db.preferences.put({ key: 'communityProfile', value: profile() });
    await db.posts.put({
      ...post('withdrawn', { publishedAt: 500 }),
      dirty: 0, deleted: 0, shared: 0,
    });

    await useCommunityStore.getState().init();

    const p = useCommunityStore.getState().posts.find((x) => x.id === 'withdrawn');
    expect(p?.publishedAt).toBe(500);
    expect(useCommunityStore.getState().shared.withdrawn).toBe(false);
  });

  it('does not load a post the user deleted', async () => {
    await db.preferences.put({ key: 'communityProfile', value: profile() });
    await db.posts.put({ ...post('gone'), dirty: 1, deleted: 1, shared: 0 });

    await useCommunityStore.getState().init();

    expect(useCommunityStore.getState().posts.map((p) => p.id)).not.toContain('gone');
  });

  it('drops a cached feed post that failed verification', async () => {
    // It should never have been stored, but a build that changed the
    // canonicalization could leave one behind, and rendering it would present
    // unverified writing as verified.
    await db.preferences.put({ key: 'communityProfile', value: profile() });
    await db.feedPosts.bulkPut([
      { ...post('ok', { publishedAt: 2 }), code: 'c1', verified: true, fetchedAt: 1 },
      { ...post('bad', { publishedAt: 1 }), code: 'c1', verified: false, fetchedAt: 1 },
    ]);

    await useCommunityStore.getState().init();

    expect((useCommunityStore.getState().feed.c1 ?? []).map((p) => p.id)).toEqual(['ok']);
  });
});
