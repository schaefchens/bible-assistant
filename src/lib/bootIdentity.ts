import { Capacitor } from '@capacitor/core';
import { adoptPassphrase, generatePassphrase, PASSPHRASE_KEY, setPassphrase } from './passphrase';
import { secureGet, secureSet } from './secureStore';

/** Pre-native localStorage keys. The identity is derived from the mnemonic, so
 * these two were always redundant — they're only listed here so the migration
 * can clean them up. */
const LEGACY_KEYS = ['ba.userId', 'ba.userSecret'];

/**
 * Load the recovery mnemonic into memory before the first render, migrating it
 * out of localStorage on the way — and minting one if this is a first run.
 *
 * Must resolve before React mounts: the identity is required synchronously by
 * every api.php call (see identity.ts), and hydrating late would let the first
 * request go out unauthenticated.
 *
 * The mnemonic is two things wearing one hat. It is the device's API identity,
 * needed for the assistant and for TTS even when nothing is stored server-side;
 * and it is the portable recovery key for server sync. Only the second is worth
 * a screen, so it is minted silently here and shown when — and only when — the
 * user turns sync on. The app used to open on "create an account", which made a
 * fully-offline reader feel like it needed a server before it would read.
 */
export async function hydrateIdentity(): Promise<void> {
  let mnemonic: string | null = null;

  try {
    mnemonic = await secureGet(PASSPHRASE_KEY);
  } catch {
    // Durable storage unavailable — fall through to the legacy location.
  }

  if (!mnemonic) {
    // One-shot migration. Existing web/PWA users hit this on their first
    // native launch (and on their next web load, where it's a no-op move
    // within localStorage).
    let legacy: string | null = null;
    try {
      legacy = localStorage.getItem(PASSPHRASE_KEY);
    } catch {
      /* private mode or storage disabled */
    }

    if (legacy) {
      try {
        await secureSet(PASSPHRASE_KEY, legacy);
        // Only drop the cleartext copy once we can read it back, and only on
        // native — on web, secureStore *is* localStorage, so removing it here
        // would delete the very value we just wrote.
        if (Capacitor.isNativePlatform() && (await secureGet(PASSPHRASE_KEY)) === legacy) {
          localStorage.removeItem(PASSPHRASE_KEY);
          for (const k of LEGACY_KEYS) localStorage.removeItem(k);
        }
      } catch {
        // Migration failed — keep the legacy copy exactly where it is rather
        // than risk losing the only unrecoverable value in the app.
      }
      mnemonic = legacy;
    }
  }

  if (mnemonic) {
    adoptPassphrase(mnemonic);
    return;
  }

  // First run. setPassphrase() populates the in-memory caches before it awaits
  // durable storage, so even a failed write leaves this session usable — and
  // nothing is lost by it, because a mnemonic that has never been used for sync
  // has nothing to recover. The next launch simply mints another.
  const fresh = generatePassphrase();
  try {
    await setPassphrase(fresh);
  } catch {
    adoptPassphrase(fresh);
  }
}
