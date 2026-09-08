import { expect, test, type Page } from '@playwright/test';
import { appReady } from '../support/app';
import { centreOf, longPressDrag } from '../support/gestures';

/**
 * Journey: long-press a card in All cards, carry it up to a board's tab, drop.
 *
 * The most intricate gesture in the app, and the one with the most written
 * about it in CLAUDE.md — four load-bearing details, none of which is visible
 * from the outside:
 *
 *  - **the finger is hit-tested, not the card**, which is what lets the card
 *    keep its vertical clamp and still reach a tab at the far end of the strip;
 *  - the carried card gives up pointer events, or it would be what
 *    `elementFromPoint` answers with;
 *  - the pointer comes from a real `pointermove`, not dnd-kit's delta, which
 *    carries scroll compensation;
 *  - the drop is offered *before* the carry state is torn down.
 *
 * And the reason it needs a test more than most: **a successful drop changes
 * nothing in the list.** The card stays in All cards. All the feedback is in
 * the tab — which is exactly the kind of thing that can quietly stop working.
 */

const CARD = 'Frucht des Geistes';

async function setUp(page: Page) {
  await page.goto('/');
  await appReady(page);
  await page.getByRole('link', { name: 'Cards' }).click();
  await expect(page.getByRole('button', { name: /^All cards/ })).toBeVisible();

  // A board to aim at.
  await page.getByRole('button', { name: 'New board' }).click();
  await page.getByRole('textbox', { name: 'Board name' }).fill('Merken');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('button', { name: /^Merken/ })).toBeVisible();

  // Back to All cards before making the card. Creating a board *selects* it,
  // and the labelled "New card" button deliberately shows only on All cards —
  // a card made while a board is selected would still be a card outside every
  // board. (The drag affordance is All-cards-only for the same reason.)
  await page.getByRole('button', { name: /^All cards/ }).click();

  await page.getByRole('button', { name: 'New card', exact: true }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill(CARD);
  await page.getByRole('textbox', { name: /^Verses/ }).fill('Galatians 5:22');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('button', { name: CARD })).toBeVisible();
}

test('a card is carried onto a board’s tab and joins it', async ({ page }) => {
  await setUp(page);

  // The board holds nothing yet. The count comes from the live cards, not from
  // the board's stored ids — deleting a card does not rewrite the boards
  // holding it, so the stored ids overcount.
  await expect(page.getByRole('button', { name: /^Merken/ })).toHaveAccessibleName(
    /Merken\s*·\s*0 cards/,
  );

  const card = await centreOf(page.getByRole('button', { name: CARD }));
  const tab = await centreOf(page.locator('[data-board-tab]'));
  await longPressDrag(page, card, tab);

  // It joined.
  await expect(page.getByRole('button', { name: /^Merken/ })).toHaveAccessibleName(
    /Merken\s*·\s*1 card/,
  );

  // **And it is still in All cards** — the drop adds, it does not move. This is
  // the assertion the feature is built around, and the reason the tab has to
  // carry all the feedback.
  await expect(page.getByRole('button', { name: CARD })).toBeVisible();
  await expect(page.getByRole('button', { name: /^All cards/ })).toHaveAccessibleName(
    /All cards\s*·\s*1 card/,
  );
});

test('the board really holds it, not just the count', async ({ page }) => {
  await setUp(page);
  const card = await centreOf(page.getByRole('button', { name: CARD }));
  const tab = await centreOf(page.locator('[data-board-tab]'));
  await longPressDrag(page, card, tab);

  // Select the board: the tab strip *is* the selector.
  await page.getByRole('button', { name: /^Merken/ }).click();
  await expect(page.getByRole('button', { name: CARD })).toBeVisible();

  // And it survives a reload, so the board's cardIds were persisted.
  await page.reload();
  await appReady(page);
  await expect(page.getByRole('button', { name: CARD })).toBeVisible();
});

/**
 * The All-cards tab carries no `data-board-tab`, so it is not a target — every
 * card is already in it. Dropping there must leave the library alone rather
 * than erroring or duplicating.
 */
test('All cards is not a drop target', async ({ page }) => {
  await setUp(page);

  const card = await centreOf(page.getByRole('button', { name: CARD }));
  const allCards = await centreOf(page.getByRole('button', { name: /^All cards/ }));
  await longPressDrag(page, card, allCards);

  await expect(page.getByRole('button', { name: CARD })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Merken/ })).toHaveAccessibleName(
    /Merken\s*·\s*0 cards/,
  );
  await expect(page.getByRole('button', { name: /^All cards/ })).toHaveAccessibleName(
    /All cards\s*·\s*1 card/,
  );
});

/**
 * A swipe pans, a hold drags. Movement inside `MOVE_TOLERANCE_PX` of the delay
 * is what separates them, and getting that wrong means the list cannot be
 * scrolled at all — which is what `c0c4d38` was about at the strip end.
 */
test('a quick swipe does not carry the card anywhere', async ({ page }) => {
  await setUp(page);

  const card = await centreOf(page.getByRole('button', { name: CARD }));
  const tab = await centreOf(page.locator('[data-board-tab]'));

  // No hold: press, move, release — a pan, not a drag.
  await page.mouse.move(card.x, card.y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(card.x, card.y - ((card.y - tab.y) * i) / 6);
  }
  await page.mouse.up();

  await expect(page.getByRole('button', { name: /^Merken/ })).toHaveAccessibleName(
    /Merken\s*·\s*0 cards/,
  );
});
