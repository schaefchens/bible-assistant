# The reader screen (`/read`)

> Part of the architecture notes indexed in [`CLAUDE.md`](../../CLAUDE.md). Moved there verbatim; "above" and "below" may refer to sections that now live in a sibling file.

A fifth bottom-bar tab, right of Chat, for reading rather than asking. `src/routes/ReadPage.tsx`
plus `src/components/reader/*`; the store is `useReaderStore`.

**Its unit is a *segment*, not a chapter.** A segment is usually a whole chapter — every
segment the Bible source produces is — but a reading-list entry with verse ranges
("Psalm 23:1-6") is a first-class segment the reader renders and plays. `isWholeChapter(ref)`
is the test, and it decides the heading phrasing and the announcement wording.

**What it walks through is `source`**: `{kind:'bible'}` (canonical order) or
`{kind:'list', listId}` (list order). Prev/next, endless scroll in both directions, the
pager labels and the picker all go through the sequence for that source
(`services/reading/readingSequence.ts`, or `useReaderSequence()` in components) — there is no
`nextChapterRef` call left in the reader.

`source` is also **the app's one notion of "the list I'm reading through"**, not just the
reader's: the book picker in both headers reads and writes it, so selecting a list on the chat
screen is the same act as selecting it on `/read`, and it survives closing the sheet. Switching
source keeps the reader's place — leaving a list re-reads the passage you were on canonically,
because clearing a filter is not a request to be sent somewhere else.

- **Flowing prose, not one verse per line.** `WordHighlighter` takes `layout="inline"` so several
  verses share a `<p>`, with superscript verse numbers. The "currently reading" tint uses the
  `.verse-inline` CSS pair (background + `box-decoration-break: clone`) because the block
  variant's left inset bar and horizontal padding are meaningless on a wrapping span.
- **Paragraph breaks are computed** (`src/lib/readerParagraphs.ts`). None of the eight source
  bibles carries paragraph markup — `public/bibles/*.xml` has only `<verse>`/`<chapter>`/`<book>`
  — so the rule is "break after a verse that ends a sentence, once ≥4 verses have accumulated".
  Deterministic and never mid-sentence, but not editorial. `MIN_VERSES_PER_PARAGRAPH` is the knob.
- **Auto-continuation moves the reader the way the reader moves** (`readerStore.adopt`).
  Endless scroll grows downward, so a continuation appends and the page carries on under the
  voice; **paged mode turns the page** — the window is replaced and `position` follows, because
  appending there stacked the next chapter under the current one while the header and the pager
  still named the old one, three answers on screen to "where am I?". The position move is
  reported as a `'jump'`: `autoPlay` has already ticked the passage that finished and claimed
  the new one, and letting the dwell rule fire as well would count progress twice off two
  different clocks. `ReadPage` scrolls a self-turned page to the top (`pagedAt`), which the
  pager's own next button was already doing and the picker was not.
- **Two fields, not one array**: `segments` is a bounded cache keyed by group id, `visible` is the
  mounted window (`MAX_VISIBLE = 6`). The cache outlives window trimming so a track queued for a
  scrolled-away segment still resolves. `MAX_VISIBLE` is the load-bearing render-cost mitigation
  (every verse mounts a `WordHighlighter` with two playback selectors, and the rAF loop rewrites
  `current` ~60×/s) — don't raise it without profiling.
- **Only `position` and `source` are persisted.** Verse text would bloat localStorage and go stale
  on a pack upgrade, and `getChapter` is memoized + in-flight-deduped so a re-fetch on boot is
  nearly free. A Bible reader's first-ever open seeds from `useLastReadingStore`; a list-sourced
  one resumes from that list's own progress instead. After that they are independent.
- **Paged vs endless** is `settings.readerEndlessScroll` (default off → prev/next chapter buttons).
  Endless appends forward from an IntersectionObserver sentinel and prepends backward from an
  explicit button. Both directions, plus window trimming, re-pin the scroll position in
  `useEndlessChapters` by **pinning a chapter element**, not by scrollHeight arithmetic — WebKit
  has no dependable `overflow-anchor` and iOS momentum scrolling fights raw `scrollTop` writes.
- **Versification gaps are normal, not exotic.** `BookEntry.chapters` is English versification, so
  the German texts legitimately lack chapters the catalog advertises (LUT's Malachi ends at 3
  where KJV has 4). A *step* absorbs that and keeps going the way the user was heading — forward
  rolls into the next book, backward walks down — while an explicit jump still errors. The miss
  arrives two ways depending on the source, so test it with `isChapterMissing()`
  (`ChapterUnavailableError` offline, `bible.chapter` 404 online), never `instanceof` alone.
  In a reading list the same tolerance applies per *entry*: a whole-book entry fans out using the
  catalog's chapter count, so a step (and a continuation) walks past chapters the chosen text
  genuinely lacks rather than stalling a plan on a phantom chapter.
- Switching translation stops reader audio before reloading: group ids embed the translation, and
  word counts differ between texts, so letting queued TTS play on would desync the highlight.
  **A segment whose translation is pinned by its list entry is exempt** (`SegmentRef.translationPinned`):
  the user asked for that passage in that text. Without the exemption the reader "corrects" a
  deliberately German entry to whatever is globally selected — mid-playback, and its group id then
  no longer matches the sequence's, so the passage loses its neighbours.
- **Known limitation:** a voice command on `/read` still produces a *chat* reading (audio plays,
  the page doesn't follow). Same as `/cards` today; routing it into the reader needs a target-host
  field on `SendOpts`/`DispatchContext`.

## Which translations, and their notices

`translationCatalog.ts` answers both, per translation, and nothing else may.

- **`offered`** is whether anyone may *choose* it. ESV, NKJV and Hoffnung für Alle are
  `offered: false` because the app holds no licence for them, and Schlachter 1951 because
  nobody can yet say whether it needs one (the Genfer Bibelgesellschaft has been asked). All
  four are absent from every choice:
  `TranslationList` (the reader's picker, the chat picker, Settings, onboarding), the tool
  schemas and the glossary both system prompts are built from (`OFFERED_CODES`,
  `translationGlossary()`), and the handlers, which run tool arguments through `asOffered`
  because an enum does not bind the model. A persisted selection of one is replaced on hydration
  by the locale's default — `settingsStore`'s `merge`, not a migration, so it holds for whichever
  translation is withdrawn next.
- Hidden is not deleted. A card, or a list entry that pinned one, still reads in it; the server
  still serves it. Withdrawing a translation *server-side* is a different switch — the pack
  manifest's `available: false`, which leaves the row visible but disabled.
- **`notice`** is the copyright notice, in the translation's own language rather than the UI's.
  `TranslationNotice` lists the offered ones in Settings › Data & app › Bible texts — and only
  there: a notice under every reading was tried and rejected. A rights holder's wording is reproduced verbatim — S00's is the Genfer
  Bibelgesellschaft's, pinned by `tests/unit/translationNotices.test.ts`. A line that is a URL is
  linked and shown as written.

## The reader store owns state, not loading

`readerStore` was 658 lines holding three unrelated things. Two of them were
rules rather than state, and neither needed the store:

| file | owns |
| --- | --- |
| `store/readerStore.ts` | the window, the segment cache, the position, the source |
| `services/reading/segmentLoader.ts` | how a segment is fetched, sliced, and its gap walked past |
| `lib/readerProgress.ts` | whether the passage just left was actually *read* |

**`segmentLoader` reads no store at all** — the locale arrives as an argument —
which is the whole point: `loadSegment`'s gap absorption is the rule where a
mistake shows the reader a piece they did not ask for, and it was unreachable
by any test while it was module-private inside the store and built its own
fetch. `tests/int/segmentLoad.test.ts` covers it now (mutation-tested, seven
breaks, seven kills).

**`readerProgress` is handed the loaded segments rather than reading them.** All
it ever wanted was the verse count of the passage being left, and importing
`readerStore` from there is the value cycle that quietly turns a store's type
into `any` (see `communityRows` in [`stores.md`](stores.md)). The three call sites pass
`get().segments`, which is the same read at the same moment the function used to
do itself. It holds `dwell` — module state the store had no business keeping —
and sits next to the `readingProgressTracker` it reports to: **that** module is
where progress is written, this one decides whether there is anything to write.

`LoadedSegment` and `ReaderError` belong to the loader that returns them; the
store re-exports them, because three components have always asked the store for
the reader's types.
