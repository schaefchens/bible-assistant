import { Capacitor } from '@capacitor/core';
import { adoptPassphrase, PASSPHRASE_KEY } from './passphrase';
import { secureGet, secureSet } from './secureStore';

/** Pre-native localStorage keys. The identity is derived from the mnemonic, so
 * these two were always redundant — they're only listed here so the migration
 * can clean them up. */
const LEGACY_KEYS = ['ba.userId', 'ba.userSecret'];

/**
 * Load the recovery mnemonic into memory before the first render, migrating it
 * out of localStorage on the way.
 *
 * Must resolve before React mounts: AppShell reads getPassphrase() during
 * render to decide whether to show onboarding, so hydrating late would flash
 * the passphrase setup screen at an existing user — and, worse, invite them to
 * generate a second identity over the top of their real one.
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

  if (mnemonic) adoptPassphrase(mnemonic);
}
