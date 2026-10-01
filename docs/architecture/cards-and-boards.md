# Cards and boards — one screen, one tab strip

> Part of the architecture notes indexed in [`CLAUDE.md`](../../CLAUDE.md). Moved there verbatim; "above" and "below" may refer to sections that now live in a sibling file.

A **card** is a verse note; a **board** groups cards for memorization. They were two
nav tabs with near-identical headers until they became one screen, `/cards`
(`src/routes/CardsPage.tsx`), whose tab strip is the whole selector: **All cards**
leftmost, then one tab per board. The nav slot that freed up went to `/spaces`.

**The selected tab *is* `libraryStore.activeBoardId`, and `null` means All cards.**
That state already existed and was already persisted (as the *absence* of the
`activeBoardId` preference row), so consolidating cost no store change and no
migration. What had to go is the effect that force-selected `boards[0]` whenever the
id was null — that is exactly what made `null` unreachable while any board existed.
Two existing behaviours now land somewhere sensible rather than nowhere: `deleteBoard`
and `pullFromServer` both null the id when the board is gone.

The page derives the selection from **the board that actually exists**
(`activeBoard?.id ?? null`), never from the raw id, so an id whose board was deleted
on another device reads as All cards instead of as a blank screen.

**All cards is pinned outside the horizontal scroller, not an item in it**
(`components/cards/LibraryTabs.tsx`). That is what keeps it on screen with twenty
boards, out of `boardOrder`'s sortable, and clear of the long-press-to-rename
gesture — three guards that would otherwise have to be written and then kept right.

The two tab shapes and the menu row are `components/cards/libraryTabParts.tsx`, and
`TAB_CLASSES` went with them — it is the geometry the pinned tab and the sortable ones
must not drift apart on, and both live there now. `railBorderClass` stayed with the
screen, because it colours the rail rather than a tab on it. `SortableTab` still calls
`useSortable`, which reads dnd-kit's context: that crosses a module boundary for free,
so it needs the `DndContext`/`SortableContext` the screen puts around it and nothing else.

**The strip is `sticky top-0 z-[1000]`.** The z sits between `CardStack`'s raised card
(999) and a dragging one (2000), so a raised card passes under the tabs and a carried
one over them — those three numbers are coupled. Sticky because switching board after
scrolling shouldn't mean scrolling back up first, and because a card can be carried
onto a board's tab (below): a drop target you have to scroll to reach is no target. It is opaque unconditionally, which also confines a board's background
image to the area below the tabs (that used to be a `solidBackdrop` prop).

**Two `+` affordances, deliberately.** The one among the tabs adds a tab (a board);
the labelled one in the right cluster adds a card and shows only on All cards, since
a card created while a board is selected would still be a card outside every board.
The `⋮` menu carries both in full text either way, and the board-only items (edit /
add cards / delete) are `disabled` on All cards rather than hidden.

**Per-tab counts are resolved against the live cards**, not `board.cardIds.length`:
deleting a card does not rewrite the boards holding it, so the stored ids overcount.
A *shared* board is the exception and its count is exact, because it ships its cards.

**There is a third region**, after the user's own boards and a rule: boards other
people share with them, marked with a guest glyph, not sortable, and not drop
targets. What makes that possible without a `libraryStore → communityStore`
dependency is that the selection is a `TabSelection` union whose shared arm lives
in the *route* rather than in `activeBoardId` — see "A shared board is a tab" in
[`community-shared-items.md`](community-shared-items.md), which is also where the rest of the rules are.

**The two bodies are separate components** (`AllCardsView`, `BoardCardsView`), and
the board one is keyed by board id — so a board switch drops its tag filter by
remounting instead of resetting during render. The corkboard's arrange toggle can't
do that (it is drawn in the header), so `freeformEdit` stays lifted into the page
with the guarded in-render reset used elsewhere in this codebase.

**Every draggable here takes `MouseSensor + TouchSensor`, never `PointerSensor`** —
the card list, the board grid *and* the tab strip. A `PointerSensor` only keeps the
gesture once it activates if the draggable carries `touch-action: none`, and both
these things sit on top of a scroller they cover completely: with `touch-none` on the
tabs the board strip could not be panned at all, and the same on a card would kill the
list's vertical scroll. The touch sensor's `move` listener is non-passive and
`preventDefault`s, so it suppresses the native pan itself from the moment the
long-press elapses — which is what lets the tabs sit at `touch-manipulation` and still
reorder. A swipe pans (movement inside `MOVE_TOLERANCE_PX` of the delay cancels the
drag), a hold drags.

**The scrolling itself is the browser's**, and deliberately nothing else: plain
`overflow-x-auto` with the **native scrollbar left visible**. `no-scrollbar` is what
must not come back here — with the bar hidden, a plain wheel mouse has no way into a
horizontal scroller at all (a vertical wheel does nothing to one, and there is nothing
to drag), which is what made the strip look unscrollable on the desktop. Mapping the
wheel onto `scrollLeft` by hand covers that too, and was tried, but it means a sticky
44px strip under the cursor intercepting the page's own scrolling; the bar costs
nothing on a phone or under macOS overlay scrollbars, and is what the user already
knows how to use.

**It scrolls in one axis, and that takes three utilities rather than one.** CSS
computes the other axis from `visible` to `auto` the moment one of them scrolls, and
each tab's `-mb-[2px]` — the overlap that merges it into the rail — then reads as 2px
of vertical overflow: the strip scrolled a couple of pixels up and down, and the
overhang was absorbed instead of laid over the rail, so the folder seam showed. So the
scroller carries `pb-[2px] -mb-[2px] overflow-y-hidden`: the padding absorbs the
overhang, the negative margin puts the scroller back over the rail (same geometry,
nothing left to scroll), and hiding the y axis also swallows the sub-pixel a targeted
tab's `scale-[1.03]` adds mid card-drag. It belongs on the scroller and not in
`TAB_CLASSES` — the pinned All-cards tab needs its overlap and has no scroller to
overflow.

**All cards is stack-only.** Grid / pile / corkboard are `board.viewMode`, a per-board
field, and the corkboard's placements live in `board.freeform` — a pseudo-board has
nowhere to keep either.

`/boards` and `/boards/:boardId` still resolve (the first redirects, the second
selects that board and rewrites the URL), because a deep link outlives the nav tab it
came from. Distinct route params — `:cardId` vs `:boardId` — are what let one
component tell the two aliases apart.

## Dragging a card onto a board's tab

Long-press a card in All cards, carry it up to a board's tab, let go: the card joins
that board. `hooks/useCardTabDrop.ts` is the gesture; `lib/boardTabDrop.ts` is the DOM
contract between the list and the strip.

**One `DndContext` over both was deliberately not hoisted**, which is the obvious
dnd-kit answer. dnd-kit's modifiers are per *context*, not per draggable, so one
context would mean reconciling the list's vertical clamp with the strip's horizontal
one, plus a custom collision strategy. Instead the strip marks each tab with
`data-board-tab` and the drop is hit-tested through `elementFromPoint`, which can't go
stale the way a registry of tab rects does the moment the strip scrolls sideways
mid-drag.

Four things are load-bearing:

- **The finger is hit-tested, not the card.** That is what lets the card keep
  `restrictToVerticalAxis` — it stays in its column, exactly as before — and still
  reach a tab at the far end of the strip. Only `restrictToParentElement` is dropped,
  and only while the affordance is on, since that is what pins the drag inside the
  list's box.
- **The carried card gives up pointer events** (`pointerEvents: 'none'`), or it would
  be what `elementFromPoint` answers with at every point under the finger. It costs the
  drag nothing: dnd-kit tracks the pointer on the document once a drag is active.
- **The pointer comes from a `pointermove` listener**, not from dnd-kit's
  `activatorEvent + delta`. That delta is the *transform*, which carries scroll
  compensation, so it drifts from the finger exactly when the list scrolls mid-drag.
- **The drop is offered before the carry state is torn down.** The same hook holds both,
  so asking it after `onCardDrag(null)` gets an answer it has just forgotten — which is
  exactly the bug that made the first version silently do nothing.

`overDropZone` (the finger is over the strip) does two jobs, which is why the prop names
the state and not either one: it pauses dnd-kit's edge autoscroll — the sticky strip
sits inside the scroller's top threshold band, so aiming at a tab would otherwise scroll
the list to the top underneath you — and it fades the carried card, which spans the
column and would otherwise cover the tab it is aimed at.

**Feedback matters more here than usual, because a successful drop changes nothing in
the list**: the card stays in All cards. So every board tab is faintly armed while a
card is in the air (that ring is most of what makes the gesture discoverable at all),
the tab under the finger swaps its count for `+`, a board that already holds the card
shows `✓` instead, and the target keeps a ring for `FLASH_MS` after the drop. A `✓` drop
is still **consumed** — the user aimed at a tab, and reordering the list instead would
be a surprise. A drop that misses every tab but lands on the strip is **not** consumed:
the sortable has been showing the card at the top of the list the whole way up, and
cancelling would contradict what the user is looking at.

The All-cards tab carries no `data-board-tab`, so it is not a target — every card is
already in it. With no boards at all the page passes no drop handlers, and the drag is
the clamped reorder it has always been.

Only the All-cards stack has the affordance. The same two props (`onCardDrag`,
`onDropOutside`) plus `overDropZone` extend it to a board's own views — moving a card
from one board to another — if that is ever wanted. The non-gesture paths are unchanged
and remain the accessible route: the ⋮ menu's *add cards*, and the board checkboxes in
`CardEditor`.
