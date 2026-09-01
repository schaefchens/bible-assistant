/**
 * Assert the properties post signatures are supposed to have.
 *
 * There is no test runner in this project — `npm run build` is the correctness
 * gate — so this follows `bible:verify`'s pattern: a node script that asserts
 * invariants and exits non-zero. It imports the real modules rather than
 * re-deriving them, which is why `lib/postSignature.ts` and `lib/spaceCode.ts`
 * deliberately import nothing from the app.
 *
 * Run: npm run community:verify
 */
import assert from 'node:assert/strict';
import { generateMnemonic, mnemonicToSeedSync } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import {
  canonicalPostMessage,
  deriveSigningKey,
  signPostWith,
  verifyPost,
} from '../../src/lib/postSignature.ts';
import { postParagraphs, postToUnits } from '../../src/services/community/postUnits.ts';
import {
  codeMatchesKey,
  formatSpaceCode,
  keyFingerprint,
  mintSpaceCode,
  normalizeSpaceCode,
  SPACE_CODE_LEN,
} from '../../src/lib/spaceCode.ts';

const bytesToHex = (b) => Buffer.from(b).toString('hex');
let checks = 0;
const check = (name, fn) => {
  fn();
  checks++;
  console.log(`  ok  ${name}`);
};

const mnemonic = generateMnemonic(wordlist, 128);
const pair = deriveSigningKey(mnemonic);
const keyHex = bytesToHex(pair.publicKey);

const post = {
  id: 'e3b0c442-0000-4000-8000-000000000001',
  spaceId: 'e3b0c442-0000-4000-8000-0000000000aa',
  title: 'Ein Morgen am Fluss',
  body: 'Zeile eins.\n\nZeile zwei.',
  language: 'de',
  publishedAt: 1_700_000_000_000,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
};

const signed = { ...post, ...signPostWith(post, pair) };

console.log('signing');

check('the same mnemonic derives the same key (multi-device publishing)', () => {
  assert.equal(bytesToHex(deriveSigningKey(mnemonic).publicKey), keyHex);
});

check('a different mnemonic derives a different key', () => {
  assert.notEqual(bytesToHex(deriveSigningKey(generateMnemonic(wordlist, 128)).publicKey), keyHex);
});

check('the signing key is unrelated to the account credential', () => {
  // Both come from the same 64-byte seed, so domain separation is the only
  // thing keeping them apart. These are the slices passphrase.ts uses for
  // userId and userSecret; the signing key must be none of them, and must not
  // be the leftover [48..64] either.
  const seed = mnemonicToSeedSync(mnemonic);
  const secretHex = bytesToHex(pair.secretKey);
  for (const [from, to] of [[0, 16], [16, 48], [48, 64], [0, 32], [32, 64]]) {
    assert.notEqual(secretHex, bytesToHex(seed.slice(from, to)));
  }
  assert.equal(secretHex.includes(bytesToHex(seed.slice(48, 64))), false);
});

check('a freshly signed post verifies against its own key', () => {
  assert.equal(verifyPost(signed, keyHex), true);
});

check('an edited body is rejected', () => {
  assert.equal(verifyPost({ ...signed, body: 'Zeile eins.\n\nZeile drei.' }, keyHex), false);
});

check('an edited title is rejected', () => {
  assert.equal(verifyPost({ ...signed, title: 'Ein Abend am Fluss' }, keyHex), false);
});

check('a rolled-back updatedAt is rejected', () => {
  assert.equal(verifyPost({ ...signed, updatedAt: post.updatedAt - 1 }, keyHex), false);
});

check('a post moved into another space is rejected', () => {
  assert.equal(verifyPost({ ...signed, spaceId: 'other' }, keyHex), false);
});

check('a post re-id-ed is rejected', () => {
  assert.equal(verifyPost({ ...signed, id: 'other' }, keyHex), false);
});

check('a signature lifted onto another author is rejected', () => {
  const other = deriveSigningKey(generateMnemonic(wordlist, 128));
  const otherKeyHex = bytesToHex(other.publicKey);
  // Claiming the other key with our signature, and claiming ours while the
  // subscriber pinned theirs, must both fail.
  assert.equal(verifyPost({ ...signed, authorKey: otherKeyHex }, otherKeyHex), false);
  assert.equal(verifyPost(signed, otherKeyHex), false);
});

check('an unsigned post is rejected', () => {
  assert.equal(verifyPost(post, keyHex), false);
});

check('an unknown canonicalization version is rejected', () => {
  assert.equal(verifyPost({ ...signed, sigVersion: 'ba.post.v2' }, keyHex), false);
});

check('malformed hex is rejected rather than thrown', () => {
  assert.equal(verifyPost({ ...signed, signature: 'zz' }, keyHex), false);
});

check('fields cannot be forged by stuffing a delimiter into another', () => {
  const a = canonicalPostMessage({ ...post, title: 'A', body: 'B' }, keyHex);
  const b = canonicalPostMessage({ ...post, title: 'A\nB', body: '' }, keyHex);
  assert.notEqual(Buffer.from(a).toString(), Buffer.from(b).toString());
});

console.log('share codes');

check('a minted code is the documented length and shape', () => {
  const code = mintSpaceCode(keyHex);
  assert.equal(code.length, SPACE_CODE_LEN);
  assert.match(code, /^[0-9A-HJKMNP-TV-Z]+$/);
  assert.equal(formatSpaceCode(code), `${code.slice(0, 5)}-${code.slice(5, 10)}-${code.slice(10)}`);
});

check('a code commits to its own key and to no other', () => {
  const code = mintSpaceCode(keyHex);
  assert.equal(codeMatchesKey(code, keyHex), true);
  const other = bytesToHex(deriveSigningKey(generateMnemonic(wordlist, 128)).publicKey);
  assert.equal(codeMatchesKey(code, other), false);
});

check('a tampered fingerprint half stops matching', () => {
  const code = mintSpaceCode(keyHex);
  const swapped = code.slice(0, -1) + (code.at(-1) === '0' ? '1' : '0');
  assert.equal(codeMatchesKey(swapped, keyHex), false);
});

check('two codes for the same key differ in the capability half', () => {
  const a = mintSpaceCode(keyHex);
  const b = mintSpaceCode(keyHex);
  assert.notEqual(a.slice(0, 10), b.slice(0, 10));
  assert.equal(a.slice(10), b.slice(10));
});

check('normalizing folds separators, case and look-alikes', () => {
  const code = mintSpaceCode(keyHex);
  assert.equal(normalizeSpaceCode(formatSpaceCode(code).toLowerCase()), code);
  assert.equal(normalizeSpaceCode(` ${formatSpaceCode(code)} `), code);
  assert.equal(normalizeSpaceCode('IL'.padEnd(SPACE_CODE_LEN, '0')), '11'.padEnd(SPACE_CODE_LEN, '0'));
  assert.equal(normalizeSpaceCode('O'.padEnd(SPACE_CODE_LEN, '0')), '0'.padEnd(SPACE_CODE_LEN, '0'));
});

check('a wrong-length or out-of-alphabet code is refused', () => {
  assert.equal(normalizeSpaceCode('ABC'), null);
  assert.equal(normalizeSpaceCode('!'.padEnd(SPACE_CODE_LEN, '0')), null);
});

check('the fingerprint is stable and 6 characters', () => {
  assert.equal(keyFingerprint(keyHex), keyFingerprint(keyHex));
  assert.equal(keyFingerprint(keyHex).length, 6);
});

check('the code alphabet has no ambiguous letters', () => {
  const code = mintSpaceCode(keyHex);
  assert.doesNotMatch(code, /[ILOU]/);
});

console.log('post units');

const units = (body, title = 'T') =>
  postToUnits({ ...post, body, title }, 'space-1', 'Alice');

check('one unit per authored paragraph, blanks collapsed', () => {
  const u = units('Eins.\n\nZwei.\n\n\n\nDrei.\n');
  assert.deepEqual(u.map((x) => x.text), ['Eins.', 'Zwei.', 'Drei.']);
  assert.deepEqual(u.map((x) => x.verse), [1, 2, 3]);
  assert.deepEqual(u.map((x) => x.unit.index), [0, 1, 2]);
});

check('a unit is marked non-scripture and carries no book', () => {
  const [u] = units('Eins.');
  assert.equal(u.bookId, 0);
  assert.equal(u.chapter, 0);
  assert.equal(u.unit.kind, 'post');
  assert.equal(u.unit.title, 'T');
  assert.equal(u.unit.author, 'Alice');
});

check('the voice language follows the post, not the reader', () => {
  assert.equal(postToUnits({ ...post, language: 'de' }, 's', 'A')[0].translation, 'LUT');
  assert.equal(postToUnits({ ...post, language: 'en' }, 's', 'A')[0].translation, 'KJV');
});

check('chunking is deterministic — it is a cache key', () => {
  const body = 'Eins. Zwei.\n\nDrei vier fünf.';
  assert.deepEqual(
    units(body).map((u) => u.text),
    units(body).map((u) => u.text),
  );
});

check('an empty body yields no units rather than one blank one', () => {
  assert.deepEqual(units('   \n\n  '), []);
});

check('every unit fits the tts.speak byte cap', () => {
  // Umlauts are two bytes each, so a character-based cap would pass this and a
  // byte-based one is what api.php actually enforces.
  const long = ('Schöne Grüße über Flüsse. ').repeat(400);
  const parts = postParagraphs(long);
  assert.ok(parts.length > 1, 'expected the paragraph to be split');
  for (const part of parts) {
    assert.ok(new TextEncoder().encode(part).length <= 3500, `chunk too long: ${part.length}`);
  }
  assert.equal(parts.join(' ').replace(/\s+/g, ' ').trim(), long.replace(/\s+/g, ' ').trim());
});

check('a single unbroken run longer than the cap is still cut', () => {
  const parts = postParagraphs('x'.repeat(9000));
  assert.ok(parts.length >= 3);
  for (const part of parts) assert.ok(new TextEncoder().encode(part).length <= 3500);
  assert.equal(parts.join(''), 'x'.repeat(9000));
});

check('rendered text and spoken text are the same string', () => {
  // The whole reason posts are plain text: WordHighlighter re-splits this exact
  // string to build its word index space.
  for (const u of units('Eins zwei.\n\nDrei.')) {
    assert.equal(u.text.trim(), u.text);
    assert.doesNotMatch(u.text, /\n/);
  }
});

console.log(`\n${checks} checks passed`);
