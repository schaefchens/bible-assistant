import { expect, test, type Page, type Request } from '@playwright/test';
import { appReady } from '../support/app';
import { voicePersisted } from '../support/persisted';
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
  type Install,
  type Room,
} from '../support/community';

/**
 * Journey: one person fills a room with every kind of thing, and somebody else
 * picks every one of them up — a piece, a plan, a board, and a voice.
 *
 * The sibling of `share-with-a-reader`, which covers the *piece* path end to
 * end — the signature, the pinned key, the reader. This one is about the room
 * being a **shelf**: a plan and a board are shared over machinery a piece never
 * touches (a payload fetched separately from its header, a hash the signature
 * commits to, a read-only tab in the reader's own card library, a fork), and
 * none of that is exercised anywhere else at this level.
 *
 * Serial and sharing one setup, because two genuinely separate installs are the
 * expensive part and the steps are a sequence rather than independent facts:
 * "the board is there" is not a claim you can make before it has been shared.
 * Splitting them into named tests is what makes a failure say *which* kind
 * broke rather than pointing at a hundred-line block.
 *
 * **Moderation runs for real**, on `gpt-4o`, for every publish here — including
 * on the text walked out of a plan's and a board's payload, which is a path
 * `community:verify:api` can only reach through `MODERATION_STUB`. So
 * everything published below is plainly on-theme, and short.
 */

const AUTHOR = 'Christoph';
const READER = 'Leser';
const ROOM = 'Werkstatt';

const PIECE = 'Ein Morgen am Fluss';
const PIECE_BODY = [
  'Am Morgen sass ich am Fluss und dachte an das Wort des Herrn.',
  '',
  'Sein Wort ist eine Leuchte fuer meinen Fuss und ein Licht auf meinem Weg.',
].join('\n');

const PLAN = 'Jona in zwei Tagen';
const BOARD = 'Merkverse';
const CARD = 'Galater 5,22';

let alice: Install;
let bob: Install;
let room: Room;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  alice = await freshInstall(browser);
  bob = await freshInstall(browser);

  await makeProfile(alice.page, AUTHOR);
  room = await makeRoom(alice.page, ROOM);

  await makeProfile(bob.page, READER);
  await askToJoin(bob.page, room, ROOM);
  // Holding the code is not access — it locates the room, and the owner decides.
  await expect(bob.page.locator('main')).not.toContainText(PIECE);
  await acceptReader(alice.page, ROOM, READER);
});

test.afterAll(async () => {
  await alice?.context.close();
  await bob?.context.close();
});

test('a piece reaches the room, and reads in the reader', async () => {
  await alice.page.getByRole('link', { name: 'Shelves' }).click();
  await alice.page.getByRole('button', { name: new RegExp(ROOM) }).first().click();
  await publishPiece(alice.page, PIECE, PIECE_BODY);

  await roomEventually(bob.page, room, PIECE);

  // A post can only be read in the reader — chat has no representation for one.
  await bob.page.getByRole('button', { name: new RegExp(PIECE) }).first().click();
  const segment = bob.page.locator('[data-segment-id]').first();
  // Seeing the body at all is the signature checking out against the key the
  // share code committed to: a piece that fails verification is refused, never
  // rendered with a caveat.
  await expect(segment).toContainText('Am Morgen', { timeout: 30_000 });
  await expect(segment).toHaveAttribute('data-segment-id', /^reader:sp:[0-9a-f-]+:[0-9a-f-]+$/);
});

test('a plan reaches the room, and is read-only with the reader’s own progress', async () => {
  await makePlan(alice.page, PLAN, 'Jonah 1\nJonah 2');
  await shareIntoRoom(alice.page, ROOM);

  await roomEventually(bob.page, room, PLAN);
  await bob.page.getByRole('button', { name: new RegExp(PLAN) }).first().click();

  // The passages being here at all means two things held: the header verified
  // against the pinned key, and the separately-fetched payload matched the hash
  // that signature commits to.
  await expect(bob.page.locator('main')).toContainText('Jonah 1');
  await expect(bob.page.locator('main')).toContainText('Jonah 2');

  // Read-only: a fork is offered, an edit is not.
  await expect(bob.page.getByRole('button', { name: 'Make my copy' })).toBeVisible();
  await expect(bob.page.getByRole('button', { name: 'Edit' })).toHaveCount(0);
  await expect(bob.page.getByRole('button', { name: '+ Add passage' })).toHaveCount(0);

  // Ticking somebody else's plan records the *reader's* progress: the row is
  // keyed by the author's list id but lives in Bob's own account.
  await bob.page.getByRole('button', { name: 'Mark as read' }).first().click();
  await expect(bob.page.locator('main')).toContainText('1 of 2 read');
});

test('a copy of a plan is the reader’s own, and editable', async () => {
  // The other half of read-only: the escape hatch has to actually produce
  // something they can change. It is a genuine fork — new ids at every level,
  // no link back — so it starts unread rather than carrying the tick above.
  await bob.page.getByRole('button', { name: 'Make my copy' }).click();
  await expect(bob.page).toHaveURL(/\/lists\/[0-9a-f-]+$/);
  await expect(bob.page.getByRole('button', { name: 'Edit' })).toBeVisible();
  await expect(bob.page.getByRole('button', { name: 'Make my copy' })).toHaveCount(0);
  await expect(bob.page.locator('main')).toContainText('0 of 2 read');
});

test('a shared plan plays as a plan, and the picker locks into it', async () => {
  // Back to the *mirror*, not the copy just made — the picker offers both, and
  // the shared one is the one grouped under its author.
  await roomEventually(bob.page, room, PLAN);
  // The payoff of keeping the author's list id: everything downstream — the
  // picker's band, the reader's sequence, the group id — treats it as a list.
  await bob.page.getByRole('link', { name: 'Read' }).click();
  await bob.page.getByRole('button', { name: 'Choose book and chapter' }).click();
  await bob.page.getByRole('button', { name: /Reading lists/ }).click();

  // Under the rule, grouped by author — a shared plan is somebody's, and the
  // group is keyed on their signing key rather than on their name.
  await bob.page.getByRole('button', { name: new RegExp(AUTHOR) }).first().click();
  await bob.page.getByRole('button', { name: new RegExp(PLAN) }).first().click();

  // Locked in: the book columns give way to the plan's own passages.
  await expect(bob.page.getByRole('button', { name: /Genesis/ })).toHaveCount(0);
  await expect(bob.page.getByRole('dialog').filter({ hasText: PLAN })).toBeVisible();
});

test('a board reaches the room, and lands in the card library as a guest tab', async () => {
  await makeBoard(alice.page, BOARD, { title: CARD, verses: 'Galatians 5:22' });
  await shareBoardIntoRoom(alice.page, BOARD, ROOM);

  await roomEventually(bob.page, room, BOARD);
  await bob.page.getByRole('button', { name: new RegExp(BOARD) }).first().click();

  // Into `/cards`, not a screen of its own off the room. A foreign board could
  // not be a tab while its id had to live in `activeBoardId`, which is nulled
  // against the user's own boards on every boot and every sync; it is the
  // *route* that holds the selection now, so both null-outs stay true.
  await expect(bob.page).toHaveURL(/\/cards\/shared\/[0-9a-f-]+$/);
  await expect(bob.page.getByRole('button', { name: CARD })).toBeVisible();

  // The tab says whose it is, and says it in the accessible name — two people
  // may both have a board called Merkverse, so the name alone cannot.
  const guestTab = bob.page.getByRole('button', {
    name: new RegExp(`^${BOARD} · shared by ${AUTHOR}`),
  });
  await expect(guestTab).toBeVisible();
  // No `data-board-tab`, which is the whole of "you cannot drag your own card
  // onto somebody else's board" — the drop hit-tests that attribute, so its
  // absence is the rule rather than a guard implementing it.
  await expect(guestTab).not.toHaveAttribute('data-board-tab', /.*/);

  // Read-only is the *absence* of the mutating props, so there is nothing to
  // press rather than something that presses and does nothing.
  await expect(bob.page.getByRole('button', { name: 'Remove from board' })).toHaveCount(0);
  await expect(bob.page.getByRole('button', { name: /Arrange|Edit layout/ })).toHaveCount(0);
  // And the strip's menu drops the board actions entirely rather than greying
  // them: on All cards they would apply the moment you picked a board, but on
  // somebody else's they never can.
  await bob.page.getByRole('button', { name: 'Menu' }).click();
  // Wait for the menu to actually be open before asserting what is *absent*
  // from it. `toHaveCount(0)` is satisfied just as well by a menu that never
  // opened, so without this the two assertions below hold even if the ⋮ button
  // stops working entirely — they would have gone on passing while proving
  // nothing.
  await expect(bob.page.getByRole('menuitem', { name: /New card/ })).toBeVisible();
  await expect(bob.page.getByRole('menuitem', { name: /Delete/ })).toHaveCount(0);
  await expect(bob.page.getByRole('menuitem', { name: /Edit board/ })).toHaveCount(0);
  // And leave it shut. This dropdown hangs over the "Make my copy" button the
  // next test presses, so a menu leaked out of here does not fail here — it
  // fails there, ninety seconds later, pointing at the wrong thing.
  await bob.page.keyboard.press('Escape');
  await expect(bob.page.getByRole('menuitem')).toHaveCount(0);
});

test('a copy of a board is the reader’s own, and opens as their own tab', async () => {
  // The fork is a real one — new ids at every level — and it is an own board
  // from the moment it exists, so it opens in its own tab rather than dropping
  // the reader back on All cards to go looking for it.
  await bob.page.getByRole('button', { name: 'Make my copy' }).click();
  await expect(bob.page).toHaveURL(/\/cards$/);
  await expect(bob.page.getByRole('button', { name: CARD })).toBeVisible();

  // Its tab carries no guest mark: same name as the one it was forked from,
  // and that is exactly why the mark has to be what tells them apart.
  await expect(
    bob.page.getByRole('button', { name: `${BOARD} · 1 card`, exact: true }),
  ).toBeVisible();
  await expect(
    bob.page.getByRole('button', { name: new RegExp(`^${BOARD} · shared by ${AUTHOR}`) }),
  ).toBeVisible();
});

test('the room lists all three, and the author’s own screen agrees', async () => {
  await roomEventually(bob.page, room, PIECE);
  const shelf = bob.page.locator('main');
  await expect(shelf).toContainText(PIECE);
  await expect(shelf).toContainText(PLAN);
  await expect(shelf).toContainText(BOARD);

  // The author's own screen keeps each kind behind its own tab, so this walks
  // them rather than reading one page.
  await ownRoom(alice.page);
  await alice.page.getByRole('button', { name: /^Reading plans/ }).click();
  await expect(alice.page.locator('main')).toContainText(PLAN);
  await alice.page.getByRole('button', { name: /^Cards & boards/ }).click();
  await expect(alice.page.locator('main')).toContainText(BOARD);
});

/**
 * A voice is the one thing a room holds that *spends* — its owner's key, on
 * the reader's listening. What this proves end to end, nothing faked: the
 * owner lends one in the app, the reader finds it in the room and reads with
 * it, every request goes to `tts.shared` on the owner's account — and, because
 * this owner has no key, each is refused before anything is generated, and the
 * reading carries on in Echo, from the warm cache, for free. Taking it off the
 * shelf takes it away from the reader.
 *
 * Refused rather than generated on purpose: a run that made this voice speak
 * would bill a real account. `voices:verify:api` proves the paying half
 * against stubs.
 */
test('a voice lent to the room reads for the reader on its owner’s account — refused without a key, Echo reads, for free', async () => {
  // Two waits on the other install (the voice arriving, then leaving) plus a
  // real moderation call: more than one step's usual budget.
  test.setTimeout(180_000);
  const VOICE = `Opa Georg ${Date.now()}`;
  await alice.page.goto('/settings/voices');
  await appReady(alice.page);
  await alice.page.getByRole('button', { name: /Create a voice/ }).click();
  await alice.page.getByLabel('Name', { exact: true }).fill(VOICE);
  await alice.page.getByRole('radio', { name: /Cedar/ }).click();
  await alice.page.getByRole('button', { name: 'Save', exact: true }).click();
  await voicePersisted(alice.page, VOICE);

  // Lent from the voice's own editor, on the default terms — scripture only,
  // with a monthly and a daily allowance. Real `gpt-4o` moderation judges it.
  await alice.page.getByRole('button', { name: `Edit ${VOICE}` }).click();
  await alice.page.getByRole('button', { name: /Lend to a shelf/ }).click();
  const row = alice.page.getByRole('listitem').filter({ hasText: ROOM });
  const lent = alice.page.waitForResponse((r) => r.url().includes('action=items.upsert') && r.ok(), { timeout: 60_000 });
  await row.getByRole('button', { name: 'Lend it here' }).click();
  await lent;
  await expect(row).toContainText('Lent here');
  await alice.page.keyboard.press('Escape');

  // The reader finds it in the room, with its terms, and reads with it.
  await roomEventually(bob.page, room, VOICE);
  await expect(bob.page.locator('main')).toContainText('Reads scripture');
  await bob.page.getByRole('button', { name: 'Read with it' }).click();
  await expect(bob.page.getByRole('button', { name: 'Reads for you' })).toBeVisible();

  const calls = recordNarration(bob.page);
  await bob.page.getByRole('link', { name: 'Read' }).click();
  await bob.page.getByRole('button', { name: 'Choose book and chapter' }).click();
  // The reader is still walking the shared plan from the step above, which is
  // what locks the picker into it: back to the Bible first.
  await bob.page.getByRole('button', { name: 'Leave this reading list' }).click();
  await bob.page.getByRole('button', { name: 'Psalms', exact: true }).click();
  await bob.page.getByRole('button', { name: '117', exact: true }).click();
  await bob.page.getByRole('button', { name: 'Read this chapter aloud' }).click();

  // Both verses end up read — in Echo, from the cache.
  await expect
    .poll(() => calls.filter((c) => c.action === 'tts' && c.status === 200).length, { timeout: 30_000 })
    .toBe(2);
  // It asked the owner's account first, and was refused — never generated.
  const shared = calls.filter((c) => c.action.endsWith('.shared'));
  expect(shared.length, 'the lent voice was never asked for').toBeGreaterThan(0);
  for (const c of shared) {
    expect(c.status, `${c.action} was not refused`).toBe(403);
    expect(c.json).toMatchObject({ error: 'shared_voice_unavailable', payer: 'owner' });
  }
  const verses = calls.filter((c) => c.action === 'tts' && c.status === 200);
  expect(verses.map((c) => c.body.voice)).toEqual(['echo', 'echo']);
  expect(verses[0].json?.audioUrl).toBe('/storage/audio/echo/KJV/19/117/1.mp3');
  const uncached = calls
    .filter((c) => (c.action === 'tts' || c.action === 'tts.speak') && c.json?.cached !== true)
    .map((c) => `${c.action} ${JSON.stringify(c.body)}`);
  expect(uncached, 'these narration requests were not cache hits — this run called OpenAI').toEqual([]);

  // Still the reader's choice, listed under what is shared with them.
  await bob.page.goto('/settings/voices');
  await appReady(bob.page);
  await expect(bob.page.getByRole('heading', { name: 'Shared with you' })).toBeVisible();
  await expect(bob.page.getByRole('radio', { name: new RegExp(VOICE) })).toHaveAttribute('aria-checked', 'true');

  // Taking it off the shelf takes it from the reader.
  await ownRoom(alice.page);
  await alice.page.getByRole('button', { name: /^Voices/ }).click();
  const removed = alice.page.waitForResponse((r) => r.url().includes('action=items.delete') && r.ok());
  await alice.page.getByRole('button', { name: `Remove from shelf — ${VOICE}` }).click();
  await removed;
  await roomEventuallyWithout(bob.page, room, VOICE);
});

type NarrationCall = {
  action: string;
  status: number;
  body: Record<string, unknown>;
  json: { cached?: boolean; audioUrl?: string; error?: string; payer?: string } | null;
};

/** Every narration request — plain and shared — with what came back. */
function recordNarration(page: Page): NarrationCall[] {
  const calls: NarrationCall[] = [];
  page.on('requestfinished', async (req: Request) => {
    const m = /action=(tts(?:\.speak)?(?:\.shared)?)(?:&|$)/.exec(req.url());
    if (!m) return;
    const res = await req.response();
    let json: NarrationCall['json'] = null;
    try {
      json = (await res?.json()) ?? null;
    } catch {
      /* not JSON */
    }
    calls.push({ action: m[1], status: res?.status() ?? 0, body: (req.postDataJSON() ?? {}) as Record<string, unknown>, json });
  });
  return calls;
}

async function ownRoom(page: Page) {
  await page.goto('/spaces');
  await appReady(page);
  await page.getByRole('button', { name: new RegExp(ROOM) }).first().click();
}
