# Bible Assistant — Architecture Map

Mobile-first app for voice-controlled Bible reading: speak (or type) a reference, hear it read aloud. React 19 + Vite + TypeScript + Tailwind v3 + Zustand; a PHP backend (`public/api.php`) proxies OpenAI (chat / TTS / Whisper) and serves Bible text from local Zefania XML.

**Three build targets from one codebase**: the web PWA (`npm run build` → `dist/`, deployed to
https://bibleassistant.apps.schaefchens.de) and native iOS + Android via Capacitor 8
(`npm run build:native` → `dist-native/`, then `cap sync`). See "Native builds" below —
several things differ per target and getting them wrong is the usual source of breakage.

This file is the orientation map. When changing code, find the relevant subsystem here first, then read the named files.

## Commands
- `npm run dev` — Vite dev server (the maintainer usually already has this on `localhost:5173`; probe before starting).
- `npm run build` — `tsc -b && vite build`. **This is the primary correctness gate** — keep it green.
- `npm run build:native` / `npm run sync` — the Capacitor build; `sync` also runs `cap sync`.
- `npm run icons` — regenerate every app icon from `resources/source/icon.png`
  (`scripts/icons/buildIcons.mjs`). It owns iOS, Android (legacy + adaptive, all
  densities, and the adaptive XML), and the web/PWA icons; splash screens are
  still `capacitor-assets`' job. Sizing is per role — full-bleed surfaces get a
  large glyph, only genuinely masked ones carry safe-zone padding — so don't
  "simplify" it back to one shared bitmap.
- `npm run bible:build` / `bible:verify` — regenerate the offline Bible packs, and diff them
  against golden fixtures from the PHP parser. **Run verify after touching either parser.**
- `npm run community:verify` / `community:verify:api` — assert the post-signing, share-code and
  chunking properties, and drive the community endpoints against a throwaway `php -S`. **Run
  both after touching signatures, share codes, `postUnits`, or `api.php`'s community actions.**
- `npm run bible:counts` — regenerate `src/services/bible/verseCounts.ts` (verses per chapter)
  from the KJV pack. Only needed if the packs or the book catalog change; it asserts the two
  agree and that the totals are still 1,189 chapters / 31,102 verses.
- `./scripts/deploy.sh [--dry-run]` — deploy the PWA + PHP over SFTP. Uses an explicit
  allow-list: it must never upload `storage/` (live user data) or `secrets.php`.
- `npm run lint` — ESLint. Note: a handful of pre-existing `react-hooks/refs` errors live in `EyesFreeMode.tsx`, plus one `exhaustive-deps` warning in `CardStack.tsx`; don't add new ones. `set-state-in-effect` is an error here — adjust state during render (guarded) instead, the way `AppShell` and `MicDock` do.

## Entry points
| Concern | File |
| --- | --- |
| Router + error boundary | `src/App.tsx` → routes render under `src/components/common/AppShell.tsx` |
| App init (audio teardown, last-reading, network, key hydration, ambient prefetch, pack retry) | `src/hooks/useAppInitialization.ts` — six independent effects |
| Voice/text command pipeline | `src/hooks/useCommandPipeline.ts` (`send()`), tool loop in `src/services/ai/orchestrate.ts` |
| Global mic / push-to-talk | `src/hooks/useGlobalVoice.ts` + `src/components/voice/*` |
| The mic + transport dock (one element, five positions) | `src/components/voice/MicDock.tsx`, `MicButton.tsx` + `src/components/playback/TransportControls.tsx` |
| AI tool definitions (the model's API) | `src/services/ai/tools.ts` |
| AI tool dispatch (the handlers) | `src/services/ai/dispatch.ts` (table-driven `TOOL_REGISTRY`) |
| Audio engine (OpenAI TTS) | `src/lib/audioPlaybackManager.ts` singleton `audioPlayback` |
| Verse/reply/ambient playback (HTMLAudioElement) | `src/lib/elementTrackPlayer.ts`, `src/lib/ambientAudioBus.ts` |
| Browser TTS engine (SpeechSynthesis) | `src/lib/browserTts.ts` singleton `browserTts` |
| Persistent audio + alignment cache (IndexedDB) | `src/lib/mediaCache.ts` |
| Theme application (palettes live in `src/index.css`) | `src/lib/theme.ts` |
| Narration source chain (cached → server) | `src/services/narration/narrationSources.ts` |
| Chapter narration download | `src/services/narration/downloadChapter.ts` + `src/store/narrationStore.ts` |
| Native speech recognition | `src/lib/nativeSpeech.ts` (Whisper stays the fallback) |
| What plays next (canonical order *or* a reading list) | `src/lib/readingContinuation.ts` |
| Auto-continuation + prefetch (the machinery, not the policy) | `src/lib/autoPlay.ts` |
| Bible reader screen | `src/routes/ReadPage.tsx` + `src/store/readerStore.ts` |
| Reading lists (screen / editor) | `src/routes/ReadingListsPage.tsx` + `src/components/reading/*` |
| Community spaces (screen / editors) | `src/routes/SpacesPage.tsx` + `src/components/community/*` |
| Post signing (crypto / passphrase-bound) | `src/lib/postSignature.ts` + `src/lib/postSigning.ts` |
| Share codes (mint / fingerprint / normalize) | `src/lib/spaceCode.ts` |
| A post as reading units (the one chunker) | `src/services/community/postUnits.ts` |
| Community ⇄ reading seam | `src/services/community/spaceReading.ts` |
| Which narration path an item takes | `src/services/narration/narrationRequest.ts` |
| Loading one segment, whatever kind | `src/services/reading/segmentLoader.ts` |
| Reading-list order + expansion | `src/services/reading/readingSequence.ts` |
| Playing a list, and its progress | `src/lib/readingListPlayback.ts` |
| Playback ⇄ content seam | `src/lib/readingHosts.ts` |
| Bible data / references | `src/services/bible/*` |
| HTTP to backend | `src/services/api/*` (all via `client.ts`) |

## Data flow — a voice command
```
mic / text input
  └─ useGlobalVoice → useCommandPipeline.send(text)
       ├─ isStopCommand? → cancelAllActivity() (kills audio + aborts in-flight)
       └─ postChat({messages, tools})            [services/api/chat.ts → api.php ?action=chat]
            └─ orchestrateToolCalls() loops while the model calls tools:
                 dispatchTool(name, args)         [services/ai/dispatch.ts → TOOL_REGISTRY]
                   ├─ read_verses → getChapter/getVerses → buildPlaybackPlan
                   │     → startPlayback → audioPlayback.enqueue / browserTts.enqueue
                   │         → playbackStore.setStatus / setCurrent  (UI reads these)
                   ├─ create_card / create_board → libraryStore (+ Dexie + sync queue)
                   └─ set_* → settingsStore
            └─ assistant reply (if no read action) → speakAssistantReply → TTS
```
Reading aloud is the response: pure `read_verses` turns emit **no** chat text, only audio (logged as a `historyNote` so the model can later "continue reading").

### Random passages — the model must never roll its own

`random_passage` (`unit: 'verse' | 'chapter' | 'book'`, plus `count` for several at once) is
the only way a random pick is made. Both system prompts say so in as many words, because a
model asked to "pick a random verse" does not sample — it returns John 3:16, Jeremiah 29:11,
Philippians 4:13, forever.

**One ask is one draw, and the pipeline enforces it.** A reading tool's result has to read as
*done*, or gpt-4o-mini treats it as a failure and tries again: the duplicate-read guard used
to answer a repeated `read_verses` with `count: 0`, the model read that as "the passage came
back empty", drew again, and asking for one random verse reliably played **three** — one per
round until `MAX_TOOL_LOOPS` cut it off. So `useCommandPipeline` now intercepts both shapes of
going round again, and both replies say the request is already fulfilled rather than reporting
nothing read:

- `read_verses` for a reference already played this turn (`playedKeys`) — the model's "I picked
  X, now I'll read X" reflex;
- `random_passage` with identical arguments (`drawnKeys`) — a re-roll, not a second passage.

`count` exists *because* of that second guard: with identical calls dropped, "three random
verses" has to be one call, and the handler draws and reads three. The draw's own result says
so too (`alreadyRead` plus the passages by name), which is what stopped the follow-up
`read_verses` being issued at all — worth keeping in mind for any new tool whose effect is
audio rather than data.

A *themed* ask ("a verse about hope") is deliberately **not** routed here — that's the model
resolving a reference, which is what it's good at.

The draw itself is `services/bible/randomPassage.ts` on `lib/cryptoRandom.ts`
(`crypto.getRandomValues` + rejection sampling, never `Math.random()`), and its one
non-obvious rule is **what gets weighted**:

- a **verse** draw picks the chapter *weighted by how many verses it holds*
  (`VERSE_COUNTS`), which is what makes it uniform across all 31,102 verses. Drawing
  book → chapter → verse uniformly at each step, as this used to, made any given verse of
  Obadiah ~400× likelier than any given verse of Psalms;
- a **chapter** draw is uniform over the 1,189 chapters (Psalms gets 150 tickets, Obadiah 1);
- a **book** draw is uniform over the 66, and opens it at chapter 1 — a whole book is
  thousands of verses of TTS, and auto-continuation carries on from wherever a reading starts.

Only the *chapter* comes from the table; the verse is drawn from the text that actually came
back, so a translation with a shorter chapter can't yield a verse number it doesn't have. For
the same reason a drawn chapter the translation lacks entirely is **redrawn** (up to
`RANDOM_DRAW_ATTEMPTS`) rather than erroring — the catalog is English versification. A chapter
the *user* named is never redrawn; that's a real error.

### Reading hosts — how playback finds its verses

Every queued track carries a `groupId` (`PlaybackTrack.groupId`,
`usePlaybackStore.current.groupId`). It is an **opaque playback-group key**, not a chat
message id — it binds audio to the verses `WordHighlighter` highlights.
`src/lib/readingHosts.ts` resolves it by namespace prefix:

| id | host | a "reading" is |
| --- | --- | --- |
| bare uuid (no `:`) | `chatReadingHost` | an assistant message with `verses` |
| `reader:<translation>:<book>:<chapter>` | `readerReadingHost` | a loaded chapter |
| `reader:<translation>:l:<listId>:<entryId>:<chapter>` | `readerReadingHost` | one chapter of a reading-list entry |

Ids are built by `segmentId()` and only ever *parsed* for their namespace prefix — the
reader looks segments up by whole id, so the shapes above are free to change together.

Anything in the playback path that needs "the verses behind what is playing" goes through
`readingHosts.getGroup(id)` — the transport, `autoPlay`, `playbackController`, the
last-reading writer, `startPlayback`, `playbackPosition`. **Never re-introduce a
`useChatStore.messages.find(...)` in that path**: that assumption is what used to make the
whole audio pipeline chat-only.

Resolution is per *id*, not per active screen, because both hosts can own live groups at
once (chat has readings from earlier in the session while the reader has chapters mounted).
`readingHosts.focus()` is consulted only for "what does Play start when nothing is queued?".

Auto-continuation is host-agnostic: `autoPlay` asks **`readingContinuation.nextReadingAfter()`**
what follows, then asks the host to `appendReading()` it. Chat materializes a new assistant
message (with a `historyNote` so the model knows); the reader inserts the segment into its
window. That one function is the only place the rule lives:

- a group carrying `ReadingGroup.provenance` (a `{listId, entryId}` pair) continues with the
  **next entry of that list**, and stops at its end — a list is a playlist;
- everything else continues **canonically**: a fully-read chapter rolls into the next one, a
  verse range walks on in ~5-verse chunks, stopping at Revelation 22.

Both hosts report provenance (chat from `ChatMessage.listId/entryId`, the reader from the
segment's `SegmentRef`) and both propagate it through `appendReading`, which is what lets a
list play as a list from either screen. **Don't reintroduce a second copy of "what comes
next"** — that rule previously existed three times (autoPlay, readerStore, useContinueReading)
and the copies disagreed about book rollover.

Reader group ids are **deterministic**, so scrolling away and back (or replaying) re-binds
the highlighter to already-queued tracks. `appendReading` must stay idempotent for the same
reason — and for a list continuation it adopts **the list's own segment**
(`findListSegment`) rather than rebuilding one from the verses, because a rebuilt ref drifts
from the sequence's and a ref with no match in the sequence has no neighbours.

## Stores (Zustand) — who owns what
All in `src/store/`. `(persist)` = survives reload via `zustand/middleware`.
| Store | Owns |
| --- | --- |
| `usePlaybackStore` | **Source of truth for audio state**: status, current track, word index (drives `WordHighlighter`), volumes |
| `useChatStore` | Conversation history, `isProcessing`, `currentTool` |
| `useSettingsStore` *(persist v17 + migrations)* | User prefs: locale, `theme`, `readingAppearance`, translation, voices, reading/announcement prefs, ambient, mic position, `syncEnabled` |
| `useLibraryStore` | Cards + boards + their order, reading lists + per-list progress, and the offline sync queue (flushed to `api.php`) |
| `useRibbonsStore` *(persist)* | Colored bookmarks ("ribbons") |
| `useGlobalVoiceStore` | Mic listening state, last voice response |
| `useLastReadingStore` *(persist)* | Resume point for "play last reading" — **audio-owned**, written only from the playback subscription. The reader's scroll position deliberately does not write here, or idle scrolling would move it |
| `useReaderStore` *(persist v2 — `position` + `source`)* | The reader screen: what it is walking through (the Bible, or a reading list), the current segment, the loaded-segment cache + the mounted window |
| `useBiblePacksStore` *(persist — `wanted` only)* | Offline Bible packs: per-translation status/progress, and which translations the user has asked for |
| `useCommunityStore` | The community profile, the user's own spaces and posts (drafts included, plus which are `shared`), subscriptions, subscribers, and the verified cache of other people's posts |
| `useNarrationStore` | Per-target narration download state (status/progress/error) for a chapter *or* a post — `NarrationTarget` is a union. Transient — the truth is in Dexie and `check()` re-derives from it |
| `useUiLayoutStore` | Transient layout — `bottomBarHeight`, the height of whichever bar the current page puts above the nav (chat composer, reader pager), so floaters clear it |
| `useUpdateStore` (in `lib/pwaUpdate.ts`) | PWA update-available flag *(named `use*` though it's a store, not a hook — a known, intentionally-left naming exception)* |

`lib/` and `services/` read stores directly via `useXStore.getState()`; React components use
the `useXStore(selector)` hooks for reactivity. The one read path that *is* behind a contract
is playback-group → verses, via `src/lib/readingHosts.ts` (see above).

## Layer rules
- `components/` → call hooks + store selector hooks; presentational.
- `hooks/` → orchestrate; call `lib/` and `services/`.
- `lib/` → stateful singletons & logic (audio, gestures, sound cues); read stores via `getState()`.
- `services/` → stateless data access. `services/api/*` = HTTP; `services/bible/*` = reference parsing + verse fetch/format; `services/ai/*` = tool contract + dispatch.
- `store/` → Zustand state. `types/domain.ts` = canonical shared types. `utils/` = pure helpers.

## Naming conventions
- `use*` is reserved for **React hooks** (`hooks/`) and **Zustand store hooks** (`store/`).
- `lib/` singletons are camelCase nouns: `audioPlayback`, `browserTts`.
- `services/` modules export plain functions, not singletons.

## The mic dock — one control, five positions

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

### Floating

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

### Docked

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

## The reader screen (`/read`)

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

## Reading lists

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

That sheet **locks into** the selected list: while one is selected it shows that list's
passages *instead of* the Old/New Testament book columns — the list is the only thing you can
be choosing from, which is the point of having chosen it. The selection row carries its own
controls, because with the books hidden there is no longer a chapter tap to imply "I've left
the list": a pencil opens that list's editor, and an `×` clears the selection so the books come
back.

It shows a **window**, not the whole list, because a ninety-day plan is not something you pick
from:

- a plan (two or more days) shows one day at a time, with the neighbouring days *named* in the
  pager (`‹ Day 1 · DAY 2 · Day 3 ›`) rather than listed, and the day you're on in a brand pill;
  finishing today's last passage moves the window on by itself;
- a plain list gets pages of `PASSAGES_PER_PAGE`, opening on the page holding the current entry;
- a finished day is ticked wherever it is named, including in the pager, so "have I done that
  one" needs no stepping onto it.

**"Where I am" is derived, not stored**: `progress.currentEntryId` when something has been
played, else the first unread passage. Three things read it and must agree — the day the window
opens on, the highlighted row, and what Continue plays — and the reader's own resume
(`resumeOf`) derives it the same way, so the sheet and the page never disagree about where you
left off. A plan ticked off entirely by hand has no `currentEntryId` at all, which is why the
fallback exists rather than being a nicety.

The rows are **the list screen's rows** — `components/reading/PassageRow.tsx`, shared with
`/lists/:id`, progress bar and tappable checkboxes included. The picker had its own compact
variant, and looking like a different feature was the first thing anyone noticed about it. One
component means one answer to what a passage looks like.

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
"Reading hosts" above).

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

## Community spaces

A **space** is one person's collection of their own writing; a **post** is one piece in it.
Sharing is invite-only by a share code — there is no public listing, no discovery, no follower
counts. `Profile`, `Space`, `Post`, `Subscription` (a space I follow) and `Membership`
(somebody following mine) are in `types/domain.ts`; the store is `useCommunityStore`.

**The whole point is reuse of the reader.** A post is displayed and narrated exactly like a
Bible chapter — the user's paper and ink, forced-aligned word highlighting, offline pinning,
lock-screen transport. Everything below exists to make user prose fit that machinery without
a second pipeline.

### `VerseSummary.unit` — the one discriminant

`VerseSummary` is the currency of the entire playback path (the reader,
`groupIntoParagraphs`, `buildPlaybackPlan`, the TTS cache keys, `WordHighlighter`,
`readingContinuation`, `lastReadingStore`, `publishNowPlaying`). Widening it into a
`ReadingUnit` supertype would touch ~20 files; a bare `bookId: 0` sentinel would leak into
`getBookById(0)`, the lock-screen subtitle and the last-reading slot.

So there is **one optional field**, `unit?: PostUnit`, carrying exactly what the display sites
need (title, author, language, paragraph index), and `isScriptureUnit(v)` is how you test for
it. Purely additive, so nothing that constructs a `VerseSummary` had to change — and
`SegmentRef` grows `spaceId`/`postId`/`postTitle` the same way, which is why **`readerStore`
needed no persist migration** (it stays v2).

`translation` on a post unit is a **stand-in for the voice language only**
(`postUnits.voiceTranslationFor`), so `localeForTranslation()` picks the right TTS language for
free. The two places that would otherwise show it — `publishNowPlaying`'s lock-screen subtitle
and `buildPlaybackPlan`'s spoken heading — branch on `unit` first.

### Rendered text must equal narrated text

`services/bible/verseSummaries.ts:10-17` records the rule: display and speech share one
string, or `WordHighlighter`'s word index space drifts from the alignment and the highlight
silently desyncs. **That is why posts are plain text.** Markdown would have to be stripped for
TTS and the two would no longer match.

`services/community/postUnits.ts` is therefore the single chunker, **and its output is a cache
key**: one unit per authored paragraph (the author chose those breaks — unlike Bible verses,
where `lib/readerParagraphs.ts` has to infer them), split at sentence boundaries only when a
paragraph exceeds `tts.speak`'s 4000-**byte** cap. Change how it splits and every existing
narration key changes with it, orphaning generated audio and pinned downloads.

### Where the reader had to grow

- `ReaderSource |= { kind: 'space', spaceId?, code? }` — by **code** for somebody else's space
  (that is the only way to name one) and by **id** for your own, which may have no code yet.
  `resolveSpace()` / `resolveSpaceFrom()` in `services/community/spaceReading.ts` answers both;
  the pure form exists so `useReaderSequence` can pass a *subscribed* snapshot, otherwise
  `exhaustive-deps` can't see the dependency and the memo serves a stale sequence.
- `segmentId` gains a third shape, `reader:sp:<spaceId>:<postId>`, still under the `reader:`
  namespace — so `readingHosts` dispatch, the transport, autoPlay and the lock screen work
  untouched. No translation in it: a post has none, and nothing can re-render its words under
  the audio.
- **The fetch came out of `readerStore.loadSegment`** into
  `services/reading/segmentLoader.ts`. That one hardcoded `loadChapterSummaries` call was the
  reason the reader could only ever show Bible chapters; everything else about the store's
  loading machinery turned out to be source-agnostic. `absorbsGaps()` is the other half:
  versification gaps are normal for scripture and a *step* walks past them, but a missing post
  is a real miss and skipping to the next one would show something the reader didn't ask for.
- Both copies of `sequenceFor` need the space branch — `readerStore.ts` and
  `useReaderSequence.ts`. They were already duplicated; they must not diverge.

### Continuation — the one place a mistake produces wrong *audio*

`ReadingGroup.provenance` is now a union (`readingHosts.ts`):

```ts
type ReadingProvenance = ListProvenance | SpaceProvenance;   // + isListProvenance / isSpaceProvenance
```

A union rather than a second optional field so "no provenance" stays exactly one thing —
canonical Bible order — and the compiler forces every consumer to say which kind it handles.
Without it, a post group falls through to `canonicalNext()`, which asks the Bible what follows
chapter 0 of book 0: **auto-play reads a blog post and then starts Genesis.**
`nextReadingAfter` now has a `nextInSpace` branch (next post, stop at the end, no canonical
fallback — the alternative to the end of a space is silence), plus a defensive guard for a post
group carrying no provenance at all.

### Audio, and why the server needs no new storage

`?action=tts.speak` already content-addresses generated speech and its forced alignment under
`storage/audio/speak/{voice}/<sha256 of the text>`, in a directory **shared by every user** —
the same arrangement as verse audio. So the first person to hear a paragraph pays for it and
everyone after gets a cache hit, and an author who taps "prepare audio" at publish time is
warming it for their subscribers. That is the whole of "cache post audio on the server": no
upload step, no per-user audio.

`services/narration/narrationRequest.ts` is the single answer to *which* narration path an
item takes, because playback (`startPlayback.buildTrack`), the offline download
(`downloadChapter` / `downloadPost`) and the offline-coverage check (`planFullyCached`) must
all agree — a key computed one way in one place means a downloaded chapter is silently
re-fetched, or a post's audio is filed under a scripture reference that does not exist. Three
kinds, which do **not** map onto `PlanItem['kind']`: a Bible verse (reference-keyed), a post
paragraph (`kind: 'verse'` but text-keyed), an announcement (text-keyed).

`highlightVerse` stays `kind === 'verse'`, which now includes post paragraphs. That flag
suppresses the per-word tick for *announcements*, whose alignment maps onto nothing rendered;
a post paragraph is rendered verbatim, so its highlighting is as valid as a verse's.

### Signatures — what they prove, and what they don't

Every published post is Ed25519-signed on the device. The key comes from the same seed as the
identity but via its own domain separator (`sha512(seed || 'ba.sign.v1')`), rather than
claiming the seed's unused `[48..64]` — so nothing collides with a future use of the seed.
Being derived from the mnemonic means **the same user signs identically on every device**, with
nothing extra stored or synced.

`lib/postSignature.ts` holds the crypto and imports nothing from the app, which is what lets
`npm run community:verify` exercise the real code; `lib/postSigning.ts` is the passphrase-bound
cache around it. The signed message is canonical and domain-separated, with every free-text
field replaced by the hex sha256 of its bytes — so a title or body may contain anything,
newlines included, with no way to forge one field by stuffing a delimiter into another. It
commits to the **author's public key** rather than to `userId`, which keeps the owner's uuid (a
valid `X-User-Id`) out of the feed projection and blocks signature-lifting just as well.

Stated plainly, because signing invites over-claiming:

- ✅ the server cannot forge a post, alter a published one, or attribute someone else's writing
  to you — it never sees the private key;
- ✅ tampering and rollback are *detected*: a post that fails verification is refused, not
  rendered with a caveat, and `updatedAt` is signed so an older-but-valid replay is caught;
- ❌ the server can still **withhold or delay** a post, or hide a deletion. Catching that needs
  a signed per-space manifest with a serial number, which last-write-wins sync across the
  author's own devices would fight. Known limitation.

### The share code is an address, not a key

This is the distinction to keep straight, because the code *looks* like a secret and is not
one. It exists so an author can say "here, read this" over WhatsApp or out loud — it locates
the space. **Access control is the accept/deny and nothing else**: `space.feed` answers only a
member the owner accepted, so holding a code buys the ability to *ask*. Named codes
(`christoph/gedanken`) are a sensible thing to add later for exactly that reason.

Two things temper it, pulling in opposite directions:

- guessing a code is not consequence-free — the reply to `space.request` names the space and
  its owner (the asker has to know what they just asked to join), and for a space set to
  **auto**-approval the code *is* the gate, because that setting is the owner saying it is
  enough. So a generated code carries ~50 bits, and the UI says plainly what auto-approval
  means;
- `SHARES_DIR` is HTTP-denied like `storage/users/`. That is about not letting anyone
  enumerate every space on the server, not about the codes being secret.

**The key fingerprint is a separate, optional concern.** A generated code is
`10 random + 6 fingerprint` characters, the last six committing to the author's public signing
key. That is an *integrity* check, not an access check: a signature only proves "whoever holds
this key wrote this", so a code that commits to the key lets the subscriber confirm the key it
is about to pin belongs to whoever sent the code — over a channel the server does not control.
Strictly better than trust-on-first-use, for six characters.

It is deliberately **conditional**, so a named code stays possible: `codeMatchesKey` is
*vacuously true* for a code carrying no fingerprint, and callers that care ask
`codeCarriesFingerprint` instead of reading `true` as "confirmed" — `communityStore.subscribe`
is the one that does. A code with no fingerprint pins on first contact, and the author's
fingerprint is shown in Settings so two people can compare it by hand.

`normalizeSpaceCode` is the single gate on what a code may look like. **Widen it together with
api.php's `normalizeShareCode`**, which turns the result into a filename under `SHARES_DIR`.

Replacing a code drops that space's memberships — not because the old code was a key, but
because a membership is a decision about a particular invitation.

### Local-first ownership

The writing is the user's and lives in Dexie; the server holds a *copy* of what is currently
shared. Two deliberately different actions:

- **delete a post** — `deleted: 1`, gone from device and server, like every other entity;
- **withdraw** (leave the community, or delete the server account) — local-only `shared: 0` plus
  a `post.delete`. The row survives untouched and readable.

`publishedAt` is immutable because it is signed, so withdrawing and re-sharing keeps both the
date **and the original signature valid** — the round trip is lossless. `disableCommunity()`
deliberately leaves `syncEnabled` alone: creating the profile turned it on, but cards and lists
may now depend on it. `lib/factoryReset.ts` is the only thing that removes the writing.

The pull has one asymmetry that matters: **posts absent from the server are never deleted
locally.** The server holds only what is shared, so a draft or a withdrawn piece legitimately
has no remote counterpart, and treating "missing" as "deleted" would destroy the user's own
writing — the one outcome this feature must never produce.

### Sync and the backend

`communityStore` does not open its own network path: `flushQueue()` and `pullFromServer()` stay
the only ones, so the `syncEnabled` opt-in keeps meaning what it says.
`services/community/communitySync.ts` supplies the op routing table, `pullCommunity()` and
`seedCommunityQueue()`, and `libraryStore` gained three small hooks. A completed pull is
delivered through `onCommunityPulled()` rather than an import, so the dependency runs one way.
`refreshSubscriptions()` is the exception and is not sync: it reads *other people's* spaces into
the `feedPosts` cache, which sits outside the machinery entirely because `dirty`/`deleted` and
the pull's `pending*Ids` all assume one writer per row and somebody else's writing has none.

`api.php` gained two rules and seventeen actions. **A share code is the only way to name a
space** — no action takes a target userId, `storage/shares/{code}.json` resolves it, and that
file tree is HTTP-denied like `storage/users/` so nobody can enumerate it. **Nothing user-authored is echoed verbatim to
another user**: every record crossing accounts goes through a `sanitize*` whitelist, which for
posts is additionally enforced *by the signature* — the client signs exactly the fields kept,
so dropping or mangling one is detected rather than accepted.

`space.request` is the only cross-user **write** (it appends a membership row, carrying the
caller's authenticated id and a name snapshot, into the owner's file; a requester can never set
its own status, and re-asking cannot clear a block). `space.feed` is the only cross-user
**read** and answers only an accepted member, with projections rather than stored records.
Signature verification server-side is defence in depth only, guarded on the sodium extension —
PHP has no private key, so it stores signatures and never mints them.

Avatars are the one exception to "nothing a user owns is served statically": an `<img src>`
needs a real URL, so they go to `storage/avatars/{sha256}.{ext}`, content-addressed and
world-readable once the URL is known. `public/.htaccess`'s CORS `FilesMatch` was extended to
image types so the native WebView can `fetch()` one into `mediaCache`.

### Verification

Two scripts, following `bible:verify`'s pattern rather than introducing a test runner:

- `npm run community:verify` — signing and share-code properties, plus the chunker's byte cap
  and determinism. Imports the real modules, which is why `postSignature.ts` and `spaceCode.ts`
  import nothing from the app.
- `npm run community:verify:api` — starts its own `php -S` in a temp docroot (so
  `public/storage` is never touched) and exercises the cross-user surface: approval gating,
  blocked subscribers, code rotation, expiry pruning, the feed projection leaking no uuid, and
  the ownership round trip.

### Reading across spaces

"Everything new" and "today, from everyone I follow" are not spaces but
**selections** — `ReaderSource` gains `{kind:'selection', label, postIds}`, and it
carries the post ids rather than a filter. That is the whole point: a filter
would be re-evaluated as pieces are marked seen, so the list would shrink
underneath the pager while it was being read and `next()` would start returning
the wrong piece. A snapshot is fixed from the moment the user asked for it, which
is also why `sameSource` compares the ids and why `unseenPosts` reads `seen`
from the store rather than through `SpaceSnapshot` (that snapshot is what
`useReaderSequence` memoizes on).

They cover subscribed spaces only — the user's own writing is not new to them —
and `todayPosts` is deliberately *not* filtered by seen: asking for today's
pieces is a request for today's, not for what is left of them.

**Continuation follows the reader's source, not the piece's own space**
(`nextInSpace`). A piece read as part of "everything new" is usually followed by
one from a *different* space, so continuing within its own space would quietly
leave the reading the user asked for. Consulting the reader there is not the host
leak it appears to be: a post can only be read in the reader, so its sequence is
the only answer there is.

**`markSeen` is what empties all this**, and it has three callers, mirroring
`readingProgressTracker`'s design: narration starting a piece
(`noteEntryStarted`), narration finishing one, and the reader moving off one
after the dwell threshold. The dwell rule is shared with reading-list progress
rather than duplicated — the flick-past problem is identical. One known gap:
reading a piece and closing the app without moving on never marks it, because
dwell is only evaluated on a position change.

`Subscription` caches `spaceKind` and `spaceEphemeralHours`, restated from every
feed response, which is what makes the Today filter possible and lets a
subscribed Today space show its localized name instead of the stored literal.

### Staying current — there is no push channel

Sharing is the one place two people wait on each other, and nothing pushed:
`members.list` was pulled only at boot and the feeds only on mount, so an author
sat looking at a request list from whenever they last loaded and a subscriber who
had just been accepted still read "waiting for approval". Both needed a reload to
see something that had already happened.

`useCommunityRefresh` polls instead, and where it *doesn't* poll is the design:

- only while a community screen is mounted (the hook is not global);
- only while the tab is visible — a backgrounded app polling a shared server for
  nothing is what makes polling rude, and `visibilitychange` does a full refresh
  on the way back, which on a phone is the common case;
- `members.list` every 15 s (one small file, and it is what the author waits on);
- feeds **only while a subscription is `pending`**, because one `space.feed` per
  subscription prunes and returns posts. Otherwise they refresh on mount and on
  returning to the foreground.

Both halves of the original complaint land on the 15 s path: the author's inbox,
and a subscriber whose subscription is pending.

`refreshMembers` **warns** on failure rather than swallowing, unlike its
neighbours — it runs once per poll and a silent failure means a quietly stale
request inbox, which is invisible otherwise and cost real debugging time.
`refreshSubscriptions` stays silent because it runs per subscription and offline
is a normal state there.

### Known limitations

- A voice command on `/read` still produces a *chat* reading, as it does for the Bible.
- Updates between two people are polled, not pushed, so an accept or a new request can take up
  to 15 s to appear (immediately on returning to the app). A hidden tab does not poll at all.
- Per-post completion is not tracked; unread is a local dot (`seenPosts`), not a synced tick, so
  what you have seen does not travel between your devices. Doing it properly wants
  `readingProgress`'s union-merge machinery, which is keyed by `listId`.
- No QR code yet. `shareText()` covers sending a code; scanning would need a camera plugin plus
  iOS/Android permissions, and a QR that opens the app needs Universal Links / App Links.
- User-generated content shared between users brings Apple guideline 1.2 / Play UGC policy into
  scope. Invite-only plus approval-gated access covers most of it; a report affordance is not
  built yet.

## Theming

Colour tokens are named by **role, not hue** — `surface` / `surface-raised` /
`surface-sunken`, `ink` / `ink-muted`, `brand` / `brand-muted` / `brand-bright`. The
old `navy` / `cream` / `gold` names stopped being true the moment a light theme
existed. Two extra roles exist because one name was doing two jobs:

| token | meaning |
| --- | --- |
| `on-brand` | foreground on a **brand** fill — inverts with the theme (dark text on light gold, light text on dark brown) |
| `on-fill` | foreground on a **pastel ribbon or card** fill — fixed dark in every theme, because those fills are light in every theme |

`ribbon-*` and `card-*` are user-chosen *content* colours and deliberately do not
follow the theme. The two exceptions are `card-none-*`, which is chrome.

Three constraints, each of which breaks something quietly if ignored:

- **Values are space-separated RGB channels, not hex.** Tailwind alpha modifiers
  compile to `rgb(var(--token) / .4)`, and this codebase has ~173 of them. A hex
  makes every one of them invalid.
- **Palettes are declared on `[data-theme]`, not just `:root`.** An attribute
  selector applies at any depth, which is what lets a subtree (a sepia reader)
  carry its own palette without touching `lib/theme.ts`.
- **Colour lives in `src/index.css`, not in TS.** `lib/theme.ts` decides *which*
  palette is active and syncs what CSS can't reach (the `theme-color` meta tag,
  `SystemBars.setStyle()`). It reads values back out of the cascade rather than
  keeping a copy. `setPaletteVars()` is the seam for palettes that can't exist at
  build time — a user contrast preset — and `THEME_TOKENS` is their contract.

The light palette is **not** an inversion of the dark one: the dark theme's gold is
2.1:1 on paper, a hard fail, so `brand` carries its own values chosen to mirror the
dark theme's contrast ratios. Check a ratio before changing any of them.

`--verse-tint-alpha` is the "currently reading" highlight's opacity, a number
rather than a colour so the tint follows `brand` automatically and a contrast
control has one knob. The inline (reader) variant adds 0.02, since with no inset
bar the tint is the only cue.

**Native chrome.** Android resources split into `values/` (light) and
`values-night/` (dark), so system-bar *backgrounds* follow the device.
`SystemBars.setStyle()` sets bar *icon* contrast at runtime — it has no background
counterpart, so an in-app override that disagrees with the device (light theme on
a dark phone) leaves the bars dark. Closing that needs a small native shim.

Existing installs migrate to an explicit `'dark'`, not `'system'`: the app was
dark-only before this, so following the OS would restyle people who never asked.

### Reading appearance — the user's own paper and ink

`settings.readingAppearance` (`lib/readingAppearance.ts`, edited through the
reader's `Aa` sheet and a mirrored section in `/settings`) governs **the Bible
text only**: the reader column and chat verse panels. App chrome — headers,
footers, nav, and the sheet itself — deliberately stays on the app theme, because
the contrast control can be taken to zero on purpose and the button that undoes
that has to remain visible. `BottomSheet` portals to `document.body`, so the sheet
is outside the surface's subtree for free.

Colour is **derived, not stored**, and it derives from **one colour per chip**.
A chip supplies the *lightness pair* — which end is paper, which is ink, how far
apart — and the colour picked for it supplies hue and saturation. One brown gives
a cream page with brown-black text on the light chips and a dark-brown page with
cream text on the dark ones, so a chip keeps its character and the colour is what
changes. Per chip rather than shared, so recolouring Night can't turn Sepia blue.
The contrast slider then slides the ink toward the paper and past it —
`ink' = paper + (ink - paper) * k`, `k = 1` being the chip untouched. OKLCH and
not sRGB because "distance" has to mean *perceptual* distance.

**Saturation is always a fraction of the gamut, never an absolute chroma.** sRGB
holds about four times more chroma at the ink's L 0.26 than at a near-white
paper's L 0.97 (`maxChromaFor()` measures it), so any single absolute value is
invisible at one end or clipped at the other. A pick therefore carries its
saturation *relative to its own lightness* — `main.c / maxChromaFor(main.l,
main.h)` — and spends that same share of the very different room each end has.
The swatch grid's three rows are fractions for the same reason: as absolutes they
clamped together, and all three produced an identical page on four chips out of
five. This one mistake has now been made three times in this feature (the ink
tint floor, the swatch levels, and the first hue sliders); absolute chroma is the
trap.

**The paper is pinned.** An earlier version moved both around their midpoint,
which made every contrast change a change of page brightness too — a lot to
happen under one control, and on a tinted preset it went muddy on the way down
(a fixed chroma reads as far more saturated at mid lightness than at the ends,
so softening sepia turned the page olive). Now the paper is whatever the preset
says at every setting, and the slider only decides how strongly the text is
printed on it. Chroma and hue converge along with the lightness, so `k = 0`
lands the ink *exactly* on the paper rather than merely at its luminance —
without that the text survives its own contrast as a colour. Both are capped at
`min(k, 1)` so pushing past the preset drives lightness apart without
over-saturating.

`k` scales the **brand** distance too: left at full strength, collapsing the
contrast left a page whose verses had vanished while its chapter heading and drop
cap still shouted.

`setPaletteVars()` was left in `lib/theme.ts` for exactly this and is now its only
caller. Three things about the derivation are load-bearing:

- **Only nine tokens are written.** The surface carries a `[data-theme]` chosen by
  the resolved paper's *lightness*, which brings in the rest from `index.css` —
  `--verse-tint-alpha` above all, so the reading tint follows the paper rather
  than the app. A bright paper under the dark app theme still highlights legibly.
- **The gold is read back out of the cascade**, from a *detached probe* element,
  and only its lightness is re-placed relative to the paper. `index.css` stays the
  one place a colour is written down, and the heading stays legible on a paper its
  author never saw. The probe is why: the derived tokens are inline styles on the
  same element that carries `data-theme`, so reading the base back off it would
  chase its own tail.
- **The app's mode is an argument, not a DOM read** (`useDocumentThemeMode()`).
  `lib/theme.ts` writes `<html data-theme>` from an effect, so sampling it during
  render is one tick stale on every theme switch and never notices the OS flipping
  appearance at all.

The default (`paper: 'theme'`, contrast 1, no tints) emits **no** colour vars and
no `data-theme` — `isDefaultPalette()` short-circuits — so an install that never
opens the sheet renders exactly as it did before the feature existed.

Type is three custom properties (`--reading-font-size`, `--reading-line-height`,
`--reading-measure`) on `.reading-surface`, whose fallbacks are today's values;
`SegmentBlock` and `WordHighlighter` therefore carry **no** size, leading or family
of their own, and headings use `em` so they track the body instead of shrinking
away from it. The measure is in `ch` so it stays constant in *characters* as the
size changes. Everything is written imperatively through a ref, never as a `style`
prop, so dragging a slider repaints without re-rendering the verse tree.

**Two columns are gated in CSS** (`@media (min-width: 768px)`), not on the setting:
a phone in portrait has no room for them, and someone who turned it on for their
tablet must not get 20-character columns on their phone. The setting is a
preference; the media query is the constraint.

## Offline-first — what needs a network and what doesn't

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

**`isBundled()` vs `isPreinstalled()`** (`services/bible/packFormat.ts`) — the second is
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

## Backend — `public/api.php`
Single PHP entry; routes on `?action=`. Per-user data dirs keyed by an identity derived from the user's passphrase. OpenAI actions (`chat`, `tts`, `tts.speak`, `transcribe`, `recording.upload`) require a key — a personal key (sent by the client) or the shared key, selected via the `X-Prefer-Shared-Key` header.

**Accounts are lazy.** `authenticate()` validates the identity headers and creates
nothing; `requireUserDir()` creates `storage/users/{id}` and is called from the router
only for `$ACCOUNT_ACTIONS` (the cards/boards writers, `auth.openaiKey.set`,
`recording.upload`). Everything else works with no directory at all — the readers guard
with `file_exists`/`is_readable` and answer empty. This is what makes the client's sync
opt-in truthful: a user who only reads scripture and asks the assistant questions leaves
nothing on the server. Don't move an action into `$ACCOUNT_ACTIONS` without meaning it,
and don't reintroduce an eager `mkdir` in `authenticate()`.

Actions: `chat`, `tts`, `tts.speak`, `bible.chapter`, `transcribe`, `auth.openaiKey.{status,set,clear}`, `cards.{list,upsert,delete,order.get,order.set}`, `boards.{list,upsert,delete,order.get,order.set}`, `readingLists.{list,upsert,delete}`, `readingProgress.{list,set}`, `recording.upload`, `account.delete`, `ambient.list`, and the community actions:
`profile.{get,set,delete}`, `profile.avatar.upload`, `spaces.{list,upsert,delete}`,
`spaces.code.set`, `posts.{list,upsert,delete}`, `members.{list,decide}`,
`subscriptions.{list,upsert,delete}`, plus the only two that cross accounts —
`space.request` and `space.feed` (see "Community spaces").

`readingProgress.set` is the one writer that **merges** rather than replaces — see "Reading
lists". `readingLists.delete` also drops that list's progress row, which has no meaning without
it. The client tolerates both reading-list actions being absent (an older api.php answers
"unknown action"), so shipping the client before the backend costs a user their lists syncing,
not their cards.

Bible text is parsed from Zefania XML in `public/bibles/*.xml` (S00, S51, LUT, HFA, ELB = German; ESV, KJV, NKJV = English). Client base URL + error handling: `src/services/api/client.ts` (`apiPostJson` / `apiGetJson` / `apiPostForm`, `ApiError`, `onUserKeyFailure`).

## Native builds (Capacitor 8) — the per-target differences

`vite build --mode capacitor` is a genuinely different artifact, not just a repackaged web build:

| | web | native |
| --- | --- | --- |
| `base` | `/` | `./` |
| outDir | `dist/` | `dist-native/` |
| `publicDir` | `public/` | **off** — an allow-list is copied instead |
| Router | `BrowserRouter` | `HashRouter` (Android WebView ≥117 won't change paths on custom schemes) — `/read` is `#/read`, and `useLocation().pathname` still reads `/read` |
| Service worker | yes | none — no SW under `capacitor://` |
| API origin | same-origin, relative | absolute, from `.env.capacitor` (`src/services/api/origin.ts`) |
| Bible source | downloaded packs first, then network | bundled LUT/KJV packs first, then downloads, then network |

**`webDir` must stay `dist-native`.** `dist/` is ~300 MB and contains `secrets.php` (a live
OpenAI key), `storage/` (every user's cards + `secret.txt`) and the Bible XML, because Vite
copies `public/` verbatim. `vite.config.ts` has a recursive `closeBundle` assertion that fails
the build if any of that reaches the bundle — don't weaken it.

### Audio: why playback is an HTMLAudioElement, not Web Audio
Measured on iOS, not assumed: WebKit **suspends the AudioContext** as soon as the page is
hidden. Over a 13 s background window `ctx.currentTime` froze at 7.97 while a media element's
`currentTime` advanced 9.02 → 22.17. `UIBackgroundModes: audio` does not change this — Web Audio
never gets background privileges, and iOS only attaches lock-screen controls to media elements.

So: verses, assistant replies and ambient music run on media elements
(`elementTrackPlayer.ts`, `ambientAudioBus.ts`). The AudioContext remains **only** for UI cues
(`micCue`, `clickTick`, `thinkingDrone`, `speakLabel`), which are foreground-only so suspension
is harmless. Word highlighting reads `element.currentTime` directly.

Two traps live in `elementTrackPlayer.ts`, both learned the hard way:
- Priming with `play()` on a **src-less** element wedges it at `readyState 0` forever — prime
  with a real silent WAV, and always call `.load()` after assigning `src`.
- Never clear `src` from an async callback; it races `load()` and wipes the track out from
  under the element.

Interruptions (calls, Siri, headphone unplug) are handled by *following the element*: it fires
`pause`, and `onExternalPause` syncs app state. Web Audio gave no such signal. `AppDelegate`
reactivates the `AVAudioSession` when an interruption ends; playback deliberately does **not**
auto-resume.

### Speech input
Native builds prefer on-device recognition (`nativeSpeech.ts`, `@capgo/capacitor-speech-recognition`).
The Web Speech API does not exist in either WebView, so the web build is Whisper-only, and
Whisper (`?action=transcribe`) remains the fallback everywhere.

The iOS workaround layer — `iosAudioRouting.ts`'s silent-WAV nudge, the AEC/AGC-disabling
`micConstraints()`, `DUCK_FACTOR = 0` — is now **only on the Whisper/push-to-talk path**, which
still uses `getUserMedia` and so still hijacks the audio session. It can't be deleted while that
fallback exists.
