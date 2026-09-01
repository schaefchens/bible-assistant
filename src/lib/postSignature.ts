import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256, sha512 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { mnemonicToSeedSync } from '@scure/bip39';
import type { Post } from '@/types/domain';

/**
 * Signing a post proves the author wrote it, to a reader whose only other
 * source is a server they have no reason to trust.
 *
 * The key comes out of the same seed as the identity. `mnemonicToSeedSync()`
 * gives 64 bytes and `passphrase.ts` uses `[0..16]` for `userId` and
 * `[16..48]` for `userSecret`; rather than claim the remaining 16, this
 * derives its own 32 with an explicit domain separator, so nothing here
 * collides with a future use of the seed and neither half weakens the other.
 *
 * Being derived from the mnemonic alone means the **same user signs
 * identically on every device** — recovering a passphrase restores the ability
 * to publish as that author, with nothing extra stored or synced. It also
 * means losing the mnemonic loses that ability, exactly as it already loses
 * the account.
 *
 * What a signature does and does not prove is spelled out on
 * {@link verifyPost}; read that before describing this feature to anyone.
 *
 * This module holds the crypto and **nothing else** — no stores, no
 * passphrase access, no Capacitor. That is what lets
 * `scripts/community/verifySigning.mjs` exercise the real code rather than a
 * copy of it. The passphrase-bound wrapper lives in `postSigning.ts`.
 */

const SIGN_DOMAIN = 'ba.sign.v1';

/** Canonicalization version, carried on the post so a v2 can be additive. */
export const POST_SIG_VERSION = 'ba.post.v1';

export type SigningKeyPair = { publicKey: Uint8Array; secretKey: Uint8Array };

/**
 * Derive the signing key from a mnemonic. Pure and deterministic: the same
 * words give the same key on every device and every platform.
 */
export function deriveSigningKey(mnemonic: string): SigningKeyPair {
  const seed = mnemonicToSeedSync(mnemonic);
  const signSeed = sha512(concatBytes(seed, utf8ToBytes(SIGN_DOMAIN))).slice(0, 32);
  return ed25519.keygen(signSeed);
}

/**
 * The exact bytes a signature covers.
 *
 * Not `JSON.stringify(post)`: key order is not guaranteed across engines and
 * free text would need escaping. Instead every variable-length field is
 * replaced by the hex sha256 of its UTF-8 bytes, so a title or body may
 * contain anything — newlines included — with no way to forge one field by
 * stuffing a delimiter into another. Every field left unhashed is a
 * constrained charset (a uuid, digits, `'en' | 'de'`), so the newline join is
 * unambiguous.
 *
 * Two inclusions are deliberate:
 *
 * - the author's own **public key**, which makes the signature key-committing
 *   and the message self-contained: a verifier needs the post and the pinned
 *   key, nothing else. Binding to the key rather than to `userId` also keeps
 *   the owner's uuid — a valid `X-User-Id` — out of the feed projection;
 * - `updatedAt`, so a server that replays an older but validly-signed version
 *   is detectable — the feed cache refuses to go backwards on it.
 *
 * Signature-lifting is blocked by the key, not by the uuid: a post carries the
 * key it claims to be signed by, {@link verifyPost} requires that to be the
 * key pinned for the space, and no other key can produce a valid signature
 * over this message.
 */
export function canonicalPostMessage(post: Post, authorKeyHex: string): Uint8Array {
  return utf8ToBytes(
    [
      POST_SIG_VERSION,
      authorKeyHex.toLowerCase(),
      post.spaceId,
      post.id,
      String(post.publishedAt),
      String(post.updatedAt),
      post.language,
      bytesToHex(sha256(utf8ToBytes(post.title))),
      bytesToHex(sha256(utf8ToBytes(post.body))),
    ].join('\n'),
  );
}

export type PostSignature = {
  signature: string;
  authorKey: string;
  sigVersion: string;
};

/** Sign `post` with an already-derived key. `postSigning.ts` wraps this. */
export function signPostWith(post: Post, pair: SigningKeyPair): PostSignature {
  const publicKeyHex = bytesToHex(pair.publicKey);
  return {
    signature: bytesToHex(ed25519.sign(canonicalPostMessage(post, publicKeyHex), pair.secretKey)),
    authorKey: publicKeyHex,
    sigVersion: POST_SIG_VERSION,
  };
}

/**
 * Verify a post that arrived from the server against the key pinned for its
 * space.
 *
 * What this buys:
 *
 * - The server cannot forge a post, alter a published one, or attribute
 *   somebody else's writing to this author. The private key never leaves the
 *   author's device, and PHP never sees it.
 * - Tampering and rollback are *detected*, not merely discouraged. A post that
 *   fails here is refused, never rendered with a caveat.
 *
 * What it does not buy, and must not be described as buying:
 *
 * - The server can still **withhold or delay** a post, or hide a deletion.
 *   Catching that needs a signed per-space manifest with a serial number,
 *   which last-write-wins sync across the author's own devices would fight.
 * - It says nothing about whether the pinned key belongs to the person you
 *   think. That binding comes from the share code's fingerprint half
 *   (`lib/spaceCode.ts`), which travels out of band.
 */
export function verifyPost(post: Post, pinnedKeyHex: string): boolean {
  if (!post.signature || !post.authorKey || post.sigVersion !== POST_SIG_VERSION) return false;
  // The post's own claimed key must be the pinned one; otherwise a server
  // could hand us a validly self-signed post from a key we never trusted.
  if (post.authorKey.toLowerCase() !== pinnedKeyHex.toLowerCase()) return false;
  try {
    return ed25519.verify(
      hexToBytes(post.signature),
      canonicalPostMessage(post, pinnedKeyHex),
      hexToBytes(pinnedKeyHex),
    );
  } catch {
    // Malformed hex or a bad point encoding — indistinguishable from a forgery
    // as far as the reader is concerned.
    return false;
  }
}
