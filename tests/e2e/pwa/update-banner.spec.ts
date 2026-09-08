import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { appReady } from '../support/app';

/**
 * Journey: a new version is deployed while someone has the app open.
 *
 * The service worker only exists in the built bundle, so this is the one thing
 * `npm run dev` can never show you — and `registerType: 'prompt'` means the app
 * owes the user a banner rather than reloading under them.
 *
 * The "new version" is a genuine rebuild, not a simulated one. That works
 * because `vite.config.ts` defines `__BUILD_TIME__` as `new Date()`, so every
 * build produces different asset hashes and therefore a different precache
 * manifest — a real update whose behaviour is identical, which is exactly what
 * this needs: later specs share this `dist/` and must not see a different app.
 *
 * Its own project because it is the only spec that wants a service worker at
 * all, and because it rebuilds the artifact the others are running against.
 */

test('a new deploy offers a reload instead of taking one', async ({ page, baseURL }) => {
  await page.goto('/');
  await appReady(page);

  // Wait for this build's worker to install, then reload so it is actually in
  // control. A newly installed worker does not control the page that installed
  // it — `registerType: 'prompt'` means no `clients.claim()`, which is the same
  // reason the app owes the user a banner rather than reloading itself.
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.reload();
  await appReady(page);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
  expect(controlled, 'the service worker should be in control before we deploy over it').toBe(true);

  // Nothing to reload for yet.
  await expect(page.getByText('New version available — tap to reload')).toHaveCount(0);

  // ── Deploy ───────────────────────────────────────────────────────────────
  execFileSync('npm', ['run', 'build'], { cwd: process.cwd(), stdio: 'ignore' });

  // Ask the browser to look, which is what a foregrounded PWA does anyway.
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    await reg?.update();
  });

  // `registerType: 'prompt'` — the new worker waits, and the app says so.
  await expect(page.getByText('New version available — tap to reload')).toBeVisible({
    timeout: 60_000,
  });

  // The old version is still the one running: an update must not reload the
  // page out from under someone mid-chapter.
  expect(page.url()).toBe(`${baseURL}/`);
  await appReady(page);
});
