# A room holds plans and boards too, not only pieces

> Part of the architecture notes indexed in [`CLAUDE.md`](../../CLAUDE.md). Moved there verbatim; "above" and "below" may refer to sections that now live in a sibling file.

A room's second content type is `SharedItem` — a **snapshot** of a reading plan,
or of a board with its cards, signed and published the way a piece is. Cards are
never shared loose: a board is already "cards grouped to memorize", so it is the
unit.

It sits beside `Post` rather than absorbing it. A post is wired into
`postUnits`, the reader, narration and `ba.post.v1`; folding the two together
would be risk for no gain.

**A snapshot, with an explicit republish.** Editing the source list changes
nothing for readers until the author presses Update. Three reasons, in order:
`libraryStore` has no dependency on `communityStore` and auto-republish would
create one; re-signing, re-moderating and re-downloading for every subscriber on
every keystroke is absurd; and silently changing a plan people are forty days
into is worse than a button. It also makes the shared item genuinely independent
— deleting the source list leaves the shared plan intact, exactly as a piece
outlives nothing in particular. "Out of date" is a **number comparison**
(`itemSources[id].sourceUpdatedAt` against the live row), never a rebuilt hash.

## The header/payload split

`space.feed` carries **headers only**. That is not an optimisation to revisit:
`useCommunityRefresh` polls it on mount, on every foreground, and **every 15 s
across all subscriptions while any one of them is pending** — and a
Bible-in-a-year plan is 1,189 entries, near 100 KB. Twenty of those across ten
rooms would be megabytes an hour.

The header is nonetheless **self-verifying**, because `payloadHash` is inside
the signed message *and* carried on the header. So nothing is ever rendered
unverified, which is the existing rule for posts; the payload is fetched once
per version through `space.item` and checked against that hash before it is
stored. A mismatch is a refusal, not a caveat.

On disk: `storage/users/{id}/items/{spaceId}.json` holds headers,
`storage/users/{id}/payloads/{itemId}.json` holds one payload each. Both under
`USERS_DIR`, so already HTTP-denied — no `.htaccess` change and no new
`public/api/*.php` file, which is why `verifyBackend.mjs`'s handler-count floor
and `deploy.sh`'s allow-list are untouched. **`itemId` goes through `safeUuid`
before it touches a path**: that is the one place here where a caller-supplied
string becomes a filename.

`space.item` is the **fourth** cross-account endpoint and the second
cross-account read. Its whole security content is that the item must be listed
in *the space the code resolves to* — payload files are keyed by item id alone,
so without that binding a code for a room you are accepted in would fetch any
payload in the owner's account.

## The payload is a format

`services/community/sharedPayload.ts` is the **only** producer, and nothing ever
re-serializes a parsed payload — the signature covers the bytes, so the string
received is stored verbatim. Fixed field order, absent means omitted (never
`null`), array order preserved, and **`freeform`'s keys sorted** because a
`Record` has none of its own and two devices would otherwise hash the same board
differently. `tests/unit/sharedPayload.test.ts` pins the exact bytes: property
tests cannot see a field reorder, since both runs change together.

Parsing is `sharedItems.ts`, which reuses `normalizeReadingList` — already the
whitelisting coercer for a list from any untrusted source. It restores two
invariants a payload cannot be trusted to have: `cardIds` names only cards that
arrived, and `freeform` is keyed only by ids in `cardIds`.

**A copy is a fork, and the ids are what make it one.** `copyPlan`/`copyBoard`
mint fresh ids at every level. Keeping the author's would make the fork and the
mirror share one `readingProgress` row — ticking one would tick the other — and
for a board would leave the corkboard's placements pointing at nothing.

## `ba.item.v1`

Same discipline as `canonicalPostMessage`, with two differences worth knowing:
**`kind` is in the message** (unhashed, a two-value enum) so a plan's signature
cannot be lifted onto a board, and the payload is committed to **by hash**
rather than carried. Mirrored in `verifyItemSignature` in `public/api/community.php`.

## A shared plan is read as a plan, not as a special case

`ReaderSource`'s list variant gained `code?`, and the plan **keeps the author's
`ReadingList.id` verbatim**. That is the premise: `segmentId()` keys on the ref,
so any design carries the author's id anyway — and once it does, a fifth source
kind describes a distinction the data does not have. Keeping it means
`segmentId`, `provenanceOf`, `findListSegment` and **progress** work untouched.
`ReadingProgress` is keyed by `listId` alone and lives in the *reader's* own
account, so ticking off somebody else's plan is your own reading of it, synced
across your devices, **with no server change at all**.

**`sameSource` deliberately does not compare `code`.** A list has one id
namespace by construction, so the same plan delivered through two rooms is one
reading. It is also load-bearing: `playSegmentInReader` rebuilds the source from
a `SegmentRef`, which carries no code, so with the code in identity every play
would strip it. Do not put `code` on `SegmentRef` — a ref is a copy and copies
go stale; the resolver is live.

The real work was that **"find the list with this id" existed eight times**, all
reading `libraryStore`, and two of them are severity-1 for a mirrored plan:
`readingContinuation.nextInList` returned `undefined`, which `nextReadingAfter`
reads as "decide some other way" and answers with `canonicalNext` — **wrong
audio**, a plan followed by the next chapter of the Bible; and
`readingProgressTracker.noteEntryFinished` returned early, so a subscriber could
read a whole plan with nothing ticked. `resolveListById` is now the one copy,
keyed **by id** rather than by source because five call sites hold a bare
`listId` out of a `ListProvenance`. `ensureOpen`'s `staleList` needs **both**
`initialized` flags, or a mirrored plan looks deleted during the boot race.

## A shared board is a tab, and the route is what makes it one

`/cards/shared/:itemId`, a third region in the tab strip after the user's own
boards and a rule, reusing `BoardCardsView` whole — the four view modes are the
board's entire value, and reimplementing them is four copies of a rule.

It shipped first as its own screen off the room, because the code appeared to
refuse a tab: **`activeBoardId` is nulled against the user's own boards in
`libraryStore.init` and again in `librarySync.pullFromServer`**, so a foreign id
put there deselects itself on every boot and every sync — and teaching those two
to read the community store would push a dependency into a store that has none,
in the direction `onCommunityPulled()` exists to prevent. That reasoning was
sound and the conclusion was wrong: **the id never has to go there.** `CardsPage`
holds the shared half of its selection in the *route*, so both null-outs stay
true, `libraryStore` still cannot see the community store, and the persistence
story is arguably better — a route is shareable and survives a reload. The
screen off the room went with it, since two renderers for one board is the
duplication this file keeps cataloguing; the room's board row links here.

Why it moved at all: on its own screen it was, in the maintainer's words, a
disaster to find. Boards are looked for where boards are.

**The selection is a union, not a nullable id** (`TabSelection`: `all` | `own` |
`shared`). Written as one id, every board action would be gated on "is this id
in `boards`?" — which is false for a shared tab, so the mutations would no-op
*correctly, for the wrong reason*. Four of the five things in this feature are
that same move — a rule expressed as a shape rather than as a guard someone has
to remember:

| the rule | how it is expressed |
| --- | --- |
| board actions apply to your own board only | `active.kind === 'own'`, not `activeBoard !== undefined` |
| you cannot drag a card onto somebody else's board | the tab carries no `data-board-tab`, and that attribute *is* the drop target |
| a shared tab is not in `boardOrder` | it renders outside the `SortableContext` |
| read-only | the *absence* of `BoardCardsView`'s three mutating props |

The strip's `⋮` **hides** the board actions on a shared tab where it merely
*disables* them on All cards, and the difference is meant: on All cards they
would apply the moment you picked a board, so greying them says "pick one"; on
somebody else's board they can never apply, and a greyed Delete beside their
name suggests otherwise.

Two things the tab has that a row in a room did not, and both are load-bearing
rather than decoration. It carries a **guest mark** (`GuestIcon`), *in the
accessible name as well as on screen* — two people may both have a board called
"Merkverse", so the name alone cannot say whose it is, and a strip that reads
identically to a screen reader whichever tab you are on says nothing. And it
keeps the **author's colour**, because that is the board's identity; the mark is
what says whose.

The board is shown in the **author's view mode**, with no toggle, since
switching writes `board.viewMode` and a mirror has nowhere to write. The count
is `mirror.cards.length` and is *exact* — a shared board ships its cards, so
`boardCounts`' "stored ids overcount" rule cannot apply. A card opens as a
`FlipCard` in a sheet, never `CardEditor`: the read-only version of nine
controlled inputs plus a save that reconciles every board's `cardIds` is a form
with everything disabled, a shape nobody has seen in this app. `CardStack.onDelete`
is optional for the same family of reasons — it also fires on a keypress.

**A fork opens as its own tab**, and in that order: `setActiveBoardId` first,
then leave the shared route, or the new tab flashes past All cards on the way.
It has the same name as the board it came from, which is precisely why the guest
mark rather than the name has to be what tells them apart.

The one cost accepted rather than solved is **growth**: follow five prolific
people and the strip grows by fifteen tabs, and unlike the picker's author
groups a tab strip cannot collapse. Own boards come first and All cards is
pinned outside the scroller, so nothing of the user's is ever pushed off —
which is what makes waiting acceptable. If it bites, the next move is a pin
("put this on my tabs") rather than a cap, because a strip that silently drops
a tab is worse than a long one.

A shared board that goes away under the reader — withdrawn, or the room
unsubscribed — redirects to `/cards`, but only once **both** stores are
initialized. Bouncing during the boot race is the bug `readerStore.ensureOpen`'s
`staleList` already had to learn.

## The subscriber's room screen

`/rooms/:code` — not `/spaces/:code`, since `SpacesPage` resolves its param
against the user's own space *ids*, and distinct params are how `:cardId` and
`:boardId` are already told apart. It lists Pieces, Plans and Boards, and it is
also where an invite link naming one thing lands.

**The reassignment cost nothing**: a subscription row's `onOpen` and `onRead`
were the *same function*. The row now opens the room and the ▶ still starts
reading, which is what an own-space row has always meant.

Pending, revoked or a changed key renders the header plus the reason and no
sections — deliberately not a bounce to `/subscribe`, whose job is to *create* a
request the user already has. `useCommunityRefresh` is mounted here, so the
screen fills itself in the moment the author accepts.

## A link to one precise thing

`/subscribe/<code>?piece=<id>` — **one parameter for all three kinds**, since
their ids are all uuids and all resolve inside the room; a `?plan=` beside a
`?piece=` would break the day a fourth kind exists. `inviteTarget` also accepts
`?item=`, the same liberality `parseSpaceCodeInput` has.

Accepted goes straight to the thing; **pending goes to `/rooms/:code?piece=`**,
which is the honest answer to "nothing to open yet": that screen polls and
`SubscribePage` does not. No stash — the target stays in the URL, the
route-is-the-pending-state design one hop further. `stayHere` now rebuilds from
the live `URLSearchParams`; building it from the code alone silently dropped the
target, the same class of bug as the wizard's `onDone` eating the invitation.

## Moderation covers it, and the standards did not change

`items.upsert` runs the same judge in the write path. The server needs the text
without knowing the schema, so `moderationTextOf` walks the decoded payload and
collects every string, dropping uuids and single characters — domain-ignorant,
so a payload shape this build has never seen is still judged, and **server-side**,
so a modified client cannot skip it.

**No `COMMUNITY_TERMS_VERSION` bump.** `community.terms.intro` already binds
"what you publish here" generally, and `MODERATION_POLICY` already allows
"practical notes about reading, memorising or studying Scripture" — which is
what a plan and a memory board are. The policy gained one *clarifying*
paragraph (the text may be fragments pulled out of a structured document, and a
list of book names is a plan rather than spam), which widens no rule and so does
not trip that file's mirror-and-bump instruction.

`report.create` takes a shared item as its target too, snapshotting its title
and its extracted text — deleting the thing is the obvious first move after
being reported. Blocking needs no change: it is keyed by the author's signing
key and deletes their subscriptions, so their shelf goes with them.
