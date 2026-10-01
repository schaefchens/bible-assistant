# Community — the shelf screens

> Part of the architecture notes indexed in [`CLAUDE.md`](../../CLAUDE.md). Moved there verbatim; "above" and "below" may refer to sections that now live in a sibling file.

## Passing a space on — readers share too

Sharing used to be an owner's act only: the code lived in the space's own screen,
behind a "Share code" section with mint and rotate beside it. But the person most likely to
recommend a space is somebody who enjoys reading it, and a reader had no way to except by
reading the code off a screen they had no reason to open.

`components/community/ShareSpaceSheet.tsx` is the affordance for everyone else — the code, a
link, a copy of either — and it appears in two places, both chosen the way `ReportDialog`'s
were: on the **piece**, beside its play button, because wanting to recommend a space happens
while reading something in it; and in the subscription row's `⋮` on `/spaces`, first in the
menu and the only entry there that is not a complaint.

What it hands on is exactly what the sharer was given: the same code, the same
`/subscribe/<code>` link. That follows from the code being **an address, not a key** ([`community.md`](community.md)) —
a resharer cannot grant access they don't control, because holding a code only buys the
ability to *ask*. The exception is a space set to **auto**-approval, where the code is the
gate; there a reshare does admit someone without the owner deciding, which is what that
setting already means. The hint says what is true either way ("they can ask; the author
decides") because a subscriber cannot see which mode a space is in — `Subscription` caches its
kind, not its approval.

`ShareSpaceButton` takes a **space id**, not a code, and that is load-bearing: keyed by code it
was simply absent from the one space its owner had never got round to sharing — which is
exactly the space you reach for a share button on. It mints on the tap. That is not a decision
made behind anyone's back: a code is an *address*, the tap says "share this", and `SpaceDetail`
offers the identical one-tap `shareCreate`. **Rotating** stays over there, because it is the
one share action with a consequence — every current reader is cleared — and it belongs beside
the sentence that says so. The button still renders nothing when there is no code *and* the
space is not the user's to mint one for.

`shareCodeForSpace` / `shareLabelForSpace` in `spaceReading.ts` answer for either side of a
space from one `spaceId`, and both return primitives so a component can select them straight
out of the store — the same trick `SegmentBlock` already used for `reportCode`, so a feed
refresh cannot re-render the verse tree.

**Several spaces from one author collapse into one row** in the picker's spaces view
(`groupSubscriptionsByAuthor` + `AuthorGroup`). Follow a few prolific people and the flat list
was mostly the same name repeated, and it grows without bound. Grouping is presentation, so it
stays out of the store — but *how* to group is a correctness question: it keys on the **pinned
signing key**, never on the display name. A name is neither unique nor claimed (see
`spaceLabel`), so two people called Christoph would be merged under one heading, which for a
feature about knowing whose writing you are reading is the one mistake not to make. Same
identity `blockAuthor` keys on.

Only where it earns the tap: one space from someone stays a flat row naming both, several
become a collapsible whose children name the space alone — the author is the heading. Closed
by default, since a shorter list is the point, with the counts on the closed row so a collapsed
group still says what is inside it.

**The user's own spaces group by the same rule**, since four rows all beginning with your own
name is the same noise and the same unbounded list. Its heading is "your spaces" rather than
your display name: it is the one group you can write in, and nobody thinks of their own writing
as belonging to their own name.

## A shelf's own screen: three tabs and two sheets

`SpaceDetail` was one long scroll of six sections — the code, the approval mode,
the name, the requests, the readers, then finally what was actually on the
shelf. You came to it to put something on the shelf and had to scroll past its
settings to reach them.

Now the body is **what is on the shelf**, behind three tabs: Pieces, Reading
plans, Cards & boards. Each tab carries its own way to add to it, at the top of
the panel — "+ New piece" writes one, the other two open `AddToShelfSheet`,
which lists the plans or boards you have that are **not already here**. That
sheet is the inverse of `ShareToRoomSheet` (which starts from the plan and picks
a shelf); both exist because both journeys are real and neither reads as the
other backwards.

The settings went to **two** sheets, not one, off two header buttons:

- **share** — the code, and whether holding it is enough (`approval`);
- **readers** — who has asked, and who already reads it, with the pending count
  as a badge on the button.

One sheet was the first attempt and it read wrong: a list of people under a
share code looks like an afterthought to the code, when it is the half the
author actually comes back to check. Deciding about a person also should not
share a screen with a code you might be about to rotate.

A shared item has **one removal, not the withdraw/delete pair a piece has**.
That pair is real for a piece, whose text lives only on the device, and the
shelf shows the difference — a withdrawn piece stays listed as a draft. A shared
item is a snapshot of something that already lives in the library, and the list
only ever showed what was *currently* shared: so both buttons made the row
vanish, they looked identical from the outside, and the withdraw left an
invisible orphan row behind that nothing would ever show again. "Remove from
shelf" is `deleteItem`; the source plan or board is untouched, and re-sharing is
one tap in `AddToShelfSheet`, which mints a fresh item rather than resurrecting
the old one — to a reader it *is* newly there.

**Delete is outside the scroller**, tucked under it. Inside, it read as the last
row of whichever tab happened to be showing. Its bottom padding is clearance for
a floating mic dock, which overlays that corner in four of its five positions.

The name and description stay in the body above the tabs — they are neither
sharing nor readers, and moving them was not asked for.

## The index is two tabs, not two sections

Your own shelves and the ones you read used to stack in one scroller. Stacked,
a long list of your own pushed the ones you read off the bottom of a phone
entirely — and the second list is the one with new writing in it. So the body is
now a **column**: a fixed head (what a shelf is for, "new shelf", the two tabs)
and one panel that takes the whole remaining height and scrolls on its own.

Three details are load-bearing:

- **It opens on your own, with no cleverness.** Every profile gets an
  undeletable "Today", so "you have none of your own" is not a state a profiled
  user can be in, and a default that switched when one list was empty would
  never fire.
- **The counts are on the tab labels, and unread is a dot**, because hiding a
  list hides what it was telling you. That is also why `SubscribeField` takes an
  `onSubscribed` callback: the shelf just added lands in a list the screen may
  not be showing, and without it the field clears, says "added", and nothing
  visibly changes.
- **`aria-pressed` buttons, not ARIA tabs**, matching the two switches this app
  already has — the `/cards` strip and the share sheet's piece/shelf toggle.

Each row carries its own actions on the right, and which ones differ by whose
shelf it is. Your own gets **write, share, delete**; one you read gets **share
and disconnect** — no quill, because it is not yours to write in, and a broken
link rather than a bin, because nothing is destroyed and the code would let you
back in. The `⋮` beside the second pair keeps *report* and *block*: those are
complaints about a person, and a menu is what makes them deliberate, which is
exactly why the harmless two came out of it.

**Every one of them names the shelf it acts on** (`Delete shelf — Werkstatt`).
Six rows of identically-named buttons tell a screen reader nothing, and it is
also what stopped a spec counting "is this shelf listed once?" from counting the
row's own delete button as a second listing.

Both destructive ones go through the same `window.confirm` the shelf's own
screen uses — the same irreversible act should ask the same question wherever it
is offered — and disconnecting calls `releaseReader` **before** it unsubscribes,
or the reader is left walking a shelf that no longer resolves.

## Where the share code is asked for

The code field sits **beside "new shelf" in the body**, on one row under the
sentence that names both ways in. It began at the bottom of the list of shelves
you already read — exactly where nobody looks for the way in, when being handed
a code is the commonest reason to open the screen at all — then spent a while in
the header, which is where it stopped working: neither it nor the button
shrinks, so the title column (`min-w-0 flex-1`) was the only thing that could,
and on a narrow phone the heading and its subtitle collapsed to nothing. The
header is now the title alone and the subtitle fits.

Moving it made its own hint a problem worth knowing about, and it took three
tries. It began as `absolute right-4`, pinned to the header so a message could
not shove the header's height around mid-typing — in the body that laid an
unreadable five-line error across the tabs and the first shelf. In flow it was
legible but shoved the whole screen down on every focus. It is a **popover**
now: still absolute, so it moves nothing, but with a surface of its own,
`w-max` so a short message stays short, and `z-40`, which is where this app
already puts a dropdown over content. Nothing above it clips — the head block
has no `overflow` and the scrolling list is a sibling, not an ancestor.

The field fills its column (`w-full` in a `flex-1` wrapper). It was pinned to
7rem while it lived in the header, where anything wider pushed "new shelf" off a
narrow phone; on its own row there is nothing left to crowd, and a code is 18
characters — the width is the difference between reading it back and not.

**"Today" is always first in your own list, and tinted.** It is the shelf every
profile has, it is where a passing thought goes, and it empties itself every 24
hours — so an order by "recently touched" buried it the moment anything else was
written, which is exactly when its own pieces are about to expire unread. The
sort is stable, so the rest keep the order the store gave them, and `Row`'s
`accent` swaps the background rather than layering a second one: two Tailwind
background utilities on one element have equal specificity, so which wins is
stylesheet order, not the order they are written in.

It has **no button**. `parseSpaceCodeInput` already answers "is this a code
yet?" on every keystroke, so the field submits itself the moment the answer is
yes, which is the moment a paste lands; `submittedRef` is what stops that firing
twice while the request is in flight. The field is sized to its own placeholder
(7rem) rather than to the room available — at 375px the header also holds the
title and "new space", and that arithmetic is written down beside the class.
