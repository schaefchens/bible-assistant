import { expect, test } from '@playwright/test';
import { appReady } from '../support/app';
import {
  acceptReader,
  askToJoin,
  freshInstall,
  makeBoard,
  makePlan,
  makeProfile,
  makeRoom,
  publishPiece,
  roomEventually,
  roomEventuallyWithout,
  shareBoardIntoRoom,
  shareIntoRoom,
  updateSharedItem,
  type Install,
  type Room,
} from '../support/community';

/**
 * Journey: the author changes something, and the people reading it get the
 * change.
 *
 * The sibling of `a-room-is-a-shelf`, which is about things *arriving*. This is
 * the half where the machinery is easiest to get quietly wrong, because a stale
 * copy looks exactly like a correct one:
 *
 *  - a piece is re-signed on every save, so an edit that did not re-sign would
 *    be **refused** rather than shown stale — the failure is invisible from the
 *    author's side either way;
 *  - a plan or board is a **snapshot**, so the change reaches nobody until the
 *    author presses Update. That is a deliberate decision and the only place it
 *    can be checked is here: no unit can see "and the reader still has the old
 *    one";
 *  - a republished payload has a new hash, and the subscriber has to notice
 *    that and **re-fetch** rather than rendering the payload it already has
 *    under the new header. That cache invalidation is one line in
 *    `communityFeed`, and nothing else exercises it.
 *
 * Serial and sharing one setup, for the reason `a-room-is-a-shelf` is: two
 * separate installs are the expensive part, and "the update arrived" is not a
 * claim you can make before something has been shared.
 *
 * **Moderation runs for real** on every publish and every update, so everything
 * here is plainly on-theme and short.
 */

const AUTHOR = 'Christoph';
const READER = 'Leser';
const ROOM = 'Umbau';

const PIECE = 'Am Abend';
const PIECE_FIRST = 'Am Abend dachte ich an den Psalm.';
const PIECE_EDITED = 'Am Abend dachte ich an den Psalm, und an das Licht auf meinem Weg.';

const PLAN = 'Jona im Ganzen';
const BOARD = 'Verse zum Lernen';
const CARD_ONE = 'Galater 5,22';
const CARD_TWO = 'Psalm 119,105';

let alice: Install;
let bob: Install;
let room: Room;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  alice = await freshInstall(browser);
  bob = await freshInstall(browser);

  await makeProfile(alice.page, AUTHOR);
  room = await makeRoom(alice.page, ROOM);
  await publishPiece(alice.page, PIECE, PIECE_FIRST);

  await makePlan(alice.page, PLAN, 'Jonah 1\nJonah 2');
  await shareIntoRoom(alice.page, ROOM);

  await makeBoard(alice.page, BOARD, { title: CARD_ONE, verses: 'Galatians 5:22' });
  await shareBoardIntoRoom(alice.page, BOARD, ROOM);

  await makeProfile(bob.page, READER);
  await askToJoin(bob.page, room, ROOM);
  await acceptReader(alice.page, ROOM, READER);

  // Everything has to have landed before "it changed" can mean anything.
  await roomEventually(bob.page, room, PIECE);
  await roomEventually(bob.page, room, PLAN);
  await roomEventually(bob.page, room, BOARD);
});

test.afterAll(async () => {
  await alice?.context.close();
  await bob?.context.close();
});

test('an edited piece reaches the reader, still verifying', async () => {
  await alice.page.goto('/spaces');
  await appReady(alice.page);
  await alice.page.getByRole('button', { name: new RegExp(ROOM) }).first().click();
  await alice.page.getByRole('button', { name: new RegExp(PIECE) }).first().click();

  const pushed = alice.page.waitForResponse(
    (r) => r.url().includes('action=posts.upsert') && r.ok(),
  );
  await alice.page.getByRole('textbox', { name: 'Your text' }).fill(PIECE_EDITED);
  await alice.page.getByRole('button', { name: 'Save' }).click();
  await pushed;

  // Seeing the *new* words is two claims at once: the edit propagated, and the
  // re-signed post still verified against the key Bob pinned from the code. A
  // post that failed verification would be refused, so a stale body and a
  // broken signature are not confusable here.
  await roomEventually(bob.page, room, PIECE);
  await bob.page.getByRole('button', { name: new RegExp(PIECE) }).first().click();
  await expect(bob.page.locator('[data-segment-id]').first()).toContainText(
    'und an das Licht',
    { timeout: 30_000 },
  );
});

test('a plan the author edits does not change under the reader until it is shared again', async () => {
  // The snapshot rule, and the only place it can be checked. Alice adds a third
  // day; Bob is mid-plan and must not have it move under him.
  await alice.page.goto('/lists');
  await appReady(alice.page);
  await alice.page.getByRole('button', { name: new RegExp(PLAN) }).first().click();
  await alice.page.getByRole('button', { name: 'Edit' }).click();
  await alice.page.getByRole('button', { name: '+ Add passage' }).click();
  await alice.page.getByRole('textbox', { name: /Genesis 1-3/ }).fill('Jonah 3');
  await alice.page.getByRole('button', { name: 'Add passage', exact: true }).click();
  await alice.page.getByRole('button', { name: 'Done' }).click();

  await roomEventually(bob.page, room, PLAN);
  await bob.page.getByRole('button', { name: new RegExp(PLAN) }).first().click();
  await expect(bob.page.locator('main')).toContainText('Jonah 2');
  await expect(
    bob.page.locator('main'),
    'the author has not shared the change yet',
  ).not.toContainText('Jonah 3');
});

test('pressing Update sends the new version, and the reader picks it up', async () => {
  // The room marks it changed — a number comparison against the live list, not
  // a rebuilt hash — and Update is what re-snapshots, re-signs and re-publishes.
  await updateSharedItem(alice.page, ROOM, PLAN);

  // Wait on the *room*, which is a settled screen, and open the plan once
  // afterwards. Clicking inside the poll and reading `innerText` straight after
  // is a race — `click()` does not wait for the navigation it causes — and it
  // fails by returning the room's text forever rather than by saying so.
  await roomEventually(bob.page, room, '3 chapters');

  await bob.page.getByRole('button', { name: new RegExp(PLAN) }).first().click();
  await expect(bob.page.locator('main')).toContainText('Jonah 3');
  // The header's hash changed, so the stale payload had to be dropped and
  // fetched again rather than rendered under the new header.
  await expect(bob.page.locator('main')).toContainText('Jonah 1');
});

test('the reader’s own progress survives the update', async () => {
  // Entry ids are stable across an edit, and a tick is keyed by entry id on the
  // reader's *own* progress row — so an update must not reset what they have
  // read. Ticked after the update so the assertion is about the new copy.
  await bob.page.getByRole('button', { name: 'Mark as read' }).first().click();
  await expect(bob.page.locator('main')).toContainText('1 of 3 read');

  await updateSharedItemViaRename(PLAN);

  // The renamed plan arriving is the signal that the update landed; the tick
  // still being counted beside it is the claim.
  await roomEventually(bob.page, room, 'überarbeitet');
  await expect(bob.page.locator('main')).toContainText('1 of 3 read');
});

test('an updated board reaches the reader with its new card', async () => {
  await alice.page.getByRole('link', { name: 'Cards' }).click();
  await alice.page.getByRole('button', { name: /^All cards/ }).click();
  await alice.page.getByRole('button', { name: 'New card', exact: true }).click();
  await alice.page.getByRole('textbox', { name: 'Title' }).fill(CARD_TWO);
  await alice.page.getByRole('textbox', { name: /^Verses/ }).fill('Psalm 119:105');
  await alice.page.getByRole('button', { name: BOARD, exact: true }).click();
  await alice.page.getByRole('button', { name: 'Save' }).click();

  await updateSharedItem(alice.page, ROOM, BOARD, 'board');

  await roomEventually(bob.page, room, '2 cards');
  await bob.page.getByRole('button', { name: new RegExp(BOARD) }).first().click();
  await expect(bob.page.locator('main')).toContainText(CARD_TWO);
  await expect(bob.page.locator('main')).toContainText(CARD_ONE);
});

test('taking it off the shelf takes it off the reader’s too', async () => {
  await alice.page.goto('/spaces');
  await appReady(alice.page);
  await alice.page.getByRole('button', { name: new RegExp(ROOM) }).first().click();
  await alice.page.getByRole('button', { name: /^Cards & boards/ }).click();
  const gone = alice.page.waitForResponse(
    (r) => r.url().includes('action=items.delete') && r.ok(),
  );
  await alice.page.getByRole('button', { name: `Remove from shelf — ${BOARD}` }).click();
  await gone;

  // Dropped from the reader's cache, not merely hidden: the room no longer
  // serves it, and `refreshSubscriptions` deletes what it no longer sees.
  await roomEventuallyWithout(bob.page, room, BOARD);
  // The plan is untouched — a withdrawal is per item.
  await expect(bob.page.locator('main')).toContainText(PLAN);
});

/** Rename the plan and push it, as a second, content-changing update. */
async function updateSharedItemViaRename(plan: string) {
  await alice.page.goto('/lists');
  await appReady(alice.page);
  await alice.page.getByRole('button', { name: new RegExp(plan) }).first().click();
  await alice.page.getByRole('button', { name: 'Edit' }).click();
  const name = alice.page.getByRole('textbox', { name: 'Name' });
  await name.fill(`${plan} (überarbeitet)`);
  await name.blur();
  await alice.page.getByRole('button', { name: 'Done' }).click();
  await updateSharedItem(alice.page, ROOM, plan);
}
