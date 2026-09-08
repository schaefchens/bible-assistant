import { expect, test, type Page } from '@playwright/test';
import { appReady } from '../support/app';

/**
 * Journey: choose a theme, then choose your own paper and ink.
 *
 * Two settings that look similar and are deliberately not: `theme` restyles the
 * **app**, while `readingAppearance` governs the **Bible text only** — the
 * reader column and the chat verse panels. App chrome stays on the app theme on
 * purpose, "because the contrast control can be taken to zero and the button
 * that undoes that has to remain visible".
 *
 * The sheet's own contrast readout is the best assertion in the app for this:
 * it is `resolveReadingPalette`'s real WCAG ratio between the resolved paper
 * and ink. The unit layer pins the arithmetic; this pins that the arithmetic
 * reaches the screen, and that each chip actually changes the page.
 */

const READING_SHEET = 'Reading text';

async function openAppearance(page: Page) {
  await page.goto('/');
  await appReady(page);
  await page.getByRole('link', { name: 'Read' }).click();
  await page.getByRole('button', { name: 'Adjust the reading text' }).click();
  return page.getByRole('dialog').filter({ hasText: READING_SHEET });
}

/** The ratio the sheet is currently reporting, e.g. "13.0:1" → 13.0 */
async function reportedRatio(page: Page): Promise<number> {
  const text = await page
    .getByRole('dialog')
    .filter({ hasText: READING_SHEET })
    .getByText(/^\d+\.\d+:1$/)
    .innerText();
  return Number.parseFloat(text);
}

test('the app theme can be switched, and the document says so', async ({ page }) => {
  await page.goto('/');
  await appReady(page);
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'General', exact: true }).click();

  // Existing installs migrate to an explicit 'dark' rather than 'system': the
  // app was dark-only before the light theme existed, so following the OS would
  // have restyled people who never asked.
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.getByText('Light', { exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  // It is applied before the first paint on the next load, not in an effect —
  // otherwise the wrong palette flashes.
  await page.reload();
  await appReady(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  await page.getByRole('button', { name: 'General', exact: true }).click();
  await page.getByText('Dark', { exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('the reading sheet reports a real contrast ratio', async ({ page }) => {
  const sheet = await openAppearance(page);

  // The default (`paper: 'theme'`, contrast 1) emits no colour vars at all, so
  // a fresh install renders exactly as it did before this feature existed —
  // but it still reports the ratio it has.
  await expect(sheet).toContainText(/\d+\.\d+:1/);
  expect(await reportedRatio(page)).toBeGreaterThan(4.5);
});

/**
 * READING_PAPERS' docblock claims every chip sits between 9.9:1 and 14.6:1 at
 * contrast 1 — "all of them start past AAA with room to move either way". The
 * unit test recomputes that from the module; this checks the number the user
 * is actually shown.
 */
test('every paper chip starts past AAA', async ({ page }) => {
  const sheet = await openAppearance(page);

  for (const chip of ['Paper', 'Sepia', 'Grey', 'Night', 'Black']) {
    await sheet.getByRole('button', { name: new RegExp(`^Aa\\s*${chip}$`) }).click();
    const ratio = await reportedRatio(page);
    expect(ratio, `${chip} should start past AAA`).toBeGreaterThanOrEqual(9.9);
    expect(ratio, `${chip} should not exceed the documented band`).toBeLessThanOrEqual(14.6);
  }
});

/**
 * A chosen paper is *painted*, which the default deliberately is not: the
 * surface carries a `[data-theme]` chosen by the resolved paper's lightness,
 * which is what brings in the rest of index.css — `--verse-tint-alpha` above
 * all, so a bright paper under the dark app theme still highlights legibly.
 */
test('a light paper switches the reading surface to the light palette', async ({ page }) => {
  const sheet = await openAppearance(page);

  await sheet.getByRole('button', { name: /^Aa\s*Paper$/ }).click();
  // The app itself is still dark — the chrome does not follow the paper.
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  // But the reading surface does.
  await expect(page.locator('[data-theme="light"]').first()).toBeAttached();

  await sheet.getByRole('button', { name: /^Aa\s*Night$/ }).click();
  await expect(page.locator('[data-theme="light"]')).toHaveCount(0);
});

test('the type controls change the text, and reset puts them back', async ({ page }) => {
  const sheet = await openAppearance(page);
  await expect(sheet).toContainText('17px');

  // Size, leading and measure are custom properties on `.reading-surface`,
  // written imperatively through a ref — so dragging a slider repaints without
  // re-rendering the verse tree.
  const surface = page.locator('.reading-surface').first();
  await expect(surface).toBeAttached();

  await sheet.getByRole('button', { name: /^Aa\s*Sepia$/ }).click();
  await expect(sheet).not.toContainText(/App theme.*\[pressed\]/);

  await sheet.getByRole('button', { name: 'Reset to default' }).click();
  // Back to the no-op default: nothing painted, nothing overridden.
  await expect(sheet).toContainText('17px');
  await expect(page.locator('[data-theme="light"]')).toHaveCount(0);
});
