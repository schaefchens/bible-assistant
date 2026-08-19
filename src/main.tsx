import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import { SplashScreen } from '@capacitor/splash-screen';
import './index.css';
import './i18n';
import App from './App';
import { hydrateIdentity } from '@/lib/bootIdentity';
import { reclaimLegacyAudioCache } from '@/lib/mediaCache';
import { initPwaUpdate } from '@/lib/pwaUpdate';
import { initReadingHosts } from '@/lib/readingHosts';
import { initPlaybackController } from '@/lib/playbackController';
import { initAutoPlay } from '@/lib/autoPlay';

initPwaUpdate();
// Must come first: the two initializers below install playbackStore
// subscribers that resolve verses through the host registry.
initReadingHosts();
initPlaybackController();
initAutoPlay();
// Reclaim the disk held by the retired Workbox `verse-audio-v2` cache; nothing
// reads or expires it now that mediaCache has taken over.
void reclaimLegacyAudioCache();

// The mnemonic lives in async native storage, but AppShell reads it during
// render to decide between onboarding and the app — so hydration has to finish
// before the first mount. `.finally` rather than `await` so a storage failure
// still boots the app instead of leaving a blank screen forever.
void hydrateIdentity().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );

  // capacitor.config.ts sets launchAutoHide:false so the splash covers this
  // whole boot rather than flashing an empty WebView — which means *we* own
  // hiding it. Forget this and the app is stuck on the splash forever.
  // Deferred one frame so the first paint has landed underneath.
  if (Capacitor.isNativePlatform()) {
    requestAnimationFrame(() => {
      void SplashScreen.hide().catch(() => {
        /* best-effort: a visible splash beats a boot failure */
      });
    });
  }
});
