import { expect, test, type Browser, type Page } from '@playwright/test';
import { appReady } from '../support/app';
import { BASE_URL } from '../../../playwright.config';
import { completeOnboarding, quietTheHarness } from '../support/onboard';

/**
 * Journey: one person publishes, another subscribes by code and reads it.
 *
 * **The most valuable journey in the suite, and the only one that needs two
 * identities.** `community:verify:api` already exercises the server side
 * exhaustively — approval gating, blocked subscribers, code rotation, the feed
 * projection leaking no uuid. What it structurally *cannot* cover is the
 * client's half, because the server never sees a private key: it stores
 * signatures and never mints them. So "Bob pinned Alice's key from the code and
 * verified what he read" is untested anywhere else, and faking it would mean
 * faking ed25519 — i.e. faking the thing under test.
 *
 * Two browser contexts, two silently-minted mnemonics, one real PHP backend.
 * Everything crosses the wire: `profile.set`, `spaces.upsert`, `posts.upsert`
 * with a real signature, `space.request`, `members.decide`, `space.feed`,
 * `items.upsert` and `space.item`.
 *
 * A room holds plans as well as pieces, so the journey covers both rather than
 * splitting: it is one capability — "share something, someone else reads it" —
 * and the second identity is the expensive part, not the second item.
 * Moderation runs for real too — `MODERATION_POLICY` on `gpt-4o` — which is
 * why the piece below is plainly on-theme.
 */

const AUTHOR = 'Christoph';
const SPACE = 'Gedanken';
const TITLE = 'Ein Morgen am Fluss';
const PLAN = 'Jona in zwei Tagen';
const BODY = [
  'Am Morgen sass ich am Fluss und dachte an das Wort des Herrn.',
  '',
  'Sein Wort ist eine Leuchte fuer meinen Fuss und ein Licht auf meinem Weg.',
].join('\n');

/**
 * A second, genuinely separate install: a fresh browser profile that walks the
 * wizard itself, so `hydrateIdentity()` mints it its own mnemonic once and
 * keeps it.
 *
 * Deliberately **not** the setup profile with the mnemonic deleted. That was
 * the first attempt and it is a trap: `addInitScript` runs on *every*
 * navigation, so each reload minted a new identity while the subscription
 * stayed in Dexie — leaving a reader whose `space.feed` is called as somebody
 * who never asked, permanently "waiting for approval". Two identities also has
 * to mean two identities for a plainer reason: `space.request` refuses your own
 * space with 409 `own_space`.
 */
async function secondInstall(browser: Browser) {
  const context = await browser.newContext({
    // `baseURL` has to be restated — a context made this way has nothing to
    // resolve `/` against.
    baseURL: BASE_URL,
    viewport: { width: 390, height: 844 },
    locale: 'en-US',
    timezoneId: 'Europe/Berlin',
    // **The load-bearing line.** This context *does* pick up the project's
    // `use.storageState`, so without the override Bob boots with the setup
    // profile's mnemonic — the same identity as Alice. The symptom is not an
    // error: the space is subscribed, the request is filed under a different
    // user, and the reader sits on "waiting for approval" forever while the
    // server is perfectly correct.
    storageState: undefined,
  });
  const page = await context.newPage();
  await completeOnboarding(page);
  await quietTheHarness(page);
  return { context, page };
}

async function makeProfile(page: Page, name: string) {
  await page.goto('/');
  await appReady(page);
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Community', exact: true }).click();
  await page.getByRole('textbox', { name: 'Display name' }).fill(name);
  // `enableCommunity` refuses without an accepted version of the content
  // standards, so the gate is part of the flow rather than a detour.
  await page.getByRole('checkbox', { name: /content standards/ }).check();
  await page.getByRole('button', { name: 'Create a profile' }).click();
  // Creating a profile turns server sync on — that is what makes sharing work.
  await expect(page.getByRole('textbox', { name: 'Display name' })).toHaveValue(name);
}

test('a piece is published, shared by code, accepted, and read by someone else', async ({
  page,
  context,
}) => {
  // ── Alice writes and publishes ───────────────────────────────────────────
  await makeProfile(page, AUTHOR);
  await page.getByRole('link', { name: 'Shelves' }).click();
  // The space has to reach the server before its code means anything: a
  // `space.request` for a code the server has never seen is a 404, and
  // `shouldDropSyncOp` treats a 404 as permanent. Waiting on the actual
  // response is the only honest gate — the alternative is a sleep that is
  // either flaky or slow.
  const spaceSynced = page.waitForResponse(
    (r) => r.url().includes('action=spaces.upsert') && r.ok(),
  );
  await page.getByRole('button', { name: /New shelf/ }).click();
  await page.getByRole('textbox', { name: 'Name' }).fill(SPACE);
  await spaceSynced;

  // The share code is minted with the space. It is an *address*, not a key:
  // holding it buys the ability to ask, and the accept below is the gate.
  const code = (await page.getByText(/^[0-9A-Z]{5}-[0-9A-Z]{5}-[0-9A-Z]{6}$/).innerText()).trim();
  expect(code).toMatch(/^[0-9A-Z]{5}-[0-9A-Z]{5}-[0-9A-Z]{6}$/);

  await page.getByRole('button', { name: /New piece/ }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill(TITLE);
  await page.getByRole('textbox', { name: 'Your text' }).fill(BODY);
  await page.getByRole('button', { name: 'de' }).click();

  // Publishing signs the post on the device and asks the server to moderate it.
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText(TITLE).first()).toBeVisible({ timeout: 60_000 });

  // ── Bob subscribes with the code ─────────────────────────────────────────
  const { context: bobContext, page: bob } = await secondInstall(context.browser()!);
  try {
    await makeProfile(bob, 'Leser');
    await bob.getByRole('link', { name: 'Shelves' }).click();

    // The code field is in the header, left of "new space", and submits itself
    // the moment `parseSpaceCodeInput` says the input is a code — which is the
    // moment a paste lands. No button.
    await bob.getByRole('textbox', { name: /Add a shelf by code/ }).fill(code);
    await bob.getByRole('button', { name: /^You are reading/ }).click();
    await expect(bob.locator('main')).toContainText(SPACE, { timeout: 30_000 });

    // Holding the code is not access: the author has not decided yet.
    await expect(bob.locator('main')).not.toContainText(TITLE);

    // ── Alice accepts ──────────────────────────────────────────────────────
    await page.reload();
    await page.getByRole('link', { name: 'Shelves' }).click();
    await page.getByRole('button', { name: new RegExp(SPACE) }).first().click();
    const accept = page.getByRole('button', { name: /Accept|Allow/ }).first();
    await expect(accept, 'the request should appear in the owner’s space').toBeVisible({
      timeout: 30_000,
    });
    // The decision is written locally and then rides the sync queue, so wait
    // for it to actually reach the server rather than for the button to react.
    const decided = page.waitForResponse(
      (r) => r.url().includes('action=members.decide') && r.ok(),
    );
    await accept.click();
    await decided;
    await expect(page.locator('main')).toContainText('Leser');

    // ── Bob reads it, verified ─────────────────────────────────────────────
    // Updates between two people are **polled, not pushed**: 15s while a
    // community screen is mounted, plus a full refresh on returning to the
    // foreground. So this reloads rather than waiting on one fetch — a reload
    // is the foreground path, and it is what the user would do.
    //
    // The index lists *spaces*, not pieces, so the signal that the accept
    // propagated is the row's piece count, not the title.
    await expect
      .poll(
        async () => {
          await bob.reload();
          await appReady(bob);
          await bob.getByRole('link', { name: 'Shelves' }).click();
          // A reload puts the index back on your own shelves; the one being
          // waited for is in the other tab.
          await bob.getByRole('button', { name: /^You are reading/ }).click();
          return bob.locator('main').innerText();
        },
        { timeout: 90_000, intervals: [1000, 2000, 3000, 5000, 5000, 5000] },
      )
      .toContain('1 piece');
    await expect(bob.locator('main')).not.toContainText('Waiting for approval');

    // Tapping the room opens the *room*, not the reader: a room holds plans and
    // boards too, so it needs a screen. The ▶ beside it still starts reading,
    // which is what the row's two controls used to do identically.
    await bob.getByRole('button', { name: new RegExp(`${AUTHOR}.*${SPACE}`) }).first().click();
    await expect(bob.locator('main')).toContainText(TITLE);

    // Open it. A post can only be read in the reader — chat has no
    // representation for one.
    await bob.getByRole('button', { name: new RegExp(TITLE) }).first().click();

    // A post that fails verification is **refused, not rendered with a
    // caveat** — so seeing the body at all is the signature checking out
    // against the key the share code committed to.
    const segment = bob.locator('[data-segment-id]').first();
    await expect(segment).toContainText('Am Morgen', { timeout: 30_000 });
    await expect(bob.locator('main')).toContainText(TITLE);

    // Its group id is the post shape, with no translation in it: a post has
    // none, and nothing can re-render its words under the audio.
    await expect(segment).toHaveAttribute(
      'data-segment-id',
      /^reader:sp:[0-9a-f-]+:[0-9a-f-]+$/,
    );

    // ── Alice shares a reading plan into the same room ─────────────────────
    // A plan is the second thing a room can hold, and the one with the most
    // machinery behind it: it is signed like a piece, but its payload travels
    // separately and its progress is the *reader's* own.
    await page.goto('/lists');
    await appReady(page);
    await page.getByRole('button', { name: '+ New list' }).click();
    await page.getByRole('textbox', { name: 'Name' }).fill(PLAN);
    await page.getByRole('button', { name: '+ Add passage' }).click();
    await page.getByRole('textbox', { name: /Genesis 1-3/ }).fill('Jonah 1\nJonah 2');
    await page.getByRole('button', { name: 'Add passage', exact: true }).click();
    await page.getByRole('button', { name: 'Done' }).click();

    // Header, beside Play — sharing is not a structural edit.
    const itemSynced = page.waitForResponse(
      (r) => r.url().includes('action=items.upsert') && r.ok(),
    );
    await page.getByRole('button', { name: 'Share to a shelf' }).click();
    await page.getByRole('button', { name: 'Share here' }).first().click();
    // Real moderation again, on the text pulled out of the payload.
    await itemSynced;

    // ── Bob picks the plan up ──────────────────────────────────────────────
    await expect
      .poll(
        async () => {
          await bob.goto(`/rooms/${code.replace(/-/g, '')}`);
          await appReady(bob);
          return bob.locator('main').innerText();
        },
        { timeout: 90_000, intervals: [1000, 2000, 3000, 5000, 5000] },
      )
      .toContain(PLAN);

    // Read-only, and offering a fork rather than an edit. Seeing the passages
    // at all means the header verified against the pinned key *and* the
    // separately-fetched payload matched the hash that signature commits to.
    await bob.getByRole('button', { name: new RegExp(PLAN) }).first().click();
    await expect(bob.locator('main')).toContainText('Jonah 1');
    await expect(bob.getByRole('button', { name: 'Make my copy' })).toBeVisible();
    await expect(bob.getByRole('button', { name: 'Edit' })).toHaveCount(0);

    // Ticking somebody else's plan records the reader's own progress: the row
    // is keyed by the author's list id but lives in Bob's account.
    await bob.getByRole('button', { name: 'Mark as read' }).first().click();
    await expect(bob.locator('main')).toContainText('1 of 2 read');
  } finally {
    await bobContext.close();
  }
});
