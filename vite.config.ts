import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';

/**
 * Path the web build is served from.
 *
 * The app now lives at the root of its own subdomain
 * (https://bibleassistant.apps.schaefchens.de/), not under the old
 * '/assistant/' subpath — the SFTP account's root *is* the web root. Override
 * with WEB_BASE=/subpath/ if it ever moves back under a prefix.
 */
const WEB_BASE = process.env.WEB_BASE ?? '/';
const NATIVE_OUT_DIR = 'dist-native';

/**
 * `public/` is a minefield for a native build: alongside the icons it holds
 * api.php, secrets.php (a live OPENAI_API_KEY), 59 MB of Bible XML, and
 * storage/ with every user's secret.txt. Vite copies publicDir verbatim, and
 * `cap copy` would then bundle all of it into the .ipa/.apk — an APK is a zip
 * anyone can open. So the native build turns publicDir OFF and copies an
 * explicit allow-list instead.
 */
const NATIVE_PUBLIC_ASSETS = ['favicon-32.png', 'apple-touch-icon.png', 'icons', 'bible-packs'];

/** Anything matching these anywhere in the tree fails the build. Server-side
 * config and secrets have no business inside an app binary. */
const NATIVE_FORBIDDEN = [/^\.htaccess$/, /\.php$/i, /\.xml$/i, /^secrets\b/i];
/** Directory names that must never appear in the bundle at any depth. */
const NATIVE_FORBIDDEN_DIRS = new Set(['storage', 'bibles']);

function assertNoServerFiles(dir: string, outDir: string, rel = ''): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const here = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (NATIVE_FORBIDDEN_DIRS.has(entry.name)) {
        throw new Error(`[native build] refusing to ship ${outDir}/${here}/ — server-side directory`);
      }
      assertNoServerFiles(path.join(dir, entry.name), outDir, here);
      continue;
    }
    if (NATIVE_FORBIDDEN.some((re) => re.test(entry.name))) {
      throw new Error(`[native build] refusing to ship ${outDir}/${here} — server-side file`);
    }
  }
}

function nativePublicAssets(outDir: string): Plugin {
  return {
    name: 'native-public-assets',
    apply: 'build',
    closeBundle() {
      const out = path.resolve(__dirname, outDir);
      for (const name of NATIVE_PUBLIC_ASSETS) {
        const src = path.resolve(__dirname, 'public', name);
        if (!fs.existsSync(src)) continue;
        fs.cpSync(src, path.join(out, name), {
          recursive: true,
          // .htaccess only means something to Apache; in an app bundle it's
          // dead weight that would also trip the assertion below.
          filter: (s) => path.basename(s) !== '.htaccess',
        });
      }
      // Belt and braces: fail the build rather than ship a leak. Recursive,
      // because a top-level-only check would miss public/anything/secrets.php.
      assertNoServerFiles(out, outDir);
    },
  };
}

const GIT_COMMIT = (() => {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'dev';
  }
})();
const BUILD_TIME = new Date().toISOString();

export default defineConfig(({ mode }) => {
  // `vite build --mode capacitor` produces the native bundle; everything else
  // is the /assistant/ web deploy. One config so the two can't drift.
  const isNative = mode === 'capacitor';

  return {
    // Native assets are served from the root of capacitor://localhost, so the
    // '/assistant/' base would 404 every chunk.
    base: isNative ? './' : WEB_BASE,
    publicDir: isNative ? false : 'public',
    build: {
      // A separate outDir makes it impossible for `cap copy` to pick up the
      // 285 MB web dist/ by accident.
      outDir: isNative ? NATIVE_OUT_DIR : 'dist',
    },
    define: {
      __GIT_COMMIT__: JSON.stringify(GIT_COMMIT),
      __BUILD_TIME__: JSON.stringify(BUILD_TIME),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      host: true,
      proxy: {
        // The PHP dev server (php -S 0.0.0.0:8000 -t public) serves api.php /
        // storage at root, so strip the /assistant prefix when forwarding. The
        // X-Base-Path header tells PHP what prefix the SPA expects in returned
        // URLs (e.g. cached-audio URLs) so they round-trip correctly.
        '/assistant/api.php': {
          target: 'http://localhost:8000',
          changeOrigin: false,
          rewrite: (p) => p.replace(/^\/assistant/, ''),
          headers: { 'X-Base-Path': '/assistant' },
        },
        '/assistant/storage': {
          target: 'http://localhost:8000',
          changeOrigin: false,
          rewrite: (p) => p.replace(/^\/assistant/, ''),
        },
      },
    },
    plugins: [
      react(),
      VitePWA({
        // Service workers don't run under the capacitor:// scheme on iOS. With
        // `disable`, vite-plugin-pwa still resolves `virtual:pwa-register` to a
        // no-op registerSW stub, so src/lib/pwaUpdate.ts needs no changes —
        // needRefresh simply never becomes true and the update UI stays hidden.
        disable: isNative,
        registerType: 'prompt',
        includeAssets: ['favicon-32.png', 'apple-touch-icon.png', 'icons/*.png'],
        manifest: {
          name: 'Bible Assistant',
          short_name: 'Bible',
          description: 'Voice-controlled Bible reading assistant',
          theme_color: '#1a1a2e',
          background_color: '#1a1a2e',
          display: 'standalone',
          orientation: 'any',
          start_url: WEB_BASE,
          scope: WEB_BASE,
          icons: [
            { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            // `maskable` is declared separately and only on the large size:
            // the artwork sits inside the central ~66% of the square, so a
            // circular or squircle mask can't clip the dove's wings or the
            // book. Declaring `any maskable` on one entry (as this did while
            // pointing at the old placeholder favicon) lets a browser use the
            // same bitmap for both, which is what causes over-cropped icons.
            {
              src: 'icons/icon-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
          navigateFallbackDenylist: [/\/api\.php/, /\/storage\//, /\/bible-packs\//],
          // The `verse-audio-v2` CacheFirst route that used to live here is
          // gone: src/lib/mediaCache.ts now persists verse audio + alignments
          // in IndexedDB instead. That works in the native builds too, where
          // there is no service worker at all — and keeping both would mean
          // web users storing every mp3 twice.
        },
      }),
      ...(isNative ? [nativePublicAssets(NATIVE_OUT_DIR)] : []),
    ],
  };
});
