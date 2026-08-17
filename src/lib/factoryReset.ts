import Dexie from 'dexie';
import { audioPlayback } from '@/lib/audioPlaybackManager';
import { clearPassphrase } from '@/lib/passphrase';

// Wipes every piece of persisted state so the next load is a clean install:
// localStorage keys under `ba.*`, sessionStorage, the Dexie database, all
// CacheStorage entries (Workbox runtime + precache), and registered service
// workers. Reloads the page so a fresh boot picks up a brand-new state.
export async function factoryReset(): Promise<void> {
  try {
    audioPlayback.stop();
  } catch {
    // ignore
  }

  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('ba.')) keysToRemove.push(k);
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
  } catch {
    // ignore
  }

  // The mnemonic now lives in durable native storage, which the localStorage
  // sweep above doesn't touch — without this a "factory reset" would leave the
  // identity behind and the app would boot straight back into it.
  try {
    await clearPassphrase();
  } catch {
    // ignore
  }

  try {
    sessionStorage.clear();
  } catch {
    // ignore
  }

  try {
    // Cards, boards, sync queue, preferences, and the media cache.
    await Dexie.delete('bible-assistant');
  } catch {
    // ignore
  }

  try {
    // Downloaded Bible packs live in their own database, so the delete above
    // does not touch them — without this a "factory reset" would leave tens of
    // MB of offline Bibles behind and the picker would still show them as
    // installed while the app treated itself as a clean install.
    await Dexie.delete('bible-assistant-packs');
  } catch {
    // ignore
  }

  if (typeof caches !== 'undefined') {
    try {
      const names = await caches.keys();
      await Promise.all(names.map((n) => caches.delete(n)));
    } catch {
      // ignore
    }
  }

  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    } catch {
      // ignore
    }
  }

  window.location.reload();
}
