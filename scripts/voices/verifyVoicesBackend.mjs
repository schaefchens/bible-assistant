/**
 * End-to-end check of the narration-voice backend in public/api.php: the
 * ElevenLabs key, ElevenLabs narration and its cache, the proxies, the synced
 * voices collection — and that OpenAI narration did not move.
 *
 * Offline and free by construction. ElevenLabs is an in-process stub
 * (elevenLabsStub.mjs) that api.php reaches through ELEVENLABS_API_BASE in the
 * staged secrets.php; OpenAI is never reached because the shared key is blank,
 * every OpenAI request below is a cache hit or refused before any call, and
 * the one personal OpenAI key in play is a canary that must never leave the
 * server.
 *
 * What is worth asserting here is what a unit test cannot see: who pays and
 * when (a hit needs no key at all), what crosses to ElevenLabs (the right
 * endpoint and fields; never `Authorization`, never the OpenAI key), what is
 * left on disk (a 0600 key under the denied users/, no temp file after a
 * failure, one generation for two listeners), and that the alignment the
 * server writes counts words exactly the way the reader does — checked against
 * src/lib/wordTokens.ts itself, not against a copy.
 *
 * Self-managing: copies api.php and api/ into a temporary docroot (the real
 * public/storage is never touched), starts `php -S` there with four workers,
 * runs, tears down.
 *
 * Run: npm run voices:verify:api
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { wordTokens } from '../../src/lib/wordTokens.ts';
import { deriveSigningKey, signItemWith, signPostWith } from '../../src/lib/postSignature.ts';
import { mintSpaceCode } from '../../src/lib/spaceCode.ts';
import { BOOKS } from '../../src/services/bible/bookCatalog.ts';
import { buildVoicePayload, payloadBytes, payloadHash } from '../../src/services/community/sharedPayload.ts';
import {
  BUSY_ONCE_VOICE,
  NO_ALIGNMENT_VOICE,
  NORMALIZED_ONLY_VOICE,
  SAMPLE_RATE,
  SAMPLES_PER_FRAME,
  SECOND_CHUNK_FAILS_VOICE,
  charEnd,
  charStart,
  fakeMp3,
  framesFor,
  startElevenLabsStub,
} from './elevenLabsStub.mjs';
import { startOpenAiStub } from './openAiStub.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// ---------- the staged backend ------------------------------------------------

const root = mkdtempSync(join(tmpdir(), 'ba-voices-'));
copyFileSync(join(repo, 'public', 'api.php'), join(root, 'api.php'));
// api.php is a router over public/api/*.php: the docroot needs both, or every
// request is a silent 500 (display_errors is off).
cpSync(join(repo, 'public', 'api'), join(root, 'api'), { recursive: true });

// Two tiny Zefania files, so a verse miss has neighbours to send as context.
const PSALM_117 = [
  'O praise the LORD, all ye nations: praise him, all ye people.',
  'For his merciful kindness is great toward us: and the truth of the LORD endureth for ever. Praise ye the LORD.',
];
const GENESIS_1 = [
  'Am Anfang schuf Gott Himmel und Erde.',
  'Und die Erde war wüst und leer, und es war finster auf der Tiefe; und der Geist Gottes schwebte auf dem Wasser.',
  'Und Gott sprach: Es werde Licht! und es ward Licht.',
];
const zefania = (book, chapter, verses) =>
  `<?xml version="1.0" encoding="utf-8"?>\n<XMLBIBLE><BIBLEBOOK bnumber="${book}"><CHAPTER cnumber="${chapter}">` +
  verses.map((v, i) => `<VERS vnumber="${i + 1}">${v}</VERS>`).join('') +
  '</CHAPTER></BIBLEBOOK></XMLBIBLE>\n';
mkdirSync(join(root, 'bibles'));
writeFileSync(join(root, 'bibles', 'kjv.xml'), zefania(19, 117, PSALM_117));
writeFileSync(join(root, 'bibles', 'lut.xml'), zefania(1, 1, GENESIS_1));

const stub = await startElevenLabsStub();
const STUB_BASE = `http://127.0.0.1:${stub.port}`;
// OpenAI is a stub too, so that no check — whatever it does — can reach the
// real service. The shared voices below ask it, on their owners' keys.
const openAi = await startOpenAiStub();
const OPENAI_BASE = `http://127.0.0.1:${openAi.port}`;

const phpString = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
/** The docroot's secrets.php. Every request re-reads it (opcache is off
 * below), so rewriting it takes effect on the next request. The shared
 * OpenAI key is blank unless a check says otherwise, and OpenAI is the stub:
 * nothing here may make a real OpenAI call. */
function setSecrets({ openAiKey = '', base = STUB_BASE, lines = [] } = {}) {
  writeFileSync(
    join(root, 'secrets.php'),
    `<?php\ndefine('OPENAI_API_KEY', ${phpString(openAiKey)});\ndefine('ELEVENLABS_API_BASE', ${phpString(base)});\n` +
      `define('OPENAI_API_BASE', ${phpString(OPENAI_BASE)});\n${lines.join('\n')}\n`,
  );
}
setSecrets();

async function freePort() {
  return new Promise((resolve, reject) => {
    const s = createNetServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}
const PORT = await freePort();
const BASE = `http://127.0.0.1:${PORT}`;

let phpErr = '';
const php = spawn(
  'php',
  ['-d', 'opcache.enable=0', '-d', 'log_errors=1', '-S', `127.0.0.1:${PORT}`, '-t', root],
  {
    stdio: ['ignore', 'ignore', 'pipe'],
    // Blank keys, so neither the developer's OPENAI_API_KEY nor an
    // ELEVENLABS_API_KEY exported from sftp.env can leak in; four workers, so
    // concurrent requests really are concurrent.
    env: { ...process.env, OPENAI_API_KEY: '', ELEVENLABS_API_KEY: '', PHP_CLI_SERVER_WORKERS: '4' },
    detached: true,
  },
);
php.stderr.on('data', (d) => {
  phpErr = (phpErr + d.toString()).slice(-400_000);
});
const stopPhp = () => {
  try {
    process.kill(-php.pid, 'SIGTERM'); // the workers too
  } catch {
    /* already gone */
  }
};
process.on('SIGINT', () => {
  stopPhp();
  process.exit(130);
});

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`${BASE}/api.php?action=ambient.list`);
      if (res.status === 401) return; // no identity headers => PHP is alive
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`php -S did not start on ${PORT}\n${phpErr}`);
}

// ---------- helpers -----------------------------------------------------------

let checks = 0;
const check = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    const tail = phpErr.trim().split('\n').filter((l) => !/Accepted|Closing|\[\d{3}\]: /.test(l)).slice(-12).join('\n');
    if (tail) console.error(`\n--- php stderr ---\n${tail}\n`);
    throw e;
  }
  checks++;
  console.log(`  ok  ${name}`);
};

const hex = (n) => randomBytes(n).toString('hex');
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const round3 = (x) => Math.round(x * 1000) / 1000;
const near = (a, b, msg) => assert.ok(Math.abs(a - b) <= 0.0011, `${msg}: ${a} vs ${b}`);
const mask = (k) => `${k.slice(0, 3)}…${k.slice(-4)}`;
const durationOf = (frames) => (frames * SAMPLES_PER_FRAME) / SAMPLE_RATE;

const makeUser = () => ({ userId: randomUUID(), userSecret: hex(32) });
const userDir = (u) => join(root, 'storage', 'users', u.userId);

/** Every body api.php ever answered with, for "no full key is ever echoed". */
const answered = [];
const ALL_KEYS = [];

async function call(user, action, body, { method = 'POST', headers = {} } = {}) {
  const res = await fetch(`${BASE}/api.php?action=${encodeURIComponent(action)}`, {
    method,
    headers: {
      'X-User-Id': user.userId,
      'X-User-Secret': user.userSecret,
      ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
  });
  const text = await res.text();
  answered.push(text);
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON — asserted on by the caller where it matters */
  }
  return { status: res.status, body: json, text, headers: res.headers };
}
const get = (user, action) => call(user, action, null, { method: 'GET' });

/** Give a user an account directory with no side effect and no upstream
 * call: a key writer is in $ACCOUNT_ACTIONS, so the directory is made before
 * the malformed key is refused. */
async function claim(user) {
  const r = await call(user, 'auth.elevenlabsKey.set', { key: 'x' });
  assert.equal(r.status, 400);
  assert.ok(existsSync(userDir(user)));
}
/** A key ElevenLabs would refuse can't be stored through the API, by design;
 * this puts one on disk the way storeKey would have. */
async function plantKey(user, key) {
  await claim(user);
  writeFileSync(join(userDir(user), 'elevenlabs_key.txt'), key, { mode: 0o600 });
}
async function keyedUser(prefix) {
  const user = makeUser();
  user.key = `${prefix}${hex(16)}`;
  ALL_KEYS.push(user.key);
  const r = await call(user, 'auth.elevenlabsKey.set', { key: user.key });
  assert.equal(r.status, 200, r.text);
  return user;
}

/** Everything under storage/audio/el, relative, sorted — files and dirs. */
function elEntries() {
  const base = join(root, 'storage', 'audio', 'el');
  const out = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      out.push(relative(base, p));
      if (e.isDirectory()) walk(p);
    }
  };
  walk(base);
  return out.sort();
}
const workFiles = () => readdirSync(join(root, 'storage', 'work')).filter((f) => f !== '.htaccess');
const fileOf = (url) => join(root, url);

/** api.php's ElevenLabs cache identity, rebuilt independently. */
function fixed(v) {
  return (Math.round(v * 20) / 20).toFixed(2);
}
function canonicalOf(cfg) {
  const c = {
    v: 1,
    format: 'mp3_44100_128',
    provider: 'elevenlabs',
    voiceId: cfg.voiceId,
    model: cfg.model,
    stability: fixed(cfg.stability ?? 0.5),
    similarity: fixed(cfg.similarity ?? 0.75),
  };
  if (cfg.model === 'eleven_multilingual_v2') {
    c.style = fixed(cfg.style ?? 0);
    c.speed = fixed(Math.min(1.2, Math.max(0.7, cfg.speed ?? 1)));
    c.speakerBoost = true;
  }
  const sorted = {};
  for (const k of Object.keys(c).sort()) sorted[k] = c[k];
  return JSON.stringify(sorted);
}
const configHashOf = (cfg) => sha256(canonicalOf(cfg)).slice(0, 20);
function expectedBase(cfg, lang, text) {
  const k = sha256(`el-content-v1\0${lang}\0${text}`);
  return `/storage/audio/el/${configHashOf(cfg)}/${lang}/${k.slice(0, 2)}/${k}`;
}

/** The words api.php must write: wordTokens() itself, with the leading empty
 * token as its `' '` placeholder and the trailing one (never highlighted) left
 * out. */
function expectedWords(text) {
  const t = wordTokens(text);
  if (t.length > 1 && t[t.length - 1] === '') t.pop();
  if (t[0] === '') t[0] = ' ';
  return t;
}
/** When each word must start: at its first letter or digit (else its first
 * character), timed the way the stub times characters. */
function expectedStarts(text, { from = 0, offset = 0 } = {}) {
  const cps = Array.from(text);
  const space = (c) => /\s/.test(c);
  const starts = cps.length && space(cps[0]) ? [0] : [];
  for (let i = 0; i < cps.length; ) {
    if (space(cps[i])) {
      i++;
      continue;
    }
    let j = i;
    while (j < cps.length && !space(cps[j])) j++;
    const letter = cps.slice(i, j).findIndex((c) => /[\p{L}\p{N}]/u.test(c));
    starts.push(round3(offset + charStart((letter === -1 ? i : i + letter) - from)));
    i = j;
  }
  return starts;
}
function assertTimeline(words, duration) {
  let previous = 0;
  words.forEach((w, k) => {
    assert.ok(w.start >= previous, `word ${k} (${w.word}) starts before the one before it`);
    assert.ok(w.end >= w.start, `word ${k} ends before it starts`);
    assert.ok(w.end <= duration + 1e-9, `word ${k} ends after the audio`);
    const placeholder = k === 0 && w.word === ' ';
    if (!placeholder && k + 1 < words.length) assert.equal(w.end, words[k + 1].start, `a gap after word ${k}`);
    if (!placeholder) previous = w.start;
  });
}

const GEORGE = 'JBFqnCBsd6RMkjVDRZzb';
const v4 = (over = {}) => ({ voiceId: GEORGE, model: 'eleven_v4', stability: 0.5, similarity: 0.75, ...over });
const v2 = (over = {}) => ({
  voiceId: GEORGE,
  model: 'eleven_multilingual_v2',
  stability: 0.5,
  similarity: 0.75,
  style: 0.35,
  speed: 1.1,
  ...over,
});
const verseBody = (cfg, over = {}) => ({
  text: PSALM_117[0],
  provider: 'elevenlabs',
  voice: cfg.voiceId,
  elevenlabs: cfg,
  translation: 'KJV',
  bookId: 19,
  chapter: 117,
  verse: 1,
  ...over,
});
const speakBody = (cfg, text, language) => ({ text, provider: 'elevenlabs', voice: cfg.voiceId, elevenlabs: cfg, language });
const callsWithText = (text) => stub.requests.filter((r) => (r.body?.inputs?.[0]?.text ?? r.body?.text) === text);

/** A German paragraph of 3,500+ bytes: umlauts, „…“, — and …, every
 * sentence starting with a letter. */
function germanParagraph() {
  const sentences = [
    'Und Gott sah, dass das Licht gut war; da schied Gott das Licht von der Finsternis.',
    'Er sprach: „Fürchtet euch nicht!“ — und die Hirten kehrten wieder um … voller Freude.',
    'Über den Wassern schwebte der Geist, und die Erde war wüst und öde.',
    'Selig sind, die da Leid tragen; denn sie sollen getröstet werden.',
    'Größer als alle Weisheit der Welt ist die Güte, die nicht müde wird.',
  ];
  let text = '';
  for (let i = 0; Buffer.byteLength(text) < 3500; i++) {
    text += (text ? ' ' : '') + sentences[i % sentences.length];
  }
  return text;
}

// ---------- shared voices: the community around them -------------------------

/** Started `ms` from now — see check 13 for why concurrent requests are staggered. */
const staggered = (ms, fn) => new Promise((r) => setTimeout(r, ms)).then(fn);

/**
 * A community identity: an account, a signing key, a published profile — and,
 * when asked, an ElevenLabs and/or OpenAI key of its own (`plant` writes a key
 * the API would refuse straight onto disk, the way storeKey would have).
 */
async function communityUser(name, { elevenLabs, openAi: openAiPrefix, plant = false } = {}) {
  const user = makeUser();
  user.displayName = name;
  user.pair = deriveSigningKey(generateMnemonic(wordlist, 128));
  user.authorKey = Buffer.from(user.pair.publicKey).toString('hex');
  const p = await call(user, 'profile.set', { profile: { displayName: name, authorKey: user.authorKey, updatedAt: Date.now() } });
  assert.equal(p.status, 200, p.text);
  if (elevenLabs) {
    user.elKey = `${elevenLabs}${hex(16)}`;
    ALL_KEYS.push(user.elKey);
    if (plant) {
      writeFileSync(join(userDir(user), 'elevenlabs_key.txt'), user.elKey, { mode: 0o600 });
    } else {
      const r = await call(user, 'auth.elevenlabsKey.set', { key: user.elKey });
      assert.equal(r.status, 200, r.text);
    }
  }
  if (openAiPrefix) {
    user.oaKey = `${openAiPrefix}${hex(16)}`;
    ALL_KEYS.push(user.oaKey);
    if (plant) {
      writeFileSync(join(userDir(user), 'openai_key.txt'), user.oaKey, { mode: 0o600 });
    } else {
      const r = await call(user, 'auth.openaiKey.set', { key: user.oaKey });
      assert.equal(r.status, 200, r.text);
    }
  }
  return user;
}

/** A shelf of `owner`'s with a share code, on the approval given. */
async function shelfOf(owner, name, approval = 'manual') {
  const space = { id: randomUUID(), name, kind: 'custom', approval, createdAt: Date.now(), updatedAt: Date.now() };
  const up = await call(owner, 'spaces.upsert', { space });
  assert.equal(up.status, 200, up.text);
  const code = mintSpaceCode(owner.authorKey);
  const r = await call(owner, 'spaces.code.set', { spaceId: space.id, code });
  assert.equal(r.status, 200, r.text);
  return { id: space.id, space, code, owner };
}

/** `reader` asks to read `shelf`, and its owner decides (`null`: not yet). */
async function joinShelf(reader, shelf, decision = 'accepted') {
  const r = await call(reader, 'space.request', { code: shelf.code });
  assert.equal(r.status, 200, r.text);
  if (decision && r.body.status !== decision) {
    const d = await call(shelf.owner, 'members.decide', { userId: reader.userId, spaceId: shelf.id, status: decision });
    assert.equal(d.status, 200, d.text);
  }
}

/** Sign and publish a shared item of `kind` the way the app does. */
async function publishItem(shelf, kind, title, payload) {
  const now = Date.now();
  const base = {
    id: randomUUID(),
    spaceId: shelf.id,
    kind,
    title,
    language: 'en',
    payloadHash: payloadHash(payload),
    payloadBytes: payloadBytes(payload),
    publishedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  const item = { ...base, ...signItemWith(base, shelf.owner.pair) };
  const r = await call(shelf.owner, 'items.upsert', { item, payload });
  assert.equal(r.status, 200, r.text);
  return item;
}

/** Share a voice on a shelf, its payload built by the app's own builder. */
async function shareVoice(shelf, config, sharing, name = 'Opa Georg') {
  const now = Date.now();
  const voice = { v: 1, id: randomUUID(), name, config, createdAt: now, updatedAt: now };
  const item = await publishItem(shelf, 'voice', name, buildVoicePayload(voice, sharing));
  return { item, config, ref: { code: shelf.code, itemId: item.id }, owner: shelf.owner };
}

/** A shared plan — a room's other kind, which is not a voice. */
const sharePlan = (shelf) =>
  publishItem(shelf, 'plan', 'Ein Plan', JSON.stringify({ v: 1, list: { id: randomUUID(), name: 'Ein Plan', days: [] } }));

/** Publish a piece on a shelf, signed. */
async function publishPiece(shelf, { title, body, language }) {
  const now = Date.now();
  const base = { id: randomUUID(), spaceId: shelf.id, title, body, language, publishedAt: now, createdAt: now, updatedAt: now };
  const post = { ...base, ...signPostWith(base, shelf.owner.pair) };
  const r = await call(shelf.owner, 'posts.upsert', { post });
  assert.equal(r.status, 200, r.text);
  return post;
}

/** A v4 voice no other check uses, so its every narration is a miss. */
let freshCount = 0;
const freshV4 = () => {
  const n = freshCount++;
  return {
    provider: 'elevenlabs',
    voiceId: GEORGE,
    model: 'eleven_v4',
    stability: (n % 20) / 20,
    similarity: (3 + Math.floor(n / 20)) / 20,
  };
};

/** A sponsored request: the plain body plus whose voice it is. */
const sharedVerse = (voice, over = {}) => ({ ...verseBody(voice.config, over), shared: over.shared ?? voice.ref });
const sharedSpeak = (voice, text, language) => ({ ...speakBody(voice.config, text, language), shared: voice.ref });
const oaVerse = (voice, over = {}) => ({
  text: PSALM_117[0],
  voice: voice.config.voice,
  voiceStyle: voice.config.style || undefined,
  translation: 'KJV',
  bookId: 19,
  chapter: 117,
  verse: 1,
  ...over,
  shared: voice.ref,
});
const oaSpeak = (voice, text, language) => ({
  text,
  voice: voice.config.voice,
  voiceStyle: voice.config.style || undefined,
  language,
  shared: voice.ref,
});

/** A shared voice's spending counters, as stored in its owner's directory. */
const sponsored = (owner, voice) => join(userDir(owner), 'sponsored', voice.item.id);
function counter(owner, voice, file) {
  const path = join(sponsored(owner, voice), file);
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
}
const monthUtc = () => new Date().toISOString().slice(0, 7);
const dayUtc = () => new Date().toISOString().slice(0, 10);
/** What a text costs a voice's allowance: its characters, never under 50. */
const charge = (text) => Math.max(Array.from(text).length, 50);

// ---------- the run -----------------------------------------------------------

try {
  await waitForServer();

  const nobody = makeUser(); // never has a key, never gets an account
  const CANARY = `sk-canary-${hex(16)}`;
  let alice; // an sk_ok_ key, plus the canary as her "personal OpenAI key"
  let first; // Psalm 117:1 in v4, as first generated

  console.log('keys');

  await check('1. key status creates no account — nor does any reader', async () => {
    const u = makeUser();
    assert.deepEqual((await get(u, 'auth.elevenlabsKey.status')).body, { hasKey: false });
    assert.deepEqual((await call(u, 'auth.elevenlabsKey.clear', {})).body, { hasKey: false });
    assert.deepEqual((await get(u, 'voices.list')).body, { voices: [] });
    assert.deepEqual((await get(u, 'voices.selection.get')).body, {
      narration: 'system:echo',
      assistant: 'system:device',
      updatedAt: 0,
    });
    const proxy = await call(u, 'elevenlabs.voices', {});
    assert.equal(proxy.status, 403);
    assert.equal(proxy.body.error, 'elevenlabs_key_missing');
    assert.equal(existsSync(userDir(u)), false, 'no account directory');
  });

  await check('2. malformed and OpenAI-shaped keys are refused with zero upstream calls', async () => {
    const u = makeUser();
    const mark = stub.requests.length;
    for (const [key, error] of [
      ['sk-proj-abcdefghijklmnopqrstuvwxyz0123456789', 'that looks like an OpenAI key'],
      ['  sk-abcdefghijklmnopqrstuvwxyz  ', 'that looks like an OpenAI key'],
      ['', 'invalid key format'],
      ['too_short', 'invalid key format'],
      ['sk_ok_has a space in it 0123456789', 'invalid key format'],
      ['sk_ok_0123456789abcdef\r\nX-Injected: 1', 'invalid key format'],
      ['sk_ok_0123456789abcdef";drop', 'invalid key format'],
      [12345, 'invalid key format'],
    ]) {
      const r = await call(u, 'auth.elevenlabsKey.set', { key });
      assert.equal(r.status, 400, JSON.stringify(key));
      assert.equal(r.body.error, error, JSON.stringify(key));
    }
    assert.equal(stub.requests.length, mark, 'nothing reached ElevenLabs');
    assert.equal(existsSync(join(userDir(u), 'elevenlabs_key.txt')), false);
  });

  await check('3. a stored key is 0600 under the denied users/, and only its masked form comes back', async () => {
    alice = makeUser();
    alice.key = `sk_ok_${hex(16)}`;
    ALL_KEYS.push(alice.key);
    const mark = stub.requests.length;
    const r = await call(alice, 'auth.elevenlabsKey.set', { key: alice.key });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.body, {
      hasKey: true,
      masked: mask(alice.key),
      restricted: false,
      subscription: { tier: 'creator', characterCount: 1234, characterLimit: 100000, resetsAt: 1767225600000, status: 'active' },
    });
    const sent = stub.since(mark);
    assert.deepEqual(sent.map((c) => `${c.method} ${c.path}`), ['GET /v1/user/subscription']);
    assert.equal(sent[0].key, alice.key);

    const file = join(userDir(alice), 'elevenlabs_key.txt');
    assert.equal(readFileSync(file, 'utf8'), alice.key);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.deepEqual(readdirSync(userDir(alice)).filter((f) => f.startsWith('.key-')), [], 'no temp file left');
    assert.match(readFileSync(join(root, 'storage', 'users', '.htaccess'), 'utf8'), /Require all denied/);
    assert.deepEqual((await get(alice, 'auth.elevenlabsKey.status')).body, { hasKey: true, masked: mask(alice.key) });

    // The canary: Alice's "personal OpenAI key". It must never leave (check 17).
    writeFileSync(join(userDir(alice), 'openai_key.txt'), CANARY, { mode: 0o600 });
    assert.deepEqual((await get(alice, 'auth.openaiKey.status')).body, { hasKey: true, masked: mask(CANARY) });
    // The OpenAI key writer gained the same shape check, before any call.
    const injected = await call(alice, 'auth.openaiKey.set', { key: 'sk-abc\r\nX-Injected: 1' });
    assert.equal(injected.status, 400);
    assert.equal(injected.body.error, 'invalid key format');
  });

  await check('4. a restricted key is accepted after the library probe; an unknown one is rejected; an outage stores nothing', async () => {
    const rita = makeUser();
    const key = `sk_restricted_${hex(16)}`;
    ALL_KEYS.push(key);
    const mark = stub.requests.length;
    const r = await call(rita, 'auth.elevenlabsKey.set', { key });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.body, { hasKey: true, masked: mask(key), restricted: true });
    assert.deepEqual(
      stub.since(mark).map((c) => `${c.method} ${c.path} ${JSON.stringify(c.query)}`),
      ['GET /v1/user/subscription {}', 'GET /v2/voices {"page_size":"1"}'],
    );
    assert.deepEqual((await get(rita, 'auth.elevenlabsKey.status')).body, { hasKey: true, masked: mask(key), restricted: true });

    const unknown = `sk_bad_${hex(16)}`;
    ALL_KEYS.push(unknown);
    const bad = await call(rita, 'auth.elevenlabsKey.set', { key: unknown });
    assert.equal(bad.status, 400);
    assert.deepEqual(bad.body, { error: 'key rejected by ElevenLabs', status: 401, code: 'invalid_api_key', detail: 'Invalid API key' });
    assert.equal(readFileSync(join(userDir(rita), 'elevenlabs_key.txt'), 'utf8'), key, 'the stored key is untouched');

    const down = makeUser();
    const downKey = `sk_down_${hex(16)}`;
    ALL_KEYS.push(downKey);
    const out = await call(down, 'auth.elevenlabsKey.set', { key: downKey });
    assert.equal(out.status, 502);
    assert.equal(out.body.error, 'elevenlabs_unavailable');
    assert.equal(out.body.provider, 'elevenlabs');
    assert.equal(existsSync(join(userDir(down), 'elevenlabs_key.txt')), false);

    // Clearing takes the "restricted" note with it.
    assert.deepEqual((await call(rita, 'auth.elevenlabsKey.clear', {})).body, { hasKey: false });
    assert.deepEqual(readdirSync(userDir(rita)).filter((f) => f.startsWith('elevenlabs_key')), []);
  });

  await check('5. clear and account.delete remove the key', async () => {
    const u = await keyedUser('sk_ok_');
    const file = join(userDir(u), 'elevenlabs_key.txt');
    assert.ok(existsSync(file));
    assert.deepEqual((await call(u, 'auth.elevenlabsKey.clear', {})).body, { hasKey: false });
    assert.equal(existsSync(file), false);
    assert.deepEqual((await call(u, 'auth.elevenlabsKey.clear', {})).body, { hasKey: false }, 'idempotent');
    assert.deepEqual((await get(u, 'auth.elevenlabsKey.status')).body, { hasKey: false });

    assert.equal((await call(u, 'auth.elevenlabsKey.set', { key: u.key })).status, 200);
    assert.ok(existsSync(file));
    assert.equal((await get(u, 'account.delete')).body.deleted, true);
    assert.equal(existsSync(userDir(u)), false);
  });

  console.log('narration');

  await check('6. a miss without a key is elevenlabs_key_missing, and leaves nothing behind', async () => {
    const mark = stub.requests.length;
    const before = elEntries();
    const r = await call(nobody, 'tts', verseBody(v4()));
    assert.equal(r.status, 403);
    assert.deepEqual(r.body, {
      error: 'elevenlabs_key_missing',
      provider: 'elevenlabs',
      payer: 'requester',
      voiceId: GEORGE,
      model: 'eleven_v4',
    });
    const s = await call(nobody, 'tts.speak', speakBody(v2(), 'Friede sei mit euch.', 'de'));
    assert.equal(s.status, 403);
    assert.equal(s.body.error, 'elevenlabs_key_missing');
    assert.equal(s.body.model, 'eleven_multilingual_v2');
    assert.equal(stub.requests.length, mark, 'nothing reached ElevenLabs');
    assert.deepEqual(elEntries(), before, 'no directory was made');
    assert.deepEqual(workFiles(), []);
    assert.equal(existsSync(userDir(nobody)), false);
  });

  await check('7. a miss with a key writes frames-only audio and words that are wordTokens(text), timed to the character', async () => {
    const mark = stub.requests.length;
    const r = await call(alice, 'tts', verseBody(v4()));
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.cached, false);
    first = r.body;

    const sent = stub.since(mark);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].path, '/v1/text-to-dialogue/with-timestamps');
    assert.deepEqual(sent[0].query, { output_format: 'mp3_44100_128' });
    const { future_text: future, ...rest } = sent[0].body;
    assert.deepEqual(rest, {
      inputs: [{ text: PSALM_117[0], voice_id: GEORGE }],
      model_id: 'eleven_v4',
      settings: { stability: 0.5, similarity: 0.75 },
      language_code: 'en',
    });
    // Continuity: the next verse, cut on a word, at most 100 characters; no
    // previous verse exists.
    assert.ok(PSALM_117[1].startsWith(future), future);
    assert.ok(Array.from(future).length <= 100 && Array.from(future).length > 80, future);
    assert.match(PSALM_117[1].slice(future.length), /^\s/, 'cut between words');

    const mp3 = readFileSync(fileOf(r.body.audioUrl));
    const frames = framesFor(Array.from(PSALM_117[0]).length);
    assert.ok(mp3.equals(fakeMp3(frames, { wrapped: false })), 'audio frames only: the ID3, Info and TAG wrappers are stripped');
    assert.equal(statSync(fileOf(r.body.audioUrl)).mode & 0o777, 0o644);

    const al = JSON.parse(readFileSync(fileOf(r.body.alignmentUrl), 'utf8'));
    assert.deepEqual(al.words.map((w) => w.word), expectedWords(PSALM_117[0]));
    assert.deepEqual(al.words.map((w) => w.start), expectedStarts(PSALM_117[0]));
    assert.equal(al.words.at(-1).end, charEnd(Array.from(PSALM_117[0]).length - 1));
    near(al.duration, durationOf(frames), 'duration is the frames');
    assertTimeline(al.words, al.duration);
    assert.deepEqual(
      { provider: al.provider, format: al.format, quality: al.quality, text: al.text, configHash: al.configHash, sourceTextHash: al.sourceTextHash },
      {
        provider: 'elevenlabs',
        format: 'el-chars-v1',
        quality: 'exact',
        text: PSALM_117[0],
        configHash: configHashOf(v4()),
        sourceTextHash: sha256(`\0${PSALM_117[0]}`),
      },
    );
    assert.deepEqual(workFiles(), [], 'the lock and the temp files are gone');

    // v4 reads [brackets] as audio tags: they go out as (parentheses), and the
    // words still come back as written.
    const bracketed = 'Er sprach [leise]: Friede sei mit euch.';
    const b = await call(alice, 'tts.speak', speakBody(v4(), bracketed, 'de'));
    assert.equal(b.status, 200, b.text);
    const bs = callsWithText('Er sprach (leise): Friede sei mit euch.');
    assert.equal(bs.length, 1);
    assert.equal(bs[0].body.language_code, 'de');
    assert.equal('previous_text' in bs[0].body || 'future_text' in bs[0].body, false, 'speech has no neighbours');
    const bal = JSON.parse(readFileSync(fileOf(b.body.alignmentUrl), 'utf8'));
    assert.equal(bal.text, bracketed);
    assert.deepEqual(bal.words.map((w) => w.word), expectedWords(bracketed));
    assert.equal(bal.quality, 'exact');
    assert.equal(b.body.audioUrl, `${expectedBase(v4(), 'de', bracketed)}.mp3`);

    // Multilingual v2: the speech endpoint, its own settings, never a language.
    const spoken = 'Der Herr ist mein Hirte; mir wird nichts mangeln.';
    const m = await call(alice, 'tts.speak', speakBody(v2(), spoken));
    assert.equal(m.status, 200, m.text);
    const ms = callsWithText(spoken);
    assert.equal(ms.length, 1);
    assert.equal(ms[0].path, `/v1/text-to-speech/${GEORGE}/with-timestamps`);
    assert.deepEqual(ms[0].query, { output_format: 'mp3_44100_128' });
    assert.deepEqual(ms[0].body, {
      text: spoken,
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.35, speed: 1.1, use_speaker_boost: true },
    });
    assert.equal(m.body.audioUrl, `${expectedBase(v2(), '_', spoken)}.mp3`);

    // A v2 verse carries the verse before it as previous_text (and nothing
    // after the last verse of the chapter).
    const v = await call(alice, 'tts', verseBody(v2(), { text: PSALM_117[1], verse: 2 }));
    assert.equal(v.status, 200, v.text);
    const vs = callsWithText(PSALM_117[1]);
    assert.equal(vs.length, 1);
    assert.equal(vs[0].body.previous_text, PSALM_117[0]);
    assert.equal('next_text' in vs[0].body, false);
    assert.equal('language_code' in vs[0].body, false);

    // Only ElevenLabs' normalized timings: still exact. No timings at all:
    // no words, and the audio still plays.
    const n = await call(alice, 'tts.speak', speakBody(v4({ voiceId: NORMALIZED_ONLY_VOICE }), 'Normalized only.', 'en'));
    assert.equal(JSON.parse(readFileSync(fileOf(n.body.alignmentUrl), 'utf8')).quality, 'exact');
    const none = await call(alice, 'tts.speak', speakBody(v4({ voiceId: NO_ALIGNMENT_VOICE }), 'No timings at all.', 'en'));
    assert.equal(none.status, 200, none.text);
    const nal = JSON.parse(readFileSync(fileOf(none.body.alignmentUrl), 'utf8'));
    assert.deepEqual([nal.quality, nal.words], ['none', []]);
    assert.ok(readFileSync(fileOf(none.body.audioUrl)).length > 0);
  });

  await check('8. a keyless hit costs zero upstream calls', async () => {
    const mark = stub.requests.length;
    const r = await call(nobody, 'tts', verseBody(v4()));
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.body, { ...first, cached: true });
    assert.equal(stub.requests.length, mark);
    assert.equal(existsSync(userDir(nobody)), false);
  });

  await check('9. the cache path is golden; v4 ignores style and speed; 0.51 is 0.50', async () => {
    const base = expectedBase(v4(), 'en', PSALM_117[0]);
    assert.equal(first.audioUrl, `${base}.mp3`);
    assert.equal(first.alignmentUrl, `${base}.json`);
    assert.equal(configHashOf(v4()), '213e54144520db9cb02a', 'the v4 identity of George at 0.50/0.75 is frozen');

    const mark = stub.requests.length;
    for (const cfg of [v4({ style: 0.9, speed: 1.15 }), v4({ stability: 0.51 }), v4({ stability: 0.5000001, similarity: 0.76 })]) {
      const r = await call(nobody, 'tts', verseBody(cfg));
      assert.equal(r.status, 200, `${JSON.stringify(cfg)} → ${r.text}`);
      assert.equal(r.body.audioUrl, `${base}.mp3`, JSON.stringify(cfg));
    }
    // The same words through tts.speak, in the same language, are the same file.
    const s = await call(nobody, 'tts.speak', speakBody(v4(), PSALM_117[0], 'en'));
    assert.deepEqual(s.body, { ...first, cached: true });
    assert.equal(stub.requests.length, mark, 'all of them hits');

    // 0.53 is 0.55: another voice, another path — a miss, which needs a key.
    const other = await call(nobody, 'tts', verseBody(v4({ stability: 0.53 })));
    assert.equal(other.status, 403);
    assert.notEqual(configHashOf(v4({ stability: 0.53 })), configHashOf(v4()));
    // v2's identity includes style, speed and speaker boost; v4's never does.
    assert.notEqual(configHashOf(v2()), configHashOf(v2({ style: 0.4 })));
    assert.match(canonicalOf(v2()), /"speakerBoost":true/);
    assert.doesNotMatch(canonicalOf(v4({ style: 0.9 })), /style|speed|speakerBoost/);
  });

  await check('10. a 3,500-byte German paragraph on v4 is cut at sentences, joined cleanly and timed across the join', async () => {
    const text = germanParagraph();
    assert.ok(Buffer.byteLength(text) >= 3500 && Buffer.byteLength(text) <= 4000);
    const mark = stub.requests.length;
    const r = await call(alice, 'tts', {
      text,
      provider: 'elevenlabs',
      voice: GEORGE,
      elevenlabs: v4(),
      translation: 'LUT',
      bookId: 1,
      chapter: 1,
      verse: 2,
    });
    assert.equal(r.status, 200, r.text);
    const sent = stub.since(mark).filter((c) => c.path === '/v1/text-to-dialogue/with-timestamps');
    assert.ok(sent.length >= 2, `${sent.length} requests`);
    const chunks = sent.map((c) => c.body.inputs[0].text);
    for (const c of chunks) {
      assert.ok(Array.from(c).length <= 1800 && c.length <= 2000, `a ${c.length}-character request`);
      assert.match(c, /[.!?…]["“”'’»«)\]]*$/u, 'cut at a sentence end');
    }
    assert.equal(chunks.join(' '), text, 'nothing lost or doubled at a cut');
    for (const c of sent) assert.equal(c.body.language_code, 'de');
    // The neighbours: the verse before the first chunk, the next chunk's head
    // after each one, the verse after the last.
    assert.equal(sent[0].body.previous_text, GENESIS_1[0]);
    assert.equal(sent.at(-1).body.future_text, GENESIS_1[2]);
    for (let i = 1; i < sent.length; i++) {
      const prev = sent[i].body.previous_text;
      const next = sent[i - 1].body.future_text;
      assert.ok(chunks[i - 1].endsWith(prev) && Array.from(prev).length <= 100, prev);
      assert.ok(chunks[i].startsWith(next) && Array.from(next).length <= 100, next);
    }

    const frames = chunks.map((c) => framesFor(Array.from(c).length));
    const mp3 = readFileSync(fileOf(r.body.audioUrl));
    assert.ok(mp3.equals(Buffer.concat(frames.map((f) => fakeMp3(f, { wrapped: false })))), 'the chunks’ frames, joined, nothing else');
    const al = JSON.parse(readFileSync(fileOf(r.body.alignmentUrl), 'utf8'));
    near(al.duration, durationOf(frames.reduce((a, b) => a + b, 0)), 'duration');
    assert.deepEqual(al.words.map((w) => w.word), expectedWords(text));
    assert.equal(al.quality, 'exact');
    assertTimeline(al.words, al.duration);
    // Each chunk's timings start after the real audio before it.
    let index = 0;
    let offset = 0;
    chunks.forEach((c, i) => {
      near(al.words[index].start, offset + expectedStarts(c)[0], `first word of chunk ${i + 1}`);
      index += wordTokens(c).length;
      offset += durationOf(frames[i]);
    });
  });

  await check('11. invalid parameters are 400, before any upstream call', async () => {
    const mark = stub.requests.length;
    const before = elEntries();
    const cases = [
      ['tts', verseBody(v4({ voiceId: 'short' }))],
      ['tts', verseBody(v4({ voiceId: 'has_underscores_00000' }))],
      ['tts', verseBody(v4({ model: 'eleven_v9' }))],
      ['tts', { ...verseBody(v4()), elevenlabs: 'George' }],
      ['tts', { ...verseBody(v4()), elevenlabs: undefined }],
      ['tts', { ...verseBody(v4()), provider: 'acme' }],
      ['tts', verseBody(v4(), { text: '' })],
      ['tts', verseBody(v4(), { text: ' \n\t ' })],
      ['tts', verseBody(v4(), { text: 'ä'.repeat(2001) })],
      ['tts', verseBody(v4(), { translation: 'XYZ' })],
      ['tts', verseBody(v4(), { bookId: 0 })],
      ['tts.speak', speakBody(v4(), 'Bonjour.', 'fr')],
      ['tts.speak', speakBody(v4(), 'x'.repeat(4001), 'en')],
      ['tts.speak', { text: 'Hello', provider: 'elevenlabs', voice: GEORGE }],
    ];
    for (const [action, body] of cases) {
      const r = await call(alice, action, body);
      assert.equal(r.status, 400, `${action} ${JSON.stringify(body).slice(0, 100)} → ${r.text}`);
    }
    assert.equal(stub.requests.length, mark, 'nothing reached ElevenLabs');
    assert.deepEqual(elEntries(), before);
  });

  /** What failed in check 12, for check 14 to prove nothing was left of it:
   * the entry itself, and — for a voice that never succeeded — any directory. */
  const failed = [];
  const noteFailure = (cfg, text) => failed.push({ cfg, text });

  await check('12. every upstream failure maps to its code, names the voice, and is never user_key_failed', async () => {
    const bea = makeUser();
    const beaKey = `sk_bad_${hex(16)}`;
    ALL_KEYS.push(beaKey);
    await plantKey(bea, beaKey); // refused at set, by design — so planted
    const carl = await keyedUser('sk_broke_');
    const dora = await keyedUser('sk_brokelegacy_');
    const ella = await keyedUser('sk_busy_');

    const fast = [
      ['an unknown key', bea, GEORGE, 502, 'elevenlabs_key_failed'],
      ['a missing permission', alice, 'FaultPermission00001', 502, 'elevenlabs_key_permissions', { permission: 'text_to_speech' }],
      ['credits used up (current shape, 402)', carl, GEORGE, 502, 'elevenlabs_quota_exceeded'],
      ['credits used up (original shape, 401)', dora, GEORGE, 502, 'elevenlabs_quota_exceeded'],
      ['a voice gone from the library', alice, 'FaultVoiceNotFound01', 502, 'elevenlabs_voice_unavailable'],
      ['a voice the plan does not allow', alice, 'FaultNotAllowed00001', 502, 'elevenlabs_not_allowed'],
      ['a validation error that echoes the key', alice, 'FaultRejected0000001', 400, 'elevenlabs_rejected'],
      ['a long rejection that echoes the key', alice, 'FaultRejectedLong001', 400, 'elevenlabs_rejected'],
      ['a server error', alice, 'FaultServerError0001', 502, 'elevenlabs_unavailable'],
      ['a body that is not JSON', alice, 'FaultGarbage00000001', 502, 'elevenlabs_bad_response'],
      ['audio that is not MP3', alice, 'FaultBadAudio0000001', 502, 'elevenlabs_bad_response'],
      ['an announced 17 MB response', alice, 'FaultHugeResponse001', 502, 'elevenlabs_bad_response'],
      ['a streamed 17 MB response', alice, 'FaultHugeChunked0001', 502, 'elevenlabs_bad_response'],
      ['a redirect, not followed', alice, 'FaultRedirect0000001', 502, 'elevenlabs_bad_response'],
    ];
    const expectFailure = (name, r, voiceId, status, error, extra = {}) => {
      assert.equal(r.status, status, `${name}: ${r.text}`);
      assert.equal(r.body.error, error, name);
      assert.notEqual(r.body.error, 'user_key_failed');
      assert.equal(r.body.provider, 'elevenlabs', name);
      assert.equal(r.body.payer, 'requester', name);
      assert.equal(r.body.voiceId, voiceId, `${name} names the voice`);
      assert.equal(r.body.model, 'eleven_v4', name);
      for (const [k, v] of Object.entries(extra)) assert.equal(r.body[k], v, `${name}: ${k}`);
    };
    for (const [name, user, voiceId, status, error, extra] of fast) {
      const cfg = v4({ voiceId });
      const text = `Fault: ${name}.`;
      noteFailure(cfg, text);
      const r = await call(user, 'tts.speak', speakBody(cfg, text, 'en'));
      expectFailure(name, r, voiceId, status, error, extra);
      if (error === 'elevenlabs_rejected') {
        assert.ok(r.body.detail.length > 0 && r.body.detail.length <= 300, `${name}: a ${r.body.detail.length}-character detail`);
        assert.equal(r.body.detail.includes(user.key ?? alice.key), false, `${name}: the key is scrubbed`);
      }
    }
    // The voice id is what lets the client set aside just that one voice.
    const gone = await call(alice, 'tts', verseBody(v4({ voiceId: 'FaultVoiceNotFound01' }), { text: 'Gone.' }));
    assert.equal(gone.body.error, 'elevenlabs_voice_unavailable');
    assert.equal(gone.body.voiceId, 'FaultVoiceNotFound01');

    // "Busy" is retried once after 1.5 s; still busy is 429 with Retry-After.
    // Run together, so the three waits overlap.
    const slow = [
      ['always busy', ella, GEORGE, 429, 'elevenlabs_rate_limited'],
      ['always 503', alice, 'FaultUnavailable0001', 429, 'elevenlabs_rate_limited'],
      ['busy once, then fine', alice, BUSY_ONCE_VOICE, 200, null],
    ];
    const started = Date.now();
    const results = await Promise.all(
      slow.map(([name, user, voiceId]) => call(user, 'tts.speak', speakBody(v4({ voiceId }), `Slow: ${name}.`, 'en'))),
    );
    assert.ok(Date.now() - started >= 1400, 'the retry waited');
    slow.forEach(([name, , voiceId, status, error], i) => {
      const r = results[i];
      assert.equal(callsWithText(`Slow: ${name}.`).length, 2, `${name}: one retry`);
      if (status === 200) {
        assert.equal(r.status, 200, `${name}: ${r.text}`);
        return;
      }
      noteFailure(v4({ voiceId }), `Slow: ${name}.`);
      expectFailure(name, r, voiceId, status, error);
      assert.equal(r.headers.get('retry-after'), '2', name);
    });

    // Upstream unreachable, and an origin this server refuses to talk to.
    for (const [name, base] of [['connection refused', 'http://127.0.0.1:1'], ['not https', 'http://elevenlabs.example']]) {
      setSecrets({ base });
      try {
        const mark = stub.requests.length;
        const r = await call(alice, 'tts.speak', speakBody(v4(), `Unreachable: ${name}.`, 'en'));
        expectFailure(name, r, GEORGE, 502, 'elevenlabs_unavailable');
        assert.equal(stub.requests.length, mark);
      } finally {
        setSecrets();
      }
    }
  });

  await check('13. two listeners asking at once cost one generation; one kept waiting too long is tts_busy', async () => {
    const sam = await keyedUser('sk_slow_');
    // Started 100 ms apart, while the first is still at the stub (SLOW_MS):
    // a php -S worker running a script accepts no other connection, so each
    // request is guaranteed its own worker — sent at the same instant, one
    // worker can accept two connections and run them back to back, and then
    // nothing here would contend for anything.
    const staggered = (delay, body) =>
      new Promise((r) => setTimeout(r, delay)).then(async () => {
        const t = Date.now();
        const r = await call(sam, 'tts.speak', body);
        return { ...r, took: Date.now() - t };
      });
    const text = 'Concurrent: the LORD is my shepherd; I shall not want.';
    const body = speakBody(v4(), text, 'en');
    const rs = await Promise.all([staggered(0, body), staggered(100, body), staggered(200, body)]);
    for (const r of rs) assert.equal(r.status, 200, r.text);
    assert.equal(new Set(rs.map((r) => r.body.audioUrl)).size, 1);
    assert.deepEqual(rs.map((r) => r.body.cached), [false, true, true]);
    assert.equal(callsWithText(text).length, 1, 'one synthesis');
    for (const r of rs.slice(1)) assert.ok(r.took >= 300, `a later listener answered in ${r.took} ms: it never waited`);
    assert.deepEqual(workFiles(), []);

    // With the wait cut to 0.2 s, the second listener gives up while the
    // first (0.7 s at the stub) is still generating.
    setSecrets({ lines: ["define('EL_LOCK_WAIT_SECONDS', 0.2);"] });
    try {
      const other = speakBody(v4(), 'Impatient: thy rod and thy staff they comfort me.', 'en');
      const [a, b] = await Promise.all([staggered(0, other), staggered(100, other)]);
      const busy = b.status === 503 ? b : null;
      const done = a.status === 200 ? a : null;
      assert.ok(busy && done, `${a.status} / ${b.status}`);
      assert.deepEqual(busy.body, { error: 'tts_busy', provider: 'elevenlabs', payer: 'requester', voiceId: GEORGE, model: 'eleven_v4' });
      assert.equal(busy.headers.get('retry-after'), '2');
    } finally {
      setSecrets();
    }
    assert.deepEqual(workFiles(), []);
  });

  await check('14. a failure leaves no temp file, no lock and no half entry', async () => {
    assert.deepEqual(workFiles(), []);
    assert.match(readFileSync(join(root, 'storage', 'work', '.htaccess'), 'utf8'), /Require all denied/);
    const files = elEntries().filter((f) => /\.(mp3|json)$/.test(f));
    for (const f of files) {
      const twin = f.endsWith('.mp3') ? f.replace(/\.mp3$/, '.json') : f.replace(/\.json$/, '.mp3');
      assert.ok(files.includes(twin), `${f} has no twin`);
    }
    assert.ok(failed.length >= 15);
    for (const { cfg, text } of failed) {
      const entry = expectedBase(cfg, 'en', text);
      assert.equal(existsSync(fileOf(`${entry}.mp3`)) || existsSync(fileOf(`${entry}.json`)), false, text);
      if (cfg.voiceId !== GEORGE) {
        // A voice that never once succeeded has no directory at all: mkdir
        // comes after synthesis, not before.
        assert.equal(existsSync(join(root, 'storage', 'audio', 'el', configHashOf(cfg))), false, `a directory for ${cfg.voiceId}`);
      }
    }
  });

  await check('15. OpenAI did not move: the Echo hits are byte-identical, a keyless miss is the same 500, the shared key reads only Echo', async () => {
    const dir = join(root, 'storage', 'audio', 'echo', 'KJV', '19', '117');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '1.mp3'), fakeMp3(3));
    writeFileSync(join(dir, '1.json'), JSON.stringify({ words: [], duration: 0.07, text: PSALM_117[0], sourceTextHash: sha256(`\0${PSALM_117[0]}`) }));
    const echo = { text: PSALM_117[0], voice: 'echo', translation: 'KJV', bookId: 19, chapter: 117, verse: 1 };
    for (const who of [nobody, alice]) {
      const r = await call(who, 'tts', echo);
      assert.equal(r.status, 200);
      assert.equal(r.text, '{"audioUrl":"/storage/audio/echo/KJV/19/117/1.mp3","alignmentUrl":"/storage/audio/echo/KJV/19/117/1.json","cached":true}');
    }
    const speakKey = sha256('echo::en:Psalm 117');
    mkdirSync(join(root, 'storage', 'audio', 'speak', 'echo'), { recursive: true });
    writeFileSync(join(root, 'storage', 'audio', 'speak', 'echo', `${speakKey}.mp3`), fakeMp3(2));
    writeFileSync(join(root, 'storage', 'audio', 'speak', 'echo', `${speakKey}.json`), '{"words":[]}');
    const s = await call(nobody, 'tts.speak', { text: 'Psalm 117', voice: 'echo', language: 'en' });
    assert.equal(s.text, `{"audioUrl":"/storage/audio/speak/echo/${speakKey}.mp3","alignmentUrl":"/storage/audio/speak/echo/${speakKey}.json","cached":true}`);

    // No key anywhere: the 500 the router used to answer before any handler
    // ran — and now no directory is made for it either.
    const miss = await call(nobody, 'tts', { ...echo, text: 'Praise ye the LORD.', chapter: 118 });
    assert.equal(miss.status, 500);
    assert.equal(miss.text, '{"error":"no OpenAI API key configured"}');
    assert.equal(existsSync(join(root, 'storage', 'audio', 'echo', 'KJV', '19', '118')), false);
    const speakMiss = await call(nobody, 'tts.speak', { text: 'Never said before.', voice: 'echo' });
    assert.equal(speakMiss.text, '{"error":"no OpenAI API key configured"}');
    assert.equal((await call(nobody, 'tts', { ...echo, provider: 'acme' })).status, 400, 'an unknown provider is not read as OpenAI');

    // The shared key pays for Echo-without-a-style and nothing else. Every
    // request below is refused before any call is made.
    setSecrets({ openAiKey: 'sk-operator-dummy-not-a-real-key' });
    try {
      for (const voice of [{ voice: 'alloy' }, { voice: 'echo', voiceStyle: 'Read it slowly.' }]) {
        const t = await call(nobody, 'tts', { ...echo, text: 'Praise ye the LORD.', chapter: 118, ...voice });
        assert.equal(t.status, 403, t.text);
        assert.deepEqual(t.body, { error: 'openai_key_required' });
        const sp = await call(nobody, 'tts.speak', { text: 'Never said before.', ...voice });
        assert.equal(sp.status, 403, sp.text);
      }
      // Preferring the shared key for the session puts a key-holder under the same rule.
      const pref = await call(alice, 'tts', { ...echo, text: 'Praise ye the LORD.', chapter: 118, voice: 'alloy' }, {
        headers: { 'X-Prefer-Shared-Key': '1' },
      });
      assert.deepEqual(pref.body, { error: 'openai_key_required' });
      // ...and a hit is still free for everyone.
      assert.equal((await call(nobody, 'tts', echo)).body.cached, true);
    } finally {
      setSecrets();
    }
    assert.equal(existsSync(join(root, 'storage', 'audio', 'alloy')), false);
  });

  console.log('proxies');

  await check('16. the proxies need a key, and whitelist what comes back', async () => {
    for (const action of ['elevenlabs.subscription', 'elevenlabs.voices', 'elevenlabs.design', 'elevenlabs.design.save']) {
      const r = await call(nobody, action, { description: 'A voice.', generatedVoiceId: 'gen0abc', name: 'X' });
      assert.equal(r.status, 403, action);
      assert.deepEqual(r.body, { error: 'elevenlabs_key_missing', provider: 'elevenlabs', payer: 'requester' }, action);
    }

    assert.deepEqual((await call(alice, 'elevenlabs.subscription', {})).body, {
      subscription: { tier: 'creator', characterCount: 1234, characterLimit: 100000, resetsAt: 1767225600000, status: 'active' },
    });

    let mark = stub.requests.length;
    const page1 = await call(alice, 'elevenlabs.voices', { pageSize: 2 });
    assert.equal(page1.status, 200, page1.text);
    assert.deepEqual(stub.since(mark).map((c) => c.query), [{ page_size: '2', include_total_count: 'false' }]);
    assert.deepEqual(Object.keys(page1.body).sort(), ['hasMore', 'nextPageToken', 'voices']);
    assert.deepEqual([page1.body.hasMore, page1.body.nextPageToken], [true, 'page-2']);
    assert.deepEqual(page1.body.voices[0], {
      voiceId: GEORGE,
      name: 'George',
      category: 'premade',
      labels: { accent: 'british', age: 'middle_aged', gender: 'male', descriptive: 'warm', useCase: 'narrative_story' },
      description: 'Warm resonance that instantly captivates listeners.',
      previewUrl: 'https://storage.example/george.mp3',
      languages: [
        { language: 'en', accent: 'british', locale: 'en-GB', modelId: 'eleven_v4', previewUrl: 'https://storage.example/george-en.mp3' },
        { language: 'de', accent: 'standard', locale: 'de-DE', modelId: 'eleven_multilingual_v2', previewUrl: null },
      ],
      isOwner: false,
    });
    assert.equal(page1.body.voices[1].previewUrl, null, 'an http:// preview is dropped');
    const page2 = await call(alice, 'elevenlabs.voices', { pageSize: 2, nextPageToken: 'page-2' });
    assert.deepEqual(page2.body.voices.map((v) => v.voiceId), ['MyOwnVoice0000000001'], 'a voice narration could not use is dropped');
    assert.deepEqual([page2.body.voices[0].isOwner, page2.body.hasMore, page2.body.nextPageToken], [true, false, null]);
    mark = stub.requests.length;
    const found = await call(alice, 'elevenlabs.voices', { search: 'opa' });
    assert.equal(stub.since(mark)[0].query.search, 'opa');
    assert.equal(stub.since(mark)[0].query.page_size, '30', 'the default page');
    assert.deepEqual(found.body.voices.map((v) => v.name), ['Opa Heinrich']);
    assert.equal([page1.text, page2.text].some((t) => t.includes('leak-me')), false);
    for (const body of [{ pageSize: 0 }, { pageSize: 101 }, { pageSize: '30' }, { search: 'x'.repeat(101) }, { nextPageToken: 'x'.repeat(513) }]) {
      assert.equal((await call(alice, 'elevenlabs.voices', body)).status, 400, JSON.stringify(body).slice(0, 60));
    }

    mark = stub.requests.length;
    const description = 'A warm, elderly German narrator with a gentle, unhurried voice.';
    const d = await call(alice, 'elevenlabs.design', { description, language: 'de' });
    assert.equal(d.status, 200, d.text.slice(0, 300));
    const sent = stub.since(mark)[0];
    assert.deepEqual([sent.method, sent.path, sent.query], ['POST', '/v1/text-to-voice/design', { output_format: 'mp3_44100_128' }]);
    assert.deepEqual(
      { model: sent.body.model_id, description: sent.body.voice_description, auto: sent.body.auto_generate_text },
      { model: 'eleven_ttv_v3', description, auto: false },
    );
    assert.equal(sent.body.text, d.body.text);
    assert.ok(d.body.text.length >= 100 && d.body.text.length <= 1000 && d.body.text.includes('Hirte'), 'Psalm 23, in German');
    assert.equal(d.body.previews.length, 3);
    for (const p of d.body.previews) {
      assert.deepEqual(Object.keys(p).sort(), ['audioBase64', 'durationSecs', 'generatedVoiceId', 'language', 'mediaType']);
      assert.equal(p.mediaType, 'audio/mpeg');
      assert.ok(Buffer.from(p.audioBase64, 'base64').length <= 2 * 1024 * 1024);
    }
    assert.equal(d.text.includes('leak-me'), false);
    const english = await call(alice, 'elevenlabs.design', { description: 'Please include a broken preview.' });
    assert.equal(english.body.previews.length, 2, 'an unplayable take is dropped');
    assert.ok(english.body.text.includes('shepherd'), 'English by default');
    for (const body of [{ description: '' }, { description: 'x'.repeat(1001) }, { description: 'Fine.', language: 'fr' }]) {
      assert.equal((await call(alice, 'elevenlabs.design', body)).status, 400, JSON.stringify(body).slice(0, 60));
    }

    mark = stub.requests.length;
    const save = await call(alice, 'elevenlabs.design.save', {
      generatedVoiceId: d.body.previews[0].generatedVoiceId,
      name: 'Opa Heinrich',
      description,
    });
    assert.deepEqual(save.body, {
      voice: { voiceId: 'Designed00000000000001', name: 'Opa Heinrich', category: 'generated', previewUrl: 'https://storage.example/designed.mp3' },
    });
    assert.deepEqual(stub.since(mark)[0].body, {
      voice_name: 'Opa Heinrich',
      voice_description: description,
      generated_voice_id: d.body.previews[0].generatedVoiceId,
    });
    for (const body of [
      { generatedVoiceId: 'has space', name: 'X', description },
      { generatedVoiceId: 'gen0', name: 'x'.repeat(101), description },
      { generatedVoiceId: 'gen0', name: 'X' },
    ]) {
      assert.equal((await call(alice, 'elevenlabs.design.save', body)).status, 400, JSON.stringify(body).slice(0, 60));
    }
  });

  await check('17. no upstream request ever carried Authorization, the OpenAI key or the canary; no answer echoed a key', () => {
    assert.ok(stub.requests.length > 30, `${stub.requests.length} upstream requests seen`);
    for (const r of stub.requests) {
      assert.equal('authorization' in r.headers, false, `${r.method} ${r.path} carried Authorization`);
      const everything = JSON.stringify(r.headers) + r.raw + JSON.stringify(r.query);
      assert.equal(everything.includes(CANARY), false, `${r.path} carried the canary`);
      assert.equal(everything.includes('sk-operator-dummy'), false, `${r.path} carried the shared OpenAI key`);
      assert.match(r.key ?? '', /^sk_[a-z]+_[0-9a-f]+$/, `${r.path} without an ElevenLabs key`);
    }
    for (const text of answered) {
      for (const key of [...ALL_KEYS, CANARY]) assert.equal(text.includes(key), false, 'a full key in an answer');
    }
  });

  console.log('voices');

  await check('18. voices: whitelisted on the way in, exactly what was stored on the way out', async () => {
    const vic = makeUser();
    const now = Date.now();
    const jpeg = (n) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(n)]).toString('base64');
    const upsert = (voice) => call(vic, 'voices.upsert', { voice });
    const stored = () => JSON.parse(readFileSync(join(userDir(vic), 'voices.json'), 'utf8'));

    const marin = {
      v: 1,
      id: randomUUID(),
      name: '  Marin, warm  ',
      config: { provider: 'openai', voice: 'marin', style: 'Warm storyteller.', extra: 'dropped' },
      createdAt: now,
      updatedAt: now,
      dirty: 1,
      deleted: 0,
      secret: 'dropped',
    };
    const r1 = await upsert(marin);
    assert.equal(r1.status, 200, r1.text);
    assert.deepEqual(r1.body.voices, [
      { v: 1, id: marin.id, name: 'Marin, warm', config: { provider: 'openai', voice: 'marin', style: 'Warm storyteller.' }, createdAt: now, updatedAt: now },
    ]);

    const avatar = `data:image/jpeg;base64,${jpeg(900)}`;
    const george = {
      v: 1,
      id: randomUUID(),
      name: 'George · v4',
      sourceName: '  George  ',
      avatar,
      config: { provider: 'elevenlabs', voiceId: GEORGE, model: 'eleven_v4', stability: 0.51, similarity: 0.3, style: 0.9, speed: 1.1 },
      createdAt: now,
      updatedAt: now + 1,
    };
    const r2 = await upsert(george);
    assert.deepEqual(r2.body.voices[1], {
      v: 1,
      id: george.id,
      name: 'George · v4',
      sourceName: 'George',
      avatar,
      config: { provider: 'elevenlabs', voiceId: GEORGE, model: 'eleven_v4', stability: 0.5, similarity: 0.3 },
      createdAt: now,
      updatedAt: now + 1,
    });
    const steady = {
      v: 1,
      id: randomUUID(),
      name: 'Steady',
      sourceName: 'L'.repeat(100),
      config: { provider: 'elevenlabs', voiceId: GEORGE, model: 'eleven_multilingual_v2', stability: 0.53, similarity: 'loud', speed: 1.5 },
      createdAt: now,
      updatedAt: now,
    };
    const r3 = await upsert(steady);
    assert.deepEqual(r3.body.voices[2].config, {
      provider: 'elevenlabs',
      voiceId: GEORGE,
      model: 'eleven_multilingual_v2',
      stability: 0.55,
      similarity: 0.75,
      style: 0,
      speed: 1.2,
    }, 'quantized, clamped, defaulted — as the client does');
    assert.equal(r3.body.voices[2].sourceName, 'L'.repeat(80), 'an over-long sourceName is truncated, not refused');
    const blankSource = await upsert({ ...steady, sourceName: '   ' });
    assert.equal('sourceName' in blankSource.body.voices[2], false, 'an empty sourceName is omitted');

    assert.deepEqual((await get(vic, 'voices.list')).body.voices, stored());
    assert.deepEqual(stored(), blankSource.body.voices);

    const refused = [
      ['a non-uuid id', { ...marin, id: '../../secret' }],
      ['an unknown provider', { ...marin, id: randomUUID(), config: { provider: 'acme', voice: 'x' } }],
      ['an unknown OpenAI voice', { ...marin, id: randomUUID(), config: { provider: 'openai', voice: 'robot' } }],
      ['an unknown model', { ...marin, id: randomUUID(), config: { ...george.config, model: 'eleven_v9' } }],
      ['a bad ElevenLabs voice id', { ...marin, id: randomUUID(), config: { ...george.config, voiceId: 'not valid' } }],
      ['a style over 1,000 bytes', { ...marin, id: randomUUID(), config: { provider: 'openai', voice: 'echo', style: 'ä'.repeat(501) } }],
      ['a non-image avatar', { ...marin, id: randomUUID(), avatar: 'data:text/html;base64,PHNjcmlwdD4=' }],
      ['an avatar that is not what it claims', { ...marin, id: randomUUID(), avatar: `data:image/png;base64,${jpeg(100)}` }],
      ['an oversized avatar', { ...marin, id: randomUUID(), avatar: `data:image/jpeg;base64,${jpeg(75_000)}` }],
      ['a blank name', { ...marin, id: randomUUID(), name: '   ' }],
      ['an 81-character name', { ...marin, id: randomUUID(), name: 'n'.repeat(81) }],
      ['no timestamps', { ...marin, id: randomUUID(), createdAt: undefined }],
      ['a future record version', { ...marin, id: randomUUID(), v: 2 }],
    ];
    const before = stored();
    for (const [name, voice] of refused) {
      const r = await upsert(voice);
      assert.equal(r.status, 400, `${name}: ${r.text}`);
    }
    assert.deepEqual(stored(), before, 'nothing refused was written');

    // Thirty voices, and not one more — but a full collection stays editable.
    for (let i = stored().length; i < 30; i++) {
      assert.equal((await upsert({ ...marin, id: randomUUID(), name: `Voice ${i}` })).status, 200);
    }
    const thirtyFirst = await upsert({ ...marin, id: randomUUID(), name: 'One too many' });
    assert.equal(thirtyFirst.status, 400);
    assert.equal(thirtyFirst.body.error, 'too many voices');
    const renamed = await upsert({ ...marin, name: 'Marin, renamed', updatedAt: now + 5 });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.voices.length, 30);
    assert.equal(renamed.body.voices.find((v) => v.id === marin.id).name, 'Marin, renamed');

    const del = await call(vic, 'voices.delete', { id: george.id });
    assert.equal(del.status, 200);
    assert.equal(del.body.voices.some((v) => v.id === george.id), false);
    assert.deepEqual((await get(vic, 'voices.list')).body.voices, del.body.voices);

    // The selection: last write wins, a stale write is ignored and told what is stored.
    const selection = { narration: steady.id, assistant: 'system:device', updatedAt: 1000 };
    assert.deepEqual((await call(vic, 'voices.selection.set', selection)).body, selection);
    const stale = await call(vic, 'voices.selection.set', { narration: 'system:echo', assistant: 'system:echo', updatedAt: 999 });
    assert.deepEqual(stale.body, { ...selection, ignored: true });
    assert.deepEqual((await get(vic, 'voices.selection.get')).body, selection);
    const later = { narration: 'system:device', assistant: marin.id, updatedAt: 1000 };
    assert.deepEqual((await call(vic, 'voices.selection.set', later)).body, later, 'an equal timestamp overwrites, as order.set does');
    for (const body of [
      { narration: 'system:robot', assistant: 'system:device', updatedAt: 2000 },
      { narration: '../../etc', assistant: 'system:device', updatedAt: 2000 },
      { narration: 'system:echo', assistant: 'system:device' },
    ]) {
      assert.equal((await call(vic, 'voices.selection.set', body)).status, 400, JSON.stringify(body));
    }

    for (const f of ['voices.json', 'voiceSelection.json']) assert.ok(existsSync(join(userDir(vic), f)));
    assert.equal((await get(vic, 'account.delete')).body.deleted, true);
    assert.equal(existsSync(userDir(vic)), false, 'voices and the selection go with the account');
  });

  console.log('shared voices');

  // The cast. Olivia owns the shelves and the voices; Rita reads them and
  // holds keys of her own, which no sponsored narration may ever spend; Ron
  // is a second accepted reader; Paul is pending, Bea blocked, Sam never
  // asked, and Nina has no community profile at all.
  const olivia = await communityUser('Olivia', { elevenLabs: 'sk_ok_', openAi: 'sk-oa-ok-' });
  const rita = await communityUser('Rita', { elevenLabs: 'sk_ok_', openAi: 'sk-oa-ok-' });
  const ron = await communityUser('Ron');
  const paul = await communityUser('Paul');
  const bea = await communityUser('Bea');
  const sam = await communityUser('Sam');
  const nina = makeUser();
  const home = await shelfOf(olivia, 'Hausandacht');
  await joinShelf(rita, home);
  await joinShelf(ron, home);
  await joinShelf(paul, home, null);
  await joinShelf(bea, home, 'blocked');
  const spentBy = (user, mark) => stub.since(mark).filter((r) => r.key === user.elKey);

  let scripture; // an ElevenLabs voice for scripture, no limits (an approval shelf may)

  await check('19. an accepted reader narrates in the owner’s voice on the owner’s key — and a hit is free, to anyone', async () => {
    scripture = await shareVoice(home, freshV4(), { scope: 'scripture' });
    const mark = stub.requests.length;
    const r = await call(rita, 'tts.shared', sharedVerse(scripture));
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.cached, false);
    assert.equal(r.body.audioUrl, `${expectedBase(scripture.config, 'en', PSALM_117[0])}.mp3`, 'the owner’s and every reader’s cache, alike');
    const calls = stub.since(mark);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].key, olivia.elKey, 'the owner’s key paid');
    assert.equal(spentBy(rita, mark).length, 0, 'never the reader’s own');

    const again = stub.requests.length;
    for (const who of [rita, paul, nina]) {
      const hit = await call(who, 'tts.shared', sharedVerse(scripture));
      assert.equal(hit.status, 200, hit.text);
      assert.equal(hit.body.cached, true);
    }
    assert.equal(stub.requests.length, again, 'a hit needs no key, no membership, nothing');
    assert.equal(existsSync(userDir(nina)), false, 'and creates no account');
  });

  await check('20. pending, blocked, a stranger, no profile, a wrong code or room: one refusal, no upstream call', async () => {
    const mark = stub.requests.length;
    const refusal = { error: 'shared_voice_unavailable', payer: 'owner', itemId: scripture.item.id };
    const second = sharedVerse(scripture, { text: PSALM_117[1], verse: 2 });
    for (const who of [paul, bea, sam, nina]) {
      const r = await call(who, 'tts.shared', second);
      assert.equal(r.status, 403, `${who.displayName ?? 'nina'}: ${r.text}`);
      assert.deepEqual(r.body, refusal);
    }
    assert.equal(existsSync(userDir(nina)), false, 'still no account');

    // Another shelf's code, an unknown code, a malformed one, none at all.
    const other = await shelfOf(olivia, 'Andere');
    await joinShelf(rita, other);
    const unknown = mintSpaceCode(olivia.authorKey);
    for (const code of [other.code, unknown, 'not-a-code', '']) {
      const r = await call(rita, 'tts.shared', { ...second, shared: { code, itemId: scripture.item.id } });
      assert.deepEqual(r.body, refusal, code);
    }
    const bare = await call(rita, 'tts.shared', { ...second, shared: undefined });
    assert.deepEqual(bare.body, { ...refusal, itemId: null });
    const junk = await call(rita, 'tts.shared', { ...second, shared: { code: home.code, itemId: '../../x' } });
    assert.deepEqual(junk.body, { ...refusal, itemId: null }, 'an id is echoed only once it is a uuid');

    // A voice on a shelf Rita may not read, asked for with the code of one she may.
    const vault = await shelfOf(olivia, 'Tresor');
    const hidden = await shareVoice(vault, freshV4(), { scope: 'anything' });
    const cross = await call(rita, 'tts.shared', sharedVerse(hidden, { shared: { code: home.code, itemId: hidden.item.id } }));
    assert.deepEqual(cross.body, { ...refusal, itemId: hidden.item.id });

    // A shared plan is not a voice.
    const plan = await sharePlan(home);
    const notVoice = await call(rita, 'tts.shared', { ...second, shared: { code: home.code, itemId: plan.id } });
    assert.deepEqual(notVoice.body, { ...refusal, itemId: plan.id });

    assert.equal(stub.since(mark).length, 0, 'nothing reached ElevenLabs');
    assert.equal(existsSync(fileOf(`${expectedBase(scripture.config, 'en', PSALM_117[1])}.mp3`)), false);
  });

  await check('21. the voice asked for must be the voice shared — the reader’s copy may be stale', async () => {
    const mark = stub.requests.length;
    const stale = { ...scripture.config, stability: scripture.config.stability + 0.05 };
    const r = await call(rita, 'tts.shared', sharedVerse({ ...scripture, config: stale }, { text: PSALM_117[1], verse: 2 }));
    assert.equal(r.status, 409, r.text);
    assert.deepEqual(r.body, { error: 'shared_voice_mismatch', payer: 'owner', itemId: scripture.item.id });
    // Float noise is the same voice: quantized on both sides, like a cache key.
    const noisy = { ...scripture.config, stability: scripture.config.stability + 0.01 };
    const ok = await call(rita, 'tts.shared', sharedVerse({ ...scripture, config: noisy }, { text: PSALM_117[1], verse: 2 }));
    assert.equal(ok.status, 200, ok.text);
    assert.equal(stub.since(mark).length, 1);
  });

  await check('22. scripture: the verse exactly as this server reads it, and the app’s own announcements — nothing else', async () => {
    const voice = await shareVoice(home, freshV4(), { scope: 'scripture' });
    const out = (r) => assert.deepEqual(r.body, { error: 'shared_voice_out_of_scope', payer: 'owner', itemId: voice.item.id }, r.text);
    const mark = stub.requests.length;
    out(await call(rita, 'tts.shared', sharedVerse(voice, { text: 'O praise the LORD, all ye nations.' })));
    out(await call(rita, 'tts.shared', sharedVerse(voice, { text: PSALM_117[1] })), 'the text of another verse');
    out(await call(rita, 'tts.shared', sharedVerse(voice, { translation: 'ESV' })), 'a translation not on this server');
    out(await call(rita, 'tts.shared', sharedVerse(voice, { bookId: 999 })));
    for (const [text, language] of [
      ['Buy cheap watches now.', 'en'],
      ['Psalms, chapter 117, and then whatever I like', 'en'],
      ['Kill them all, chapter 1', 'en'],
      ['Psalms, chapter 117', 'de'],
    ]) {
      out(await call(rita, 'tts.speak.shared', sharedSpeak(voice, text, language)));
    }
    assert.equal(stub.since(mark).length, 0, 'refused before any call');

    const psalms = BOOKS.find((b) => b.id === 19);
    for (const [text, language] of [
      [`${psalms.nameEn}, chapter 117`, 'en'],
      [`${psalms.nameEn}, chapter 117, verses 1 to 2`, 'en'],
      [`${psalms.nameDe}, Kapitel 117, Vers 2`, 'de'],
      ['Verse 2', 'en'],
      ['2', 'en'],
    ]) {
      const r = await call(rita, 'tts.speak.shared', sharedSpeak(voice, text, language));
      assert.equal(r.status, 200, `${text}: ${r.text}`);
    }
    const verse = await call(rita, 'tts.shared', sharedVerse(voice));
    assert.equal(verse.status, 200, verse.text);
  });

  let piece; // Olivia's piece on the home shelf

  await check('23. pieces: the owner’s writing on that shelf — a heading, a whole paragraph, whole sentences of a long one', async () => {
    const long = `${germanParagraph()} Amen.`;
    assert.ok(Buffer.byteLength(long) > 3500);
    piece = await publishPiece(home, {
      title: 'Ein Morgen am Fluss',
      body: `Der Fluss war  still. Die Vögel sangen.\n\n\nIch dachte an Psalm 23.\n\n${long}`,
      language: 'de',
    });
    const elsewhere = await shelfOf(olivia, 'Woanders');
    await joinShelf(rita, elsewhere);
    await publishPiece(elsewhere, { title: 'Woanders', body: 'Nur hier zu lesen.', language: 'de' });

    const voice = await shareVoice(home, freshV4(), { scope: 'pieces' });
    const asks = (text) => call(rita, 'tts.speak.shared', sharedSpeak(voice, text, 'de'));
    const sentences = long.split(/(?<=[.!?][)\]"'”’»]?)\s+/);
    for (const text of [
      'Ein Morgen am Fluss. Von Olivia.', // the heading, as playbackPlan says it
      'Der Fluss war still. Die Vögel sangen.', // whitespace as postParagraphs folds it
      'Ich dachte an Psalm 23.',
      long, // a long paragraph whole
      sentences.slice(0, 3).join(' '), // or a run of its sentences
      sentences.slice(4, 6).join(' '),
      `${BOOKS.find((b) => b.id === 19).nameDe}, Kapitel 23`, // scripture's announcements stay allowed
    ]) {
      const r = await asks(text);
      assert.equal(r.status, 200, `${text.slice(0, 40)}: ${r.text}`);
    }
    const out = { error: 'shared_voice_out_of_scope', payer: 'owner', itemId: voice.item.id };
    const mark = stub.requests.length;
    for (const text of [
      'Die Vögel sangen.', // part of a short paragraph
      'Fluss war still.',
      sentences[0].split(' ').slice(1).join(' '), // a long paragraph, cut mid-sentence
      'Nur hier zu lesen.', // her writing, on another shelf
      'Ein Morgen am Fluss. Von Jemand Anderem.',
      'Ganz eigener Text.',
    ]) {
      assert.deepEqual((await asks(text)).body, out, text.slice(0, 40));
    }
    assert.equal(stub.since(mark).length, 0);

    // `scripture` refuses the same paragraph; `anything` takes any words at all.
    const strict = await call(rita, 'tts.speak.shared', sharedSpeak(scripture, 'Ich dachte an Psalm 23.', 'de'));
    assert.equal(strict.body.error, 'shared_voice_out_of_scope');
    const open = await shareVoice(home, freshV4(), { scope: 'anything' });
    const free = await call(rita, 'tts.speak.shared', sharedSpeak(open, 'Ganz eigener Text, von niemandem geschrieben.', 'de'));
    assert.equal(free.status, 200, free.text);
  });

  await check('24. allowances: the monthly pool and each reader’s day are charged before the call, never past the limit', async () => {
    const pooled = await shareVoice(home, freshV4(), { scope: 'anything', monthly: 120 });
    const asks = (who, text) => call(who, 'tts.speak.shared', sharedSpeak(pooled, text, 'en'));
    const budget = { error: 'shared_voice_budget', payer: 'owner', itemId: pooled.item.id };
    const sixty = 'Sixty characters exactly, give or take, for the pool test...';
    assert.equal(Array.from(sixty).length, 60);
    assert.equal((await asks(rita, sixty)).status, 200);
    assert.deepEqual(counter(olivia, pooled, 'pool.json'), { period: monthUtc(), used: 60 });
    const mark = stub.requests.length;
    assert.deepEqual((await asks(ron, 'x'.repeat(61) + ' — one character too many for what is left')).body, budget);
    assert.equal(stub.since(mark).length, 0, 'refused before any call');
    // A short text is charged the 50-character floor.
    assert.equal((await asks(ron, 'Amen.')).status, 200);
    assert.deepEqual(counter(olivia, pooled, 'pool.json'), { period: monthUtc(), used: 110 });
    assert.deepEqual((await asks(rita, 'Selah.')).body, budget, '110 + 50 is past 120');

    // A day's allowance is each reader's own.
    const daily = await shareVoice(home, freshV4(), { scope: 'anything', dailyPerReader: 100 });
    const day = (who, text) => call(who, 'tts.speak.shared', sharedSpeak(daily, text, 'en'));
    assert.equal((await day(rita, 'r'.repeat(100))).status, 200);
    assert.deepEqual((await day(rita, 'One more.')).body, { ...budget, itemId: daily.item.id });
    assert.equal((await day(ron, 'One more.')).status, 200, 'Ron’s day is his own');
    assert.deepEqual(counter(olivia, daily, `daily-${rita.userId}.json`), { period: dayUtc(), used: 100 });
    assert.deepEqual(counter(olivia, daily, `daily-${ron.userId}.json`), { period: dayUtc(), used: 50 });
    assert.equal(existsSync(join(sponsored(olivia, daily), 'pool.json')), false, 'a limit not set is not counted');

    // A hit is never charged, even with the allowance spent.
    assert.equal((await day(rita, 'r'.repeat(100))).body.cached, true);
  });

  await check('25. a shelf anyone can join needs a monthly pool before its readers may spend', async () => {
    const open = await shelfOf(olivia, 'Offen', 'auto');
    await joinShelf(ron, open, null); // auto-accepted
    const unlimited = await shareVoice(open, freshV4(), { scope: 'anything', dailyPerReader: 10000 });
    const mark = stub.requests.length;
    const r = await call(ron, 'tts.speak.shared', sharedSpeak(unlimited, 'Open shelf, no pool.', 'en'));
    assert.equal(r.status, 403, r.text);
    assert.deepEqual(r.body, { error: 'shared_voice_budget', payer: 'owner', itemId: unlimited.item.id });
    assert.equal(stub.since(mark).length, 0);
    const pooled = await shareVoice(open, freshV4(), { scope: 'anything', monthly: 5000 });
    assert.equal((await call(ron, 'tts.speak.shared', sharedSpeak(pooled, 'Open shelf, with a pool.', 'en'))).status, 200);

    // Switching an approval shelf to automatic later opens no hole: the
    // unlimited voice shared on it while it was manual stops spending.
    const manual = await shelfOf(olivia, 'Erst manuell');
    await joinShelf(rita, manual);
    const before = await shareVoice(manual, freshV4(), { scope: 'anything' });
    assert.equal((await call(rita, 'tts.speak.shared', sharedSpeak(before, 'Manual for now.', 'en'))).status, 200);
    await call(olivia, 'spaces.upsert', { space: { ...manual.space, approval: 'auto', updatedAt: Date.now() } });
    const after = await call(rita, 'tts.speak.shared', sharedSpeak(before, 'Automatic now.', 'en'));
    assert.equal(after.body.error, 'shared_voice_budget');
  });

  let oscar; // an owner whose key is slow: 0.7 s a narration

  await check('26. two readers missing the same entry cost one generation and one charge; the waiter pays nothing', async () => {
    oscar = await communityUser('Oscar', { elevenLabs: 'sk_slow_' });
    const slowShelf = await shelfOf(oscar, 'Langsam');
    await joinShelf(rita, slowShelf);
    await joinShelf(ron, slowShelf);
    const voice = await shareVoice(slowShelf, freshV4(), { scope: 'anything', monthly: 10000 });
    oscar.voice = voice;
    const text = 'Two of us asked for the same words at once, and only one of us paid for them.';
    const mark = stub.requests.length;
    const rs = await Promise.all([
      staggered(0, () => call(rita, 'tts.speak.shared', sharedSpeak(voice, text, 'en'))),
      staggered(100, () => call(ron, 'tts.speak.shared', sharedSpeak(voice, text, 'en'))),
      staggered(200, () => call(rita, 'tts.speak.shared', sharedSpeak(voice, text, 'en'))),
    ]);
    for (const r of rs) assert.equal(r.status, 200, r.text);
    assert.deepEqual(rs.map((r) => r.body.cached), [false, true, true]);
    assert.equal(stub.since(mark).length, 1, 'one generation');
    assert.deepEqual(counter(oscar, voice, 'pool.json'), { period: monthUtc(), used: charge(text) }, 'one charge');
    assert.deepEqual(workFiles(), []);
  });

  await check('27. at most two of an owner’s generations at once; one kept waiting is busy, and is not charged', async () => {
    const voice = oscar.voice;
    const asks = (delay, n) => staggered(delay, () => call(rita, 'tts.speak.shared', sharedSpeak(voice, `Slot test number ${n}, said once.`, 'en')));
    const rs = await Promise.all([asks(0, 1), asks(100, 2), asks(200, 3), asks(300, 4)]);
    for (const r of rs) assert.equal(r.status, 200, r.text);
    assert.equal(stub.peak(oscar.elKey), 2, 'never more than two at the owner’s key');

    const before = counter(oscar, voice, 'pool.json').used;
    setSecrets({ lines: ["define('SPONSOR_SLOT_WAIT_SECONDS', 0.2);"] });
    try {
      const burst = await Promise.all([asks(0, 5), asks(100, 6), asks(200, 7)]);
      const busy = burst.filter((r) => r.status === 503);
      assert.ok(busy.length >= 1, burst.map((r) => r.status).join(' / '));
      for (const r of busy) {
        assert.deepEqual(r.body, { error: 'shared_voice_busy', payer: 'owner', itemId: voice.item.id });
        assert.equal(r.headers.get('retry-after'), '2');
      }
      // Each is under the 50-character floor, so each that ran was charged 50
      // — and none that was turned away.
      const done = burst.filter((r) => r.status === 200).length;
      assert.equal(counter(oscar, voice, 'pool.json').used, before + done * 50);
    } finally {
      setSecrets();
    }
    assert.deepEqual(workFiles(), []);
  });

  await check('28. the owner’s failures say only whether they will last — no detail, no provider, no refund once paid', async () => {
    const owners = {
      // A key ElevenLabs refuses cannot be stored through the API: it is planted.
      refused: await communityUser('Boris', { elevenLabs: 'sk_bad_', plant: true }),
      broke: await communityUser('Bruno', { elevenLabs: 'sk_broke_' }),
      busy: await communityUser('Bianca', { elevenLabs: 'sk_busy_' }),
      keyless: await communityUser('Nora'),
    };
    const verdicts = { refused: 'shared_voice_unavailable', broke: 'shared_voice_unavailable', busy: 'shared_voice_busy', keyless: 'shared_voice_unavailable' };
    for (const [name, owner] of Object.entries(owners)) {
      const shelf = await shelfOf(owner, `Regal ${name}`);
      await joinShelf(rita, shelf);
      const voice = await shareVoice(shelf, freshV4(), { scope: 'anything', monthly: 1000 });
      const r = await call(rita, 'tts.speak.shared', sharedSpeak(voice, `Owner ${name}, please read this.`, 'en'));
      assert.deepEqual(r.body, { error: verdicts[name], payer: 'owner', itemId: voice.item.id }, `${name}: ${r.text}`);
      assert.equal(r.status, name === 'busy' ? 503 : 403);
      // Nothing came back, so nothing stays charged.
      assert.equal(counter(owner, voice, 'pool.json')?.used ?? 0, 0, `${name}: refunded`);
    }
    // A voice gone from the owner's library is theirs to fix, not a provider code.
    const gone = await shareVoice(home, { ...freshV4(), voiceId: 'FaultVoiceNotFound01' }, { scope: 'anything' });
    const g = await call(rita, 'tts.speak.shared', sharedSpeak(gone, 'A voice that is not there.', 'en'));
    assert.deepEqual(g.body, { error: 'shared_voice_unavailable', payer: 'owner', itemId: gone.item.id });

    // A long text whose first chunk came back before the second failed was
    // paid for: the charge stands.
    const half = await shareVoice(home, { ...freshV4(), voiceId: SECOND_CHUNK_FAILS_VOICE }, { scope: 'anything', monthly: 100000 });
    const long = germanParagraph();
    const h = await call(rita, 'tts.speak.shared', sharedSpeak(half, long, 'de'));
    assert.deepEqual(h.body, { error: 'shared_voice_busy', payer: 'owner', itemId: half.item.id }, h.text);
    assert.equal(counter(olivia, half, 'pool.json').used, Array.from(long).length);
    assert.deepEqual(workFiles(), []);
  });

  await check('29. removing, blocking, a new code, deleting the shelf or the profile — each revokes at once', async () => {
    const olga = await communityUser('Olga', { elevenLabs: 'sk_ok_' });
    const shelf = await shelfOf(olga, 'Widerruf');
    await joinShelf(rita, shelf);
    let voice = await shareVoice(shelf, freshV4(), { scope: 'anything', monthly: 100000 });
    let n = 0;
    const asks = (ref = voice.ref) => call(rita, 'tts.speak.shared', sharedSpeak({ ...voice, ref }, `Revocation test ${++n}.`, 'en'));
    const refused = async (why) => {
      const r = await asks();
      assert.equal(r.body?.error, 'shared_voice_unavailable', `${why}: ${r.text}`);
    };
    assert.equal((await asks()).status, 200);

    await call(olga, 'members.decide', { userId: rita.userId, spaceId: shelf.id, status: 'blocked' });
    await refused('blocked');
    await call(olga, 'members.decide', { userId: rita.userId, spaceId: shelf.id, status: 'accepted' });
    assert.equal((await asks()).status, 200);

    assert.ok(existsSync(sponsored(olga, voice)));
    await call(olga, 'items.delete', { id: voice.item.id, spaceId: shelf.id });
    await refused('removed');
    assert.equal(existsSync(sponsored(olga, voice)), false, 'its counters went with it');

    voice = await shareVoice(shelf, voice.config, { scope: 'anything', monthly: 100000 });
    assert.equal((await asks()).status, 200, 'shared again: a new item, a fresh allowance');

    const fresh = mintSpaceCode(olga.authorKey);
    await call(olga, 'spaces.code.set', { spaceId: shelf.id, code: fresh });
    await refused('the old code');
    const viaNew = await asks({ code: fresh, itemId: voice.item.id });
    assert.equal(viaNew.body.error, 'shared_voice_unavailable', 'a new code starts over on who may read');

    const kept = await shelfOf(olga, 'Noch da');
    await joinShelf(rita, kept);
    const keptVoice = await shareVoice(kept, freshV4(), { scope: 'anything', monthly: 100000 });
    await call(olga, 'spaces.delete', { id: shelf.id });
    await refused('the shelf deleted');
    const k = await call(rita, 'tts.speak.shared', sharedSpeak(keptVoice, 'Before leaving.', 'en'));
    assert.equal(k.status, 200);
    await call(olga, 'profile.delete', {});
    const left = await call(rita, 'tts.speak.shared', sharedSpeak(keptVoice, 'After leaving.', 'en'));
    assert.equal(left.body.error, 'shared_voice_unavailable', 'the owner left the community');
    assert.equal(existsSync(join(userDir(olga), 'sponsored')), false);
  });

  await check('30. OpenAI: a shared voice spends the owner’s key — one generation under concurrency, failures scrubbed', async () => {
    const nova = { provider: 'openai', voice: 'nova', style: 'Calm and warm, unhurried.' };
    const voice = await shareVoice(home, nova, { scope: 'anything' });
    const mark = openAi.requests.length;
    const r = await call(rita, 'tts.speak.shared', oaSpeak(voice, 'The LORD is my shepherd.', 'en'));
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.cached, false);
    const calls = openAi.since(mark);
    assert.deepEqual(calls.map((c) => c.path), ['/v1/audio/speech', '/v1/audio/transcriptions']);
    for (const c of calls) assert.equal(c.auth, `Bearer ${olivia.oaKey}`, 'the owner’s OpenAI key, for speech and alignment');
    assert.equal(calls[0].body.voice, 'nova');
    assert.match(calls[0].body.instructions, /Calm and warm/);
    const mp3 = fileOf(r.body.audioUrl);
    assert.equal((statSync(mp3).mode & 0o777).toString(8), '644', 'published world-readable');
    assert.equal(JSON.parse(readFileSync(fileOf(r.body.alignmentUrl), 'utf8')).words[0].word, 'stub');

    // A verse, by the same rules as ElevenLabs.
    const holy = await shareVoice(home, { provider: 'openai', voice: 'cedar', style: '' }, { scope: 'scripture' });
    const v = await call(rita, 'tts.shared', oaVerse(holy));
    assert.equal(v.status, 200, v.text);
    assert.equal((await call(rita, 'tts.shared', oaVerse(holy, { text: 'Not the verse.' }))).body.error, 'shared_voice_out_of_scope');

    // The ElevenLabs treatment: three listeners, one generation.
    const ophelia = await communityUser('Ophelia', { openAi: 'sk-oa-slow-' });
    const shelf = await shelfOf(ophelia, 'Ophelias Regal');
    await joinShelf(rita, shelf);
    await joinShelf(ron, shelf);
    const slow = await shareVoice(shelf, { provider: 'openai', voice: 'sage', style: '' }, { scope: 'anything' });
    const text = 'Three listeners, one generation.';
    const before = openAi.requests.length;
    const rs = await Promise.all([0, 100, 200].map((d, i) => staggered(d, () => call(i === 1 ? ron : rita, 'tts.speak.shared', oaSpeak(slow, text, 'en')))));
    for (const x of rs) assert.equal(x.status, 200, x.text);
    assert.deepEqual(rs.map((x) => x.body.cached), [false, true, true]);
    assert.equal(openAi.since(before).filter((c) => c.path === '/v1/audio/speech').length, 1);
    assert.deepEqual(workFiles(), []);

    // An owner's key OpenAI refuses: the reader learns it will last, and nothing
    // of OpenAI's message — which quotes part of the key.
    for (const [prefix, error, status] of [['sk-oa-bad-', 'shared_voice_unavailable', 403], ['sk-oa-broke-', 'shared_voice_unavailable', 403]]) {
      const owner = await communityUser(`Owner ${prefix}`, { openAi: prefix, plant: true });
      const s = await shelfOf(owner, `Regal ${prefix}`);
      await joinShelf(rita, s);
      const bad = await shareVoice(s, { provider: 'openai', voice: 'ash', style: '' }, { scope: 'anything' });
      const b = await call(rita, 'tts.speak.shared', oaSpeak(bad, `Refused for ${prefix}.`, 'en'));
      assert.equal(b.status, status, b.text);
      assert.deepEqual(b.body, { error, payer: 'owner', itemId: bad.item.id });
    }

    // The plain path is unchanged: Rita's own key pays for her own voice.
    const own = openAi.requests.length;
    const mine = await call(rita, 'tts.speak', { text: 'My own voice, my own key.', voice: 'alloy', language: 'en' });
    assert.equal(mine.status, 200, mine.text);
    assert.ok(openAi.since(own).every((c) => c.auth === `Bearer ${rita.oaKey}`));
  });

  await check('31. no ElevenLabs request carried Authorization, no OpenAI one the shared key; no answer quoted a key', () => {
    for (const r of stub.requests) {
      assert.equal('authorization' in r.headers, false, `${r.path} carried Authorization`);
      assert.match(r.key ?? '', /^sk_[a-z]+_[0-9a-f]+$/, `${r.path} without an ElevenLabs key`);
    }
    assert.ok(openAi.requests.length >= 8, `${openAi.requests.length} OpenAI requests seen`);
    for (const r of openAi.requests) {
      assert.match(r.auth ?? '', /^Bearer sk-oa-[a-z]+-[0-9a-f]+$/, `${r.path} without a user's own key`);
    }
    for (const text of answered) {
      for (const key of [...ALL_KEYS, CANARY]) assert.equal(text.includes(key), false, 'a full key in an answer');
      assert.equal(/Incorrect API key|sk-oa-bad-[0-9a-f]{4}/.test(text), false, 'OpenAI’s message reached a reader');
    }
  });

  console.log('the converter');

  await check('character timings become exactly wordTokens(text), for the texts that are hard', () => {
    const timingsOf = (spoken) => {
      const chars = Array.from(spoken);
      return {
        characters: chars,
        character_start_times_seconds: chars.map((_, i) => charStart(i)),
        character_end_times_seconds: chars.map((_, i) => charEnd(i)),
      };
    };
    const one = (text, spoken = text, { from = 0, quality = 'exact', sentAs } = {}) => ({
      text,
      spoken: sentAs,
      quality,
      segments: [{ from, to: Array.from(text).length, alignment: timingsOf(spoken), offset: 0 }],
      duration: 30,
    });
    const D1 = 1.5;
    const cases = {
      'KJV': one(PSALM_117[0]),
      'Luther, with umlauts': one('Lobet den HERRN, alle Heiden! Preiset ihn, alle Völker!'),
      '„…“ quotes, — and …': one('Er sprach: „Fürchtet euch nicht!“ — und ging … weiter.'),
      'NBSP and NNBSP split, as in JavaScript': one('Psalm 117 um 3 Uhr'),
      'U+0085 joins and U+FEFF splits (JavaScript, not PCRE)': one('eins\u0085zwei drei﻿vier'),
      'a decomposed ü against a precomposed one': one('Grüße an alle Brüder', 'Grüße an alle Brüder', { quality: 'repaired' }),
      'swapped quotes': one('„Halt!“, rief er.', '"Halt!", rief er.', { quality: 'repaired' }),
      'a different case': one('the LORD is good', 'the Lord is good', { quality: 'repaired' }),
      'an ellipsis spelled out': one('und ging … weiter', 'und ging ... weiter', { quality: 'repaired' }),
      'a leading space': { ...one(' Am Anfang', 'Am Anfang', { from: 1 }) },
      'a trailing space': one('Amen. '),
      'emoji': one('Freude 😊 und 👍🏽 Frieden'),
      'brackets sent as parentheses': one('Er sprach [leise].', 'Er sprach (leise).', { sentAs: 'Er sprach (leise).' }),
      'two chunks': {
        text: 'Erster Satz hier. Zweiter Satz dort.',
        quality: 'exact',
        segments: [
          { from: 0, to: 17, alignment: timingsOf('Erster Satz hier.'), offset: 0 },
          { from: 18, to: 36, alignment: timingsOf('Zweiter Satz dort.'), offset: D1 },
        ],
        duration: 3,
      },
      'speech that matches nothing': one('Hello wonderful world', 'Xyzzy qwrtpsdfgh plugh', { quality: 'proportional' }),
      'a chunk without timings': {
        text: 'Erster Satz hier. Zweiter Satz dort.',
        quality: 'proportional',
        segments: [
          { from: 0, to: 17, alignment: timingsOf('Erster Satz hier.'), offset: 0, duration: D1 },
          { from: 18, to: 36, alignment: null, offset: D1, duration: 1.2 },
        ],
        duration: D1 + 1.2,
      },
      'no timings at all': { text: 'Kein Wort.', quality: 'none', segments: [{ from: 0, to: 10, alignment: null, offset: 0 }], duration: 1 },
    };
    const names = Object.keys(cases);
    const run = spawnSync(
      'php',
      [
        '-d', 'opcache.enable_cli=0',
        '-r',
        '$in = json_decode(stream_get_contents(STDIN), true); require getenv("BA_API_PHP"); $out = [];' +
          ' foreach ($in as $c) $out[] = elevenLabsWords($c["text"], $c["segments"], (float)$c["duration"], $c["spoken"] ?? null);' +
          ' echo json_encode($out, JSON_UNESCAPED_UNICODE);',
      ],
      {
        input: JSON.stringify(names.map((n) => cases[n])),
        env: { ...process.env, BA_API_PHP: join(root, 'api.php'), OPENAI_API_KEY: '' },
        encoding: 'utf8',
      },
    );
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const results = JSON.parse(run.stdout);
    names.forEach((name, i) => {
      const { text, quality, segments, duration } = cases[name];
      const got = results[i];
      assert.equal(got.quality, quality, `${name}: quality`);
      if (quality === 'none') {
        assert.deepEqual(got.words, [], name);
        return;
      }
      assert.deepEqual(got.words.map((w) => w.word), expectedWords(text), `${name}: the words`);
      assertTimeline(got.words, duration);
      if (quality === 'exact' && segments.length === 1) {
        assert.deepEqual(got.words.map((w) => w.start), expectedStarts(text, { from: segments[0].from }), `${name}: the starts`);
      }
    });
    // Across a chunk boundary the timings carry the real offset.
    const twoChunks = results[names.indexOf('two chunks')];
    assert.equal(twoChunks.words[3].word, 'Zweiter');
    assert.equal(twoChunks.words[3].start, round3(D1 + charStart(0)));
    // A chunk ElevenLabs gave no timings for is spread over its own audio.
    const untimed = results[names.indexOf('a chunk without timings')];
    assert.ok(untimed.words[3].start >= D1 && untimed.words.at(-1).end <= D1 + 1.2 + 1e-9);
    // A leading space is the placeholder wordTokens counts as word 0.
    assert.deepEqual(results[names.indexOf('a leading space')].words[0], { word: ' ', start: 0, end: 0 });
  });

  await check('the new handler files say nothing when fetched directly', async () => {
    for (const name of ['voices.php', 'elevenlabs.php', 'sponsorship.php', 'announcements.php']) {
      const res = await fetch(`${BASE}/api/${name}`);
      assert.equal(res.status, 404, name);
      assert.equal(await res.text(), '', name);
    }
  });

  await check('the backend logged no PHP warning, notice or deprecation', () => {
    const noise = phpErr.split('\n').filter((l) => /PHP (Warning|Notice|Deprecated|Fatal|Parse)|^(Warning|Notice|Deprecated|Fatal error):/.test(l));
    assert.deepEqual(noise, []);
  });

  console.log(`\n${checks} checks passed`);
} finally {
  stopPhp();
  await stub.close();
  await openAi.close();
  rmSync(root, { recursive: true, force: true });
}
