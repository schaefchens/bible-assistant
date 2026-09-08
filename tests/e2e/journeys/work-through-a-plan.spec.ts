import { expect, test, type Page } from '@playwright/test';
import { appReady } from '../support/app';
import { progressPersisted } from '../support/persisted';

/**
 * Journey: build a reading list, work through it, and have it remember.
 *
 * Two routes and a whole feature that had no journey at all. The logic beneath
 * it is well covered lower down — `mergeReadingProgress`'s union merge,
 * `nextReadingAfter`'s list-as-playlist rule, `noteEntryFinished`'s
 * last-chapter guard — but nothing walked the screens.
 *
 * Three of the app's rules about lists are visible here and are what this
 * pins:
 *
 *  - **A stored entry is one chapter.** The parser accepts a book or a span,
 *    but `expandEntryToChapters` splits those *before they are saved*, because
 *    progress is per entry: an entry covering four chapters could only ever be
 *    all-read or all-unread.
 *  - **An unparseable line is rejected and reported.** A card is a note that
 *    may hold a half-remembered reference; a list is a playback queue, and an
 *    entry playback cannot resolve is a silent hole in the middle of a plan.
 *  - **Progress is per entry and survives a reload**, because it is a separate
 *    Dexie table written far more often than the list itself.
 */

const LISTS = '/lists';

async function newList(page: Page, name: string) {
  await page.goto(LISTS);
  await appReady(page);
  await page.getByRole('button', { name: '+ New list' }).click();
  await page.getByRole('textbox', { name: 'Name' }).fill(name);
}

/** The editor's free-text entry field, which takes the card syntax plus the
 * two shapes a plan needs (a bare book, and a chapter span). */
async function addPassages(page: Page, lines: string) {
  await page.getByRole('button', { name: '+ Add passage' }).click();
  await page.getByRole('textbox', { name: /Genesis 1-3/ }).fill(lines);
  await page.getByRole('button', { name: 'Add passage', exact: true }).click();
}

test('a whole book is stored as one entry per chapter', async ({ page }) => {
  await newList(page, 'Jona');
  // Typed as one line naming the book — Jonah has four chapters.
  await addPassages(page, 'Jonah');

  // Four entries, not one: they are created at the granularity they are read
  // and displayed at.
  await expect(page.locator('main')).toContainText('0 of 4 read');
  for (const chapter of ['1', '2', '3', '4']) {
    await expect(page.locator('main')).toContainText(`Jonah ${chapter}`);
  }
});

test('a chapter span is split the same way', async ({ page }) => {
  await newList(page, 'Anfang');
  await addPassages(page, 'Genesis 1-3');
  await expect(page.locator('main')).toContainText('0 of 3 read');
});

test('verses within a chapter stay one entry', async ({ page }) => {
  await newList(page, 'Psalm');
  await addPassages(page, 'Ps 23:1-6');
  await expect(page.locator('main')).toContainText('0 of 1 read');
  await expect(page.locator('main')).toContainText('Psalms 23:1-6');
});

/**
 * The difference between a list and a card: a line the parser cannot resolve
 * is refused, and said so, rather than stored as prose.
 */
test('a line that is not a reference is refused, not stored', async ({ page }) => {
  await newList(page, 'Unsinn');
  await addPassages(page, 'the bit about the whale');

  await expect(page.locator('main')).toContainText('0 of 0 read');
  // And it says which line it could not read, rather than failing silently.
  await expect(page.locator('main')).toContainText(/whale/);
});

test('a passage is ticked off, and the tick survives a reload', async ({ page }) => {
  await newList(page, 'Jona lesen');
  await addPassages(page, 'Jonah 1\nJonah 2');
  await expect(page.locator('main')).toContainText('0 of 2 read');

  // The rows are the list screen's own rows — shared with the picker, so the
  // two cannot disagree about what a passage looks like. The tick is a labelled
  // button rather than a checkbox input.
  await page.getByRole('button', { name: 'Mark as read' }).first().click();
  await expect(page.locator('main')).toContainText('1 of 2 read');

  // The screen says the tick was *accepted*; this waits until it was *stored*.
  // `updateProgress` updates the store before awaiting the Dexie write, so
  // reloading straight off the screen races that write — and loses, sometimes.
  // See support/persisted.ts.
  await progressPersisted(page);

  await page.reload();
  await appReady(page);
  // Progress lives in its own Dexie table (`db.readingProgress`), keyed by
  // list, because it is written far more often than the list and merges
  // differently.
  await expect(page.locator('main')).toContainText('1 of 2 read');
  // And the row itself offers to *un*tick it, which is how it says it is done.
  await expect(page.getByRole('button', { name: 'Mark as unread' })).toHaveCount(1);
});

test('unticking a passage puts it back', async ({ page }) => {
  await newList(page, 'Hin und zurück');
  await addPassages(page, 'Jonah 1');
  await page.getByRole('button', { name: 'Mark as read' }).first().click();
  await expect(page.locator('main')).toContainText('1 of 1 read');
  await page.getByRole('button', { name: 'Mark as unread' }).first().click();
  await expect(page.locator('main')).toContainText('0 of 1 read');
});

/**
 * The entry point is the book picker in the Chat and Read headers — where
 * "what should I read" is already asked — rather than a nav tab. A list made
 * on `/lists` has to show up there.
 */
test('a list made here is offered by the reader’s picker', async ({ page }) => {
  await newList(page, 'Mein Plan');
  await addPassages(page, 'Jonah 1');
  await page.getByRole('button', { name: 'Done' }).click();

  await page.getByRole('link', { name: 'Read' }).click();
  await page.getByRole('button', { name: 'Choose book and chapter' }).click();
  await page.getByRole('button', { name: 'Reading lists' }).click();

  await expect(page.getByText('Mein Plan')).toBeVisible();
});

/**
 * Selecting a list is the app's one notion of "the list I am reading through",
 * not the reader's alone — so the sheet **locks into it**, showing that list's
 * passages *instead of* the book columns. With the books hidden there is no
 * chapter tap left to imply "I've left the list", which is why the selection
 * row carries its own clear control.
 *
 * Note on locators: several bottom sheets are mounted at once (translations,
 * reading text, playback) and all of them report as visible, so
 * `getByRole('dialog')` matches four things at any time — each sheet has to be
 * addressed by its own title. The picker's title moves through **three** states
 * — "Read a chapter" → "Reading lists" → "Read from your list" — so a locator
 * held across a click goes stale. That the title changes at all is half the
 * assertion here.
 */
test('choosing a list locks the picker into it, and it can be left again', async ({ page }) => {
  await newList(page, 'Gewählt');
  await addPassages(page, 'Jonah 1\nJonah 2');
  await page.getByRole('button', { name: 'Done' }).click();

  await page.getByRole('link', { name: 'Read' }).click();
  await page.getByRole('button', { name: 'Choose book and chapter' }).click();

  const sheet = (title: string) => page.getByRole('dialog').filter({ hasText: title });

  await sheet('Read a chapter').getByRole('button', { name: 'Reading lists' }).click();
  await sheet('Reading lists').getByRole('button', { name: /Gewählt/ }).click();

  // Locked in: its own title, its own passages, and no book grid.
  const locked = sheet('Read from your list');
  await expect(locked).toContainText('Jonah 1');
  await expect(locked).toContainText('Jonah 2');
  await expect(locked).not.toContainText(/OLD TESTAMENT/i);
  await expect(locked.getByRole('button', { name: 'Start reading' })).toBeVisible();

  // A day of a plan (or, here, the page of a plain list) downloads as one tap,
  // right above the passages it covers.
  await expect(locked.getByRole('button', { name: 'Download these passages' })).toBeVisible();

  // Leaving brings the books back — clearing a filter is not a request to be
  // sent somewhere else, so the reader keeps its place.
  await locked.getByRole('button', { name: 'Leave this reading list' }).click();
  await expect(sheet('Read a chapter')).toContainText(/OLD TESTAMENT/i);
});
