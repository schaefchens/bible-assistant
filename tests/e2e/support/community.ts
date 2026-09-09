import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { BASE_URL } from '../../../playwright.config';
import { appReady } from './app';
import { completeOnboarding, quietTheHarness } from './onboard';

/**
 * The two-identity harness the sharing journeys are built on.
 *
 * Sharing is the only part of this app where two people wait on each other, so
 * every journey about it needs two genuinely separate installs — and setting
 * those up is the expensive half. It lives here rather than in one spec because
 * two specs now need it, and a copy would drift the moment onboarding gains a
 * step.
 *
 * **Both identities are fresh, and that is deliberate.** The `app` project's
 * saved profile is shared by every spec in a run — CLAUDE.md's "a space made by
 * an earlier spec is still there" — so building an owner out of it means every
 * name in every sharing spec has to be unique against every other, forever.
 * Minting both here costs two onboarding walks (about a second each) and buys a
 * clean server directory per spec instead.
 */

export type Install = { context: BrowserContext; page: Page };

/**
 * A separate install: its own browser profile, walking the real wizard, so
 * `hydrateIdentity()` mints it one mnemonic and keeps it.
 *
 * Deliberately **not** the saved profile with the mnemonic deleted. That was
 * tried first and it is a trap: `addInitScript` runs on *every* navigation, so
 * each reload minted a new identity while the subscription stayed in Dexie —
 * leaving a reader whose `space.feed` is called as somebody who never asked,
 * permanently "waiting for approval".
 */
export async function freshInstall(browser: Browser): Promise<Install> {
  const context = await browser.newContext({
    // `baseURL` has to be restated: a context made this way has nothing to
    // resolve `/` against.
    baseURL: BASE_URL,
    viewport: { width: 390, height: 844 },
    locale: 'en-US',
    timezoneId: 'Europe/Berlin',
    // **The load-bearing line.** Without it this context picks up the project's
    // saved `storageState` and boots with the *same mnemonic* as everyone else.
    // The symptom is not an error: the space is subscribed, the request is
    // filed under a different user, and the reader sits on "waiting for
    // approval" forever while the server is perfectly correct.
    storageState: undefined,
  });
  const page = await context.newPage();
  await completeOnboarding(page);
  await quietTheHarness(page);
  return { context, page };
}

/**
 * The community opt-in: a display name plus the content standards.
 *
 * Taken **from the shelves screen**, which offers the form inline — the path a
 * real first-time user takes, since that tab is where the feature is visible.
 * It used to go through Settings, which still works and is still covered by
 * `share-with-a-reader`'s own copy of this; doing it here instead means the
 * inline form is exercised by every sharing spec rather than by one.
 */
export async function makeProfile(page: Page, name: string): Promise<void> {
  await page.goto('/spaces');
  await appReady(page);
  await page.getByRole('textbox', { name: 'Display name' }).fill(name);
  // `enableCommunity` refuses without an accepted version of the standards, so
  // the gate is part of the flow rather than a detour.
  await page.getByRole('checkbox', { name: /content standards/ }).check();
  await page.getByRole('button', { name: 'Create a profile' }).click();
  // The form gives way to the shelf list, which is the signal the profile
  // exists. Creating one also turns server sync on — that is what makes
  // sharing work at all.
  await expect(page.getByRole('button', { name: /^Your shelves/ })).toBeVisible({
    timeout: 30_000,
  });
}

export type Room = {
  /** As shown and as pasted: `XXXXX-XXXXX-XXXXXX`. */
  formatted: string;
  /** As stored and as routed: no dashes. */
  code: string;
};

/**
 * Make a room and read its share code back.
 *
 * Waits on `spaces.upsert` rather than on the UI, because the code means
 * nothing until the space itself has reached the server: `space.request` for a
 * code the server has never seen is a 404, and `shouldDropSyncOp` treats a 404
 * as permanent. That is the only honest gate — the alternative is a sleep that
 * is either flaky or slow.
 */
export async function makeRoom(page: Page, name: string): Promise<Room> {
  await page.getByRole('link', { name: 'Shelves' }).click();
  await page.getByRole('button', { name: /New shelf/ }).click();

  // The name field is a `Draft`: it commits on **blur**, and Enter blurs it.
  // Filling it and moving on leaves the shelf called "New shelf" — which the
  // owner never notices, because their own screen shows the draft they typed,
  // while every reader sees the default. Waiting on a `spaces.upsert` whose
  // body actually carries the name is the only gate that catches that; waiting
  // for "a spaces.upsert" would be satisfied by the creation itself.
  const named = page.waitForResponse(
    (r) =>
      r.url().includes('action=spaces.upsert') &&
      r.ok() &&
      (r.request().postData() ?? '').includes(name),
  );
  const field = page.getByRole('textbox', { name: 'Name' });
  await field.fill(name);
  await field.press('Enter');
  await named;

  const formatted = (
    await page.getByText(/^[0-9A-Z]{5}-[0-9A-Z]{5}-[0-9A-Z]{6}$/).innerText()
  ).trim();
  expect(formatted).toMatch(/^[0-9A-Z]{5}-[0-9A-Z]{5}-[0-9A-Z]{6}$/);
  return { formatted, code: formatted.replace(/-/g, '') };
}

/**
 * Ask to read a room. The code only *locates* it — this creates a request, and
 * the owner accepting it is what grants access.
 *
 * The field is in the header, left of "new space", and submits itself the
 * moment `parseSpaceCodeInput` says the input is a code, which is the moment a
 * paste lands. There is no button.
 */
export async function askToJoin(page: Page, room: Room, roomName: string): Promise<void> {
  await page.getByRole('link', { name: 'Shelves' }).click();
  await page.getByRole('textbox', { name: /Add a shelf by code/ }).fill(room.formatted);
  await showShelvesYouRead(page);
  await expect(page.locator('main')).toContainText(roomName, { timeout: 30_000 });
}

/**
 * Switch the index to the shelves you read.
 *
 * It keeps your own and the ones you read behind two tabs, and it opens on your
 * own — every profile has an undeletable "Today", so that is never the empty
 * one. Subscribing switches the tab by itself, but a **reload** puts it back,
 * which is why any poll that re-enters this screen has to ask again.
 */
export async function showShelvesYouRead(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^You are reading/ }).click();
}

/**
 * Let a reader in.
 *
 * The decision is written locally and then rides the sync queue, so this waits
 * for `members.decide` to actually reach the server rather than for the button
 * to react.
 */
export async function acceptReader(page: Page, roomName: string, reader: string): Promise<void> {
  await page.reload();
  await appReady(page);
  await page.getByRole('link', { name: 'Shelves' }).click();
  await page.getByRole('button', { name: new RegExp(roomName) }).first().click();
  const accept = page.getByRole('button', { name: /Accept|Allow/ }).first();
  await expect(accept, 'the request should appear in the owner’s room').toBeVisible({
    timeout: 30_000,
  });
  const decided = page.waitForResponse((r) => r.url().includes('action=members.decide') && r.ok());
  await accept.click();
  await decided;
  await expect(page.locator('main')).toContainText(reader);
}

/**
 * Open a subscribed room and wait until it says what it is expected to say.
 *
 * **Reloading is the point, not a workaround.** Updates between two people are
 * polled, not pushed: `useCommunityRefresh` refreshes on mount and on returning
 * to the foreground, and only ticks every 15s while something is *pending*. A
 * reload is the foreground path, and it is what the user would do. Anything
 * shorter would be asserting on a timer rather than on the feature.
 */
export async function roomEventually(page: Page, room: Room, text: string): Promise<void> {
  await expect
    .poll(
      async () => {
        await page.goto(`/rooms/${room.code}`);
        await appReady(page);
        return page.locator('main').innerText();
      },
      { timeout: 90_000, intervals: [500, 1000, 2000, 3000, 5000, 5000, 5000] },
    )
    .toContain(text);
}

/** The same wait, for something that has to *stop* being there. */
export async function roomEventuallyWithout(page: Page, room: Room, text: string): Promise<void> {
  await expect
    .poll(
      async () => {
        await page.goto(`/rooms/${room.code}`);
        await appReady(page);
        return page.locator('main').innerText();
      },
      { timeout: 90_000, intervals: [500, 1000, 2000, 3000, 5000, 5000, 5000] },
    )
    .not.toContain(text);
}

/** Write a piece and publish it. Moderation runs for real, so keep it on-theme. */
export async function publishPiece(page: Page, title: string, body: string): Promise<void> {
  // "+ New piece" and not /New piece/: the index now carries a write button per
  // shelf row, so the loose pattern matched two of those while the click that
  // opens this screen was still in flight — a strict-mode violation reported
  // against a page the spec had already left. The leading "+" is this screen's
  // alone, so the locator waits for the navigation instead of racing it.
  await page.getByRole('button', { name: '+ New piece' }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill(title);
  await page.getByRole('textbox', { name: 'Your text' }).fill(body);

  // Gated on the wire, not on the screen. Publishing rides the sync queue, so
  // the editor reacts long before the server has judged and stored anything —
  // and a piece that never reached it looks, from here, exactly like one that
  // did. Generous, because this is a real `gpt-4o` moderation call.
  const stored = page.waitForResponse(
    (r) => r.url().includes('action=posts.upsert') && r.ok(),
    { timeout: 60_000 },
  );
  await page.getByRole('button', { name: 'Publish' }).click();
  await stored;
}

/** A reading list with the given passages, one per line. */
export async function makePlan(page: Page, name: string, passages: string): Promise<void> {
  await page.goto('/lists');
  await appReady(page);
  await page.getByRole('button', { name: '+ New list' }).click();
  await page.getByRole('textbox', { name: 'Name' }).fill(name);
  await page.getByRole('button', { name: '+ Add passage' }).click();
  await page.getByRole('textbox', { name: /Genesis 1-3/ }).fill(passages);
  await page.getByRole('button', { name: 'Add passage', exact: true }).click();
  await page.getByRole('button', { name: 'Done' }).click();
}

/** A board holding one card. The card joins it through the editor's board
 * pills — the non-gesture path, so this spec is not also testing dnd. */
export async function makeBoard(
  page: Page,
  board: string,
  card: { title: string; verses: string },
): Promise<void> {
  await page.getByRole('link', { name: 'Cards' }).click();
  await expect(page.getByRole('button', { name: /^All cards/ })).toBeVisible();
  await page.getByRole('button', { name: 'New board' }).click();
  await page.getByRole('textbox', { name: 'Board name' }).fill(board);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('button', { name: new RegExp(`^${board}`) })).toBeVisible();

  // Back to All cards first: creating a board *selects* it, and the labelled
  // "New card" button shows only on All cards, since a card made while a board
  // is selected would still be a card outside every board.
  await page.getByRole('button', { name: /^All cards/ }).click();
  await page.getByRole('button', { name: 'New card', exact: true }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill(card.title);
  await page.getByRole('textbox', { name: /^Verses/ }).fill(card.verses);
  await page.getByRole('button', { name: board, exact: true }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('button', { name: card.title })).toBeVisible();
}

/**
 * Share the plan or board currently on screen into a room, and wait for the
 * item to reach the server.
 *
 * `items.upsert` is the honest gate for the same reason `spaces.upsert` is: the
 * publish rides the sync queue, and the sheet closes long before the server has
 * judged and stored it.
 */
export async function shareIntoRoom(page: Page, roomName: string): Promise<void> {
  await page.getByRole('button', { name: 'Share to a shelf' }).click();
  await pickRoom(page, roomName);
}

/**
 * The same, for a board — whose share lives in the strip's `⋮` rather than in a
 * header, because a board has no header of its own.
 *
 * The board has to be **selected** first: every board action in that menu is
 * `disabled={!hasActive}`, and All cards is not a board.
 */
export async function shareBoardIntoRoom(
  page: Page,
  board: string,
  roomName: string,
): Promise<void> {
  await page.getByRole('link', { name: 'Cards' }).click();
  await page.getByRole('button', { name: new RegExp(`^${board}`) }).click();
  await page.getByRole('button', { name: 'Menu' }).click();
  // A `menuitem`, not a button — the strip's ⋮ is a real menu.
  await page.getByRole('menuitem', { name: 'Share to a shelf' }).click();
  await pickRoom(page, roomName);
}

/** The sheet itself, once something has opened it. */
async function pickRoom(page: Page, roomName: string): Promise<void> {
  // Scoped to the room's own row: the sheet lists every room the user owns, so
  // `.first()` would quietly publish into whichever happens to sort first.
  const row = page.getByRole('listitem').filter({ hasText: roomName });
  const synced = page.waitForResponse((r) => r.url().includes('action=items.upsert') && r.ok());
  await row.getByRole('button', { name: 'Share here' }).click();
  await synced;
  await expect(row.getByRole('button', { name: 'Withdraw' })).toBeVisible();
  await page.keyboard.press('Escape');
}

/**
 * Re-snapshot what has already been shared, from the room's own screen.
 *
 * Update is offered and never automatic (a snapshot, not a live link), so this
 * is the whole of "the author's change reaches the readers" on the owner's
 * side — and the button only exists once the source has actually drifted.
 */
export async function updateSharedItem(page: Page, roomName: string, title: string): Promise<void> {
  await page.getByRole('link', { name: 'Shelves' }).click();
  await page.getByRole('button', { name: new RegExp(roomName) }).first().click();
  const update = page.getByRole('button', { name: `Update — ${title}` });
  await expect(update, `"${title}" should be marked as changed`).toBeVisible({ timeout: 15_000 });
  const synced = page.waitForResponse((r) => r.url().includes('action=items.upsert') && r.ok());
  await update.click();
  await synced;
}
