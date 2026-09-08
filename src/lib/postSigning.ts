import { bytesToHex } from '@noble/hashes/utils.js';
import { getPassphrase } from './passphrase';
import { deriveSigningKey, signPostWith, type PostSignature, type SigningKeyPair } from './postSignature';
import type { Post } from '@/types/domain';

/**
 * The app-facing half of post signing: the key for *this* user, derived from
 * the passphrase and cached.
 *
 * The crypto itself, and the long note on what a signature proves, live in
 * `postSignature.ts`, which imports nothing from the app so it can be checked
 * by `npm run community:verify`.
 */

/** Mirrors the passphrase cache: derived on first use, dropped on reset. */
let cached: { mnemonic: string; pair: SigningKeyPair } | null = null;

/** Null when onboarding has not produced a passphrase yet. */
function keyPair(): SigningKeyPair | null {
  const mnemonic = getPassphrase();
  if (!mnemonic) return null;
  if (cached?.mnemonic === mnemonic) return cached.pair;
  const pair = deriveSigningKey(mnemonic);
  cached = { mnemonic, pair };
  return pair;
}

/**
 * The public key to publish in the profile, hex. Null before onboarding.
 *
 * Safe to hand out: it is the only half a verifier needs, and it is what the
 * share code's fingerprint commits to.
 */
export function authorKey(): string | null {
  const pair = keyPair();
  return pair ? bytesToHex(pair.publicKey) : null;
}

/**
 * Sign one of the user's own posts. Returns null if there is no key yet,
 * which callers treat as "cannot publish".
 *
 * `post` must already carry its final `publishedAt` and `updatedAt` — both are
 * signed, so stamping them afterwards invalidates the result.
 */
export function signPost(post: Post): PostSignature | null {
  const pair = keyPair();
  return pair ? signPostWith(post, pair) : null;
}

/** Called by factoryReset, alongside clearPassphrase(). */
export function clearSigningKey(): void {
  cached = null;
}

export { POST_SIG_VERSION, verifyPost } from './postSignature';
export type { PostSignature } from './postSignature';
