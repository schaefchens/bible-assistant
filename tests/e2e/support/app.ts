import { expect, type Page } from '@playwright/test';

/**
 * The app's ready state, and the gate every spec enters through.
 *
 * `main.tsx` awaits `hydrateIdentity()` before `createRoot()`, so the first
 * paint is deliberately deferred — an assertion made too early sees an empty
 * `#root`.
 *
 * Keyed on a nav *tab* rather than on `getByRole('navigation')`, because that
 * role is not unique: `ReaderFooter` is a `<nav>` too, so on `/read` the
 * generic locator is a strict-mode violation. It only bites after a reload
 * there — the reader restores its position — which is exactly the sort of
 * failure that looks like a bug in the app.
 */
export async function appReady(page: Page): Promise<void> {
  await expect(page.getByRole('link', { name: 'Chat' })).toBeVisible();
}
