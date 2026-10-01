# The mic dock — one control, five positions

> Part of the architecture notes indexed in [`CLAUDE.md`](../../CLAUDE.md). Moved there verbatim; "above" and "below" may refer to sections that now live in a sibling file.

`src/components/voice/MicDock.tsx` is the app's single mic-plus-transport
control. It replaced a mic in one corner and a playback bar in the *opposite*
one, which meant two positions, two long-press drags and two dismissals all kept
in sync through an `oppositeCorner` helper — and a user who dragged one to where
the other was got them swapping places.

`settings.micCorner` (type `MicPosition`) puts it in one of five places. The
persisted field keeps its old name; renaming it would cost a migration and buy
nothing.

**A new install gets `'bar'`** (`DEFAULT_MIC_POSITION`) — it covers no content,
its controls are laid out for a thumb, and it needs no discovering. Existing
installs are deliberately left alone: `micCorner` has been persisted since v1 and
is in `partialize`, so rehydration keeps whatever they have and no migration
touches it, which is the same call as the v15 theme backfill. The v<2 backfill
stays on `'br'` for that reason too. `set_mic_position`'s enum carries all five,
so the assistant can dock or float it on request.

|            | floating corner (`tl`/`tr`/`bl`/`br`) | docked bar (`bar`)         |
| ---        | ---                                    | ---                        |
| placement  | `position: fixed`, over the content     | in flow, above the nav     |
| transport  | a capsule extending out of the mic      | Play centred, rest either side |
| holds      | Prev · Play · Next, toggles, gear       | the above plus word-seeks and hands-free |
| when idle  | collapses to the mic plus a grip        | stays out                  |

They are two layouts rather than one parameterised by position because a corner
has no room and the bar has nothing but room. `MicCorner` stays its own type
alongside `MicPosition` so corner geometry (`getMicAnchor`) can't be handed the
bar by mistake.

**Both positions drag, and the bar is the fifth snap target.** `positionForPoint`
gives the bottom `BAR_DROP_BAND` of the viewport to the bar and quadrants the
rest; `MicSnapTargets` derives the two bottom corner targets *from that
constant* so they sit clear above the strip — the two drifted once, and a target
you can hover but not drop onto is worse than none. Dragging shows **the mic
alone**: the ghost has to sit under the finger, and with the transport attached
that means measuring a box whose width is mid-animation. Docked, the bar stays
mounted and merely empties while dragging, so the page doesn't reflow under the
finger.

## Floating

The mic is the anchor: bigger (`MIC_SIZE`), always present, and it never moves
when the arm opens. That falls out of the container being `position: fixed`
anchored by *the corner's own edge* (`right` for `tr`/`br`, `left` otherwise) and
never by width, so the capsule can grow and shrink inward with nothing else
shifting.

Four things about it are load-bearing:

- **The capsule's width is measured, never assumed.** The row inside it is
  `max-content` and a `ResizeObserver` reports its natural width, because the
  arm's contents change with the route (the two reading toggles are
  reading-routes-only) *and* with the viewport (both hide under 360px, where the
  full arm plus a 64px mic overruns an iPhone SE). Hard-coding the open width
  meant re-deriving it on every one of those changes.
- **Content is pinned to the mic-facing edge** (`justify-end` on a right-hand
  corner, `justify-start` on a left one). Shrinking the capsule then clips the
  *far* end, so the arm reads as retracting into the mic rather than being sliced
  off beside it. Everything but the grip also fades, because the capsule's
  rounded cap alone leaves a hard edge through the middle of an icon.
- **The tuck is geometry, not a guess.** `OVERLAP = 20` hides the capsule's
  rounded end behind the mic's circle at *every* y only because the capsule is
  44 tall against a 64 mic — at the capsule's corners the circle still reaches
  23px in. Change `CAPSULE_H`, `MIC_SIZE` or `OVERLAP` and re-check that, or a
  pale cap pokes out of the mic's side. `NEAR_GAP` then keeps the first control
  clear of the mic, which is why the near padding isn't the far padding.
- **Group order flips with the corner; `Prev | Play | Next` never does.** The
  transport sits next to the mic (nearest the thumb) with the extras beyond it,
  which means reversing the *groups* on a left-hand corner — but each group keeps
  its own left-to-right order, because a mirrored transport is unreadable.

**The arm opens by itself and the grip is an override, not a setting.** Anything
but `status === 'idle'` opens it — `paused` included, because pausing must not
take away the button you'd resume with — and the grip's override is *spent the
moment that automatic answer changes*, so collapsing the arm during one reading
doesn't leave it shut for the next. That expiry is a guarded state adjustment
during render (as in `AppShell`), not an effect: `set-state-in-effect` is a lint
error here, and an effect would render the stale answer first, which is a visible
flap.

There is no hard-stop button any more. The old bar's `×` both stopped audio and
dismissed the bar app-wide; collapsing covers the dismissal, and pause covers the
rest.

## Docked

The bar is a **flex child of `AppShell`'s column**, directly above the nav, so it
takes its own space and covers nothing — which is the whole reason to choose it
over a floater. `MicDock` is therefore mounted *inside* the column rather than
after the nav with the other floaters; in the four corner positions it renders
`position: fixed` and that slot costs nothing.

The page's own bottom bar (composer, pager) stays above the dock's, so the chrome
stack is `nav → dock bar → page bar`, and the dock never jumps as you change
route. Two consequences:

- Fixed things above it can't see it in the flex column, so `useDockBarHeight`
  publishes its height next to `useBottomBarHeight` (both now share one
  `usePublishedHeight`), and `getOverlayAnchor` adds nav + dock bar + page bar.
  That sum is why the overlay's anchoring moved out of `VoiceOverlay` and into
  `MicAnchor` — "clear of the dock" means something different in each position.
- No grip and no auto-collapse: a bar's job is to be a stable strip, and there is
  no space to reclaim by hiding. With no reading at all it is just the mic.

**Play sits on the bar's centre line, and that one requirement dictates the
whole shape.** The mic occupies the bar's right end, so a plain row puts Play
half a mic left of centre. Instead the bar is a three-column grid whose outer
columns are `minmax(0, 1fr)` — free space split evenly with *no content floor*,
so they are always exactly equal whatever they hold, and the `auto` middle column
therefore always lands on centre. Prev and Next are the same width, so Play is
the middle of the middle. Measured at 280–430px: dead centre at every width.

Two consequences worth knowing before touching it:

- **The mic is passed into the grid** (`TransportSpread`'s `trailing`) rather than
  being its sibling. It is the heaviest thing in the right column and the balance
  is only exact if the grid contains it.
- `minmax(0, …)` and not `1fr`, for the same reason it matters elsewhere in this
  codebase: with a content floor, a narrow phone widens the right column to fit
  mic + gear and shoves Play off centre — the one thing the layout exists to
  prevent. The cost is that an over-full column spills *leftwards* over Next,
  which is what the width ladder below manages.

**Two controls exist only here.** Word-level seeks (`⏪ ⏩`, just outside Prev and
Next) are the button form of the ← / → keys — same `seekByWords`, same
`SEEK_WORD_STEP`, and disabled under exactly the condition that helper enforces,
so a button is dead precisely when the key is. `canSeek` selects a *boolean* from
`playbackStore`, never `current` itself: the rAF loop patches `current` ~60×/s
and subscribing to the object would re-render the transport at frame rate.
Hands-free mode's only other way in is the chat header, so on `/read` this is the
only one — most of the reason to put it here. `EyesFreeIcon` moved out of
`ChatHeader` to be shared; a mode with two glyphs reads as two features.

**The width ladder.** Ten controls plus a 64px mic do not fit a 375px phone with
Play centred, so two things step aside in order. Measured off-centre: 0.00px at
every width in every tier.

| viewport | left column | centre | right column |
| --- | --- | --- | --- |
| ≥ 420px | hands-free · ∞ · ⌄ | ⏪ ⏮ ▶ ⏭ ⏩ | ⚙ · mic |
| 360–419 | hands-free · ⚙ | ⏪ ⏮ ▶ ⏭ ⏩ | mic |
| < 360 | hands-free · ⚙ | ⏮ ▶ ⏭ | mic |

The two `∞ ⌄` toggles go first because they duplicate rows in the ⚙ sheet, and
the gear then crosses into the room they leave — rendered twice with
complementary visibility rather than switched in JS, so `display: none` keeps the
hidden one out of the accessibility tree, and both share one `sheetOpen`. The
seeks go next. `ReadingToggles` takes the breakpoint as a *class from its caller*
because the two layouts run out of width in very different places: the capsule at
360px, the bar at 420. 420 is not arbitrary — the wide tier needs 404px, so it is
the next round number with clearance (8px at the boundary, checked).
