import { expect, test, type Page } from '@playwright/test';
import { appReady } from '../support/app';

/**
 * Journey: the app's single mic-plus-transport control.
 *
 * It replaced a mic in one corner and a playback bar in the opposite one, and
 * a new install gets the **docked bar** — it covers no content, its controls
 * are laid out for a thumb, and it needs no discovering.
 *
 * The thing worth testing is the geometry, because it is the whole reason the
 * bar is built the way it is: **Play sits on the bar's centre line.** The mic
 * occupies the right end, so a plain row would put Play half a mic left of
 * centre; instead the bar is a three-column grid whose outer columns are
 * `minmax(0, 1fr)` — free space split evenly with no content floor — with the
 * mic passed *into* the grid rather than being its sibling. `1fr` instead of
 * `minmax(0, …)` widens the right column on a narrow phone and shoves Play off
 * centre, which is the one thing the layout exists to prevent.
 */

const MIC = 'Tap to speak';

async function playPsalm117(page: Page) {
  await page.goto('/');
  await appReady(page);
  await page.getByRole('link', { name: 'Read' }).click();
  await page.getByRole('button', { name: 'Choose book and chapter' }).click();
  await page.getByRole('button', { name: 'Psalms', exact: true }).click();
  await page.getByRole('button', { name: '117', exact: true }).click();
  await page.getByRole('button', { name: 'Read this chapter aloud' }).click();
  await expect(page.locator('[data-ba-audio="verse"]')).toHaveJSProperty('paused', false, {
    timeout: 30_000,
  });
}

test('a new install gets the docked bar, and it covers no content', async ({ page }) => {
  await page.goto('/');
  await appReady(page);

  const mic = page.getByRole('button', { name: MIC });
  await expect(mic).toBeVisible();

  // Docked, the dock is a flex child of the shell's column — in flow, above the
  // nav — which is the whole reason to choose it over a floater. A floating mic
  // would be `position: fixed`.
  const position = await mic.evaluate((el) => {
    let node: HTMLElement | null = el as HTMLElement;
    while (node) {
      if (getComputedStyle(node).position === 'fixed') return 'fixed';
      node = node.parentElement;
    }
    return 'in-flow';
  });
  expect(position, 'a fresh install should dock the mic, not float it').toBe('in-flow');
});

test('with nothing playing the dock is just the mic', async ({ page }) => {
  await page.goto('/');
  await appReady(page);
  await expect(page.getByRole('button', { name: MIC })).toBeVisible();
  // No transport until there is something to transport.
  await expect(page.getByRole('button', { name: 'Previous' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Pause$|^Play$/ })).toHaveCount(0);
});

test('Play sits exactly on the bar’s centre line', async ({ page }) => {
  await playPsalm117(page);

  const play = page.getByRole('button', { name: /^Pause$|^Play$/ }).first();
  await expect(play).toBeVisible();

  const box = (await play.boundingBox())!;
  const viewport = page.viewportSize()!;
  const offCentre = Math.abs(box.x + box.width / 2 - viewport.width / 2);

  // Documented as "dead centre at every width", measured at 280–430px. A pixel
  // of slack for sub-pixel layout; a `1fr` regression moves it by half a mic.
  expect(offCentre, `Play is ${offCentre.toFixed(2)}px off centre`).toBeLessThan(1.5);
});

test('Prev and Next flank it symmetrically', async ({ page }) => {
  await playPsalm117(page);

  const centreX = async (name: string | RegExp) => {
    const b = (await page.getByRole('button', { name }).first().boundingBox())!;
    return b.x + b.width / 2;
  };
  const [prev, play, next] = await Promise.all([
    centreX('Previous'),
    centreX(/^Pause$|^Play$/),
    centreX('Next'),
  ]);

  // Prev and Next are the same width, so Play is the middle of the middle.
  expect(Math.abs(play - prev - (next - play))).toBeLessThan(1.5);
  // And the order is never mirrored: Prev | Play | Next, always.
  expect(prev).toBeLessThan(play);
  expect(play).toBeLessThan(next);
});

/**
 * The width ladder. At 390px the two reading toggles have stepped aside — they
 * duplicate rows in the gear sheet — and the gear has crossed into the room
 * they left. The word-seeks are still here; they go at 360.
 */
test('at 390px the word-seeks are present and the reading toggles are not', async ({ page }) => {
  await playPsalm117(page);

  // The button form of the arrow keys: same `seekByWords`, same step.
  await expect(page.getByRole('button', { name: 'Back 5 words' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Forward 5 words' })).toBeVisible();

  // Hands-free is here because the chat header is its only other way in — so
  // on /read this is the only one.
  await expect(page.getByRole('button', { name: 'Hands-free mode' })).toBeVisible();
  // The gear, which carries what the hidden toggles would have offered.
  await expect(page.getByRole('button', { name: 'Playback' })).toBeVisible();

  // Rendered twice with complementary visibility rather than switched in JS, so
  // `display: none` keeps the hidden copy out of the accessibility tree.
  await expect(page.getByRole('button', { name: 'Auto-play next passage' })).toHaveCount(0);
});

test('the word-seek moves the audio, and pause stops it', async ({ page }) => {
  await playPsalm117(page);
  const audio = page.locator('[data-ba-audio="verse"]');

  await page.getByRole('button', { name: 'Forward 5 words' }).click();
  await expect
    .poll(() => audio.evaluate((el) => (el as HTMLAudioElement).currentTime))
    .toBeGreaterThan(0.3);

  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(audio).toHaveJSProperty('paused', true);

  // Pausing must not take away the button you would resume with.
  await expect(page.getByRole('button', { name: /^Play$|^Pause$/ })).toBeVisible();
});

/**
 * The dock is mounted in the shell, not per page, so the transport follows you
 * between screens rather than being torn down and rebuilt — and the chrome
 * stack stays `nav → dock bar → page bar`, so it must not jump as you change
 * route.
 */
test('the transport follows you to another screen', async ({ page }) => {
  await playPsalm117(page);
  const play = page.getByRole('button', { name: /^Pause$|^Play$/ }).first();
  const before = (await play.boundingBox())!;

  await page.getByRole('link', { name: 'Cards' }).click();
  await expect(page.getByRole('button', { name: /^All cards/ })).toBeVisible();

  // Still there, still playing, still centred.
  await expect(page.getByRole('button', { name: /^Pause$|^Play$/ })).toBeVisible();
  const after = (await page.getByRole('button', { name: /^Pause$|^Play$/ }).first().boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(Math.abs(after.x + after.width / 2 - viewport.width / 2)).toBeLessThan(1.5);
  // The bar does not jump vertically between routes.
  expect(Math.abs(after.y - before.y)).toBeLessThan(1.5);
});
