import { expect, test, type Page } from '@playwright/test';
import { appReady } from '../support/app';

/**
 * Journey: type a request and have the passage read to you.
 *
 * **This calls the real `gpt-4o-mini`**, through the real `api.php` chat proxy,
 * with the real tool definitions and system prompt. That is the point: it is
 * the only thing in the suite that can catch a broken tool schema, a regressed
 * system prompt, or a `handleChat` change — none of which a scripted model can
 * see, because a script asserts the answer you already decided on.
 *
 * The price is that the model is not deterministic, so **every assertion here
 * is behavioural**: did a passage get read? Anything needing exactness — "the
 * duplicate-read guard plays exactly one passage" — belongs in layer 2, where
 * the turns are canned. Getting that boundary wrong is how a suite ends up
 * failing because a model had an opinion.
 *
 * Costs a fraction of a cent per run. Narration stays free: Psalm 117 is
 * already in the shared audio cache.
 */

const composer = (page: Page) => page.getByPlaceholder('What do you want to read?');
/** A verse rendered into the chat transcript, as opposed to the reader. */
const CHAT_VERSES = '[data-message-id] [data-verse-key]';

async function ask(page: Page, text: string) {
  await page.goto('/');
  await appReady(page);
  await composer(page).fill(text);
  // `exact`: the feedback beetle's label is "Report a bug or send feedback",
  // which a substring match also finds.
  await page.getByRole('button', { name: 'Send', exact: true }).click();
}

test('asking for a psalm reads it aloud', async ({ page }) => {
  const tts: { cached: boolean }[] = [];
  page.on('requestfinished', async (req) => {
    if (!/action=tts\b/.test(req.url())) return;
    try {
      const json = (await (await req.response())?.json()) as { cached?: boolean } | null;
      tts.push({ cached: !!json?.cached });
    } catch {
      /* ignore */
    }
  });

  await ask(page, 'read Psalm 117');

  // The model has to answer, choose the tool, and the audio has to build — all
  // over a real network. Generous, and the only long wait in the suite.
  await expect(page.locator(CHAT_VERSES).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-message-id]').last()).toContainText('praise', {
    ignoreCase: true,
  });

  // Reading aloud IS the response, so audio must actually be playing.
  await expect(page.locator('[data-ba-audio="verse"]')).toHaveJSProperty('paused', false, {
    timeout: 30_000,
  });

  // Still free: the passage it read is in the shared cache.
  expect(tts.length).toBeGreaterThan(0);
  expect(
    tts.filter((c) => !c.cached).length,
    'the assistant read something outside the warm cache — this run called OpenAI TTS',
  ).toBe(0);
});

/**
 * A pure reading turn emits **no** chat text — the audio is the reply, and the
 * passage is logged as a `historyNote` so the model can later "continue
 * reading". An assistant paragraph appearing alongside the verses means
 * `READ_TOOL_NAMES` or the suppression in `useCommandPipeline` has drifted.
 */
test('a reading turn does not also narrate itself in text', async ({ page }) => {
  await ask(page, 'please read Psalm 117');
  await expect(page.locator(CHAT_VERSES).first()).toBeVisible({ timeout: 60_000 });

  const last = page.locator('[data-message-id]').last();
  // Whatever prose the bubble holds beyond the verses themselves should be
  // nothing of substance. Verses are `[data-verse-key]` spans; strip them.
  const prose = await last.evaluate((el) => {
    const clone = el.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('[data-verse-key]').forEach((v) => v.remove());
    return (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
  });
  expect(prose.length, `unexpected assistant prose: ${prose.slice(0, 200)}`).toBeLessThan(80);
});

/**
 * A question that is not a reading request should come back as text and start
 * no audio — the other side of the same rule.
 */
test('a question is answered in text, without playing anything', async ({ page }) => {
  await ask(page, 'In one short sentence, who wrote the Psalms?');

  await expect(page.locator('[data-message-id]').last()).not.toBeEmpty({ timeout: 60_000 });
  await expect(page.locator('[data-message-id]').last()).toContainText(/\w{4,}/, {
    timeout: 60_000,
  });
  // No reading was requested, so nothing should be queued.
  await expect(page.locator(CHAT_VERSES)).toHaveCount(0);
});
