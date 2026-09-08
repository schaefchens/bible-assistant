import { expect, test, type Page } from '@playwright/test';
import { appReady } from '../support/app';

/**
 * Journey: the ways a share code can fail to work, and what the reader is told.
 *
 * `471d36c fix(spaces): one answer to "is this my own code", and say when a
 * code is unknown` is the reason this exists. Every one of these goes through
 * the real `space.request` / `space.peek`, so the branch under test is the
 * server's answer rather than a guess about it.
 *
 * The messages matter more than usual here: a code is an *address*, not a key,
 * and a reader who pastes one and gets nothing has no way to tell whether they
 * mistyped it, whether it was replaced, or whether it is their own.
 */

const CODE_FIELD = /Add a space by code/;

/**
 * Every spec in the `app` project starts from the *same* saved profile, so they
 * share one mnemonic and therefore one server user directory — spaces made by
 * an earlier spec are still there. Names are unique per spec for that reason;
 * a count assertion on a shared name passes alone and fails in a full run.
 * (`run.mjs` resets per-user state once per run, not per spec.)
 */
const SPACE = 'Eigener Raum';

async function makeProfile(page: Page, name: string) {
  await page.goto('/');
  await appReady(page);
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Community', exact: true }).click();
  await page.getByRole('textbox', { name: 'Display name' }).fill(name);
  await page.getByRole('checkbox', { name: /content standards/ }).check();
  await page.getByRole('button', { name: 'Create a profile' }).click();
  await expect(page.getByRole('textbox', { name: 'Display name' })).toHaveValue(name);
  await page.getByRole('link', { name: 'Spaces' }).click();
}

test('a well-formed code nobody answers to says so, and says why', async ({ page }) => {
  await makeProfile(page, 'Leser');

  // Shaped like a code (so `normalizeSpaceCode` accepts it and the field
  // submits itself) but no space has it.
  await page.getByRole('textbox', { name: CODE_FIELD }).fill('ZZZZZ-ZZZZZ-ZZZZZZ');

  // Not just "that failed": the message names replacement as the likely cause,
  // because rotating a code is the one share action that invalidates old ones.
  await expect(page.locator('main')).toContainText(/No space answers to that code/, {
    timeout: 30_000,
  });
});

/**
 * Refused in two places for the usual reason: the client refuses before the
 * network so it can *explain*, and `space.request` refuses with 409 `own_space`
 * because a modified client would otherwise skip the first. Allowed, it wrote
 * an invitation from yourself into your own inbox and listed the space twice
 * everywhere a space is listed.
 */
test('your own code is refused, and named as your own', async ({ page }) => {
  await makeProfile(page, 'Christoph');

  const spaceSynced = page.waitForResponse(
    (r) => r.url().includes('action=spaces.upsert') && r.ok(),
  );
  await page.getByRole('button', { name: /New space/ }).click();
  await page.getByRole('textbox', { name: 'Name' }).fill(SPACE);
  const code = (await page.getByText(/^[0-9A-Z]{5}-[0-9A-Z]{5}-[0-9A-Z]{6}$/).innerText()).trim();
  await spaceSynced;

  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('textbox', { name: CODE_FIELD }).fill(code);

  await expect(page.locator('main')).toContainText(/your own space/i, { timeout: 30_000 });
  // And it is still listed once, not twice — which is what allowing it did:
  // the space appeared both as one of yours and as one you follow.
  await expect(page.getByRole('button', { name: new RegExp(SPACE) })).toHaveCount(1);
});

/**
 * `parseSpaceCodeInput` decides when the field has a code yet — which is what
 * lets it submit itself with no button, on the keystroke a paste lands. Text
 * that is not a code must simply sit there rather than firing a request per
 * character.
 */
test('text that is not a code sends nothing at all', async ({ page }) => {
  await makeProfile(page, 'Leser');

  const requests: string[] = [];
  page.on('request', (r) => {
    if (/action=space\.(request|peek)/.test(r.url())) requests.push(r.url());
  });

  await page.getByRole('textbox', { name: CODE_FIELD }).fill('hello there');
  await page.waitForTimeout(1500);

  expect(requests, 'a non-code must not reach the server').toEqual([]);
});
