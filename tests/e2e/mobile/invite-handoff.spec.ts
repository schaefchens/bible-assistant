import { expect, test } from '@playwright/test';

/**
 * Journey: an invitation link opened in a phone browser.
 *
 * This is the one flow where **the order of two screens is the whole feature**.
 * Web and native are separate installs with separate identities, so onboarding
 * someone before they have said which one they want sets up the wrong copy of
 * the app — and the common case is that the app is already installed and the
 * link merely opened the browser on the way. So `AppShell` renders the invite
 * route *bare* — no nav, no dock — whenever `needsAppHandOff()` and the user
 * has not chosen to stay.
 *
 * It runs in its own project because it needs an Android user agent:
 * `needsAppHandOff()` tests `navigator.userAgent`, and giving the *main*
 * project a mobile UA would change what every other spec renders.
 *
 * `a4defe9` / `9c0dc22` are the fixes this protects. The invitation used to be
 * eaten by the wizard's `onDone`, which reset to chat unconditionally — with
 * `replace`, so it was not even in history.
 */

const CODE = 'ZZZZZ-ZZZZZ-ZZZZZZ';

test('the hand-off comes before the wizard, not after', async ({ page }) => {
  await page.goto(`/subscribe/${CODE}`);

  // The choice, and nothing else: no nav to navigate with, because the app
  // behind this has not been set up yet.
  await expect(page.getByRole('button', { name: 'Open in the app' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue in the browser' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Chat' })).toHaveCount(0);

  // "Copy code" is not a nicety: in-app browsers (WhatsApp, Instagram) often
  // block scheme navigation, and that is exactly the channel these links travel.
  await expect(page.getByRole('button', { name: 'Copy the code' })).toBeVisible();
});

test('choosing the browser records it in the URL and then onboards', async ({ page }) => {
  await page.goto(`/subscribe/${CODE}`);
  await page.getByRole('button', { name: 'Continue in the browser' }).click();

  // The choice lives in the URL for the same reason the code does: the route is
  // the pending state, so it survives the wizard, a reload, and the wizard's
  // own navigation without anyone having to remember it.
  await expect(page).toHaveURL(/\/subscribe\/.*[?&]web=1/);
  await expect(page.getByRole('button', { name: 'Get started' })).toBeVisible();
});

/**
 * **The invitation has to survive the wizard.** This is the regression that
 * quietly ate every link arriving before onboarding was finished.
 */
test('the invitation is still there after onboarding finishes', async ({ page }) => {
  await page.goto(`/subscribe/${CODE}?web=1`);

  const start = page.getByRole('button', { name: 'Get started' });
  await expect(start).toBeVisible();
  await start.click();

  const next = page.getByRole('button', { name: 'Continue' });
  const done = page.getByRole('button', { name: 'Done' });
  for (let step = 0; step < 12; step++) {
    if (await done.isVisible()) break;
    await expect(next).toBeVisible();
    await next.click();
  }
  await done.click();

  // Still on the invitation — `onDone` must leave this route alone. A fresh run
  // belongs on chat, which is why it resets *otherwise*.
  await expect(page).toHaveURL(new RegExp(`/subscribe/${CODE}`));
  // And the app is set up now, so the invitation can actually be acted on.
  await expect(page.getByRole('link', { name: 'Chat' })).toBeVisible();
});

/**
 * A reader who has not made a profile is not sent to Settings to find their own
 * way back: `space.request` genuinely requires one, so the no-profile branch of
 * the page *is* a name field plus the standards consent.
 */
test('with no profile, the invitation offers to make one', async ({ page }) => {
  await page.goto(`/subscribe/${CODE}?web=1`);
  const start = page.getByRole('button', { name: 'Get started' });
  await expect(start).toBeVisible();
  await start.click();

  const next = page.getByRole('button', { name: 'Continue' });
  const done = page.getByRole('button', { name: 'Done' });
  for (let step = 0; step < 12; step++) {
    if (await done.isVisible()) break;
    await next.click();
  }
  await done.click();

  // The name field is on the invitation itself, not behind a trip to Settings.
  await expect(page.getByRole('textbox', { name: /name/i }).first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole('checkbox', { name: /content standards/ })).toBeVisible();
});
