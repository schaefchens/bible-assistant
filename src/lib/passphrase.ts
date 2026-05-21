import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { setIdentity, type Identity } from './identity';

const PASSPHRASE_KEY = 'ba.passphrase';

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
  return localStorage.getItem(PASSPHRASE_KEY);
}

export function setPassphrase(mnemonic: string): void {
  const norm = normalize(mnemonic);
  localStorage.setItem(PASSPHRASE_KEY, norm);
  setIdentity(deriveIdentityFromPassphrase(norm));
}

export function clearPassphrase(): void {
  localStorage.removeItem(PASSPHRASE_KEY);
}
