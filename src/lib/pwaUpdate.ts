import { create } from 'zustand';
import { registerSW } from 'virtual:pwa-register';

type UpdateState = {
  needRefresh: boolean;
  offlineReady: boolean;
  checking: boolean;
  setNeedRefresh: (v: boolean) => void;
  setOfflineReady: (v: boolean) => void;
  setChecking: (v: boolean) => void;
};

export const useUpdateStore = create<UpdateState>((set) => ({
  needRefresh: false,
  offlineReady: false,
  checking: false,
  setNeedRefresh: (needRefresh) => set({ needRefresh }),
  setOfflineReady: (offlineReady) => set({ offlineReady }),
  setChecking: (checking) => set({ checking }),
}));

let updateSW: ((reloadPage?: boolean) => Promise<void>) | null = null;
let swRegistration: ServiceWorkerRegistration | null = null;

export function initPwaUpdate(): void {
  if (updateSW) return;
  updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      useUpdateStore.getState().setNeedRefresh(true);
    },
    onOfflineReady() {
      useUpdateStore.getState().setOfflineReady(true);
    },
    onRegisteredSW(_swUrl, reg) {
      if (reg) swRegistration = reg;
    },
  });
}

// Force the SW to check for a new version. Resolves once the check has been
// dispatched (the `onNeedRefresh` callback fires asynchronously if one is found).
export async function checkForUpdates(): Promise<void> {
  if (swRegistration) {
    try {
      await swRegistration.update();
    } catch {
      // ignore — network errors are non-fatal
    }
  }
}

export async function applyUpdate(): Promise<void> {
  if (updateSW) {
    await updateSW(true);
  } else {
    window.location.reload();
  }
}
