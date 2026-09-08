import { expect, test, type Page } from '@playwright/test';
import { appReady } from '../support/app';

/**
 * Journey: pin a chapter's narration so it plays with no network.
 *
 * "Downloading = pinning": `mediaCache`'s pinned rows are exempt from LRU
 * eviction, so a chapter saved for a flight cannot be reclaimed by whatever was
 * played since. The download covers exactly what the current settings would
 * *play*, which is why it is per chapter rather than per book.
 *
 * Real throughout, and it costs nothing: Psalm 117's two clips plus its spoken
 * heading are already in the shared, content-addressed cache, so every request
 * this makes is a hit. That is asserted, not assumed.
 */

const READER = '[data-segment-id]';

async function openPsalm117(page: Page) {
  await page.goto('/');
  await appReady(page);
  await page.getByRole('link', { name: 'Read' }).click();
  await page.getByRole('button', { name: 'Choose book and chapter' }).click();
  await page.getByRole('button', { name: 'Psalms', exact: true }).click();
  await page.getByRole('button', { name: '117', exact: true }).click();
  await expect(page.locator(`${READER} .verse-inline`).first()).toContainText('O praise the LORD');
}

test('a chapter is downloaded, and then plays with the network gone', async ({ page, context }) => {
  const tts: boolean[] = [];
  page.on('requestfinished', async (req) => {
    if (!/action=tts(\.speak)?\b/.test(req.url())) return;
    try {
      const json = (await (await req.response())?.json()) as { cached?: boolean } | null;
      tts.push(!!json?.cached);
    } catch {
      /* ignore */
    }
  });

  await openPsalm117(page);

  // Not yet saved: the control offers to download.
  const download = page.getByRole('button', {
    name: 'Download this chapter for offline listening',
  });
  await expect(download).toBeVisible();
  await download.click();

  // Preparing audio is a request per verse plus the heading, so give it room.
  // "Downloaded — plays offline" is the finished state; `check()` re-derives it
  // from Dexie rather than trusting the store, which is transient.
  await expect(
    page.getByRole('button', { name: 'Downloaded — plays offline' }),
  ).toBeVisible({ timeout: 120_000 });

  // Free, and asserted: a miss here would mean a real generation on every run.
  expect(tts.length).toBeGreaterThan(0);
  expect(tts.filter((cached) => !cached).length, 'a download request was not a cache hit').toBe(0);

  // ── The point of it ──────────────────────────────────────────────────────
  await context.setOffline(true);

  await page.reload();
  await appReady(page);
  await openPsalmOffline(page);

  // Still shown as downloaded after a reload, because the truth is in Dexie.
  await expect(page.getByRole('button', { name: 'Downloaded — plays offline' })).toBeVisible();

  // And it actually plays. `cachedNarrationSource` answers from the local index
  // with **no** call to api.php — which is the only way this works offline.
  await page.getByRole('button', { name: 'Read this chapter aloud' }).click();
  await expect(page.locator('[data-ba-audio="verse"]')).toHaveJSProperty('paused', false, {
    timeout: 30_000,
  });
  await expect(page.locator(`${READER} .word-active`)).toHaveCount(1);

  await context.setOffline(false);
});

/** The reader remembers its position, so offline it only has to be confirmed. */
async function openPsalmOffline(page: Page) {
  await page.getByRole('link', { name: 'Read' }).click();
  await expect(page.locator(`${READER} .verse-inline`).first()).toContainText(
    'O praise the LORD',
    { timeout: 30_000 },
  );
}

/**
 * The offline half of the failure story: `narrationRequestFor` needs the
 * network to *prepare* audio, so asking for a download with no connection has
 * to say that rather than failing silently — `2f28b37 fix(narration): say when
 * a download failed instead of going quiet`.
 */
test('asking for a download with no network says why', async ({ page, context }) => {
  await page.goto('/');
  await appReady(page);
  await page.getByRole('link', { name: 'Read' }).click();
  await page.getByRole('button', { name: 'Choose book and chapter' }).click();
  await page.getByRole('button', { name: 'Psalms', exact: true }).click();
  // A chapter with nothing cached for it, so the attempt must reach the network.
  await page.getByRole('button', { name: '150', exact: true }).click();
  await expect(page.locator(`${READER} .verse-inline`).first()).not.toBeEmpty();

  await context.setOffline(true);
  await page.getByRole('button', { name: /Download this chapter/ }).click();

  await expect(
    page.getByRole('button', { name: /No connection|didn't finish/ }),
  ).toBeVisible({ timeout: 60_000 });

  await context.setOffline(false);
});
