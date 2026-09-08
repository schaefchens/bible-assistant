import { expect, test as setup } from '@playwright/test';
import { STORAGE_STATE } from '../../../playwright.config';
import { completeOnboarding, quietTheHarness } from '../support/onboard';

/**
 * Walk the real 8-step wizard once and save the profile every journey starts
 * from. This is Playwright's own setup-project pattern, and it buys two things
 * that hand-crafting a `ba.settings` blob would not:
 *
 *   - onboarding is *covered* rather than bypassed, so a break in the wizard
 *     fails here loudly instead of taking every other spec with it;
 *   - no spec has to know the persist version. Seeding `{ state: …, version: 17 }`
 *     by hand means a store bump silently re-runs `migrate`, and the
 *     `version < 14` branch turns server sync on.
 *
 * `/subscribe/:code` is the one route that renders before onboarding (and only
 * on a mobile UA), so nothing here needs to worry about it.
 */
setup('a first-time user completes onboarding', async ({ page }) => {
  await completeOnboarding(page);
  await expect(page.getByRole('link', { name: 'Read' })).toBeVisible();
  await quietTheHarness(page);
  await page.context().storageState({ path: STORAGE_STATE });
});
