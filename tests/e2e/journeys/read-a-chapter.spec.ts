import { expect, test } from '@playwright/test';
import { appReady } from '../support/app';

/**
 * Journey: open the reader, find a chapter, read it, page around.
 *
 * Everything here is real — the Zefania XML is parsed by the api.php in
 * `dist/`, and the text on screen is the text that ships.
 */

/** The mounted reading. See hear-it-read.spec.ts for why this scope matters. */
const READER = '[data-segment-id]';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await appReady(page);
});

test('a reader opens the Bible and reads Psalm 117', async ({ page }) => {
  await page.getByRole('link', { name: 'Read' }).click();

  // The picker is the way in — the same sheet the chat header uses.
  await page.getByRole('button', { name: 'Choose book and chapter' }).click();
  await page.getByRole('button', { name: 'Psalms', exact: true }).click();
  await page.getByRole('button', { name: '117', exact: true }).click();

  // The real KJV text, verbatim from public/bibles/kjv.xml.
  await expect(page.locator(`${READER} .verse-inline`).first()).toContainText(
    'O praise the LORD, all ye nations',
  );
  await expect(page.locator(READER)).toContainText('Praise ye the LORD');

  // Verse numbers are superscripts inside the flowing prose, not one verse per
  // line — the layout the reader exists to provide.
  await expect(page.locator(`${READER} .verse-inline sup`).first()).toBeVisible();

  // A whole chapter is one segment, keyed by a deterministic group id so
  // scrolling away and back re-binds queued audio to it.
  await expect(page.locator('[data-segment-id]')).toHaveCount(1);
  await expect(page.locator('[data-segment-id]')).toHaveAttribute(
    'data-segment-id',
    'reader:KJV:19:117',
  );
});

test('the pager walks forward and back', async ({ page }) => {
  await page.getByRole('link', { name: 'Read' }).click();
  await page.getByRole('button', { name: 'Choose book and chapter' }).click();
  await page.getByRole('button', { name: 'Psalms', exact: true }).click();
  await page.getByRole('button', { name: '117', exact: true }).click();

  const segment = page.locator('[data-segment-id]');
  await expect(segment).toHaveAttribute('data-segment-id', 'reader:KJV:19:117');

  await page.getByRole('button', { name: 'Next chapter' }).click();
  await expect(segment).toHaveAttribute('data-segment-id', 'reader:KJV:19:118');

  await page.getByRole('button', { name: 'Previous chapter' }).click();
  await expect(segment).toHaveAttribute('data-segment-id', 'reader:KJV:19:117');
});

/**
 * Paragraph breaks are computed, not editorial — none of the eight source
 * Bibles carries paragraph markup. So a chapter long enough to break must
 * actually break, and never mid-sentence.
 */
test('a long chapter is broken into paragraphs', async ({ page }) => {
  await page.getByRole('link', { name: 'Read' }).click();
  await page.getByRole('button', { name: 'Choose book and chapter' }).click();
  await page.getByRole('button', { name: 'Genesis', exact: true }).click();
  await page.getByRole('button', { name: '1', exact: true }).click();

  await expect(page.locator(`${READER} .verse-inline`).first()).toContainText('In the beginning');
  // 31 verses at a 4-verse minimum: several paragraphs, not one wall of text.
  const paragraphs = page.locator(`${READER} p`);
  expect(await paragraphs.count()).toBeGreaterThan(1);
});
