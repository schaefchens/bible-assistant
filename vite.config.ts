import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';
import { execSync } from 'node:child_process';

const BASE = '/assistant/';

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

export default defineConfig({
  base: BASE,
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
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Bible Assistant',
        short_name: 'Bible',
        description: 'Voice-controlled Bible reading assistant',
        theme_color: '#1a1a2e',
        background_color: '#1a1a2e',
        display: 'standalone',
        orientation: 'any',
        start_url: BASE,
        scope: BASE,
        icons: [
          {
            src: 'favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallbackDenylist: [/\/api\.php/, /\/storage\//],
        runtimeCaching: [
          {
            urlPattern: /\/storage\/audio\/.*\.(?:mp3|json)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'verse-audio',
              expiration: {
                maxEntries: 5000,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/bolls\.life\/(get-books|get-text)\//,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'bolls-life',
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
            },
          },
        ],
      },
    }),
  ],
});
