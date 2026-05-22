import Dexie from 'dexie';
import { audioPlayback } from '@/lib/audioPlaybackManager';

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

  try {
    sessionStorage.clear();
  } catch {
    // ignore
  }

  try {
    await Dexie.delete('bible-assistant');
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
