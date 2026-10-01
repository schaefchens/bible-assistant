# Offline-first — what needs a network and what doesn't

> Part of the architecture notes indexed in [`CLAUDE.md`](../../CLAUDE.md). Moved there verbatim; "above" and "below" may refer to sections that now live in a sibling file.

The only genuinely online features are the **assistant** (chat needs the model),
**generating** premium narration, and **sharing** (publishing or reading somebody else's
space — the user's own writing is local, and a cached feed stays readable offline). Everything else — reading, the reader screen, cards,
boards, ribbons, playback of already-fetched audio — works with no connection.

**Sync is opt-in.** `settings.syncEnabled` is off on a fresh install; the v13→v14
migration backfills `true` for existing installs, which already have server data.
It is enforced at exactly three chokepoints, and they are the whole mechanism:

1. `syncQueueManager.enqueueOp()` / `enqueueOrderSync()` / `enqueueProgressSync()` — drop ops
   instead of growing a queue behind a flush that will never run. All three report whether
   they queued, so `pendingOps` stays honest. (`enqueueProgressSync` also collapses pending
   ops *per list*, the way order syncs collapse per array: working through a plan produces one
   per entry finished and only the newest matters.)
2. `libraryStore.flushQueue()` — the one path that pushes.
3. `libraryStore.pullFromServer()` — the one path that reads.

Guarding there rather than at the ~10 call sites is deliberate: a new caller cannot
bypass the opt-in by forgetting. Turning sync on costs one catch-up pass
(`enableSync()` → pull, then seed the queue from every row still `dirty === 1`, then
flush), which is what dropping ops buys.

**The mnemonic is a device key first, a recovery phrase second.** It is required
synchronously by every `api.php` call, so `hydrateIdentity()` mints one silently on
first run (see `lib/bootIdentity.ts`) and the user is only *shown* it when they turn
sync on. Never put it back in front of a first-run user: an app that reads scripture
offline must not open on "create an account".

**`isBundled()` vs `isPreinstalled()`** (`services/bible/packFormat.ts`) — `isBundled` is
module-private precisely so the second is the one you can reach for, and it is
the one to reach for when the question is "can I read this without the network?". It is
true only on native, where `cap sync` puts the packs in the asset bundle. On web the same
files are HTTP fetches the service worker doesn't precache (`globPatterns` excludes
`.json`; the packs are ~10 MB), so there the bundled texts are treated as ordinary
*downloadable* packs — which is the only reason the PWA can read offline at all. Only
`bible-packs/manifest.json` (71 KB) is precached, so the picker renders correct state
offline.

**Selecting a translation downloads it** (`biblePacksStore.want()`, wired into
`TranslationList`), and the active translation is wanted even if its row was never
tapped. Packs are ~1.5 MB gzipped, so this needs no confirmation.

**Narration resolves through a source chain**, `services/narration/narrationSources.ts`
— the audio counterpart of `chapterSources`, same "`null` means try the next source"
contract. `cachedNarrationSource` answers from a local index with **no** call to
api.php, which is the only way a chapter in IndexedDB is playable offline; before it
existed, `buildTrack` had to ask the server for a verse's URL first.

Two rules keep that honest:

- The URLs are recorded from api.php's response, never recomputed. Rebuilding its path
  scheme client-side would duplicate it in two languages and break silently the day it
  changes — which is what the `narration` Dexie table is for.
- Resolution requires an index entry **and** the bytes present (`isCached`). That's what
  lets ordinary playback populate the index for free without promising audio a cleared
  or evicted cache can't deliver.

**Downloading = pinning.** `mediaCache`'s `pinned` rows are exempt from LRU eviction, so
a chapter saved for a flight can't be reclaimed by whatever was played since. Enough
pinned data can push the cache past `BUDGET_BYTES` with nothing left to free; the sweep
stops, and Settings' storage readout is where that becomes visible. Downloads are
**per chapter** on purpose — a book means up to 2,461 verses of TTS plus forced
alignment — and cover exactly what the current settings would *play*, so a reader with
announcements off isn't billed for clips they'll never hear.

**One module downloads both kinds.** `services/narration/narrationDownload.ts` covers a
Bible chapter and a user-written post: the coverage loop, the one-at-a-time generation loop,
the pin and the delete are identical, and only `planFor()` — "which text is this?" — ever
differed. They were two files of the same shape (`downloadChapter.ts` / `downloadPost.ts`)
plus three `t.kind === 'post' ? … : …` branches in `narrationStore`, which is three places
to fix a cache bug in; the store no longer knows there are two kinds.

**A day of a plan — or a room's pieces, or everything unread — downloads as one tap, but
not as one download.** `lib/narrationGroup.ts` is a *coordinator* over the per-item
machinery, not a third kind of `NarrationTarget`: a chapter and a post are what get
generated, keyed, pinned and deleted, and a group is only ever "these, in order". So the
group control (`NarrationGroupButton`) and the per-row controls
(`NarrationDownloadButton`) read the *same* `narrationStore` entries — neither is the
other's source of truth, something downloaded on its own already counts toward its group,
and the rows tick over one by one as the run works through them.

`subjectsForSegments` is why one control serves both halves of the app: a `SegmentRef` with
a `postId` becomes a post subject and a scripture one becomes a chapter, so a group may mix
kinds and nothing downstream cares. Four places offer one, and each covers **what its
surface is showing**, which is the rule to keep:

| where | covers |
| --- | --- |
| above the passages, picker's list view | the day of a plan, or that page of a plain list |
| above the pieces, picker's space view | every piece in the room (a room has no pager) |
| on the "everything new" row / pill | that selection's pieces |
| on the "today from everyone" row / pill | the same |

Those last two are `compact` (icon-only) and *siblings* of the tap target, never inside it: a
button in a button is invalid, and a download is not what selecting "everything new" should
mean. Four things about the mechanism are load-bearing:

- **The aggregate selectors return primitives** (`groupStatus`, `groupFraction`,
  `groupInstalledCount`). The per-item progress ticks write to this store, so a selector
  building an array or an object would hand back a new reference on every one of them and
  re-render the whole sheet.
- **The run is held outside the component**, keyed by the group. The sheet can be closed and
  reopened mid-download, and a cancel from the *remounted* button has to stop the loop the
  old one started — otherwise the abort lands on the current chapter and the run carries
  cheerfully on to the next.
- **One failure is stepped over, two in a row end the run.** A plan can legitimately name a
  chapter the chosen translation lacks (versification is English) and one gap must not cost
  the rest of the day; two is the backend or the network being gone, and grinding through a
  day of doomed requests is a long wait for nothing.
- **A segment's own translation is what gets downloaded**, not the active one — an entry
  pinned to LUT is read in LUT, and narration is keyed by translation. `ReaderHeader` had
  this wrong (it passed the global setting), which for a pinned entry reported on and
  downloaded a text that passage never plays in.

A group is hidden entirely for a single item: that row's own button already *is* it. Post
coverage is far cheaper than a chapter's — `spacePostUnits` reads the store, where a chapter
loads a book pack — which is why an "everything unread" group can check thirty pieces on
mount without thinking about it, and why the same button is *not* offered over the 25 rows
of the list screen's week page: answering "is this downloaded?" for a week of a plan can
mean fifteen book packs loaded and parsed on open, and it would buy a screen whose job is
ticking things off. Doing it there wants a cheaper coverage read first — the narration
index's verse keys are prefix-queryable, so a count could come from one indexed range query
instead of a chapter load plus a read per verse.

Verse ranges are widened to their whole chapter, which over-downloads a hand-written
"Genesis 1:1-5" — accepted deliberately, since the alternative is a second key space for
range audio that playback would never look in. A plan's entries are chapters anyway
(`expandEntryToChapters`).

**A failed or cancelled download must leave 'downloading' before re-deriving.**
`narrationStore.download`'s catch re-derives coverage rather than assuming either extreme —
but `check` refuses to speak over a live download, so it found the status still
`'downloading'` and returned without touching it: a spinner that never stopped, and a cancel
button that looked like it had done nothing. It now sets `'unknown'` first. Easy to miss with
one chapter and glaring with a day of them, which is how it was found.

**A continuation stays on the engine that is already reading.** `readingUsesBrowserVoice`
answers from the *setting* and the network, so it cannot see a reading that dropped to the
device voice because TTS was unreachable — an OpenAI voice is still selected and the browser is
still online. `autoPlay.browserTtsIsReading()` is the other half, and without it a reading that
fell back simply stopped at the chunk boundary: measured against a backend returning 502, every
track failed to build and the continuation enqueued nothing at all, with no error anywhere. The
same episode is why an **empty prefetch is treated as a failed one** rather than cached — a
cached empty track list reads as "this chunk is silent" at enqueue time.

**A reading never plays silence.** `startPlayback.readingUsesBrowserVoice(plan)` folds
"definitely offline" into the engine choice — *unless* the whole plan is already
downloaded, in which case being offline is irrelevant and the premium narration plays.
All-or-nothing: a partial hit would read some verses in one voice and skip the rest.
`streamReading` additionally falls back to the device voice if the *first* track fails
for any non-abort reason (which also covers backend-down, no-key and quota).

Both are "decide once" by design: `playbackController`'s mid-reading rebuild and
`playFromVerseWord` keep asking `isBrowserVoice()` alone, because a reading queued while
online keeps working offline (its audio is in `mediaCache`, and seeking a queued track
needs no network), and because two engines sharing one queue talk over each other.
