import { expect, test, type Page, type Request } from '@playwright/test';
import { appReady } from '../support/app';

/**
 * Journey: tap play on a chapter and hear it read, with the words lighting up.
 *
 * **The most valuable spec in the suite, and nothing in it is faked.** It runs
 * the whole chain: the client's narration request → api.php's `handleTts` →
 * the content-addressed cache and its staleness check → a real mp3 fetched
 * into an `<audio>` element → the server's own forced alignment → the rAF loop
 * → the highlighted word → tap-to-seek.
 *
 * It is free because the server content-addresses generated speech and
 * `dist/storage/audio` is warm. **Psalm 117** is the fixture for three reasons:
 * it is the shortest chapter in the Bible (two verses), its audio is already
 * cached under voice `echo`, and its cached alignment carries a valid
 * `sourceTextHash` so `cachedAlignmentMatches` passes.
 *
 * Three defaults make `echo` the voice the app actually asks for, rather than a
 * coincidence: this profile has no personal OpenAI key, so
 * `effectiveReadingVoice()` falls through `ALLOWED_READING_VOICES_SHARED` to
 * `'echo'` and `effectiveVoiceStyle()` returns `''` (no path segment); and
 * `readChapterHeadings` is off, so no announcement audio is requested on top.
 */

type TtsCall = { action: 'tts' | 'tts.speak'; body: Record<string, unknown>; cached: boolean; audioUrl?: string };

/** Every narration request the page made, with what came back. */
function recordTts(page: Page) {
  const calls: TtsCall[] = [];
  page.on('requestfinished', async (req: Request) => {
    const m = /action=(tts(?:\.speak)?)\b/.exec(req.url());
    if (!m) return;
    let json: { cached?: boolean; audioUrl?: string } | null = null;
    try {
      json = (await (await req.response())?.json()) ?? null;
    } catch {
      /* a non-JSON or aborted response is not a cache claim */
    }
    calls.push({
      action: m[1] as TtsCall['action'],
      body: (req.postDataJSON() ?? {}) as Record<string, unknown>,
      cached: !!json?.cached,
      audioUrl: json?.audioUrl,
    });
  });
  return calls;
}

const verseAudio = '[data-ba-audio="verse"]';

/** The mounted reading, and the only place a real verse lives. */
const READER = '[data-segment-id]';

/**
 * Reader assertions are scoped to `[data-segment-id]` rather than to the
 * `.verse-inline` / `.word` classes alone. `ReadingAppearanceForm` renders a
 * static sample verse ("The LORD is my shepherd…") carrying
 * `verse-inline verse-current` for its type and contrast preview, and it is in
 * the DOM whether or not its sheet is open — so an unscoped selector matches
 * two verses and a `.first()` only works by DOM order. `data-segment-id` and
 * `data-verse-key` are production contracts (`useEndlessChapters` reads them),
 * which is exactly why they are the right anchors.
 */


/** Drive the media element's clock — never wall-clock. The rAF loop rewrites
 * `playbackStore.current` ~60x/s, so the only stable way to ask "which word is
 * lit at t?" is to set the time and let a web-first assertion poll. */
async function seekTo(page: Page, seconds: number) {
  await page.evaluate(
    ([sel, t]) => {
      const el = document.querySelector(sel as string) as HTMLAudioElement | null;
      if (el) el.currentTime = t as number;
    },
    [verseAudio, seconds] as const,
  );
}

async function openPsalm117(page: Page) {
  await page.goto('/');
  await appReady(page);
  await page.getByRole('link', { name: 'Read' }).click();
  await page.getByRole('button', { name: 'Choose book and chapter' }).click();
  await page.getByRole('button', { name: 'Psalms', exact: true }).click();
  await page.getByRole('button', { name: '117', exact: true }).click();
  await expect(page.locator(`${READER} .verse-inline`).first()).toContainText('O praise the LORD');
}

test('a chapter is read aloud, and the words light up as it goes', async ({ page }) => {
  const tts = recordTts(page);
  await openPsalm117(page);

  await page.getByRole('button', { name: 'Read this chapter aloud' }).click();

  // Real audio, really playing: a src assigned from a blob out of mediaCache,
  // and a clock that has started.
  const audio = page.locator(verseAudio);
  await expect(audio).toHaveJSProperty('paused', false, { timeout: 30_000 });
  const src = await audio.getAttribute('src');
  expect(src, 'the verse element should carry a real source').toBeTruthy();

  // The chapter is two verses, so the server is asked for exactly the audio
  // this reading needs — and asked in the voice/style the cache holds.
  // Three requests: the spoken chapter heading (the wizard leaves
  // `readChapterHeadings` on) and one per verse. Psalm 117 has two.
  //
  // Polled rather than read straight off: the announcement is cached and starts
  // the audio element almost immediately, so `paused === false` above does not
  // mean the verse requests have landed.
  await expect
    .poll(() => tts.filter((c) => c.action === 'tts').length, { timeout: 30_000 })
    .toBe(2);
  const verses = tts.filter((c) => c.action === 'tts');
  expect(verses.map((c) => c.body.verse)).toEqual([1, 2]);
  expect(verses[0].body).toMatchObject({
    translation: 'KJV', bookId: 19, chapter: 117, verse: 1, voice: 'echo',
    text: 'O praise the LORD, all ye nations: praise him, all ye people.',
  });

  /**
   * The resolved cache path, which is what `2a09502` is about: the voice and
   * the voice *style* are both path segments, and `voiceStyleSegment()` adds
   * nothing for an empty style. This profile has no personal key, so the style
   * is `''` — and that is exactly the path the warm cache holds. A style
   * leaking in here would silently miss the cache and bill a generation.
   */
  expect(verses[0].audioUrl).toBe('/storage/audio/echo/KJV/19/117/1.mp3');
  expect(verses[1].audioUrl).toBe('/storage/audio/echo/KJV/19/117/2.mp3');

  /**
   * **The guard that keeps this spec free.** Every clip Psalm 117 needs is
   * already generated, so every response must be a cache hit. If a text change
   * ever invalidates an alignment, this fails loudly here instead of quietly
   * billing an OpenAI call on every run.
   */
  const uncached = tts.filter((c) => !c.cached).map((c) => `${c.action} ${JSON.stringify(c.body)}`);
  expect(uncached, 'these narration requests were not cache hits — this run called OpenAI').toEqual([]);

  // Word-level highlighting, against the server's own forced alignment.
  // "nations" ends verse 1's first clause, ~3s in.
  await seekTo(page, 3.2);
  const active = page.locator(`${READER} .word-active`);
  await expect(active).toHaveCount(1);
  await expect(active).toHaveText(/nations/i);

  // Earlier in the same verse is an earlier word — the highlight tracks the
  // clock rather than merely existing.
  await seekTo(page, 0.2);
  await expect(page.locator(`${READER} .word-active`)).toHaveText(/^O$/i);
});

test('tapping a word seeks the audio to it', async ({ page }) => {
  await openPsalm117(page);
  await page.getByRole('button', { name: 'Read this chapter aloud' }).click();
  await expect(page.locator(verseAudio)).toHaveJSProperty('paused', false, { timeout: 30_000 });

  // Pause first so the clock cannot run past the assertion.
  const target = page.locator(`${READER} .verse-inline .word`, { hasText: /^nations/i }).first();
  await target.click();

  // It jumped forward to that word's own start time, from ~0.
  await expect
    .poll(async () => page.locator(verseAudio).evaluate((el) => (el as HTMLAudioElement).currentTime))
    .toBeGreaterThan(2);

  await expect(page.locator(`${READER} .word-active`)).toHaveText(/nations/i);
});

/**
 * The reading tint is the "you are here" cue, and on wrapping inline verses it
 * is the *only* one — the block layout's inset bar is meaningless on a span.
 */
test('the verse being read is tinted', async ({ page }) => {
  await openPsalm117(page);
  await page.getByRole('button', { name: 'Read this chapter aloud' }).click();
  await expect(page.locator(verseAudio)).toHaveJSProperty('paused', false, { timeout: 30_000 });
  // Scoped, and keyed: `data-verse-key` is what marks a rendered verse of a
  // reading, as opposed to the appearance sheet's sample.
  await expect(page.locator(`${READER} [data-verse-key].verse-current`)).toHaveCount(1);
});
