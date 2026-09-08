import { sha256 } from '@noble/hashes/sha2.js';
import { hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';

/**
 * A share code is a space's **address**, not its key.
 *
 * It exists so an author can say "here, read this" over WhatsApp or out loud —
 * it locates the space, the way a URL does. It does not grant anything:
 * `space.feed` answers only a member the owner has **accepted**, so holding a
 * code buys you the ability to *ask*. Access control is the accept/deny, and
 * nothing else.
 *
 * Two consequences worth keeping straight, because they pull in opposite
 * directions:
 *
 * - Since the code is not the gate, it does not have to be a secret, and
 *   human-chosen names (`christoph/gedanken`) are a sensible thing to add
 *   later. {@link normalizeSpaceCode} is the one place that decides what a
 *   code may look like — widen it there and in api.php's `normalizeShareCode`
 *   together, since the server turns a code into a filename.
 * - Guessing a code is still not free of consequence: it reveals the space's
 *   name and its owner's display name (the reply to `space.request`, so the
 *   asker knows what they just asked to join), and for a space set to
 *   *auto*-approval it does grant read access, because that setting is the
 *   owner saying the code is enough. So a generated code carries ~50 bits.
 *
 * Generated codes look like:
 *
 *   XXXXX-XXXXX-XXXXXX
 *   └──── 10 ────┘└─6─┘
 *
 * The trailing 6 characters are a fingerprint of the author's public signing
 * key. That is an **integrity check, not an access check**: a signature only
 * proves "whoever holds this key wrote this", and the code travels over a
 * channel the server does not control, so a code that commits to the key lets
 * the subscriber confirm the key it is about to pin belongs to the person who
 * sent the code. Strictly better than trust-on-first-use, for six characters.
 *
 * It is deliberately optional. A code with no fingerprint — a future named one
 * — pins on first contact instead, and the author's fingerprint is shown in
 * Settings so two people can still compare it by hand if they care.
 *
 * Crockford base32 throughout: no I, L, O or U, so nothing is ambiguous read
 * aloud or typed, and `normalizeSpaceCode` folds the look-alikes.
 */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const RANDOM_LEN = 10;
const FINGERPRINT_LEN = 6;

/** The length of a *generated* code. A named code is not this shape. */
export const SPACE_CODE_LEN = RANDOM_LEN + FINGERPRINT_LEN;

const GENERATED_CODE = /^[0-9A-HJKMNP-TV-Z]{16}$/;

const KEY_FINGERPRINT_DOMAIN = 'ba.key.v1';

function encode(bytes: Uint8Array, chars: number): string {
  let out = '';
  for (let i = 0; i < chars; i++) {
    // One byte per character: 5 of its 8 bits. Wasteful, but 256 is a multiple
    // of 32, so there is no modulo bias to reason about.
    out += ALPHABET[bytes[i % bytes.length]! % ALPHABET.length];
  }
  return out;
}

/**
 * The six characters that commit to `authorKeyHex`.
 *
 * Also shown on its own in Settings, so two people can compare fingerprints
 * directly rather than trusting the code's journey.
 */
export function keyFingerprint(authorKeyHex: string): string {
  const digest = sha256(
    new Uint8Array([...utf8ToBytes(KEY_FINGERPRINT_DOMAIN), ...hexToBytes(authorKeyHex)]),
  );
  return encode(digest, FINGERPRINT_LEN);
}

/** Mint a fresh code for a space owned by the holder of `authorKeyHex`. */
export function mintSpaceCode(authorKeyHex: string): string {
  const random = new Uint8Array(RANDOM_LEN);
  crypto.getRandomValues(random);
  return encode(random, RANDOM_LEN) + keyFingerprint(authorKeyHex);
}

/**
 * Fold a pasted code into its canonical form: upper case, no separators, and
 * the three look-alikes Crockford maps away (`I`/`L` → `1`, `O` → `0`).
 * Returns null if what is left is not a code we recognize.
 *
 * **The one gate on code shape.** Named codes go here — and in api.php's
 * `normalizeShareCode`, which builds a filename out of the result.
 */
export function normalizeSpaceCode(input: string): string | null {
  const folded = input
    .toUpperCase()
    .replace(/[\s.\-_]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');
  return GENERATED_CODE.test(folded) ? folded : null;
}

/** `XXXXX-XXXXX-XXXXXX` — for display and for the share sheet. */
export function formatSpaceCode(code: string): string {
  if (!codeCarriesFingerprint(code)) return code;
  return `${code.slice(0, 5)}-${code.slice(5, 10)}-${code.slice(10)}`;
}

/**
 * Pull a share code out of whatever the user pasted.
 *
 * People do not paste tidy codes. They paste the whole message they were sent
 * ("Halo\n9QQ5Z-41JCR-6YPV33" — the share sheet's own format), or a link, in
 * either of the two shapes a link can take:
 *
 *   9QQ5Z-41JCR-6YPV33
 *   9qq5z 41jcr 6ypv33
 *   https://bibleassistant.apps.schaefchens.de/join/9QQ5Z-41JCR-6YPV33
 *   bibleassistant://join/9QQ5Z-41JCR-6YPV33
 *   Halo
 *   9QQ5Z-41JCR-6YPV33
 *
 * Two passes, and the order matters. First the whole input goes through
 * {@link normalizeSpaceCode}, which is what keeps a code typed with spaces
 * ("9QQ5Z 41JCR 6YPV33") working — tokenizing first would split it. Only if
 * that fails is the input broken into candidates and each tried.
 *
 * The split characters are the ones a code cannot contain. `-`, `.` and `_` are
 * deliberately **not** among them: they appear *inside* a formatted code, and
 * splitting on them would shatter every code into three useless pieces.
 *
 * Note it cannot simply strip everything outside the alphabet and look for a
 * 16-character run: `join`, `https` and `bibleassistant` are all made of
 * alphabet or foldable characters, so that approach happily splices URL text
 * into a plausible-looking code.
 *
 * Tolerant here and nowhere else. `normalizeSpaceCode` stays strict, and so
 * does api.php's `normalizeShareCode` — the server receives a code from our own
 * client, not from a human.
 */
const MAX_INPUT = 2000;
const NOT_IN_A_CODE = /[\s/:?#&=,;<>()"'[\]{}|\\!*+$@%^~`]+/;

export function parseSpaceCodeInput(input: string): string | null {
  const trimmed = input.slice(0, MAX_INPUT);

  // Whole input first: handles a bare code however it is spaced or cased.
  const whole = normalizeSpaceCode(trimmed);
  if (whole) return whole;

  for (const candidate of trimmed.split(NOT_IN_A_CODE)) {
    if (candidate === '') continue;
    const code = normalizeSpaceCode(candidate);
    if (code) return code;
  }
  return null;
}

/**
 * Does this code commit to a key at all?
 *
 * True for a generated code, false for anything else. A caller that gets
 * `false` has nothing to verify against and pins on first contact.
 */
export function codeCarriesFingerprint(code: string): boolean {
  return GENERATED_CODE.test(code);
}

/**
 * Does `code` commit to `authorKeyHex`?
 *
 * **Vacuously true for a code that carries no fingerprint** — there is nothing
 * to check, not a check that failed. Callers must not read a `true` here as
 * "this key is confirmed"; use {@link codeCarriesFingerprint} when the
 * difference matters, as `communityStore.subscribe` does.
 *
 * A real mismatch means the key the server offered is not the key held by the
 * person who gave you the code, which has no benign reading.
 */
export function codeMatchesKey(code: string, authorKeyHex: string): boolean {
  if (!codeCarriesFingerprint(code)) return true;
  return code.slice(RANDOM_LEN) === keyFingerprint(authorKeyHex);
}
