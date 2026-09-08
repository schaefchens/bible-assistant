import { defineConfig } from '@playwright/test';

/**
 * Layer 3: the app as a user meets it.
 *
 * Nothing is mocked and no source is changed. The suite drives the **built
 * artifact** — `dist/` already contains `api.php`, `secrets.php`, the Zefania
 * XML, the service worker and a warm `storage/audio`, so one `php -S` on that
 * directory is the whole production topology, same-origin, with no proxy and no
 * dev server. Real OpenAI, real TTS, real forced alignment, real moderation.
 *
 * Run it on command (`npm run e2e`) after a risky feature or refactor — never
 * as part of `npm test`. `tests/e2e/run.mjs` is the entry point: it refuses to
 * run against a stale `dist/` and resets the per-user server state first.
 */

const PORT = Number(process.env.E2E_PORT ?? 8790);

/** Exported because `browser.newContext()` inherits none of `use`, and the
 * two-identity journey needs a second context that can still resolve `/`. */
export const BASE_URL = `http://127.0.0.1:${PORT}`;

/** Where the setup project leaves a genuinely-onboarded browser profile. */
export const STORAGE_STATE = 'test-results/e2e/onboarded.json';

export default defineConfig({
  testDir: './tests/e2e',
  // One PHP server and a live model behind these: parallelism buys little and
  // costs determinism. The suite is minutes-not-seconds by design.
  fullyParallel: false,
  workers: 1,
  // Unlike layers 1 and 2 (which sit at 0), a real network and a real model are
  // genuine variance rather than a bug in the suite.
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results/e2e-artifacts',

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',

    // Hand-rolled rather than devices['Pixel 5']: a mobile device descriptor
    // carries an Android UA, which flips `needsAppHandOff()` in
    // lib/spaceInvite.ts and changes what AppShell renders for an invite. And
    // `hasTouch` routes dnd-kit to its TouchSensor, whose non-passive
    // preventDefault is far harder to drive than the mouse path.
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: false,
    isMobile: false,

    // `settingsStore.detectLocale()` reads navigator.language in the store
    // initializer, before any persisted value exists — so this decides the
    // whole first run, including which translation it picks. Pinned so
    // accessible names are stable. A second project with 'de-DE' would also
    // catch missing translations; see the plan.
    locale: 'en-US',
    timezoneId: 'Europe/Berlin',

    // Never granted: `useSpeechRecognition` then stays inert and Whisper
    // remains the path, which is what the web build actually ships.
    permissions: [],

    launchOptions: {
      // Continuations and `playLastReading` start audio without a fresh
      // gesture, which Chromium blocks by default.
      args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
    },
  },

  projects: [
    {
      // Drives the real 8-step wizard once and saves the profile. Onboarding is
      // therefore covered rather than bypassed, and no spec has to hand-craft a
      // `ba.settings` blob with the right persist version.
      name: 'setup',
      testMatch: /setup\/.*\.setup\.ts/,
    },
    {
      name: 'app',
      dependencies: ['setup'],
      testMatch: /journeys\/.*\.spec\.ts/,
      use: { storageState: STORAGE_STATE },
    },
    {
      /**
       * An Android user agent, for the one flow that branches on it:
       * `needsAppHandOff()` decides whether an invitation shows the app
       * hand-off before the wizard. Its own project because giving the main
       * project a mobile UA would change what every other spec renders — and
       * `hasTouch` would route dnd-kit to the TouchSensor.
       *
       * No `storageState`: these specs are about a *first* run.
       */
      name: 'mobile',
      testMatch: /mobile\/.*\.spec\.ts/,
      use: {
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
        storageState: undefined,
        userAgent:
          'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36',
      },
    },
    {
      /**
       * The service worker lives only in the built bundle, so this is the one
       * project that wants one — and it *rebuilds* `dist/` to produce a real
       * update, which is why it is kept apart from the journeys.
       */
      name: 'pwa',
      // Depends on setup because it uses the saved profile: without this it
      // only passes when a previous run happens to have left the state file
      // behind, and a fresh clone fails.
      dependencies: ['setup'],
      testMatch: /pwa\/.*\.spec\.ts/,
      use: {
        viewport: { width: 390, height: 844 },
        storageState: STORAGE_STATE,
        serviceWorkers: 'allow',
      },
    },
    {
      // Opt-in, and the only place a *cold* OpenAI call happens. Not in
      // `npm run e2e`; run it deliberately before a release.
      name: 'live',
      dependencies: ['setup'],
      testMatch: /live\/.*\.spec\.ts/,
      use: { storageState: STORAGE_STATE },
    },
  ],

  webServer: {
    // The built app and the backend are the same origin here, exactly as in
    // production. PHP's CLI server falls back to index.html for a path with no
    // file behind it, so BrowserRouter deep links work with no router script.
    command: `php -S 127.0.0.1:${PORT} -t dist`,
    env: { PHP_CLI_SERVER_WORKERS: '4' },
    // api.php rather than `/`: index.html is static, so a 200 there would not
    // prove PHP is executing. 401 "missing identity headers" does, and
    // Playwright accepts it as ready.
    url: `${BASE_URL}/api.php?action=ambient.list`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    // PHP's CLI server logs every request to stderr, which buries the test
    // output. Set E2E_PHP_LOG=1 to see it (and any fatal) while debugging a
    // backend problem.
    stdout: 'ignore',
    stderr: process.env.E2E_PHP_LOG ? 'pipe' : 'ignore',
  },
});
