import { expect, test, type Page } from '@playwright/test';
import { appReady } from '../support/app';

/**
 * Journey: read with the network gone.
 *
 * The app's headline claim, and the one `0be0e72 fix(web): let the PWA read a
 * Bible offline` is about. On the web build the chapter source chain is
 * `[localPackSource (Dexie), networkSource (?action=bible.chapter)]` — the
 * bundled packs are native-only — so reading offline depends entirely on the
 * pack having been downloaded into IndexedDB.
 *
 * That download starts by itself: `useAppInitialization`'s pack-retry effect
 * calls `want(activeTranslation)` on every boot, unprompted, precisely so a
 * translation chosen in airplane mode arrives on its own. This journey waits
 * for it, cuts the network, and reads.
 */

const READER = '[data-segment-id]';

/** Wait until the active translation's pack is fully in IndexedDB. 66 books
 * over localhost, four at a time — quick, but not instant. */
async function packInstalled(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            new Promise<number>((resolve) => {
              const req = indexedDB.open('bible-assistant-packs');
              req.onsuccess = () => {
                const dbh = req.result;
                if (!dbh.objectStoreNames.contains('books')) return resolve(0);
                const count = dbh.transaction('books').objectStore('books').count();
                count.onsuccess = () => resolve(count.result);
                count.onerror = () => resolve(0);
              };
              req.onerror = () => resolve(0);
            }),
        ),
      { timeout: 120_000, message: 'the KJV pack never finished downloading' },
    )
    .toBe(66);
}

test('a chapter still reads with the network gone', async ({ page, context }) => {
  await page.goto('/');
  await appReady(page);
  await packInstalled(page);

  // Cut everything. From here the only Bible text available is what is in
  // IndexedDB — and the service worker's precache for the shell.
  await context.setOffline(true);

  const chapterCalls: string[] = [];
  page.on('request', (req) => {
    if (req.url().includes('action=bible.chapter')) chapterCalls.push(req.url());
  });

  await page.reload();
  await appReady(page);
  await page.getByRole('link', { name: 'Read' }).click();
  await page.getByRole('button', { name: 'Choose book and chapter' }).click();
  await page.getByRole('button', { name: 'Psalms', exact: true }).click();
  await page.getByRole('button', { name: '117', exact: true }).click();

  // The real KJV text, out of the local pack.
  await expect(page.locator(`${READER} .verse-inline`).first()).toContainText(
    'O praise the LORD, all ye nations',
  );

  // And the reader still walks, so this is not one lucky cached chapter.
  await page.getByRole('button', { name: 'Next chapter' }).click();
  await expect(page.locator(READER)).toHaveAttribute('data-segment-id', 'reader:KJV:19:118');

  // The point of the fix: the network was never consulted for the text.
  expect(chapterCalls, 'bible.chapter was called while offline').toEqual([]);

  await context.setOffline(false);
});

/**
 * The other half of offline: the app boots at all. The service worker
 * precaches the shell (24 entries), which is what makes a cold offline launch
 * possible rather than a blank page.
 */
test('the app boots offline from the service worker', async ({ page, context }) => {
  await page.goto('/');
  await appReady(page);
  // Let the SW finish taking control before cutting the network.
  await page.evaluate(() => navigator.serviceWorker?.ready);

  await context.setOffline(true);
  await page.reload();

  await appReady(page);
  await expect(page.getByRole('link', { name: 'Read' })).toBeVisible();
  await context.setOffline(false);
});
