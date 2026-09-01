import { sha256 } from '@noble/hashes/sha2.js';
import { hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';

/**
 * A share code is the *only* way to name a space — api.php never takes a
 * target user id — so it is both the capability that grants read access and
 * the channel that says whose writing you are reading.
 *
 * It has two halves:
 *
 *   XXXXX-XXXXX-XXXXXX
 *   └──── 10 ────┘└─6─┘
 *
 * - **10 random characters (~50 bits)** are the capability. That size is
 *   doing a specific job: api.php has no rate limiting, so guessing must be
 *   infeasible rather than merely slow.
 * - **6 characters (30 bits)** are a fingerprint of the author's public key.
 *
 * The fingerprint is the interesting half. A signature only proves "whoever
 * holds this key wrote this"; tying the key to a *person* needs a channel the
 * server does not control, and the code is exactly that — it travels by share
 * sheet, message or word of mouth. So the subscriber checks the key the server
 * returns against the fingerprint in the code they were given, *before*
 * pinning it. That makes this stronger than plain trust-on-first-use, for the
 * price of six characters.
 *
 * Crockford base32 throughout: no I, L, O or U, so nothing is ambiguous when
 * read aloud or typed, and `normalizeSpaceCode` folds the look-alikes.
 */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const RANDOM_LEN = 10;
const FINGERPRINT_LEN = 6;
export const SPACE_CODE_LEN = RANDOM_LEN + FINGERPRINT_LEN;

const KEY_FINGERPRINT_DOMAIN = 'ba.key.v1';

function encode(bytes: Uint8Array, chars: number): string {
  let out = '';
  for (let i = 0; i < chars; i++) {
    // One byte per character: 5 of its 8 bits. Wasteful, but the alternative
    // is bit-packing across a boundary for no gain at these lengths.
    out += ALPHABET[bytes[i % bytes.length]! % ALPHABET.length];
  }
  return out;
}

/**
 * The six characters of `code` that commit to `authorKeyHex`.
 *
 * Also shown on its own in Settings, so two people who care can compare
 * fingerprints directly rather than trusting the code's journey.
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
 * Returns null if what is left is not a code-shaped string.
 */
export function normalizeSpaceCode(input: string): string | null {
  const folded = input
    .toUpperCase()
    .replace(/[\s.\-_]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');
  if (folded.length !== SPACE_CODE_LEN) return null;
  for (const ch of folded) if (!ALPHABET.includes(ch)) return null;
  return folded;
}

/** `XXXXX-XXXXX-XXXXXX` — for display and for the share sheet. */
export function formatSpaceCode(code: string): string {
  return `${code.slice(0, 5)}-${code.slice(5, 10)}-${code.slice(10)}`;
}

/**
 * Does `code` commit to `authorKeyHex`?
 *
 * A mismatch is a hard failure at subscribe time, not a warning: it means the
 * key the server offered is not the key the person who gave you the code
 * holds.
 */
export function codeMatchesKey(code: string, authorKeyHex: string): boolean {
  return code.slice(RANDOM_LEN) === keyFingerprint(authorKeyHex);
}
