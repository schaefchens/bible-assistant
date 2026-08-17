import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'de.schaefchens.apps.bibleassistant',
  appName: 'Bible Assistant',

  // Produced only by `vite build --mode capacitor` (see vite.config.ts). The
  // separate outDir is deliberate: the web `dist/` is 285 MB and contains
  // api.php, secrets.php (a live OPENAI_API_KEY) and storage/users/*/secret.txt,
  // because Vite copies public/ verbatim. Pointing webDir at it would ship all
  // of that inside the .ipa/.apk.
  webDir: 'dist-native',

  // Matches --navy, so there's no white flash between splash and first paint.
  backgroundColor: '#1a1a2e',

  server: {
    // Stated explicitly because the CORS allow-list in public/api.php
    // (corsOriginAllowed) depends on these exact origins.
    androidScheme: 'https', // -> https://localhost
    iosScheme: 'capacitor', // -> capacitor://localhost
    hostname: 'localhost',
  },

  ios: {
    // The app draws its own safe areas (.pt-safe / .pb-safe / .px-safe), so the
    // WKWebView scroll view must not add insets of its own.
    contentInset: 'never',
    // Each pane scrolls itself; this kills whole-page rubber-banding.
    scrollEnabled: false,
    backgroundColor: '#1a1a2e',
    limitsNavigationsToAppBoundDomains: false,
  },

  android: {
    backgroundColor: '#1a1a2e',
    // The backend is HTTPS; keep the WebView strict.
    allowMixedContent: false,
    // Flip to true only while debugging via chrome://inspect — it exposes the
    // WebView to any process on the device that can reach the debug bridge.
    webContentsDebuggingEnabled: false,
  },

  plugins: {
    // Deliberately OFF. CapacitorHttp's patched fetch base64-encodes binary
    // bodies across the JS bridge (this app decodeAudioData's every verse),
    // does not reliably honour AbortSignal (the "stop" command is an
    // AbortSignal threaded through chat -> tool -> TTS -> playback), and only
    // supports FormData on web (voice input posts a MediaRecorder Blob to
    // ?action=transcribe). CORS on api.php is the correct fix instead.
    CapacitorHttp: { enabled: false },

    SystemBars: {
      // Injects --safe-area-inset-* inline on <html>; Android WebView < 140
      // reports wrong env() values. See src/index.css for the fallbacks.
      insetsHandling: 'css',
      style: 'DARK', // light icons over the navy background
      hidden: false,
    },

    Keyboard: {
      // Shrink the WebView frame rather than the body — correct for a
      // height:100% flex column, which is what AppShell is.
      resize: 'native',
      resizeOnFullScreen: true,
      style: 'dark',
    },

    SplashScreen: {
      // Hidden manually in main.tsx once identity hydration has resolved and
      // React has rendered.
      launchAutoHide: false,
      backgroundColor: '#1a1a2e',
      showSpinner: false,
      androidScaleType: 'CENTER_CROP',
    },
  },
};

export default config;
