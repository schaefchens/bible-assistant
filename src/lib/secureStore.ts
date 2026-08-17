/**
 * Durable key/value store for the handful of values that must survive a
 * WKWebView localStorage purge.
 *
 * iOS treats WebView localStorage as evictable under storage pressure. The
 * recovery mnemonic lives there today, and losing it is unrecoverable — the
 * server has no account recovery, so an eviction silently orphans the user's
 * cards and boards.
 *
 *   native -> UserDefaults / SharedPreferences via @capacitor/preferences:
 *             not purgeable, included in device backups.
 *   web    -> localStorage, i.e. exactly the previous behaviour.
 *
 * Swapping in a Keychain / Android Keystore plugin later is a change to these
 * three functions and nothing else.
 */
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

const isNative = (): boolean => Capacitor.isNativePlatform();

export async function secureGet(key: string): Promise<string | null> {
  if (isNative()) {
    const { value } = await Preferences.get({ key });
    return value ?? null;
  }
  return localStorage.getItem(key);
}

export async function secureSet(key: string, value: string): Promise<void> {
  if (isNative()) {
    await Preferences.set({ key, value });
    return;
  }
  localStorage.setItem(key, value);
}

export async function secureRemove(key: string): Promise<void> {
  if (isNative()) {
    await Preferences.remove({ key });
    return;
  }
  localStorage.removeItem(key);
}
