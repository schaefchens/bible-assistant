import type { Locator, Page } from '@playwright/test';
import { LONG_PRESS_MS, MOVE_TOLERANCE_PX } from '@/lib/gestureConstants';

/**
 * A long-press drag, as dnd-kit's `MouseSensor` actually recognises one.
 *
 * `page.dragTo()` cannot do this: it presses, moves and releases immediately,
 * which never satisfies the activation delay — so the drag simply does not
 * start and the assertion fails for a reason that has nothing to do with the
 * app.
 *
 * The thresholds are **imported from the app** rather than restated, so an
 * accessibility tweak to `LONG_PRESS_MS` or `MOVE_TOLERANCE_PX` moves this
 * helper with it. That is the whole reason `lib/gestureConstants.ts` exists.
 *
 * Mouse rather than touch on purpose: with `hasTouch` Chromium routes to
 * dnd-kit's `TouchSensor`, whose non-passive `preventDefault` move listener is
 * far harder to drive from outside the page. The gesture under test is the same
 * one either way.
 */
export async function longPressDrag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  opts: { steps?: number } = {},
): Promise<void> {
  const steps = opts.steps ?? 8;

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();

  // Hold perfectly still: any movement beyond MOVE_TOLERANCE_PX during the
  // delay cancels the press and leaves it a swipe.
  await page.waitForTimeout(LONG_PRESS_MS + 150);

  // Stepped, and more than once. dnd-kit needs a move to compute its delta,
  // and `useCardTabDrop` hit-tests a real `pointermove` — a single jump to the
  // target can be missed by both.
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(
      from.x + ((to.x - from.x) * i) / steps,
      from.y + ((to.y - from.y) * i) / steps,
    );
  }
  await page.mouse.up();
}

/**
 * The centre of an element, for the mouse to aim at.
 *
 * Takes a `Locator` rather than a CSS string so callers can use `getByRole`.
 * That matters here: a card's title is its *accessible name*, not its text
 * content, so `button:has-text("…")` matches nothing at all.
 */
export async function centreOf(target: Locator): Promise<{ x: number; y: number }> {
  const box = await target.first().boundingBox();
  if (!box) throw new Error('element has no bounding box — is it rendered?');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export { LONG_PRESS_MS, MOVE_TOLERANCE_PX };
