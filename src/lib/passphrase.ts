import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { clearIdentity, setIdentity, type Identity } from './identity';
import { secureRemove, secureSet } from './secureStore';

export const PASSPHRASE_KEY = 'ba.passphrase';

/** Mirrors the durable copy so getPassphrase() can stay synchronous — see
 * identity.ts for why. Populated by hydrateIdentity() at boot. */
let cachedPassphrase: string | null = null;

function normalize(mnemonic: string): string {
  return mnemonic.trim().toLowerCase().replace(/\s+/g, ' ');
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function formatUuidV8(bytes: Uint8Array): string {
  const b = new Uint8Array(bytes.slice(0, 16));
  b[6] = (b[6] & 0x0f) | 0x80;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = bytesToHex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

export function generatePassphrase(): string {
  return generateMnemonic(wordlist, 128);
}

export function validatePassphrase(mnemonic: string): boolean {
  return validateMnemonic(normalize(mnemonic), wordlist);
}

export function deriveIdentityFromPassphrase(mnemonic: string): Identity {
  const seed = mnemonicToSeedSync(normalize(mnemonic));
  return {
    userId: formatUuidV8(seed.slice(0, 16)),
    userSecret: bytesToHex(seed.slice(16, 48)),
  };
}

export function getPassphrase(): string | null {
  return cachedPassphrase;
}

/**
 * Populate the in-memory caches from an already-known mnemonic. Used by boot
 * hydration; does not write to storage.
 */
export function adoptPassphrase(mnemonic: string): void {
  const norm = normalize(mnemonic);
  cachedPassphrase = norm;
  setIdentity(deriveIdentityFromPassphrase(norm));
}

/**
 * Persist the mnemonic and derive the identity from it.
 *
 * Async because durable native storage is — callers MUST await this before
 * navigating on, or the app can be killed in the gap after telling the user
 * their passphrase is saved.
 */
export async function setPassphrase(mnemonic: string): Promise<void> {
  const norm = normalize(mnemonic);
  adoptPassphrase(norm);
  await secureSet(PASSPHRASE_KEY, norm);
}

export async function clearPassphrase(): Promise<void> {
  cachedPassphrase = null;
  clearIdentity();
  await secureRemove(PASSPHRASE_KEY);
}
