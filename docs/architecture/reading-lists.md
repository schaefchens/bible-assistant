# Reading lists

> Part of the architecture notes indexed in [`CLAUDE.md`](../../CLAUDE.md). Moved there verbatim; "above" and "below" may refer to sections that now live in a sibling file.

A **reading list** is a compiled, ordered sequence of passages — a reading plan, or a custom
collection. `ReadingList` → `ReadingDay[]` → `ReadingEntry[]` (`types/domain.ts`). Two things
about that shape are load-bearing:

- **A plain list is one untitled day**, which the UI renders flat (`isFlatList`). One data
  shape, two presentations — there is no separate "unstructured list" type.
- **A stored entry is one chapter, or verses within one.** The *parser* accepts a whole book
  ("Jonah") or a span ("Genesis 1-3"), but `expandEntryToChapters` splits those into an entry
  per chapter before they are ever saved — in the editor, in the picker's add, and in the
  assistant's tools. Progress is per entry, so an entry covering four chapters could only be
  all-read or all-unread: ticking Jonah 1 ticked all of Jonah, while the picker showed four
  separately tickable rows. Entries are created at the granularity they are read and displayed
  at. `chapter`-less and `chapterEnd` entries therefore only exist transiently (mid-parse) or as
  legacy data — `libraryStore`'s `expandStoredSpans` repairs the latter on load, carrying the
  parent's tick to every chapter so no progress is lost.
- `expandList()` fans entries out into the chapter-sized **segments** playback and the reader
  work in. Reading order is entry order, always. It is also the one place that decides a plain
  list has *no* day structure (its segments carry no `dayIndex`), which is what keeps "Day 1"
  off both the reader's heading and the picker's groups.
- **`isFlatList` is that decision; nothing may re-derive it.** A day with no entries yields no
  segments, so the picker used to conclude groupedness from the segments it got and dropped the
  empty day — and a two-day plan whose second day was still empty was then three different
  things at once: a flat one-page list in the picker, Day 1 + a dangling "DAY 2" heading in the
  editor, and a reader heading that said "Day 1". So `BookChapterPicker` asks `isFlatList` and
  builds one group per day the list *has* (bucketing segments by `dayIndex`), which also means
  an empty day can be a group with nothing in it — hence the `items.length > 0` guard on
  "which day am I on", or finishing a day would move the window onto an empty one.

A `SegmentRef` is a **copy**, and copies of list data go stale — a renamed day, an added
translation override, a field a later build computes differently. Anything holding one for a
while re-resolves it against the list (`findListSegment`): the reader on load, and
`appendReading` on a continuation. Both were bugs before they were rules.

Named `ReadingList`, not "reading": `reading`, `ReadingGroup` and `ReadingHost` already mean
"a playback group bound to verses" throughout `lib/`.

**Long lists are paged on the list screen too** (`DAYS_PER_PAGE` / `ENTRIES_PER_PAGE`), by week
for a plan and by passage for a plain list, opening on the page holding the passage you are on.
Rendering a whole year put ~13,000 nodes on the page and made every tick re-render all of them —
half a second of jank on a desktop, worse on a phone. The pager is drawn above *and* below the
passages, since a page is taller than the screen.

**Where it lives in the UI.** Not a nav tab — the entry point is the book picker in the Chat
and Read headers (`BookChapterPicker`, `showReadingLists`), which is where "what should I
read" is already asked.

That sheet is **one module per kind of `ReaderSource`**, which is the seam to follow when a
fourth kind exists. It was a single 1,209-line component holding five views:

| file | draws |
| --- | --- |
| `BookChapterPicker.tsx` | the shell: which view is showing, what the app is reading through, and where a pick goes |
| `picker/ScriptureViews.tsx` | the translation band, the two book columns, the chapter grid |
| `picker/ListViews.tsx` | the list index, and one list's passages |
| `picker/SpaceViews.tsx` | the space index, and one space's pieces |
| `picker/pickerRows.tsx` | the row shapes all three views are built from |
| `picker/SourceIcon.tsx` | the glyph for a source — `ReaderHeader` shares it |

The two view modules that need the community or the library read their own stores rather than
being handed six slices by the shell, and every selector they use takes a primitive or a
store-owned array — so a feed refresh, or the ~60×/s rewrite of `readerStore.position` during
playback, re-renders one list and not the sheet.

That sheet **locks into** the selected list: while one is selected it shows that list's
passages *instead of* the Old/New Testament book columns — the list is the only thing you can
be choosing from, which is the point of having chosen it. The selection row carries its own
controls, because with the books hidden there is no longer a chapter tap to imply "I've left
the list": a pencil opens that list's editor, and an `×` clears the selection so the books come
back.

It shows a **window**, not the whole list, because a ninety-day plan is not something you pick
from. That windowing is **`services/reading/listWindow.ts`**, not the component — it decides
which day is today, which page a flat list opens on, what is visible, and where the reader is:

- a plan (two or more days) shows one day at a time, with the neighbouring days *named* in the
  pager (`‹ Day 1 · DAY 2 · Day 3 ›`) rather than listed, and the day you're on in a brand pill;
  finishing today's last passage moves the window on by itself;
- a plain list gets pages of `PASSAGES_PER_PAGE`, opening on the page holding the current entry;
- a finished day is ticked wherever it is named, including in the pager, so "have I done that
  one" needs no stepping onto it.

**"Where I am" is derived, not stored**, and `listWindow.resumeSegment` is **the one copy** of
that derivation: `progress.currentEntryId` when something has been played, else the first
unread passage, else the start. Three things read it and must agree — the highlighted row, what
Continue plays, and where `readerStore.resumeOf` puts the reader. A plan ticked off entirely by
hand has no `currentEntryId` at all, which is why the fallback exists rather than being a
nicety.

It was written twice before, once in the picker and once in the store, and the copies disagreed
about a `currentEntryId` naming an entry **that has since been deleted** — an ordinary state,
because `updateProgress` deliberately leaves ticks for removed entries in storage in case an
undo brings the entry back. The store fell through to the first unread passage; the picker's
`find` returned nothing, so its Continue button silently disappeared on a list you had been
reading.

**Which day the window *opens* on is a deliberately different question**, and keys off the
*recorded* `currentEntryId` rather than the derived resume position (`focusDayOf`). They differ
in exactly one case: a plan read all the way through with nothing recorded, where the resume
position is the start — Continue has to be able to replay — but the day to *show* is the last
one. Feeding the derived answer in there sends a finished plan back to day 1 of 90.

The rows are **the list screen's rows** — `components/reading/PassageRow.tsx`, shared with
`/lists/:id`, progress bar and tappable checkboxes included. The picker had its own compact
variant, and looking like a different feature was the first thing anyone noticed about it. One
component means one answer to what a passage looks like.

The editor's own pieces — its pager, a day's heading, a passage row, the inline rename field —
are `components/reading/listDetailParts.tsx`, every one of them driven entirely by its props.
What stayed in `ReadingListDetail` is what is about the *screen* rather than a piece of it:
`pageOf` and the two per-page constants, because the screen is the only thing that pages.

`/lists` and `/lists/:id` are the full-screen index and editor (mirroring `/cards/:id`).
Neither is a nav tab, so both go back through **history** (`useGoBack`) rather than to a fixed
parent — a fixed parent makes the index and the editor a loop, and strands anyone who arrived
from the picker.

**Entries are typed or picked.** `parseReadingEntryLine` accepts the card editor's syntax
(`Passage; [Translation]; [Note]`) plus the two shapes a plan needs — a bare book name and a
chapter span. Unlike a card reference, an unparseable line is **rejected, and reported**: a
card is a note that may hold a half-remembered reference, but a list is a playback queue, and
an entry playback can't resolve would be a silent hole in the middle of a plan.

**Progress is a separate table** (`db.readingProgress`, keyed by `listId`) because it is
written far more often than the list and merges differently: `completed` is **unioned** across
devices, never last-write-wins, so two devices working different days can't erase each other's
ticks. `mergeReadingProgress` and api.php's `handleUpsertProgress` implement the same rule on
both sides — a device that ticks an entry without pulling first must not clobber the other's
work.

**Reading counts, not just listening.** `lib/readingProgressTracker.ts` is the one place that
writes progress, and three things call it: narration finishing a passage, the reader *moving
past* one, and a manual tick in the editor. It holds no playback or reader import precisely so
both can use it.

**The narration tick does not depend on auto-play.** It used to: the tick lived inside
`autoPlay.onSoftEnd`, which the playback subscription only calls when `autoPlayReading` is on —
and that is **off by default**. The reader's dwell rule hid it, but a plan played in the *chat*
(`play_reading_list`, or a passage tapped in the picker) has no other reporter, so it ticked
nothing at all on a fresh install. A soft-end means a reading reached its own end (a user stop
clears the flag), so it is the signal for both jobs, and only *continuing* is the setting's
business: `notePassageFinished` fires on every soft-end, `onSoftEnd` only when auto-play is on.
It still runs inside `onSoftEnd` too, for the manual next button (`triggerContinuation`), which
fires no soft-end; `setEntryDone` no-ops when the entry is already ticked, so the double call
costs nothing.

The reader's rule is the fiddly one, and it takes two signals:

1. **Intent, declared by the caller** (`PositionIntent`): the pager's next button is a `turn`,
   the scroll observer reports `scroll`, and everything else — the picker, a resume, a
   translation reload, the endless-scroll prefetch — is a `jump`, which never marks anything.
   This cannot be inferred from the positions: picking the very next passage out of the selector
   looks identical to turning the page onto it, and marking it read was wrong.
2. **Dwell, scaled by how much there is to read** (`dwellNeededFor`): leaving a passage only
   counts if it was the position long enough to have been read. Without it, stepping through
   three chapters to reach the fourth marked the two you flicked past. It has to scale, though:
   "John 3:16" is read in three seconds, so any flat threshold long enough to exclude flicking
   past a chapter excluded *every* single-verse entry — they could never be marked at all. So
   it is per verse, with a floor that still catches a flick and a cap so Psalm 119 doesn't
   demand three minutes.

Both err toward *not* claiming a passage: a missed tick is one tap to fix, a false one quietly
corrupts what a plan says you have read. `noteEntryFinished` additionally waits for an entry's
*last* chapter, so "Genesis 1-3" isn't marked read after Genesis 1.

All progress writes go through `updateProgress`, which reads the current record **inside** the
same synchronous block as the write and updates the store before awaiting Dexie. Both matter:
finishing an entry and marking the next one current happen in the same tick, and with the read
outside, the second writer's whole-record write silently dropped the first's tick.

**Playing a list** is `playReadingList(listId)` → the reader, resuming from
`progress.currentEntryId`. The playlist behaviour itself is not special-cased anywhere in the
audio pipeline: it falls out of `ReadingGroup.provenance` plus `nextReadingAfter` (see
"Reading hosts" in [`playback.md`](playback.md)).

The assistant can build and run them: `create_reading_list`, `update_reading_list`,
`list_reading_lists`, `play_reading_list`, `delete_reading_list`. `play_reading_list` is in
`READ_TOOL_NAMES`, so like `read_verses` the reading *is* the reply and no chat text is emitted.

**A long plan is built from a rule, not an enumeration.** `create_reading_list`'s `plan`
argument (`{cover: ['bible'], days: 365}`) hands the arithmetic to
`services/reading/readingPlan.ts`, which spreads every chapter of the named books or scope
words across the days. Having the model write out a year — 1,189 chapters — is slow, expensive,
and truncates long before it finishes, and a truncated plan is a wrong plan.

Two related rules keep the *reply* short: `describeReadingList` returns counts plus a two-day
sample rather than the whole list, and the prompt says to answer in one sentence and not read
the plan back. Both exist because the assistant narrated every day of a plan it had just made,
which for a year plan is minutes of speech.
