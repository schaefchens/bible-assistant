import { expect, test, type Page } from '@playwright/test';
import { existsSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { appReady } from '../support/app';

/**
 * The cold path: **this is the only spec that makes OpenAI generate speech.**
 *
 * Everything in `journeys/` reads from the shared, content-addressed cache, so
 * it proves the *read* path and nothing about generation. That leaves the
 * question this spec answers: does `synthesizeAndCacheAudio` — the TTS call,
 * the forced-alignment pass, and the two files it writes — still work?
 *
 * Not in `npm run e2e`. Run `npm run e2e:live` deliberately, before a release
 * or after touching the audio pipeline. It costs a fraction of a cent: one
 * verse, and the shortest one available.
 *
 * It works by moving a cached clip aside, forcing a miss, then restoring it —
 * so the cache the other specs depend on is left exactly as it was, whether
 * this passes or fails.
 */

const VOICE = 'echo';
const REF = { translation: 'KJV', bookId: 19, chapter: 117, verse: 1 };
const dir = join('dist', 'storage', 'audio', VOICE, REF.translation, String(REF.bookId), String(REF.chapter));
const files = [join(dir, `${REF.verse}.mp3`), join(dir, `${REF.verse}.json`)];

async function openPsalm117(page: Page) {
  await page.goto('/');
  await appReady(page);
  await page.getByRole('link', { name: 'Read' }).click();
  await page.getByRole('button', { name: 'Choose book and chapter' }).click();
  await page.getByRole('button', { name: 'Psalms', exact: true }).click();
  await page.getByRole('button', { name: '117', exact: true }).click();
  await expect(page.locator('[data-segment-id] .verse-inline').first()).toContainText(
    'O praise the LORD',
  );
}

test('a cache miss really generates speech, and the highlight still works', async ({ page }) => {
  const moved: [string, string][] = [];
  for (const f of files) {
    if (existsSync(f)) {
      const aside = `${f}.e2e-aside`;
      renameSync(f, aside);
      moved.push([aside, f]);
    }
  }
  expect(moved.length, 'nothing was cached to move aside — is dist/ built?').toBeGreaterThan(0);

  try {
    const results: { cached: boolean; audioUrl?: string }[] = [];
    page.on('requestfinished', async (req) => {
      if (!/action=tts\b/.test(req.url())) return;
      try {
        const json = (await (await req.response())?.json()) as
          | { cached?: boolean; audioUrl?: string }
          | null;
        if (json) results.push({ cached: !!json.cached, audioUrl: json.audioUrl });
      } catch {
        /* ignore */
      }
    });

    await openPsalm117(page);
    await page.getByRole('button', { name: 'Read this chapter aloud' }).click();

    /**
     * Wait for **the verse's own response**, not for the element to start
     * playing. `readChapterHeadings` is on, so the reading opens with a spoken
     * announcement that *is* cached — it starts the audio element within a
     * second or two, long before a cold generation finishes. Asserting on
     * `paused` therefore passed or failed depending on which of the two won,
     * which is exactly the kind of race that makes a suite untrustworthy.
     *
     * Generation is a TTS call plus a forced-alignment pass, so this is the one
     * place in the suite where a long wait is the point rather than a smell.
     */
    await expect
      .poll(() => results.some((r) => r.audioUrl?.endsWith(`/${REF.verse}.mp3`)), {
        timeout: 120_000,
        message: 'no response for the verse whose cache we cleared',
      })
      .toBe(true);

    const first = results.find((r) => r.audioUrl?.endsWith(`/${REF.verse}.mp3`))!;
    expect(first.cached, 'expected a miss — the clip was moved aside').toBe(false);

    await expect(page.locator('[data-ba-audio="verse"]')).toHaveJSProperty('paused', false, {
      timeout: 30_000,
    });

    // Both halves must land: the mp3 and the alignment beside it. Audio with no
    // alignment plays but highlights nothing.
    for (const f of files) {
      expect(existsSync(f), `${f} was not written`).toBe(true);
    }

    // And the freshly generated alignment drives the highlight, which is the
    // only proof the alignment is usable rather than merely present.
    await page.evaluate(() => {
      const el = document.querySelector('[data-ba-audio="verse"]') as HTMLAudioElement | null;
      if (el) el.currentTime = 1.0;
    });
    await expect(page.locator('[data-segment-id] .word-active')).toHaveCount(1);
  } finally {
    // Discard what was just generated and put the originals back. The new clip
    // is byte-different from the one every other spec's alignment assertions
    // were written against, so keeping it would quietly change their fixture.
    for (const [aside, original] of moved) {
      rmSync(original, { force: true });
      renameSync(aside, original);
    }
  }
});
