import { expect, type Page } from '@playwright/test';
import { appReady } from './app';

/**
 * Walk the real onboarding wizard, taking the defaults.
 *
 * Shared by the setup project (which saves the resulting profile) and by the
 * two-identity journey (which needs a genuinely separate install). It is here
 * rather than copied because it is one behaviour — "a first-time user gets
 * through onboarding" — and a copy would drift the moment a step is added.
 */
export async function completeOnboarding(page: Page): Promise<void> {
  await page.goto('/');

  // The wizard replaces the whole shell, so there is no nav yet — its own first
  // button is the readiness signal.
  const start = page.getByRole('button', { name: 'Get started' });
  await expect(start).toBeVisible();
  await start.click();

  // What each step *offers* is a journey's business; this only has to reach the
  // end the way someone who accepts the defaults does. Bounded rather than
  // `while (true)`: a wizard that stops advancing should fail, not spin.
  const next = page.getByRole('button', { name: 'Continue' });
  const done = page.getByRole('button', { name: 'Done' });
  for (let step = 0; step < 12; step++) {
    if (await done.isVisible()) break;
    await expect(next, `step ${step + 2} offered no way forward`).toBeVisible();
    await next.click();
  }

  // The last step is Community, and it is skippable by design — "Done" creates
  // nothing. Pressing it is what writes `onboardingComplete`.
  await expect(done).toBeVisible();
  await done.click();

  // Landing on chat with the nav mounted is the app's ready state.
  await appReady(page);
}

/**
 * Turn off the two settings that only get in a headless browser's way.
 *
 *  - "Speak assistant replies" defaults on with `assistantVoice: 'browser'`,
 *    and headless Chromium has *no* speech-synthesis voices, so `speak()` can
 *    fire neither `end` nor `error` and leave a spec waiting forever.
 *  - the feedback beetle is `fixed right, top-1/2, z-30`; on a 390px viewport
 *    Playwright reports "element intercepts pointer events" for anything under
 *    it.
 *
 * Settings groups are collapsibles, so each toggle's group has to be opened
 * first. Asserted rather than best-effort: a silently-skipped toggle leaves the
 * beetle over every screen and the failure surfaces somewhere confusing.
 */
export async function quietTheHarness(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Settings' }).click();
  for (const [group, label] of [
    ['Voice & playback', 'Speak assistant replies automatically'],
    ['Data & app', 'Show the feedback button'],
  ] as const) {
    await page.getByRole('button', { name: group, exact: true }).click();
    const toggle = page.getByRole('checkbox', { name: label });
    await expect(toggle, `settings toggle "${label}" not found under "${group}"`).toBeVisible();
    await toggle.uncheck();
    await expect(toggle).not.toBeChecked();
  }
  await expect(page.getByRole('button', { name: 'Report a bug or send feedback' })).toHaveCount(0);
}
