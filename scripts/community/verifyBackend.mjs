/**
 * End-to-end check of the community endpoints in public/api.php.
 *
 * This is the first cross-user surface in the app, so the properties worth
 * asserting are access control and isolation rather than happy-path shape:
 * a pending subscriber sees nothing, a blocked one cannot unblock themselves,
 * an expired item is gone, a forged post is refused.
 *
 * Self-managing: copies api.php into a temporary docroot (so the real
 * public/storage is never touched), starts `php -S` there, runs, tears down.
 *
 * Run: npm run community:verify:api
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { generateMnemonic, mnemonicToSeedSync } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { deriveSigningKey, signPostWith } from '../../src/lib/postSignature.ts';
import { mintSpaceCode } from '../../src/lib/spaceCode.ts';

const bytesToHex = (b) => Buffer.from(b).toString('hex');
const PORT = 8749 + (process.pid % 200);
const root = mkdtempSync(join(tmpdir(), 'ba-api-'));
copyFileSync('public/api.php', join(root, 'api.php'));

let checks = 0;
const check = async (name, fn) => {
  await fn();
  checks++;
  console.log(`  ok  ${name}`);
};

/** An identity, exactly as src/lib/passphrase.ts derives one. */
function makeUser() {
  const mnemonic = generateMnemonic(wordlist, 128);
  const seed = mnemonicToSeedSync(mnemonic);
  const b = new Uint8Array(seed.slice(0, 16));
  b[6] = (b[6] & 0x0f) | 0x80;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = bytesToHex(b);
  const pair = deriveSigningKey(mnemonic);
  return {
    userId: `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`,
    userSecret: bytesToHex(seed.slice(16, 48)),
    authorKey: bytesToHex(pair.publicKey),
    pair,
  };
}

async function call(user, action, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}/api.php?action=${encodeURIComponent(action)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-User-Id': user.userId,
      'X-User-Secret': user.userSecret,
    },
    body: JSON.stringify(body ?? {}),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

function makePost(space, user, over = {}) {
  const now = Date.now();
  const base = {
    id: randomUUID(),
    spaceId: space.id,
    title: 'Ein Morgen am Fluss',
    body: 'Zeile eins.\n\nZeile zwei.',
    language: 'de',
    publishedAt: now,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
  return { ...base, ...signPostWith(base, user.pair) };
}

const php = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', root], { stdio: ['ignore', 'ignore', 'pipe'] });
let phpErr = '';
php.stderr.on('data', (d) => { phpErr += d.toString(); });

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/api.php?action=ambient.list`);
      if (res.status === 401) return; // no identity headers => PHP is alive
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`php -S did not start on ${PORT}\n${phpErr}`);
}

try {
  await waitForServer();

  const alice = makeUser();
  const bob = makeUser();
  const carol = makeUser();

  console.log('profile');

  await check('an account with no profile reads back null, creating nothing', async () => {
    const r = await call(alice, 'profile.get', {});
    assert.equal(r.status, 200);
    assert.equal(r.body.profile, null);
  });

  await check('asking to subscribe without a profile is refused', async () => {
    const r = await call(bob, 'space.request', { code: mintSpaceCode(bob.authorKey) });
    assert.equal(r.status, 403);
    assert.equal(r.body.error, 'profile_required');
  });

  await check('a profile without a valid authorKey is refused', async () => {
    const r = await call(alice, 'profile.set', {
      profile: { displayName: 'Alice', authorKey: 'nope', updatedAt: Date.now() },
    });
    assert.equal(r.status, 400);
  });

  for (const [u, name] of [[alice, 'Alice'], [bob, 'Bob'], [carol, 'Carol']]) {
    const r = await call(u, 'profile.set', {
      profile: { displayName: name, bio: `${name} writes.`, authorKey: u.authorKey, updatedAt: Date.now() },
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }
  await check('profiles store and read back', async () => {
    const r = await call(alice, 'profile.get', {});
    assert.equal(r.body.profile.displayName, 'Alice');
    assert.equal(r.body.profile.authorKey, alice.authorKey);
  });

  console.log('spaces and posts');

  const today = { id: randomUUID(), name: 'Heute', kind: 'today', ephemeralHours: 24, approval: 'manual', createdAt: Date.now(), updatedAt: Date.now() };
  const blog = { id: randomUUID(), name: 'Gedanken', kind: 'custom', approval: 'auto', createdAt: Date.now(), updatedAt: Date.now() };

  await check('spaces upsert and list', async () => {
    await call(alice, 'spaces.upsert', { space: today });
    const r = await call(alice, 'spaces.upsert', { space: blog });
    assert.equal(r.status, 200);
    assert.equal(r.body.spaces.length, 2);
  });

  await check('a plain upsert cannot set a share code', async () => {
    const r = await call(alice, 'spaces.upsert', { space: { ...blog, shareCode: mintSpaceCode(alice.authorKey) } });
    assert.equal(r.body.spaces.find((s) => s.id === blog.id).shareCode, null);
  });

  await check('a signed post is accepted', async () => {
    const r = await call(alice, 'posts.upsert', { post: makePost(blog, alice) });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.posts.length, 1);
  });

  await check('an unsigned post is refused by the server too', async () => {
    const { signature, authorKey, sigVersion, ...unsigned } = makePost(blog, alice);
    const r = await call(alice, 'posts.upsert', { post: unsigned });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /signature/);
  });

  await check('a post whose body was altered after signing is refused', async () => {
    const r = await call(alice, 'posts.upsert', { post: { ...makePost(blog, alice), body: 'geändert' } });
    assert.equal(r.status, 400);
  });

  await check('the server cannot tell whose key is whose — only the reader can', async () => {
    const p = makePost(blog, alice);
    const otherKey = { ...p, ...signPostWith(p, bob.pair) };
    // Self-consistently signed, but under a key that is not Alice's. The server
    // accepts it, because it has no idea which key belongs to which account —
    // and that is exactly why the subscriber pins one key per space and
    // verifies every post against it (see verifyPost in postSignature.ts).
    const r = await call(alice, 'posts.upsert', { post: otherKey });
    assert.equal(r.status, 200);
    assert.notEqual(otherKey.authorKey, alice.authorKey);
    // Clean up so the later feed assertions count only real posts.
    await call(alice, 'posts.delete', { id: otherKey.id, spaceId: blog.id });
  });

  await check('a draft cannot be published', async () => {
    const r = await call(alice, 'posts.upsert', { post: makePost(blog, alice, { publishedAt: 0 }) });
    assert.equal(r.status, 400);
  });

  await check('a post for an unknown space is refused', async () => {
    const r = await call(alice, 'posts.upsert', { post: makePost({ id: randomUUID() }, alice) });
    assert.equal(r.status, 404);
  });

  await check('an over-long body is refused', async () => {
    const r = await call(alice, 'posts.upsert', { post: makePost(blog, alice, { body: 'x'.repeat(8001) }) });
    assert.equal(r.status, 400);
  });

  console.log('share codes');

  const blogCode = mintSpaceCode(alice.authorKey);
  const todayCode = mintSpaceCode(alice.authorKey);

  await check('a code can be pointed at a space', async () => {
    const r = await call(alice, 'spaces.code.set', { spaceId: blog.id, code: blogCode });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.spaces.find((s) => s.id === blog.id).shareCode, blogCode);
    await call(alice, 'spaces.code.set', { spaceId: today.id, code: todayCode });
  });

  await check('a code cannot be pointed at a space that does not exist yet', async () => {
    // Why the client must enqueue `space.upsert` before `spaceCode.set`: this
    // 404 is a 4xx, so `shouldDropSyncOp` treats it as permanent and drops the
    // op — the code would never reach the server and the space would be
    // unshareable with no error anywhere.
    const r = await call(alice, 'spaces.code.set', {
      spaceId: randomUUID(),
      code: mintSpaceCode(alice.authorKey),
    });
    assert.equal(r.status, 404);
  });

  await check('a code already owned by someone else is refused', async () => {
    const bobSpace = { id: randomUUID(), name: 'Bobs', kind: 'custom', approval: 'auto', createdAt: Date.now(), updatedAt: Date.now() };
    await call(bob, 'spaces.upsert', { space: bobSpace });
    const r = await call(bob, 'spaces.code.set', { spaceId: bobSpace.id, code: blogCode });
    assert.equal(r.status, 409);
  });

  await check('a malformed code is refused', async () => {
    assert.equal((await call(alice, 'spaces.code.set', { spaceId: blog.id, code: 'SHORT' })).status, 400);
    // I, L, O and U are outside the alphabet on purpose.
    assert.equal((await call(alice, 'spaces.code.set', { spaceId: blog.id, code: 'IIIIIIIIIIIIIIII' })).status, 400);
  });

  await check('an unknown code resolves to nothing', async () => {
    const r = await call(bob, 'space.request', { code: mintSpaceCode(bob.authorKey) });
    assert.equal(r.status, 404);
  });

  console.log('access control');

  await check('a space whose owner has no published key cannot be shared', async () => {
    // Reachable for real: a client that pushed its spaces but not its profile.
    // Without an author key there is nothing for a subscriber to pin, so every
    // post would fail verification — the subscription would look fine and show
    // nothing forever. Refusing here is what lets the reason be reported.
    const orphan = { id: randomUUID(), name: 'Orphan', kind: 'custom', approval: 'auto', createdAt: Date.now(), updatedAt: Date.now() };
    const code = mintSpaceCode(carol.authorKey);
    await call(carol, 'spaces.upsert', { space: orphan });
    await call(carol, 'spaces.code.set', { spaceId: orphan.id, code });
    // Carol has a profile; drop it to reproduce the state.
    await call(carol, 'profile.delete', {});
    await call(carol, 'spaces.upsert', { space: orphan });
    await call(carol, 'spaces.code.set', { spaceId: orphan.id, code });

    const req = await call(bob, 'space.request', { code });
    assert.equal(req.status, 409);
    assert.equal(req.body.error, 'space_not_ready');
    const feed = await call(bob, 'space.feed', { code });
    assert.equal(feed.status, 409);

    // Restore Carol for the checks that follow.
    await call(carol, 'profile.set', {
      profile: { displayName: 'Carol', authorKey: carol.authorKey, updatedAt: Date.now() },
    });
  });

  await check('an auto-approval space admits a subscriber immediately', async () => {
    const r = await call(bob, 'space.request', { code: blogCode });
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'accepted');
    assert.equal(r.body.owner.displayName, 'Alice');
    assert.equal(r.body.owner.authorKey, alice.authorKey);
    assert.equal(r.body.space.name, 'Gedanken');
  });

  await check('the feed projection leaks no uuid and no secret', async () => {
    const r = await call(bob, 'space.feed', { code: blogCode });
    const json = JSON.stringify(r.body);
    assert.equal(json.includes(alice.userId), false);
    assert.equal(json.includes(alice.userSecret), false);
    assert.deepEqual(Object.keys(r.body.owner).sort(), ['authorKey', 'avatarUrl', 'bio', 'displayName']);
  });

  await check('an accepted subscriber reads the posts, signatures intact', async () => {
    const r = await call(bob, 'space.feed', { code: blogCode });
    assert.equal(r.body.status, 'accepted');
    assert.equal(r.body.posts.length, 1);
    assert.match(r.body.posts[0].signature, /^[0-9a-f]{128}$/);
    assert.equal(r.body.posts[0].authorKey, alice.authorKey);
  });

  await check('a manual-approval space holds a subscriber at pending', async () => {
    const req = await call(bob, 'space.request', { code: todayCode });
    assert.equal(req.body.status, 'pending');
    const feed = await call(bob, 'space.feed', { code: todayCode });
    assert.equal(feed.body.status, 'pending');
    assert.deepEqual(feed.body.posts, []);
  });

  await check('a stranger who never asked reads nothing', async () => {
    const r = await call(carol, 'space.feed', { code: blogCode });
    assert.equal(r.body.status, 'pending');
    assert.deepEqual(r.body.posts, []);
  });

  await check('the owner sees who is waiting', async () => {
    const r = await call(alice, 'members.list', {});
    const pending = r.body.members.filter((m) => m.status === 'pending');
    assert.equal(pending.length, 1);
    assert.equal(pending[0].displayName, 'Bob');
    assert.equal(pending[0].spaceId, today.id);
  });

  await check('accepting opens the space', async () => {
    await call(alice, 'posts.upsert', { post: makePost(today, alice, { title: 'Heute' }) });
    const dec = await call(alice, 'members.decide', { userId: bob.userId, spaceId: today.id, status: 'accepted' });
    assert.equal(dec.status, 200);
    const feed = await call(bob, 'space.feed', { code: todayCode });
    assert.equal(feed.body.status, 'accepted');
    assert.equal(feed.body.posts.length, 1);
  });

  await check('only the owner decides — a subscriber cannot accept themselves', async () => {
    const r = await call(carol, 'members.decide', { userId: carol.userId, spaceId: blog.id, status: 'accepted' });
    // Carol writes into her OWN members.json, which governs nothing.
    assert.equal(r.status, 404);
    assert.deepEqual((await call(carol, 'space.feed', { code: blogCode })).body.posts, []);
  });

  await check('a blocked subscriber cannot clear the block by asking again', async () => {
    await call(alice, 'members.decide', { userId: bob.userId, spaceId: blog.id, status: 'blocked' });
    const again = await call(bob, 'space.request', { code: blogCode });
    assert.equal(again.body.status, 'blocked');
    assert.deepEqual((await call(bob, 'space.feed', { code: blogCode })).body.posts, []);
    await call(alice, 'members.decide', { userId: bob.userId, spaceId: blog.id, status: 'accepted' });
  });

  await check('rotating the code revokes everyone', async () => {
    const fresh = mintSpaceCode(alice.authorKey);
    await call(alice, 'spaces.code.set', { spaceId: blog.id, code: fresh });
    assert.equal((await call(bob, 'space.feed', { code: blogCode })).status, 404);
    const after = await call(bob, 'space.feed', { code: fresh });
    assert.equal(after.body.status, 'pending');
  });

  console.log('expiry');

  await check('an item past the space window is pruned on read, for both sides', async () => {
    const stale = makePost(today, alice, { publishedAt: Date.now() - 25 * 3600 * 1000, title: 'Gestern' });
    await call(alice, 'posts.upsert', { post: stale });
    const owner = await call(alice, 'posts.list', { spaceId: today.id });
    assert.equal(owner.body.posts.some((p) => p.id === stale.id), false);
    const sub = await call(bob, 'space.feed', { code: todayCode });
    assert.equal(sub.body.posts.some((p) => p.id === stale.id), false);
  });

  await check('a non-ephemeral space keeps old items', async () => {
    const old = makePost(blog, alice, { publishedAt: Date.now() - 400 * 24 * 3600 * 1000, title: 'Alt' });
    await call(alice, 'posts.upsert', { post: old });
    const r = await call(alice, 'posts.list', { spaceId: blog.id });
    assert.equal(r.body.posts.some((p) => p.id === old.id), true);
  });

  console.log('leaving');

  await check('deleting the profile removes the shared copies and the codes', async () => {
    const codeBefore = (await call(alice, 'spaces.list', {})).body.spaces.find((s) => s.id === blog.id).shareCode;
    const r = await call(alice, 'profile.delete', {});
    assert.equal(r.status, 200);
    assert.equal((await call(alice, 'profile.get', {})).body.profile, null);
    assert.deepEqual((await call(alice, 'spaces.list', {})).body.spaces, []);
    assert.equal((await call(bob, 'space.feed', { code: codeBefore })).status, 404);
  });

  await check('leaving does not touch the rest of the account', async () => {
    // The identity still works and unrelated collections survive — the client
    // keeps the writing itself, this only removed what was shared.
    const r = await call(alice, 'cards.list', {});
    assert.equal(r.status, 200);
  });

  await check('storage/users and storage/shares are HTTP-denied by generated .htaccess', () => {
    for (const p of ['users', 'shares']) {
      const ht = readFileSync(join(root, 'storage', p, '.htaccess'), 'utf8');
      assert.match(ht, /Require all denied/);
    }
  });

  console.log(`\n${checks} checks passed`);
} finally {
  php.kill('SIGTERM');
  rmSync(root, { recursive: true, force: true });
}
