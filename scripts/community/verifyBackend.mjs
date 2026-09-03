/**
 * End-to-end check of the community endpoints in public/api.php.
 *
 * This is the first cross-user surface in the app, so the properties worth
 * asserting are access control and isolation rather than happy-path shape:
 * a pending subscriber sees nothing, a blocked one cannot unblock themselves,
 * an expired item is gone, a forged post is refused.
 *
 * `feedback.create` rides along at the end. It is not a community action, but
 * it has the same shape as the one worth asserting here — user-authored text
 * written into an HTTP-denied directory — and it makes a claim of its own that
 * only an end-to-end run can check: that it touches nothing under
 * storage/users/, so a tester who never opted into sync can still report a bug.
 *
 * Self-managing: copies api.php into a temporary docroot (so the real
 * public/storage is never touched), starts `php -S` there, runs, tears down.
 *
 * Run: npm run community:verify:api
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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
  try {
    await fn();
  } catch (e) {
    // api.php runs with display_errors off, so a 500 says nothing by itself;
    // the built-in server's stderr is where the fatal actually is.
    const tail = phpErr.trim().split('\n').slice(-12).join('\n');
    if (tail) console.error(`\n--- php stderr ---\n${tail}\n`);
    throw e;
  }
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

/** Everything this identity has ever sent as feedback, newest first. */
function readFeedback(user) {
  const dir = join(root, 'storage', 'feedback', user.userId);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')))
    .sort((a, b) => b.reportedAt - a.reportedAt);
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

/** Writes the docroot's secrets.php. `MODERATION_STUB` is the seam that lets
 * the refusal half of moderation be tested without a live model: PHP's builtin
 * server re-requires this file on every request, so rewriting it takes effect
 * immediately. */
const setSecrets = (lines) =>
  writeFileSync(join(root, 'secrets.php'), `<?php\n${lines.join('\n')}\n`);

// No stub yet, and an explicitly empty key: without this the developer's own
// OPENAI_API_KEY would leak in through the environment and every publish in
// this script would make a real, billable, non-deterministic moderation call.
setSecrets(["define('OPENAI_API_KEY', '');"]);

let phpErr = '';
const php = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', root], {
  stdio: ['ignore', 'ignore', 'pipe'],
  env: { ...process.env, OPENAI_API_KEY: '' },
});
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

  await check('peeking at a space reveals it without asking for anything', async () => {
    // The whole reason space.peek exists: `space.request` *creates* the
    // membership, so a "subscribe to X?" confirmation built on it would show X
    // only after having already asked on the user's behalf.
    const before = (await call(alice, 'members.list', {})).body.members.length;
    const peek = await call(carol, 'space.peek', { code: blogCode });
    assert.equal(peek.status, 200);
    assert.equal(peek.body.space.name, 'Gedanken');
    assert.equal(peek.body.owner.authorKey, alice.authorKey);
    assert.equal(peek.body.status, null, 'never asked, so no membership');
    const after = (await call(alice, 'members.list', {})).body.members.length;
    assert.equal(after, before, 'peek must not create a membership');
  });

  await check('an author cannot subscribe to their own space', async () => {
    // Allowed, it wrote a request from the owner into the owner's own members
    // file, and the client then listed the space twice — once as theirs, once
    // as one they follow. The client refuses first (so it can explain); this is
    // the half a modified client cannot skip, so it must create nothing.
    const before = (await call(alice, 'members.list', {})).body.members.length;
    const r = await call(alice, 'space.request', { code: blogCode });
    assert.equal(r.status, 409);
    assert.equal(r.body.error, 'own_space');
    const after = (await call(alice, 'members.list', {})).body.members.length;
    assert.equal(after, before, 'a refused self-request must append nothing');
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

  console.log('automated moderation');

  const stub = (verdict, reason = '') =>
    setSecrets([
      "define('OPENAI_API_KEY', '');",
      `define('MODERATION_STUB', ${JSON.stringify(JSON.stringify({ verdict, reason }))});`,
    ]);
  const noStub = () => setSecrets(["define('OPENAI_API_KEY', '');"]);

  await check('with no key at all the check reports itself unchecked and nothing blocks', async () => {
    const r = await call(alice, 'moderation.check', { title: 'T', body: 'Ein Gedanke.', language: 'de' });
    assert.equal(r.status, 200);
    assert.equal(r.body.checked, false, 'no key, so no judgment');
    assert.equal(r.body.ok, true, 'fails open');
    const p = makePost(blog, alice, { title: 'Ungeprüft' });
    assert.equal((await call(alice, 'posts.upsert', { post: p })).status, 200);
  });

  await check('a refused piece cannot be published, and says why', async () => {
    stub('refuse', 'Das ist Werbung und kein biblischer Text.');
    const pre = await call(alice, 'moderation.check', { title: 'Kauf jetzt', body: 'Werbung.', language: 'de' });
    assert.equal(pre.body.ok, false);
    assert.equal(pre.body.checked, true);
    assert.match(pre.body.reason, /Werbung/);

    const p = makePost(blog, alice, { title: 'Kauf jetzt', body: 'Werbung.' });
    const up = await call(alice, 'posts.upsert', { post: p });
    assert.equal(up.status, 422, 'the write path judges it again');
    assert.equal(up.body.error, 'content_refused');
    assert.match(up.body.reason, /Werbung/);
    // And it really did not land.
    const listed = await call(alice, 'posts.list', { spaceId: blog.id });
    assert.equal(listed.body.posts.some((x) => x.id === p.id), false);
  });

  await check('an allowed piece publishes normally', async () => {
    stub('allow');
    const p = makePost(blog, alice, { title: 'Über die Geduld' });
    assert.equal((await call(alice, 'posts.upsert', { post: p })).status, 200);
    const listed = await call(alice, 'posts.list', { spaceId: blog.id });
    assert.equal(listed.body.posts.some((x) => x.id === p.id), true);
  });

  await check('the moderation check needs a profile of its own', async () => {
    const nobody = makeUser();
    const r = await call(nobody, 'moderation.check', { title: 'x', body: 'y', language: 'en' });
    assert.equal(r.status, 403);
    assert.equal(r.body.error, 'profile_required');
  });

  // Back to the keyless state, so the report checks below start from
  // "no triage was possible" rather than from the last stub set above.
  noStub();

  console.log('moderation');

  // The rotation check above retired `blogCode`, so moderation mints its own
  // live code and re-admits both readers.
  const modCode = mintSpaceCode(alice.authorKey);
  await call(alice, 'spaces.code.set', { spaceId: blog.id, code: modCode });
  await call(bob, 'space.request', { code: modCode });
  await call(carol, 'space.request', { code: modCode });

  await check('a report is stored where neither party can read it', async () => {
    const post = (await call(bob, 'space.feed', { code: modCode })).body.posts[0];
    const r = await call(bob, 'report.create', {
      code: modCode,
      postId: post.id,
      reason: 'offtopic',
      note: 'nichts mit der Bibel zu tun',
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.reported, true);
    const files = readdirSync(join(root, 'storage', 'reports')).filter((f) => f.endsWith('.json'));
    assert.equal(files.length, 1);
    const stored = JSON.parse(readFileSync(join(root, 'storage', 'reports', files[0]), 'utf8'));
    assert.equal(stored.triage, 'unchecked', 'no key, so no triage — still filed for a human');
    assert.equal(stored.reason, 'offtopic');
    assert.equal(stored.reporterName, 'Bob');
    assert.equal(stored.ownerName, 'Alice');
    assert.equal(stored.postId, post.id);
    // No action reads reports back: the moderator has the filesystem, and
    // neither the author nor the reporter has any way to ask.
    assert.equal((await call(alice, 'report.list', {})).status, 404);
  });

  await check('the reported text is snapshotted, so deleting it hides nothing', async () => {
    const post = (await call(bob, 'space.feed', { code: modCode })).body.posts[0];
    const files = readdirSync(join(root, 'storage', 'reports')).filter((f) => f.endsWith('.json'));
    const stored = JSON.parse(readFileSync(join(root, 'storage', 'reports', files[0]), 'utf8'));
    assert.ok(stored.postExcerpt.length > 0);
    assert.equal(stored.postTitle, post.title);
    // The obvious first move after being reported.
    await call(alice, 'posts.delete', { id: post.id, spaceId: blog.id });
    const after = JSON.parse(readFileSync(join(root, 'storage', 'reports', files[0]), 'utf8'));
    assert.equal(after.postExcerpt, stored.postExcerpt);
    // Put it back for the checks that follow.
    await call(alice, 'posts.upsert', { post });
  });

  await check('re-reporting the same piece overwrites rather than piling up', async () => {
    const post = (await call(bob, 'space.feed', { code: modCode })).body.posts[0];
    for (const reason of ['spam', 'hate', 'other']) {
      await call(bob, 'report.create', { code: modCode, postId: post.id, reason });
    }
    const files = readdirSync(join(root, 'storage', 'reports')).filter((f) => f.endsWith('.json'));
    assert.equal(files.length, 1, 'one file per reporter and target');
    const stored = JSON.parse(readFileSync(join(root, 'storage', 'reports', files[0]), 'utf8'));
    assert.equal(stored.reason, 'other', 'the latest report wins');
  });

  await check('a second reporter is a second report', async () => {
    const post = (await call(bob, 'space.feed', { code: modCode })).body.posts[0];
    await call(carol, 'space.request', { code: modCode });
    const r = await call(carol, 'report.create', { code: modCode, postId: post.id, reason: 'sexual' });
    assert.equal(r.status, 200);
    const files = readdirSync(join(root, 'storage', 'reports')).filter((f) => f.endsWith('.json'));
    assert.equal(files.length, 2);
  });

  await check('a whole space can be reported, with no post', async () => {
    const r = await call(bob, 'report.create', { code: todayCode, reason: 'political' });
    assert.equal(r.status, 200);
    const files = readdirSync(join(root, 'storage', 'reports')).filter((f) => f.endsWith('.json'));
    assert.equal(files.length, 3);
  });

  await check('a reason outside the content standards is refused', async () => {
    const r = await call(bob, 'report.create', { code: modCode, reason: 'i just do not like it' });
    assert.equal(r.status, 400);
  });

  await check('reporting needs a profile, and a real target', async () => {
    const nobody = makeUser();
    const noProfile = await call(nobody, 'report.create', { code: modCode, reason: 'spam' });
    assert.equal(noProfile.status, 403);
    assert.equal(noProfile.body.error, 'profile_required');
    const badPost = await call(bob, 'report.create', {
      code: modCode,
      postId: randomUUID(),
      reason: 'spam',
    });
    assert.equal(badPost.status, 404);
    const badCode = await call(bob, 'report.create', { code: mintSpaceCode(bob.authorKey), reason: 'spam' });
    assert.equal(badCode.status, 404);
  });

  await check('a report the triage believes reaches the human queue', async () => {
    stub('allow', 'plausible');
    const post = (await call(bob, 'space.feed', { code: modCode })).body.posts[0];
    await call(bob, 'report.create', { code: modCode, postId: post.id, reason: 'sexual' });
    const filed = readdirSync(join(root, 'storage', 'reports'))
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(readFileSync(join(root, 'storage', 'reports', f), 'utf8')))
      .find((r) => r.postId === post.id && r.reporterName === 'Bob');
    assert.equal(filed.triage, 'valid');
    assert.equal(filed.triageModel, 'gpt-4o');
  });

  await check('an unfounded report is set aside, not thrown away', async () => {
    stub('refuse', 'the piece breaks no rule');
    const post = (await call(bob, 'space.feed', { code: modCode })).body.posts[0];
    const r = await call(bob, 'report.create', { code: modCode, postId: post.id, reason: 'hate' });
    // The reporter is told the same thing either way.
    assert.equal(r.status, 200);
    assert.equal(r.body.reported, true);
    const aside = readdirSync(join(root, 'storage', 'reports', 'unfounded'))
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(readFileSync(join(root, 'storage', 'reports', 'unfounded', f), 'utf8')));
    assert.equal(aside.length, 1);
    assert.equal(aside[0].triage, 'unfounded');
    assert.match(aside[0].triageReason, /breaks no rule/);
    // Re-filed, not duplicated: the same reporter and target moved queues.
    const inHuman = readdirSync(join(root, 'storage', 'reports'))
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(readFileSync(join(root, 'storage', 'reports', f), 'utf8')))
      .filter((x) => x.postId === post.id && x.reporterName === 'Bob');
    assert.equal(inHuman.length, 0);
    noStub();
  });

  console.log('feedback');

  await check('feedback needs no profile, no account and no sync opt-in', async () => {
    // A brand-new identity: nothing has ever been stored for it, and after
    // this it still must not have a directory under storage/users. That is the
    // property the bug button rests on — the tester whose app is broken, or
    // who never turned sync on, has to be able to reach this.
    const tester = makeUser();
    const r = await call(tester, 'feedback.create', {
      kind: 'bug',
      message: 'The reader shows Malachi 4 as missing.',
      context: { route: '/read', commit: 'abc1234', platform: 'android', online: true },
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.received, true);
    assert.equal(existsSync(join(root, 'storage', 'users', tester.userId)), false);

    const filed = readFeedback(tester);
    assert.equal(filed.length, 1);
    assert.equal(filed[0].kind, 'bug');
    assert.equal(filed[0].context.route, '/read');
    assert.equal(filed[0].context.online, true);
  });

  await check('the context is whitelisted, and the user agent is the real one', async () => {
    const tester = makeUser();
    const res = await fetch(`http://127.0.0.1:${PORT}/api.php?action=feedback.create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Id': tester.userId,
        'X-User-Secret': tester.userSecret,
        'User-Agent': 'RealAgent/9.9',
      },
      body: JSON.stringify({
        kind: 'feature',
        message: 'A dark sepia paper, please.',
        // Both of these must be dropped: everything in `context` is read by a
        // human, and a client may put anything in the body.
        context: { route: '/read', userAgent: 'Totally Not A Lie', smuggled: 'x'.repeat(50) },
      }),
    });
    assert.equal(res.status, 200);
    const [filed] = readFeedback(tester);
    assert.equal(filed.context.userAgent, 'RealAgent/9.9');
    assert.equal('smuggled' in filed.context, false);
  });

  await check('an unknown kind and an empty message are refused', async () => {
    const tester = makeUser();
    const kind = await call(tester, 'feedback.create', { kind: 'praise', message: 'hi' });
    assert.equal(kind.status, 400);
    const blank = await call(tester, 'feedback.create', { kind: 'bug', message: '   \n ' });
    assert.equal(blank.status, 400);
    assert.equal(existsSync(join(root, 'storage', 'feedback', tester.userId)), false);
  });

  await check('resending the same words overwrites; different words accumulate', async () => {
    const tester = makeUser();
    const same = { kind: 'feedback', message: 'It reads beautifully on the train.' };
    await call(tester, 'feedback.create', same);
    await call(tester, 'feedback.create', same);
    assert.equal(readFeedback(tester).length, 1);
    await call(tester, 'feedback.create', { ...same, message: 'And on the bus.' });
    assert.equal(readFeedback(tester).length, 2);
    // Same words, different kind, is a different thing to read.
    await call(tester, 'feedback.create', { ...same, kind: 'bug' });
    assert.equal(readFeedback(tester).length, 3);
  });

  await check('one identity cannot fill the disk', async () => {
    const tester = makeUser();
    for (let i = 0; i < 50; i++) {
      const r = await call(tester, 'feedback.create', { kind: 'bug', message: `report ${i}` });
      assert.equal(r.status, 200);
    }
    const over = await call(tester, 'feedback.create', { kind: 'bug', message: 'report 50' });
    assert.equal(over.status, 429);
    // The cap bounds new files only — a correction to something already sent
    // still gets through.
    const again = await call(tester, 'feedback.create', { kind: 'bug', message: 'report 7' });
    assert.equal(again.status, 200);
    assert.equal(readFeedback(tester).length, 50);
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

  await check('every directory holding user text is HTTP-denied by generated .htaccess', () => {
    for (const p of ['users', 'shares', 'reports', 'moderation', 'feedback']) {
      const ht = readFileSync(join(root, 'storage', p, '.htaccess'), 'utf8');
      assert.match(ht, /Require all denied/);
    }
  });

  console.log(`\n${checks} checks passed`);
} finally {
  php.kill('SIGTERM');
  rmSync(root, { recursive: true, force: true });
}
