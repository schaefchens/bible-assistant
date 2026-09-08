import { expect, test } from '@playwright/test';
import { appReady } from '../support/app';

/**
 * Journey: keep a verse as a card, prove it persisted, then delete it. And
 * make a board, which is a tab on the same strip.
 *
 * Three things here are the app's own shape rather than a test convenience:
 *
 *  - **`New card` matches two buttons.** CLAUDE.md's "two `+` affordances,
 *    deliberately": the labelled one in the right cluster (`+ Card`) and the
 *    empty-state one (`+ New card`). `exact` picks the former.
 *  - **A board tab's accessible name carries its live count** — "All cards ·
 *    1 cards" — so it changes as the test adds cards. Matched by pattern, never
 *    by equality.
 *  - **Deleting goes through a native `confirm()`.** Without a dialog handler
 *    the page blocks and every later action times out.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await appReady(page);
  await page.getByRole('link', { name: 'Cards' }).click();
  // All cards is pinned outside the horizontal scroller — the strip's fixed
  // left end, on screen whatever else is.
  await expect(page.getByRole('button', { name: /^All cards/ })).toBeVisible();
});

test('a verse is kept as a card, survives a reload, and can be deleted', async ({ page }) => {
  await page.getByRole('button', { name: 'New card', exact: true }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill('Fruit of the Spirit');
  await page.getByRole('textbox', { name: /^Verses/ }).fill('Galatians 5:22');
  await page.getByRole('button', { name: 'Save' }).click();

  const card = page.getByRole('button', { name: 'Fruit of the Spirit' });
  await expect(card).toBeVisible();
  // The tab's count is derived from the live cards, not from stored ids. It is
  // asserted on the *accessible* name rather than the text: the tab renders the
  // number as a bare badge ("All cards1") and only the label spells it out — so
  // this is also where the pluralisation shows ("1 card", not "1 cards").
  await expect(page.getByRole('button', { name: /^All cards/ })).toHaveAccessibleName(
    /^All cards\s*·\s*1 card$/,
  );

  // Reload: proves Dexie has it, not just React.
  await page.reload();
  await appReady(page);
  await expect(page.getByRole('button', { name: 'Fruit of the Spirit' })).toBeVisible();

  page.once('dialog', (dialog) => {
    expect(dialog.message()).toBe('Delete this card?');
    void dialog.accept();
  });
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('button', { name: 'Delete' }).click();

  await expect(page.getByRole('button', { name: 'Fruit of the Spirit' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^All cards/ })).toHaveAccessibleName(
    /^All cards\s*·\s*0 cards$/,
  );
});

/**
 * The tab strip *is* the board selector — one screen, one strip — and the
 * selected tab is `libraryStore.activeBoardId`, with `null` meaning All cards.
 */
test('a board becomes a tab beside All cards, and All cards stays reachable', async ({ page }) => {
  await page.getByRole('button', { name: 'New board' }).click();
  await page.getByRole('textbox', { name: 'Board name' }).fill('Memorize');
  await page.getByRole('button', { name: 'Save' }).click();

  const boardTab = page.getByRole('button', { name: /^Memorize/ });
  await expect(boardTab).toBeVisible();

  await boardTab.click();
  // Selecting a board must never make All cards unreachable — that is exactly
  // what the removed force-select effect used to do.
  const allCards = page.getByRole('button', { name: /^All cards/ });
  await expect(allCards).toBeVisible();
  await allCards.click();
  await expect(allCards).toHaveAttribute('aria-pressed', 'true');
});
