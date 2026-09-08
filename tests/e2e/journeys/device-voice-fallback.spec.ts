import { expect, test, type Page } from '@playwright/test';
import { appReady } from '../support/app';

/**
 * Journey: reading a chapter whose audio has never been generated, offline.
 *
 * `70dd7b0 fix(playback): read with the device voice instead of silence`. The
 * premium narration needs the network to *prepare* audio, so a chapter with
 * nothing cached and no connection has exactly two possible outcomes — the
 * device voice, or silence — and silence is the bug.
 *
 * The network is cut for real (`context.setOffline`) rather than by
 * intercepting the route, which keeps the no-mocks rule intact and is also a
 * truer test: `readingUsesBrowserVoice` folds "definitely offline" into the
 * engine choice up front, and that is the branch under test.
 *
 * What is asserted is the **notice**, not speech. Headless Chromium ships zero
 * speech-synthesis voices, so `speechSynthesis.speak()` may fire neither `end`
 * nor `error` — asserting audible output would be asserting something the
 * browser cannot do. The notice is the user-visible consequence and the thing
 * that would be missing if the fallback silently did nothing.
 */

const READER = '[data-segment-id]';

/** A chapter with no cached audio, so preparing it genuinely needs the network.
 * (Psalm 117 and Genesis 1 are both warm — they must not be used here.) */
const UNCACHED = { book: 'Obadiah', chapter: '1' };

async function openUncachedChapter(page: Page) {
  await page.goto('/');
  await appReady(page);
  await page.getByRole('link', { name: 'Read' }).click();
  await page.getByRole('button', { name: 'Choose book and chapter' }).click();
  await page.getByRole('button', { name: UNCACHED.book, exact: true }).click();
  await page.getByRole('button', { name: UNCACHED.chapter, exact: true }).click();
  await expect(page.locator(`${READER} .verse-inline`).first()).not.toBeEmpty();
}

test('an unprepared chapter offline reads with the device voice, not silence', async ({
  page,
  context,
}) => {
  // Load the text while online — the pack is already in IndexedDB, so this is
  // about the *audio* being unavailable rather than the words.
  await openUncachedChapter(page);

  const ttsAttempts: string[] = [];
  page.on('request', (r) => {
    if (/action=tts(\.speak)?\b/.test(r.url())) ttsAttempts.push(r.url());
  });

  await context.setOffline(true);
  await page.getByRole('button', { name: 'Read this chapter aloud' }).click();

  // The app says which voice it fell back to, rather than appearing to do
  // nothing. This is the whole user-visible difference between the fix and the
  // bug it replaced.
  await expect(page.getByText('Reading with the device voice.')).toBeVisible({
    timeout: 60_000,
  });
  await expect(
    page.getByText(/The premium voice needs an internet connection/),
  ).toBeVisible();

  // And it decided up front rather than trying and failing per verse:
  // `readingUsesBrowserVoice` folds "definitely offline" into the engine choice,
  // so no doomed request should have gone out at all.
  expect(ttsAttempts, 'offline, the premium path should not be attempted').toEqual([]);

  await context.setOffline(false);
});

/**
 * The other half: a chapter that *is* prepared plays its premium audio offline,
 * because being offline is irrelevant once the plan is fully cached. All or
 * nothing by design — a partial hit would read some verses in one voice and
 * skip the rest.
 */
test('a prepared chapter still plays its premium audio offline', async ({ page, context }) => {
  await page.goto('/');
  await appReady(page);
  await page.getByRole('link', { name: 'Read' }).click();
  await page.getByRole('button', { name: 'Choose book and chapter' }).click();
  await page.getByRole('button', { name: 'Psalms', exact: true }).click();
  await page.getByRole('button', { name: '117', exact: true }).click();
  await expect(page.locator(`${READER} .verse-inline`).first()).toContainText('O praise the LORD');

  // Prepare it, then go offline.
  await page.getByRole('button', { name: /Download this chapter/ }).click();
  await expect(page.getByRole('button', { name: 'Downloaded — plays offline' })).toBeVisible({
    timeout: 120_000,
  });
  await context.setOffline(true);

  await page.getByRole('button', { name: 'Read this chapter aloud' }).click();
  await expect(page.locator('[data-ba-audio="verse"]')).toHaveJSProperty('paused', false, {
    timeout: 30_000,
  });
  // Premium audio, so no fallback notice.
  await expect(page.getByText('Reading with the device voice.')).toHaveCount(0);

  await context.setOffline(false);
});
