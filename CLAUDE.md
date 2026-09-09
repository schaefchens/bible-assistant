# Bible Assistant — Architecture Map

Mobile-first app for voice-controlled Bible reading: speak (or type) a reference, hear it read aloud. React 19 + Vite + TypeScript + Tailwind v3 + Zustand; a PHP backend (`public/api.php` routing over `public/api/*.php`) proxies OpenAI (chat / TTS / Whisper) and serves Bible text from local Zefania XML.

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
  `community:verify:api` also covers `feedback.create` (see "In-app feedback"), which is not a
  community action but has the same shape worth asserting — so run it after touching that too.
  It additionally asserts that no file in `public/api/` is servable on its own, so **run it
  after adding a handler file** as well.
- `npm run bible:counts` — regenerate `src/services/bible/verseCounts.ts` (verses per chapter)
  from the KJV pack. Only needed if the packs or the book catalog change; it asserts the two
  agree and that the totals are still 1,189 chapters / 31,102 verses.
- `./scripts/deploy.sh [--dry-run]` — deploy the PWA + PHP over SFTP. Uses an explicit
  allow-list: it must never upload `storage/` (live user data) or `secrets.php`. It names
  **`api.php` and the whole of `api/`** — the backend is a router plus fourteen files, and
  one without the other 500s on every request. `--dry-run` prints the transfer plan.
- TypeScript runs with `erasableSyntaxOnly`, so **constructor parameter properties
  (`constructor(private x: T)`) do not compile** — declare the field and assign it.
- `npm test` — the fast layers: `test:unit` (pure functions, node), `test:component` (a
  React render, jsdom) and `test:int` (stores + Dexie + queue, jsdom). Seconds. Run it like
  you run `tsc`.
- `npm run e2e` — the end-to-end suite, against the **built** app. Needs a current `dist/`
  (`npm run build`) and refuses to run against a stale one. Minutes, and it makes real OpenAI
  chat calls — run it after a risky feature or refactor, not on every change.
  `npm run e2e:live` is the opt-in cold-generation spec; it is the only thing that makes
  OpenAI *generate* speech. See "Testing" below.
- `npm run verify` — the whole gate: `tsc -b`, lint, the three `*:verify` scripts above, and
  `npm test`. What to run before a release, and it **exits 0** — keep it that way. It was red
  for a long time on eight `react-hooks/refs` errors, which meant nobody could tell a new
  failure from the standing ones.
- `npm run lint` — ESLint. **Zero errors**; the only warning left is one `exhaustive-deps` in `CardStack.tsx`. Two rules bite in this codebase: `set-state-in-effect` is an error, so adjust state during render (guarded) the way `AppShell`, `MicDock` and `EyesFreeMode`'s ticker do; and `react-refresh/only-export-components` is an error, so a `.tsx` file may export components **only** — a shared helper goes in a `.ts` module (which is how nine copies of `bookName` came to light).

## Entry points
| Concern | File |
| --- | --- |
| Router + error boundary | `src/App.tsx` → routes render under `src/components/common/AppShell.tsx` |
| App init (audio teardown, last-reading, network, key hydration, ambient prefetch, pack retry) | `src/hooks/useAppInitialization.ts` — six independent effects |
| Voice/text command pipeline | `src/hooks/useCommandPipeline.ts` — `send()`, and the tool loop inline in it (`while (loops < MAX_TOOL_LOOPS)`) |
| Global mic / push-to-talk | `src/hooks/useGlobalVoice.ts` + `src/components/voice/*` |
| The mic + transport dock (one element, five positions) | `src/components/voice/MicDock.tsx`, `MicButton.tsx` + `src/components/playback/TransportControls.tsx` |
| AI tool definitions (the model's API) | `src/services/ai/tools/` — one module per domain, assembled in `index.ts`; `ToolName` is **derived** from them |
| The two system prompts | `src/services/ai/prompts.ts` |
| AI tool dispatch (the routing table) | `src/services/ai/dispatch.ts` — `TOOL_REGISTRY`, one line per tool |
| AI tool handlers (the implementations) | `src/services/ai/handlers/{reading,library,readingLists,spaces,settings}.ts` |
| Audio engine (OpenAI TTS) | `src/lib/audioPlaybackManager.ts` singleton `audioPlayback`; the class is exported and takes an injectable `TrackPlayer` so its queue and feed loop can be tested |
| Verse/reply/ambient playback (HTMLAudioElement) | `src/lib/elementTrackPlayer.ts`, `src/lib/ambientAudioBus.ts` |
| Browser TTS engine (SpeechSynthesis) | `src/lib/browserTts.ts` singleton `browserTts` |
| Persistent audio + alignment cache (IndexedDB) | `src/lib/mediaCache.ts` |
| Theme application (palettes live in `src/index.css`) | `src/lib/theme.ts` |
| Narration source chain (cached → server) | `src/services/narration/narrationSources.ts` |
| Narration download (a chapter *or* a post) | `src/services/narration/narrationDownload.ts` + `src/store/narrationStore.ts` |
| Native speech recognition | `src/lib/nativeSpeech.ts` (Whisper stays the fallback) |
| What plays next (canonical order *or* a reading list) | `src/lib/readingContinuation.ts` |
| Auto-continuation + prefetch (the machinery, not the policy) | `src/lib/autoPlay.ts` |
| Bible reader screen | `src/routes/ReadPage.tsx` + `src/store/readerStore.ts` |
| "What should I read?" (the picker sheet) | `src/components/chat/BookChapterPicker.tsx` + `src/components/chat/picker/*` — one module per `ReaderSource` kind |
| Where you are in a reading list | `src/services/reading/listWindow.ts` — the one copy; `readerStore.resumeOf` reads it |
| Cards + boards (one screen, one tab strip) | `src/routes/CardsPage.tsx` + `src/components/cards/*` |
| A board's name / colour / background | `src/components/cards/BoardEditor.tsx` — a popover, not part of the rail |
| Dragging a card onto a board's tab | `src/hooks/useCardTabDrop.ts` + `src/lib/boardTabDrop.ts` |
| Community moderation (terms / block / report) | `src/lib/communityTerms.ts` + `src/components/community/{CommunityTerms,CommunityTermsGate,ReportDialog}.tsx` |
| Automated moderation (the judge and the policy) | `public/api/moderation.php` — `MODERATION_POLICY`, `moderationJudge()` |
| In-app feedback (the bug button) | `src/components/feedback/*` + `src/lib/feedbackContext.ts` |
| Reading lists (screen / editor) | `src/routes/ReadingListsPage.tsx` + `src/components/reading/*` |
| Community spaces (screen / editors) | `src/routes/SpacesPage.tsx` + `src/components/community/*` |
| Post signing (crypto / passphrase-bound) | `src/lib/postSignature.ts` + `src/lib/postSigning.ts` |
| Share codes (mint / fingerprint / normalize) | `src/lib/spaceCode.ts` |
| A post as reading units (the one chunker) | `src/services/community/postUnits.ts` |
| Community ⇄ reading seam | `src/services/community/spaceReading.ts` |
| Which reading list an id names (own, or shared) | `src/services/community/sharedReading.ts` — `resolveListById` |
| A shared plan or board as bytes | `src/services/community/sharedPayload.ts` (build, signed) + `sharedItems.ts` (parse, fork) |
| A room somebody else owns | `src/routes/RoomPage.tsx` |
| Somebody else's board, read-only | `src/components/community/SharedBoardView.tsx` — a body under `/cards`' tab strip |
| Which narration path an item takes | `src/services/narration/narrationRequest.ts` |
| Loading one segment, whatever kind (and walking past a versification gap) | `src/services/reading/segmentLoader.ts` |
| Reading-list order + expansion | `src/services/reading/readingSequence.ts` |
| Playing a list, and its progress | `src/lib/readingListPlayback.ts` |
| Playback ⇄ content seam | `src/lib/readingHosts.ts` |
| What sequence the reader walks | `src/services/reading/readerSequence.ts` (one pure + one live form) |
| Shared icons | `src/components/common/icons.tsx` (`Glyph` is the frame) |
| Clamps | `src/lib/math.ts` — `clamp`, `clamp01`; nothing else defines one |
| Bible data / references | `src/services/bible/*` |
| HTTP to backend | `src/services/api/*` (all via `client.ts`) |

## Data flow — a voice command
```
mic / text input
  └─ useGlobalVoice → useCommandPipeline.send(text)
       ├─ isStopCommand? → cancelAllActivity() (kills audio + aborts in-flight)
       └─ postChat({messages, tools})            [services/api/chat.ts → api.php ?action=chat]
            └─ useCommandPipeline loops while the model calls tools:
                 dispatchTool(name, args)         [services/ai/dispatch.ts → TOOL_REGISTRY → handlers/*]
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
| `reader:<translation>:l:<listId>:<entryId>:<chapter>` | `readerReadingHost` | one chapter of a reading-list entry — the author's list id, whether the plan is the user's own or mirrored out of a room |

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
| `useLibraryStore` | Cards + boards + their order, reading lists + per-list progress, and `pendingOps`. Split across four modules — see below |
| `useRibbonsStore` *(persist)* | Colored bookmarks ("ribbons") |
| `useGlobalVoiceStore` | Mic listening state, last voice response |
| `useLastReadingStore` *(persist)* | Resume point for "play last reading" — **audio-owned**, written only from the playback subscription. The reader's scroll position deliberately does not write here, or idle scrolling would move it |
| `useReaderStore` *(persist v2 — `position` + `source`)* | The reader screen: what it is walking through (the Bible, or a reading list), the current segment, the loaded-segment cache + the mounted window |
| `useBiblePacksStore` *(persist — `wanted` only)* | Offline Bible packs: per-translation status/progress, and which translations the user has asked for |
| `useCommunityStore` | The community profile, the user's own spaces and posts (drafts included, plus which are `shared`), subscriptions, subscribers. The state and the lifecycle only — the writers live in five sibling modules, see below |
| `useNarrationStore` | Per-target narration download state (status/progress/error) for a chapter *or* a post — `NarrationTarget` is a union. Transient — the truth is in Dexie and `check()` re-derives from it |
| `useUiLayoutStore` | Transient layout — `bottomBarHeight`, the height of whichever bar the current page puts above the nav (chat composer, reader pager), so floaters clear it |
| `useUpdateStore` (in `lib/pwaUpdate.ts`) | PWA update-available flag *(named `use*` though it's a store, not a hook — a known, intentionally-left naming exception)* |

### The community store, in six modules

`communityStore` was 881 lines holding four unrelated jobs. It is now the state,
`init`, the enable/disable lifecycle, the profile and `decideMember` — with the
writers beside it, on `librarySync`'s factory-over-`(set, get)` pattern.

| file | owns |
| --- | --- |
| `store/communityStore.ts` | the state, `init`, the lifecycle, the profile |
| `store/communityWriting.ts` | the user's **own** spaces and posts |
| `store/communitySubscriptions.ts` | the reader's side: subscribe, block, report |
| `store/communityFeed.ts` | reading **other people's** writing (polled) |
| `store/communityOps.ts` | `flush` / `queued` / `online` — the queue plumbing |
| `store/communityRows.ts` | the shaping rules and predicates the rest share |

The split lines are the **ownership rules**, not the type names. Writing is
local-first with a server copy of what is currently *shared*, which is why two
different deletes live together in one module (`deletePost` removes it
everywhere; `unpublishPost` drops only the `shared` claim). Subscribing,
blocking and reporting are one act seen from three angles — each a *reader's*
decision about somebody else's writing — which is why `blockAuthor` deleting
subscriptions reads naturally beside them.

`init` stays in the store because it touches every domain: it hydrates all of
them and tombstones both a blocked author's subscriptions and a
self-subscription.

**The feed is the one part outside the sync machinery**, and that seam predates
the rest: `dirty`/`deleted` and the pull's `pending*Ids` all assume one writer
per row, and somebody else's writing has none. Nothing in `communityFeed` rides
the sync queue or answers to `syncEnabled`. Everything in `communityWriting`
and `communitySubscriptions` does.

**Every sibling imports `type CommunityState` and nothing else, and that is a
rule rather than a coincidence.** `verbatimModuleSyntax` erases a type import,
so there is no cycle at runtime; a **value** import from the store into a module
the store spreads in is a real one. `communityOps` exists for exactly that
reason — three modules need `flush` and `queued`, and leaving them in the store
would have meant each importing it — and `isOwnCode` moved to `communityRows`
for the same reason, after being written the other way first. The store
re-exports it, so `/subscribe/:code` is untouched.

**`communityRows` is where a type cycle goes to die, and the failure mode is
worth knowing.** With its helpers in either of the modules that need them, the
two import each other, TypeScript gives up inferring `CommunityState`, and it
silently becomes `any` for *every component that reads the store*. `tsc` reports
that as a dozen implicit-any errors in `SpaceDetail` and says nothing at all
about a cycle — so if unrelated components suddenly grow implicit-any errors,
look here first.

One consequence of the factory shape: an action's parameters have no contextual
type inside it, unlike the same line written inside `create<CommunityState>`.
Every parameter in those modules is annotated for that reason, not by
preference — `markSeen(postId: string)` was the first.

### The library, in four modules

`libraryStore` was 903 lines: cards, boards, reading lists, progress **and** the
server. The CRUD half and the sync half share state but almost no code, so they
are now separate — with two small modules holding what both need, which is what
keeps them from importing each other.

| file | owns |
| --- | --- |
| `store/libraryStore.ts` | the state and the CRUD actions |
| `store/librarySync.ts` | `flushQueue`, `pullFromServer`, `enableSync`, `disableSync` |
| `store/libraryOrder.ts` | the order rule, and the three `preferences` keys |
| `store/libraryRows.ts` | turning a stored row into a row the app renders |

Three things about it are load-bearing:

- **`syncEnabled` is still enforced in exactly three places.** `flushQueue` and
  `pullFromServer` moved but did not multiply — `syncQueueManager.enqueueOp` is
  the third, as before. A new caller still cannot bypass the opt-in.
- **`librarySync` is a factory over `(set, get)`**, so the four action bodies
  moved *verbatim*. Nothing inside them was rewritten, which is what let the
  integration tests stand as the net rather than being rewritten alongside.
- **`librarySync` imports only `type LibraryState` from the store**, which
  `verbatimModuleSyntax` erases. `expandStoredSpans` and `seedSyncQueue` take
  `get` for the same reason: they used to reach the store through its own module
  import, which from there would be a cycle. Don't add a value import back.

`lib/` and `services/` read stores directly via `useXStore.getState()`; React components use
the `useXStore(selector)` hooks for reactivity. The one read path that *is* behind a contract
is playback-group → verses, via `src/lib/readingHosts.ts` (see above).

## Layer rules
- `components/` → call hooks + store selector hooks; presentational.
- `hooks/` → orchestrate; call `lib/` and `services/`.
- `lib/` → stateful singletons & logic (audio, gestures, sound cues); read stores via `getState()`.
- `services/` → stateless data access. `services/api/*` = HTTP; `services/bible/*` = reference parsing + verse fetch/format; `services/ai/*` = tool contract (`tools.ts`), routing table (`dispatch.ts`) and handlers (`handlers/*`).
- `store/` → Zustand state. `types/domain.ts` = canonical shared types. `utils/` = pure helpers.

## Naming conventions
- `use*` is reserved for **React hooks** (`hooks/`) and **Zustand store hooks** (`store/`).
- `lib/` singletons are camelCase nouns: `audioPlayback`, `browserTts`.
- `services/` modules export plain functions, not singletons.

## Testing — three layers, three jobs

There was no test runner here for a long time and `npm run build` was the gate. That is still
true of the *build*; what changed is that the two things a build cannot see — a rule that is
wrong, and a screen that does not work — now have somewhere to live.

Isolated logic is tested in isolation, where mocks belong. The end-to-end suite mocks
**nothing** and changes **no source**: it drives the shipped artifact the way a user does.

| Layer | What | Mocks? | Source changes? | When |
| --- | --- | --- | --- | --- |
| `tests/unit` | pure functions | none needed — that is the entry criterion | no | `npm test` |
| `tests/component` | a React render: hook reactivity, render-time state | rarely — the real stores drive it | an export, at most | `npm test` |
| `tests/int` | stores + Dexie + queue, the tool dispatcher, the segment loader | yes, at the outer edges | no | `npm test` |
| `tests/e2e` | a user clicking through the real app | **none** | **none** | `npm run e2e`, on command |

**`tests/component` has a deliberately narrow entry criterion**, because the layers either
side of it already cover more than it does: *a rule that only exists once React renders, and
that no pure function can see.* Hook reactivity, a guarded state adjustment during render, a
memo's dependency list. "Does this button work" is a **journey** and belongs in `tests/e2e`;
"does this function return the right thing" belongs in `unit`. What lands here is the middle
case neither can reach — and if a candidate test does not need `act()`, it is in the wrong
layer.

It is the only vitest project with `react()` in its plugins; `unit` and `int` never render
and don't pay for the JSX transform. Its setup file is one `afterEach(cleanup)`, without
which the second test in a file matches the first one's tree.

Its two founding tests are the shape to copy. `RollingTicker`'s chunk survives a gap but not
a stop — behaviour across a *sequence* of renders, driven by setting the real playback store
and wrapped in `act()`. And `useLocale` re-renders its component when the language changes,
which is the entire reason it is built on `useTranslation()` and exactly what a hand-rolled
version gets wrong: right on first render, then silently stale for the session.

**Both were mutation-tested, and one of them failed that check first time.** Three
deliberate breaks were made to the ticker; two died immediately, and the third — dropping the
`stopped ? null :` guard — *passed all eleven tests*, because clearing the held chunk blanks
the ticker on its own in every stop path the tests covered. The case that separates them is
`status: 'idle'` with the track still attached, which is a real intermediate state:
`audioPlaybackManager` stops with two separate store writes (`setStatus('idle')` then
`setCurrent(null)`). A test for that now exists and kills the mutation. Worth repeating on
anything added here — a green test that agrees with the code for the wrong reason is worse
than a red one.

**One unit test is a static scan rather than a function call**, and it earns
the exception: `tests/unit/i18nKeys.test.ts` walks every literal `t('…')` in
`src/` and asserts the key exists, names a *string* rather than a group of
them, and exists in both languages. A shared board's Report button shipped
rendering the words `community.report` because that key is a group and asking
for a group hands back the key's own name instead of throwing — invisible to
`tsc`, to lint, and to every E2E spec that did not happen to assert on that one
button. Per-button assertions would be one bug caught and six hundred call
sites left open; this is the lowest layer that can see the whole class. It
covers literals only — a handful of sites build the key, and chasing those
needs evaluation or a convention nobody would keep.

Three E2E projects, and the split is not cosmetic. `app` is the journeys.
`mobile` carries an Android user agent for the one flow that branches on it (an
invitation's app hand-off) — giving the main project a mobile UA would change
what every other spec renders, and `hasTouch` would route dnd-kit to the
TouchSensor. `pwa` is the only one that wants a service worker, and it
*rebuilds* `dist/` to produce a genuine update; that is safe because
`__BUILD_TIME__` makes every build a new bundle with identical behaviour.

`bible:verify` and `community:verify*` are part of the integration layer and predate the
naming; they stay exactly as they are.

**The E2E tier serves `dist/`.** That directory is already the whole deployed app — `api.php`,
`secrets.php`, the Zefania XML, `sw.js`, and a warm `storage/audio` — so one `php -S -t dist`
is the production topology, same origin, with no proxy and no dev server. PHP's CLI server
falls back to `index.html`, so `BrowserRouter` deep links work unaided. `tests/e2e/run.mjs`
refuses a stale `dist/` and resets per-user state, keeping the content-addressed caches.

**Narration is real and free.** Speech is content-addressed server-side, so the journeys read
from the warm cache: Psalm 117 (two verses, voice `echo`, valid `sourceTextHash`). Every spec
asserts every narration response was a **cache hit** — that one assertion is what keeps the
suite from quietly billing an OpenAI call on every run. `tests/e2e/live/` is the only place
generation happens; it moves a clip aside and restores it.

**Every spec in a project shares one identity.** They start from the saved
profile, so they share a mnemonic and therefore one `storage/users/<id>` on the
server: a space made by an earlier spec is still there. Name things uniquely per
spec — a count assertion on a shared name passes alone and fails in a full run.
`run.mjs` resets per-user state once per run, not per spec.

**Bottom sheets are all mounted at once, and all report visible.** Translations,
reading text, playback and the book picker are in the DOM together, so
`getByRole('dialog')` matches four things at any time — address each by its own
title. The picker's title also moves through three states ("Read a chapter" →
"Reading lists" → "Read from your list"), so a locator held across a click goes
stale.

**A screen is not storage.** `libraryStore.updateProgress` updates the store
*before* awaiting the Dexie write — ordinary optimistic UI, and deliberate, so
two writers in the same tick share one synchronous read-modify-write. It means
the screen says a tick was *accepted*, not *stored*: a spec that reads the
screen and then reloads is racing the write and will lose intermittently. Wait
on the durable record instead (`support/persisted.ts`), which proves more than
the screen did. The same caveat applies to a user who ticks a passage and is
killed by the OS within those few milliseconds — accepted, since re-ticking
costs one tap and `completed` is union-merged.

**Two roles that are easy to get wrong here**: the `/cards` strip's `⋮` items
are `role="menuitem"`, not buttons; and a control inside `CardEditor`'s `Field`
inherits the field's `<label>` as its accessible name unless it carries its own
`aria-label` — which is why the board pills and the shared-item row's
Update/Remove each name what they act on. Both were found by a spec
failing to find a control, which is the honest way to find them.

**A long-press drag needs `support/gestures.ts`.** `page.dragTo()` presses,
moves and releases at once, which never satisfies dnd-kit's activation delay —
the drag simply does not start. The helper imports `LONG_PRESS_MS` and
`MOVE_TOLERANCE_PX` from `lib/gestureConstants.ts` rather than restating them,
which is what that module exists for.

**A sharing journey is gated on the wire, not on the screen.** Every write in
this feature rides the sync queue, so the UI reacts long before the server has
judged and stored anything — and a piece that never reached it looks, from the
author's side, exactly like one that did. Two failures cost real time before
`support/community.ts` was written this way: a room whose name field was filled
but never blurred stayed called "New space" for every reader while the owner's
own screen showed what they typed, and a publish that silently never left the
device passed a `toBeVisible` on its own title. Both helpers now wait for the
matching `*.upsert` — `makeRoom`'s predicate additionally checks the **request
body carries the name**, since waiting for "a `spaces.upsert`" is satisfied by
the creation itself.

**The shelves index opens on your own shelves, and a reload puts it back
there.** So a spec that re-enters that screen to wait for something in the other
tab has to ask for it every iteration — `support/community.ts`'s
`showShelvesYouRead`. Subscribing switches the tab by itself, which is why
`askToJoin` mostly works without it; it asks anyway, so the spec does not depend
on that convenience staying.

**Two identities are the expensive part**, so the sharing specs are
`describe.serial` blocks over one `beforeAll` rather than independent tests, and
both installs are minted fresh: the `app` project's saved profile is shared by
every spec in a run, so building an owner out of it means every name in every
sharing spec must stay unique against every other, forever.

**Selectors are production DOM, never test hooks.** There is no `data-testid` in `src/`.
Specs use roles, accessible names (locale pinned to `en-US`), and the `data-*` attributes
production code already reads. Two traps worth knowing: `ReadingAppearanceForm` renders a
static sample verse carrying `verse-inline verse-current` whether or not its sheet is open, so
reader assertions must be scoped to `[data-segment-id]`; and a tab's accessible name carries
its live card count, so match it by pattern. `getByRole('navigation')` is not unique either —
`ReaderFooter` is a `<nav>` too — so specs enter through `support/app.ts`'s `appReady`.

### Definition of done for a new feature

Not "every feature gets three tests" — that produces a suite where the hundredth feature's
tests are a find-and-replace of the ninety-ninth's, nobody reads them, and a red run means
"probably the tests".

**A test is earned by a risk, not by a feature.** Before the tests — ideally before the code —
name the rules the feature introduces, as sentences that can be true or false. If you cannot
write the sentence you do not yet know what the feature does, and that is worth finding out
first. It is the same move this file's "one copy of a rule" table rewards: the rules that ended
up duplicated are the ones nobody named.

Then rank each rule by what a mistake costs, because in this app they are not equal:

| If this rule is wrong | What the user gets | So |
| --- | --- | --- |
| what plays next | **wrong audio**, silently — a blog post followed by Genesis | always integration-tested |
| a cache key, wire format or persisted shape | orphaned audio, dead pinned downloads, a signature that stops verifying — invisible, and it costs money | always a unit snapshot |
| a sync op sequence or count | a share code **lost forever**; a tick erased from another device | always integration |
| progress accounting | told to read something twice, or credited for something unread | integration |
| access control | someone reads writing not meant for them | extend `community:verify:api` |
| an offline path | the app fails exactly where it claims to work | a journey step |
| layout, copy, colour | something looks wrong | usually nothing — it is visible and cheap to fix |

Then subtract what is already proven. Two that are easy to forget: `TOOL_REGISTRY`'s mapped
type makes a missing tool handler a **compile error**, and zustand's shallow merge already
guarantees a new persisted field keeps its initializer's value — which is why such a field
needs no migration, and why a test for it writes `false` over `false`.

Write the outcome down: a few lines in the PR or commit, one per rule, naming its layer or
*"none needed, because…"*. That is what makes the decision reviewable.

**Four rules keep the suite from rotting:**

1. **One fact, one layer — the lowest that can see it.** Write the test, then ask what it made
   redundant, and delete that.
2. **E2E grows by journeys, not by features.** One journey per *capability*; a new feature
   almost always adds a step to an existing one. Ask *which journey did you extend* before
   *which spec did you add*.
3. **A near-copy is a table row.** Twelve `it()` blocks differing by one string is one
   parameterised test wearing a disguise.
4. **Assertions are deleted, not accumulated.** Duplication arrives by addition and nobody's
   fault; removing a now-redundant assertion is part of the work.

Two smells the analysis exists to catch: when the answer is *all three layers*, the feature is
usually one rule plus one journey and the middle test is ceremony. When it is *nowhere*, either
it is presentation — fine, write that line — or a rule has gone unnamed.

### Known gap

The **duplicate-read guard** (`useCommandPipeline`: a repeated `read_verses`, or an identical
`random_passage`, must not play a second passage — see "Random passages" above) has no test.
Its logic is inline in the hook and keyed by two module-private helpers, so covering it needs
one of: exporting `referenceKey`/`drawKey`, adding a React renderer to the integration layer,
or asserting "exactly once" against a live model — which is not deterministic. Left uncovered
deliberately; `tests/int/toolDispatch.test.ts` pins the result shapes either side of it, which
is what made the model retry in the first place.

## One copy of a rule — where the shared things live

This app grew feature by feature, and the recurring failure mode was *two
copies of one rule*: a chapter path and a post path, a card path and a board
path, a store's answer and a hook's answer. Both copies were right the day they
were written and neither survived the next change to the other. Everything
below is a place that used to be two.

Before writing a helper, check whether one of these already exists.

| looking for | it lives in | it used to be |
| --- | --- | --- |
| `clamp` / `clamp01` | `lib/math.ts` | two `clamp`s (`freeformLayout`, `color`) plus eight inline `Math.max(0, Math.min(1, …))` |
| `stripLocal(row)` — drop `dirty`/`deleted`/`shared` | `db/dexie.ts` | three copies, two of which forgot `shared` |
| an icon | `components/common/icons.tsx` | ~40 inline `<svg>`s across 22 files; three `PlayIcon`s, three chevrons, two 700-char gear paths |
| "what does this reader source play?" | `services/reading/readerSequence.ts` | `readerStore.sequenceFor` + `useReaderSequence` |
| "what plays after this?" | `lib/readingContinuation.ts` | `autoPlay` + `readerStore` + `useContinueReading` |
| "which narration path does this item take?" | `services/narration/narrationRequest.ts` | the same three-way test in three functions |
| downloading narration (chapter *or* post) | `services/narration/narrationDownload.ts` | `downloadChapter.ts` + `downloadPost.ts` |
| the lock screen / OS transport buttons | `lib/mediaSession.ts` | ~100 lines inside `audioPlaybackManager` |
| a tool handler | `services/ai/handlers/<domain>.ts` | one 1,380-line `dispatch.ts` |
| a tool's schema | `services/ai/tools/<domain>.ts` — the same five domains as `handlers/` | one 996-line `tools.ts`, whose hand-written `ToolName` union sat 40 lines from the definitions it had to agree with |
| card/board order: persist + queue | `store/libraryOrder.ts` — `commitOrder` / `adoptedOrder` | six writers, four of which mis-counted `pendingOps` |
| resolving a space from a spoken name | `services/community/spaceNameMatch.ts` | 170 lines inside `dispatch.ts` |
| what a book is called, in this language | `services/bible/bookCatalog.ts` — `bookName` | nine `lang === 'de' ? book.nameDe : book.nameEn`, two of them inside that file |
| which locale the UI is in | `i18n/locale.ts` — `localeOf`; `hooks/useLocale.ts` for components | fourteen `(i18n.language \|\| 'en').startsWith('de') ? 'de' : 'en'` across 12 files, plus `settingsStore.detectLocale` asking the same of `navigator.language` |
| "where am I in this list?" | `services/reading/listWindow.ts` | the picker + `readerStore.resumeOf`, disagreeing about a deleted entry |
| "which reading list is this id?" | `services/community/sharedReading.ts` — `resolveListById` | eight `readingLists.find(...)`, two of which produced wrong audio and no ticks for a shared plan |
| the bytes a shared plan or board publishes as | `services/community/sharedPayload.ts` | — (a signed format from the start; see below) |
| the share glyph | `components/common/icons.tsx` — `ShareIcon` | one inline `<svg>` in `ShareSpaceSheet` |
| denying HTTP to a storage directory | `public/api/bootstrap.php` — `denyHttp` + `PRIVATE_DIRS` | five 12-line `.htaccess` blocks |
| the picker's "which list/space am I in" band | `components/chat/picker/pickerRows.tsx` — `LockedSourceRow` | two near-identical copies |
| how a segment loads, and how a gap is walked past | `services/reading/segmentLoader.ts` | half in there, half in `readerStore` |
| "did they actually read that?" | `lib/readerProgress.ts` — the dwell rule | inline in `readerStore`, reaching back into it |
| a community write reaching the queue | `store/communityOps.ts` — `flush` / `queued` | module-private in `communityStore`, where three modules could not reach it |
| sending the reader home when a shelf goes | `lib/spacePlayback.ts` — `releaseReader` | module-private in `SubscriptionMenu`, where the index's own unsubscribe could not reach it |

Two conventions that follow from the same idea:

- **A new field in a persisted store needs no migration.** zustand's default
  `merge` is shallow, so a field absent from persisted state already keeps the
  initializer's value. `settingsStore` had accumulated eleven migration blocks
  that each wrote a default over the same default; only a field whose value must
  differ for an *existing* install earns a block. Add the field to the
  initializer and stop.
- **`const { dirty: _d, ...rest } = row` needs no `void _d;` after it.**
  `no-unused-vars` is configured with `ignoreRestSiblings` and an `^_` pattern
  (`eslint.config.js`), so the underscore means something now. Twelve `void _x;`
  lines existed only to keep the linter quiet.

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

### The reader store owns state, not loading

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
into `any` (see `communityRows` above). The three call sites pass
`get().segments`, which is the same read at the same moment the function used to
do itself. It holds `dwell` — module state the store had no business keeping —
and sits next to the `readingProgressTracker` it reports to: **that** module is
where progress is written, this one decides whether there is anything to write.

`LoadedSegment` and `ReaderError` belong to the loader that returns them; the
store re-exports them, because three components have always asked the store for
the reader's types.

## Cards and boards — one screen, one tab strip

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
in the *route* rather than in `activeBoardId` — see "A shared board is a tab" under
Community spaces, which is also where the rest of the rules are.

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

### Dragging a card onto a board's tab

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

**The UI calls a space a "shelf" (`Regal` in German); the code calls it a
space.** A user makes a shelf, puts things on it and shares it — which says what
the feature is far better than "space" or "room" did. The rename is **i18n
only**, deliberately: `Space`, `spaceId`, `spaces.upsert`, `space.feed`,
`ReaderSource`'s `'space'` kind and the `/spaces` and `/rooms` routes are all
unchanged, and renaming them would be a migration of persisted rows, wire
actions and on-disk paths for the sake of a word. So: when editing copy the noun
is *shelf*, when editing code it is *space*. German also changes gender with the
noun — `der Raum` became `das Regal` — so the articles moved too.

**The model is told both**, since it sits on the seam: the prompts, the tool
descriptions and the handlers' error strings all say *shelf*, and each prompt
block names the code word once — `Regale (im Code "spaces", daher die
Werkzeugnamen)` — so `read_space` and `list_spaces` still read as the obvious
tools for it. The tool *names* and the `space` parameter are wire contract and
did not move.

The functional half of that is `SPACE_FILLER_WORDS` in `spaceNameMatch.ts`:
"Christophs Regal" has to reduce to `['christophs']` the way "Christophs Raum"
always did, or the commonest phrasing resolves to nothing and the model's next
move is to look for a book of the Bible called Christoph. All five words —
shelf, space, room, Regal, Raum — are filler, because older invitations and
older habits still say the old ones. `tests/unit/spaceNameMatch.test.ts` pins
it, and a shelf genuinely *named* "Regal" still matches, a tier earlier.

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
  `services/reading/segmentLoader.ts`, and `loadSegment` itself followed later — see "The
  reader store owns state, not loading" below. That one hardcoded `loadChapterSummaries` call
  was the reason the reader could only ever show Bible chapters. `absorbsGaps()` is the other
  half: versification gaps are normal for scripture and a *step* walks past them, but a
  missing post is a real miss and skipping to the next one would show something the reader
  didn't ask for.
- The reader's sequence resolution lives **once**, in
  `services/reading/readerSequence.ts`: `readerSequenceFrom(source, translation, deps)`
  is pure and `readerSequence(source, translation)` reads the stores. A new kind
  of source is one new branch there, and `readerStore` and `useReaderSequence`
  both get it. (These were two copies with a comment on each saying they must
  not diverge.)

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

**Provenance is only as good as the host that emits it**, and that is where this went wrong
first: `readerReadingHost.toGroup` derived provenance from `ref.listId && ref.entryId` alone,
so every post group reached `nextReadingAfter` carrying nothing. The defensive guard then did
its job — no Genesis after a blog post — and a space stopped dead after its first piece with
auto-continuation on and the pager still showing another piece after it. `provenanceOf(ref)`
now answers for both kinds, **post first**, since a post ref has no list ids to fall back on.
Nothing else needed changing: `nextInSpace`, `appendReading`'s space branch and
`noteEntryStarted`'s `markSeen` were all in place and simply never called. Anything that
teaches the reader a new kind of segment has to extend that one function too.

### Audio, and why the server needs no new storage

`?action=tts.speak` already content-addresses generated speech and its forced alignment under
`storage/audio/speak/{voice}/<sha256 of the text>`, in a directory **shared by every user** —
the same arrangement as verse audio. So the first person to hear a paragraph pays for it and
everyone after gets a cache hit, and an author who taps "prepare audio" at publish time is
warming it for their subscribers. That is the whole of "cache post audio on the server": no
upload step, no per-user audio.

`services/narration/narrationRequest.ts` is the single answer to *which* narration path an
item takes, because playback (`startPlayback.buildTrack`), the offline download
(`narrationDownload`) and the offline-coverage check (`planFullyCached`) must
all agree — a key computed one way in one place means a downloaded chapter is silently
re-fetched, or a post's audio is filed under a scripture reference that does not exist.
**`narrationRequestFor()` is the one place the classification happens**; the key, the fetch
and the offline check are each a two-way `switch` on its result, so they cannot drift (they
used to be three copies of the same test, each rebuilding the request by hand). Three
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

**You cannot subscribe to yourself**, and it is refused in both places for the usual reason:
`communityStore.subscribe` refuses before the network so it can *explain*, and `space.request`
refuses (409 `own_space`) because a modified client would otherwise skip the first. Allowed, it
wrote a membership request from the owner into the owner's own file — an invitation from
yourself, waiting in your own inbox — and then listed the space twice everywhere a space is
listed: the picker, `/spaces`, and `resolveSpaceByName`, where two identical names are also an
ambiguity error. `isOwnCode` tests the stored `shareCode` *and* the code's fingerprint, because
the fingerprint commits to the signing key and so catches every code that was ever theirs — one
since rotated away, one minted on another device.

Installs that already have one are healed rather than filtered: `init` tombstones a
self-subscription the same way it drops a blocked author's, so the delete syncs and the row
cannot reappear on the next device. `withoutSelf` does the matching job for the *request inbox*,
where such an install has a pending request from itself that nobody can sensibly decide.

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

`api.php` gained two rules and nineteen actions. **A share code is the only way to name a
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

**Two presentations, one definition.** `hooks/useNewPieceSelections.ts` owns what
the two selections *are* (the pieces, the name the reading carries, and opening
it); `NewPiecesBar` renders them as pills on `/spaces`, and the picker's spaces
view renders them as the **first two rows of the list**, above a rule and then
the spaces. Rows rather than pills there because that is what they are on that
screen: things you pick, exactly like a space — the pills read as a toolbar
above the list you were choosing from. Splitting the hook out is what keeps the
two from drifting into disagreeing about what "today" means.

**"Everything new" is shown wherever the community is on at all** — *in the
picker*. `NewPiecesBar`, the pill version on `/spaces`, still returns `null`
without subscriptions, so the two disagree; the reasoning below argues for
ungating both. Gated on `hasSubscriptions` it was simply *absent*
for anyone whose install is their own writing — which is every author before
they follow their first person, and they then have no way to learn the feature
exists. The row says why it is empty instead (`community.newNeedsSubscriptions`
when you follow nobody, `community.nothingNew` when you have read it all), and
it is disabled either way. "Today" is the exception and still hides: it needs an
ephemeral space to draw from, and there is nothing to explain about not having
one.

Both still **cover subscribed spaces only**, which is the reason those empty
states exist rather than the rows quietly filling with your own pieces:
publishing does not mark a piece seen, so an author's own writing would sit in
"everything new" as unread until they read it back. Asked directly, the
maintainer confirmed keeping it that way.

`SourceRow` carries its background and hover on the *wrapper* rather than on the
button, so a row can hold a control of its own beside the tap target — which is
how those two rows carry a group download without nesting a button in a button.

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

### Invite links

An invitation is still just a share code; a link is a way of delivering one.
Both shapes land on `/subscribe/<code>` (`routes/SubscribePage.tsx`), and
`lib/spaceInvite.ts` builds them.

**The route is the pending state.** A link can arrive before the app can act on
it — onboarding unfinished, no profile (one is required to subscribe), offline —
and none of that needs a stash, because the code sits in the URL: `AppShell`
renders the wizard *over* this route and the route is still matched when
onboarding finishes, and someone sent to Settings to make a profile returns to
the same link.

That last part is only true because the wizard's `onDone` **leaves the subscribe
route alone**. It resets to chat otherwise — a first run belongs there, not on
whatever stale URL was restored — and doing that unconditionally is what quietly
ate every invitation that arrived before onboarding was finished, `replace`
taking it out of history too so there was nothing to go back to. The link is
usually the reason that person installed the app at all.

**On mobile web the hand-off comes before the wizard**, not after. Web and
native are separate installs with separate identities, so onboarding someone
*before* they have said which one they want is setting up the wrong copy of the
app — and the common case is that the app is already installed and the link only
opened the browser on the way. So `AppShell` renders the invite route bare
(no nav, no dock — there is nothing to navigate to yet, and the app behind it is
not set up) whenever `needsAppHandOff()` and the user has not yet chosen to
stay. Choosing "continue in the browser" puts `?web=1` on the route, and from
there it is an ordinary first run that ends on the invitation.

That choice lives **in the URL**, for the same reason the code does: the route
is the pending state, so it survives the wizard, a reload, and the wizard's own
navigation without anyone having to remember it. `needsAppHandOff()` and
`stayingOnWeb()` are in `lib/spaceInvite.ts` rather than in the page because
`AppShell` has to reach the same answer — the two deciding differently is a
wizard that covers the hand-off, or a hand-off that never yields to it.

Desktop web and native both skip all of this: there is no app to hand off to,
and in the app you are already where the link was going. Both get the wizard
first and the invitation after.

**The invitation makes the profile itself.** A profile is genuinely required —
`space.request` refuses without one — but sending someone to Settings to build
one and find their own way back is a second setup wall in front of a person who
has just finished the first. So the no-profile branch of `SubscribePage` is a
name field plus the standards consent, and one button accepts, creates and asks
in that order (terms first, because `enableCommunity` refuses without them).
`joining` keeps that screen up for the whole compound action, so the confirm
sheet doesn't flash past on its way to "asked".

The wizard's community step therefore **opens ready to type when an invitation
is pending** (`location.pathname` is the subscribe route) rather than behind its
"set up" button, so most people never reach the branch above. It stays
skippable: that branch is the safety net, and it also catches the long-onboarded
user who never made a profile.

One layout note, since it bit immediately: `Sheet` centres with `m-auto`, not
`items-center`. Flex centring pushes overflow out of *both* ends of a scroll
box, so with the standards inside it the top of the sheet — title included —
became unreachable. Auto margins collapse to 0 when free space runs out, which
centres while it fits and scrolls when it doesn't.

**`space.peek` exists because `space.request` writes.** A "subscribe to X?"
confirmation built on `request` would be showing X only after having already
asked on the user's behalf, so peek is a read-only lookup — the one community
action that writes nothing, not in `$ACCOUNT_ACTIONS`, and it deliberately does
*not* require the caller to have a profile, since its whole job is to show the
invitation before anything is committed. `verifyBackend` asserts it creates no
membership.

**Mobile web gets an interstitial**, because a plain https link cannot hand over
to an installed app until App Links / Universal Links are configured. Three
things about it are deliberate:

- it is a **button, not a redirect** — whether the app is installed cannot be
  detected, and firing the scheme when it is not does nothing on iOS and can
  error on Android. A tap that quietly does nothing is survivable; an automatic
  error page for everyone without the app is not;
- **"Copy code" is not a nicety.** In-app browsers (WhatsApp, Instagram) often
  block scheme navigation, and that is exactly the channel these links travel;
- **it never subscribes.** Web and native are separate installs with separate
  identities, so a membership created there would belong to the *browser* — the
  app would still have no access and the author would see a request from someone
  who can never read. Whichever client the user lands in does the asking.

**The scheme is reverse-DNS** (`de.schaefchens.apps.bibleassistant`), matching
`appId`, because custom schemes are reserved nowhere: any app may claim
`bibleassistant://`, and two installed apps declaring the same one leaves iOS to
pick *undefinedly* while Android shows a chooser. It is a stopgap — App Links
and Universal Links are keyed to a domain whose ownership is proven, and once
either is configured the https link opens the app directly and the interstitial
stops being reached on that platform. Android needs
`.well-known/assetlinks.json` with the **Play App Signing** SHA-256 (the upload
key's is the wrong one) plus `autoVerify`, and both would need adding to
`scripts/deploy.sh`'s allow-list.

**The share sheet sends the https link alone.** It used to send the space's name
and the bare code on two further lines, so that a mangled link could still be
recovered by pasting the code — but a multi-line message is not a link: the OS
sheet offers it as *text* rather than as a URL, and the targets that do linkify
it pick the wrong span out of the three lines. The code is still shown beside
its own copy button in the space, for passing along by hand.

Input stays tolerant at that one boundary regardless: `parseSpaceCodeInput` takes
a bare code, either link, or a whole message with one embedded — being liberal
about what arrives costs nothing and older invitations are still out there.
`normalizeSpaceCode` and api.php's `normalizeShareCode` stay strict.

### Where the opt-in is offered

Three places, all progressive disclosure: the shelves screen itself, the Settings tile
(`components/settings/CommunitySection.tsx`) and a wizard step
(`components/onboarding/steps/CommunityStep.tsx`).

The form is **one component**, `components/community/CreateProfileForm.tsx` — a name, the
standards, one button — and the first two render it unchanged. `SubscribePage` keeps a
version of its own on purpose: its button accepts, creates *and* asks to read a shelf in
one press, and its copy is about the invitation the user is holding.

`/spaces` is now a **nav tab** (it took the slot Boards vacated), so the feature has a
way in that isn't Settings or a step of the wizard. It shows whether or not a profile
exists: without one the index renders **the opt-in form itself**, and a tab that says so
is the point — hiding it would keep the feature invisible to exactly the people who
haven't found it. It used to be a button to Settings, which dropped someone who had
already decided onto a screen of collapsed panes with nothing saying which one to open;
`support/community.ts`'s `makeProfile` now takes the inline path, so every sharing spec
walks it. The index therefore lost its back button (a tab root has
no parent); `/spaces/:id` keeps its own, whose fallback is that index. No badge on the
tab: `useCommunityRefresh` is deliberately not global, so a count there would be
either stale or bought with app-wide polling.

The step comes **after** `sync` and is last, because it *implies* sync —
`enableCommunity` turns it on, so asking first would enable something the next
screen had not offered yet. Skipping is a first-class outcome: the footer says
"Done" and nothing is created. The "this also turns on server sync" line shows
only while sync is still off, so it does not describe something the previous
step already did.

Adding a step means `OnboardingWizard`'s `steps` array and the progress dots grow
by one; the `Step` union is the only other place to touch.

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

### Moderation — the four things a shared-writing feature owes its users

Sharing other people's writing brings Apple guideline 1.2 and the Play UGC
policy into scope, and both ask for the same four things. All four exist now.

**1. Accepted content standards, before anything is published.**
`settings.communityTermsVersion` records which version the user accepted; 0 is
never. The text lives under `community.terms.*` in the locales and is rendered
by one component (`CommunityTerms`) everywhere it appears, because a rule worded
differently in one place is a rule nobody can be held to.
`lib/communityTerms.ts` owns the version and the two ways to ask about it.

Nothing backfills the acceptance, deliberately: an install that switched the
community on before the standards existed has not agreed to them. So
`SpacesPage` renders `CommunityTermsGate` **instead of** every community screen
while a profile exists without an acceptance — the gate sits above the space
editor and the post editor too, which is why it is placed before those branches
rather than inside the index. `SubscribePage` shows the same gate, so an
invitation survives the detour (its code is in the URL). Accepting is one tap;
leaving is offered beside it, because a gate with one exit is a demand.

`enableCommunity` and `subscribe` refuse without it as well, the way the
`syncEnabled` chokepoints do: a new caller cannot switch the feature on by
forgetting to ask.

**2. Blocking an author** (`communityStore.blockAuthor`) is keyed by the
author's **signing key**, not by space or share code. That key is derived from
their mnemonic, so it is the same in every space they own — which is what lets
one tap take *all* of them out, and a share code could never do. It needs no
server support, and that is not a shortcut: nobody can push anything at a reader
here (a subscriber *pulls* `space.feed`), so removing the subscriptions and
refusing to add them back is a complete block from the reading side. `subscribe`
matches the block list against the code's own fingerprint *before* asking, so a
blocked author never even gets a membership row appended in their file. The
author is not told.

The list is a local `preferences` row. The subscription deletes sync, so the
spaces disappear from the user's other devices; "don't let them back in" is
remembered per device. Syncing it would want a server action and a merge rule
for a list whose whole purpose is to be enforced offline.

**3. Reporting** (`ReportDialog` → `report.create`) is offered on the piece, in
the reader, and on the space, in the subscription row's menu. On the piece
because that is where the offending text is — under endless scroll a header
control could only ever mean "the one I guess you mean". The reasons are the
content standards restated as choices: a report form whose options don't line up
with the rules produces reports a moderator cannot act on.

Server-side it is the third action that crosses accounts and the only one
addressed to neither party — `storage/reports/` is HTTP-denied, so the author can
neither see that they were reported nor delete what was said. Three things about
it are deliberate: **the reported text is snapshotted** (deleting the piece is
the obvious first move after being reported), **one file per (reporter, target)**
so re-reporting overwrites instead of piling up, and **a profile is required**,
since you cannot see somebody else's writing without one.

**4. Automated moderation, before a piece is ever published.**
`MODERATION_POLICY` in api.php is the server's copy of the standards — a *mirror
of `community.terms.*`*, so changing the rules means changing both and bumping
`COMMUNITY_TERMS_VERSION`. `moderationJudge()` asks for a JSON verdict on
`MODERATION_MODEL` (`gpt-4o`, not the chat's `gpt-4o-mini`): the chat's job is
corrected by the user in the next breath, the moderator's job is to refuse
somebody's writing, and a wrong call there is either published abuse or a
silenced author.

Five things hold it up:

- **The policy explicitly protects Scripture.** The Bible contains war, sex and
  politics; a judge told only "no violence, no sexual content, nothing
  political" refuses Judges, the Song of Songs and half the prophets. The
  carve-out in the middle of the policy is what makes the feature usable at all.
- **It runs server-side, in the write path.** A check the client performs is a
  check a modified client skips. The client asks the same question first
  (`moderation.check`) *only* so the refusal can be shown at the publish tap:
  publishing rides the sync queue, where a 422 would otherwise surface as a
  piece that silently never shared. The flush path handles that case anyway, by
  dropping the `shared` claim along with the op.
- **It fails open.** No key, no network or an unparseable answer publishes the
  piece and records the verdict as *unchecked* rather than caching it as
  approved. Refusing every publish while OpenAI is unreachable turns an outage
  into a total outage; reporting and a human moderator stand behind this.
- **Verdicts are cached by content** under `storage/moderation/`, like generated
  speech, because the same text is judged up to three times (the ask, the write,
  a later re-share). `temperature: 0` for the same reason: an author who fixes a
  typo must not get a different answer.
- **It always uses the shared key**, never the caller's own. Billing an author
  for the judging of their own post is odd, and a user who removed their key
  would otherwise have switched moderation off.

Reports get that same judge as a **triage, not a filter**: a plausible report is
filed in `storage/reports/` for a human, an implausible one in
`storage/reports/unfounded/`, and **the reporter is told the same thing either
way**. Telling someone a model dismissed their report teaches them to stop
reporting, and teaches an abuser what passes. Nothing is deleted, because the
judge is wrong sometimes.

`MODERATION_STUB` in `secrets.php` short-circuits the judge with a fixed
verdict. That is the seam `verifyBackend.mjs` drives — the refusal half cannot be
tested against a live model — and it doubles as a kill switch. A stubbed verdict
deliberately bypasses the cache in both directions, so flipping it changes the
answer.

### Asking the assistant for a space

`list_spaces`, `write_post`, `read_space` and `read_new` are the space half of the tool
contract; `read_space` and `read_new` are in `READ_TOOL_NAMES`, so like `read_verses` the
reading *is* the reply. Both open the **reader**, not the chat — chat has no representation
for a post (`ChatMessage` carries a list provenance but not a space's).

**Opening it takes two halves, because a tool cannot navigate.** `playSpaceInReader` sets the
reader's source and position and starts the audio, but routing belongs to a component —
`lib/` and `services/` have no router — so the handler reports
`ToolDispatchResult.opensReader` and `useCommandPipeline` (a hook) does the `navigate`. With
only the first half, which is how this shipped at first, the reading was correctly *prepared*
and the user was left on the chat screen watching the previous turn's verse panel while a post
played. The flag is not inferable from the tool name: `read_verses` also reads, into chat.
`play_reading_list` deliberately reads into chat too, so it sets nothing.

**A space is named after its author far more often than after itself.** "Read Christoph's
Today" is the ordinary phrasing, and matching `space.name` alone answered *nothing* to it —
half the people you follow have a space called Today, and none of them is called "Christoph's
Today". The model's next move was to look for a book of the Bible called Christoph, which is
the failure the user actually sees. So `resolveSpaceByName`
(`services/community/spaceNameMatch.ts`, beside `spaceName.ts` which answers the other half
— what a space is *called*) matches over **aliases**: the
localized name, the stored name (a Today space is stored as the literal `'Today'` and shown
as "Heute", so both are needed), the author alone, and author-plus-name. Three tiers — exact
alias, alias containing the phrase, then every content word appearing in the author-plus-name
text — with the possessive folded away in both languages (`'s` by the normalizer, the German
trailing `s` by `looselyEqual`) and filler words dropped from the last tier only, so a space
genuinely called "The Room" still matches exactly one tier earlier.

Ambiguity stays an error rather than a guess — reading the wrong person's writing aloud is
worse than asking — but the error now *names the candidates* (and "no match" names every
space there is), because the model's next turn is only as good as what the failure told it.
"my Today" is not ambiguous, though: an ownership word narrows to the user's own.

Both system prompts carry the same rule in as many words, including that a name which fails
to resolve is **never** a Bible reference. Prompt and matcher are two halves of one fix: the
matcher makes the natural phrasing work, the prompt stops the fallback that made it look like
scripture.

### Passing a space on — readers share too

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
`/subscribe/<code>` link. That follows from the code being **an address, not a key** (above) —
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

### A room holds plans and boards too, not only pieces

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

#### The header/payload split

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

#### The payload is a format

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

#### `ba.item.v1`

Same discipline as `canonicalPostMessage`, with two differences worth knowing:
**`kind` is in the message** (unhashed, a two-value enum) so a plan's signature
cannot be lifted onto a board, and the payload is committed to **by hash**
rather than carried. Mirrored in `verifyItemSignature` in `public/api/community.php`.

#### A shared plan is read as a plan, not as a special case

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

#### A shared board is a tab, and the route is what makes it one

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

#### The subscriber's room screen

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

#### A link to one precise thing

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

#### Moderation covers it, and the standards did not change

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

### A shelf's own screen: three tabs and two sheets

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

### The index is two tabs, not two sections

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

### Where the share code is asked for

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

### Known limitations

- A voice command on `/read` still produces a *chat* reading, as it does for the Bible.
- Updates between two people are polled, not pushed, so an accept or a new request can take up
  to 15 s to appear (immediately on returning to the app). A hidden tab does not poll at all.
- Per-post completion is not tracked; unread is a local dot (`seenPosts`), not a synced tick, so
  what you have seen does not travel between your devices. Doing it properly wants
  `readingProgress`'s union-merge machinery, which is keyed by `listId`.
- **App Links / Universal Links: deliberately deferred.** The interstitial covers the gap, so
  this is polish, not a gap in the feature. When it is worth doing, in order: Android needs
  `.well-known/assetlinks.json` carrying the SHA-256 of the **App signing key** from Play
  Console → Test and release → Setup → App signing (*not* the upload key's — you sign with the
  upload key and Google re-signs, so devices only see the app signing key, and using the wrong
  one fails silently); include the local release key's fingerprint too or a sideloaded
  `android:apk` build will not verify; add a second intent-filter with `autoVerify` for the
  https host; and add `.well-known/` to `scripts/deploy.sh`'s allow-list or the file never
  ships. iOS then wants `.well-known/apple-app-site-association` plus the Associated Domains
  entitlement and the Team ID. Once either is live, the https link opens the app directly and
  the interstitial stops being reached on that platform.
- No QR code yet. Sharing a code or a link covers it; scanning would need a camera plugin plus
  iOS/Android permissions.
- **"my shelf", said with nothing else, does not resolve** — nor did "mein Raum" before the
  rename, so this is a pre-existing gap rather than one the new noun opened. An ownership word
  plus the generic noun leaves `spaceContentWords` with no tokens at all, and its fallback then
  matches them literally, which can only fail. The fix is to treat "no tokens left, and they
  said *my*" as "their own, if there is exactly one" — which means separating that case from
  the fallback rather than reusing it.
- **A shared plan or board is a snapshot with a manual republish** (see above). Deliberate, but
  it does mean an author who fixes a typo has to press Update, and nothing nags them to.
- Taking a shared item off a shelf on one device leaves the row marked `shared` on another
  until the removal syncs — the same wart posts already have, and for the same reason: absent
  from the server cannot mean deleted, or a failed `items.list` would destroy the author's shelf.
- Progress on a shared plan survives unsubscribing, since the row is keyed by list id and
  nothing deletes it. Accepted: resubscribing restores your place.
- A shared board's tab is **not** remembered across a reload the way an own board's is: the
  selection is in the route, so reloading `/cards` lands on whichever own board was last
  active. Deliberate — that is the same property that keeps the id out of `activeBoardId` —
  and the route itself is shareable, so the link is the way back.
- Moderation now covers the four things Apple guideline 1.2 and the Play UGC policy ask for
  (see "Moderation" above), with two gaps left on purpose: a **reader's block does not remove
  that person as a subscriber of the user's own spaces** — `Membership` is keyed by uuid and
  carries no author key, so the two identities cannot be matched without changing
  `space.request` — and the block list itself does not sync between the user's own devices.
  The owner's accept / deny / block of a subscriber is unchanged and unrelated.

## In-app feedback — the bug button

A round beetle tucked into the right edge of every screen; tapping it opens one
modal that sends a bug report, a feature request, or a plain remark to the
maintainer. `src/components/feedback/*`, `src/lib/feedbackContext.ts`,
`src/services/api/feedback.ts`, and `feedback.create` in api.php.

**Where it sits is the whole design**, and it is the one thing to re-check before
moving it:

- all four *floating* positions of the mic dock are corners, and its snap targets
  and drag ghost live there too — so no corner is free of whichever one the user
  picked;
- vertically centred, it clears every page header and every page's own bottom bar
  (the chat composer, the reader's pager) without knowing which page is mounted
  and without reading `bottomBarHeight`;
- the **right** edge, not the left, because on mobile web the left edge is the
  browser's back-swipe region, and a control you have to press should not be
  fighting a navigation gesture for the same pixels;
- **hung 12px off the edge**, because the reader's text column runs to 16px from
  the viewport edge at every width. Fully on-screen there, a 40px circle covers
  the last 30px of two lines of scripture — measured, not guessed. Tucked, that
  halves to 16px while a 32px-wide lens of a 44px-tall circle stays visible,
  which is still a comfortable target. Narrower buys a few pixels of text and
  costs the tap;
- `z-30`, so it sits under every sheet, modal and the dock itself (z-40 / z-50)
  and can never cover a decision in progress — including its own dialog.

`settings.feedbackEnabled` hides it, **defaulting to on for every install,
existing ones included**: this is how the app asks for the feedback it needs
while it is being tested, and an off-by-default report channel gathers nothing.
There is no migration and the persist version is unchanged — zustand's default
merge is shallow, so a field absent from persisted state keeps the initializer's
value, and a migration would have written `true` over `true`.

**The kind is asked first and it changes the prompt**, because "what's on your
mind?" and "what went wrong, and what did you expect?" collect very different
text. One box either way: a bug form with a title, steps and an expected-result
field collects nothing at all from a tester on a phone.

**The diagnostics are collected, not asked** (`collectFeedbackContext`): route,
build commit, build time, platform, locale, viewport and online state. Every one
is a question the maintainer would otherwise have to ask back, and there is no
reply channel in the app — so a report needing a follow-up is a report that dies.
Two consequences: the dialog *shows* the lot before sending, since it is a device
fingerprint; and the **user agent is taken from the request, not the body**, where
it cannot be wrong.

### Why it is outside sync, and outside the account

`settings.syncEnabled` gates *the user's library* at three chokepoints, and
`$ACCOUNT_ACTIONS` is what brings a server directory into existence. `feedback.create`
is in neither, deliberately: the whole point of a bug button is that it works for
the tester whose app is broken and for the one who never opted into sync. Nothing
it writes goes under `storage/users/` — `verifyBackend.mjs` asserts exactly that,
because it is the kind of property a later refactor breaks silently.

It needs no profile either, unlike `report.create` and `space.request`: those are
about somebody else's writing, and this is about the app.

Nothing is queued when a send fails. The text stays in the textarea and retrying
is the whole recovery, which is both honest and what `ReportDialog` does — a
queued feedback op would be an op with no entity behind it.

### The server side

`storage/feedback/{userId}/` — HTTP-denied like `users/`, `shares/`, `reports/`
and `moderation/`, since it holds user-authored text plus a device fingerprint.
Three rules, all in `handleFeedbackCreate`:

- **the context is whitelisted, not stored as sent** — every field lands in front
  of a human, and a client may put anything in the body;
- **one file per (identity, kind, message)**, keyed by hash, so re-tapping send
  after a request that actually succeeded overwrites instead of piling up. Order
  lives in `reportedAt` inside the file, not in the filename;
- **a per-identity cap** (`MAX_FEEDBACK_PER_USER`), counted from that user's own
  directory — which is the reason for the per-identity sub-directory. There is no
  rate limiting anywhere in api.php, and this is the one write a stranger can
  reach with nothing set up at all. The cap bounds *new* files only, so a
  correction to something already sent still gets through.

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

## Backend — `public/api.php` + `public/api/*.php`
One PHP front door; routes on `?action=`. Per-user data dirs keyed by an identity derived from the user's passphrase. OpenAI actions (`chat`, `tts`, `tts.speak`, `transcribe`, `recording.upload`) require a key — a personal key (sent by the client) or the shared key, selected via the `X-Prefer-Shared-Key` header.

**Accounts are lazy.** `authenticate()` validates the identity headers and creates
nothing; `requireUserDir()` creates `storage/users/{id}` and is called from the router
only for `$ACCOUNT_ACTIONS` (the cards/boards writers, `auth.openaiKey.set`,
`recording.upload`). Everything else works with no directory at all — the readers guard
with `file_exists`/`is_readable` and answer empty. This is what makes the client's sync
opt-in truthful: a user who only reads scripture and asks the assistant questions leaves
nothing on the server. Don't move an action into `$ACCOUNT_ACTIONS` without meaning it,
and don't reintroduce an eager `mkdir` in `authenticate()`.

**Fourteen files, loaded by `api.php` before anything is dispatched.** It was one
2,786-line file, which meant a change to moderation had to be read alongside the
Zefania parser and the curl helpers. `api.php` is now the header, the requires and
the router — and **the router's `switch` is the endpoint list**, complete by
construction, which is why the docblock no longer carries a hand-written copy (by
2,786 lines that copy was missing the nineteen community actions, `tts.speak`,
`bible.chapter`, the OpenAI-key trio and `moderation.check`).

| file | owns |
| --- | --- |
| `api/bootstrap.php` | what exists on disk, and what Apache may serve. Side effects only |
| `api/http.php` | `respond`/`fail`, input narrowing (`safe*`), identity, CORS |
| `api/store.php` | the JSON files under `storage/`, and the generic collection endpoints |
| `api/openai.php` | which key pays, the four curl shapes, how a failure is reported |
| `api/chat.php` | the assistant proxy |
| `api/audio.php` | `tts`, `tts.speak`, forced alignment, `transcribe` |
| `api/bible.php` | Zefania XML → verses |
| `api/account.php` | the caller's own key, `account.delete`, `recording.upload`, `ambient.list` |
| `api/community.php` | what a space is on disk: paths, sanitizers, share codes, signatures, the moderation text pulled out of a payload |
| `api/spaces.php` | the owner's own community endpoints |
| `api/sharing.php` | the four endpoints that cross accounts |
| `api/moderation.php` | the content standards (`MODERATION_POLICY`) and the judge |
| `api/reports.php` | `report.create` |
| `api/feedback.php` | `feedback.create` |

Three things about that split are load-bearing:

- **Never write `__DIR__` in `api/`.** It means `api/`, not the web root, and three
  paths resolve against the root: `secrets.php`, `STORAGE_DIR` and the Zefania XML.
  Splitting the file repointed all three silently — the visible symptom was every
  moderation check answering "unchecked, fails open" because the key could no
  longer be found. `APP_ROOT`, defined in `api.php`, is the anchor.
- **`api.php` and `api/` deploy together**, or the backend 500s on every request.
  `scripts/deploy.sh`'s allow-list names both, and so do `tests/e2e/run.mjs`'s
  staleness check and `verifyBackend.mjs`'s temp docroot. A fourth harness that
  stages the backend has to name both too.
- **The native build needs no rule for this.** `publicDir` is off there and
  `assertNoServerFiles` already refuses any `.php` at any depth, so `api/` stays
  out of the `.ipa`/`.apk` for free — and would fail the build if it leaked in.
- **Every file in `api/` opens with `if (!defined('APP_ROOT'))` and a 404.** They
  are includes, not endpoints, and the router is the only way in. Without the
  guard, `GET /api/bootstrap.php` died on the undefined constant and printed the
  server's filesystem path — that file never reaches `api.php`'s
  `ini_set('display_errors', '0')`. `public/api/.htaccess` denies the directory too,
  but the guard is what holds on a host without `mod_authz_core` and under PHP's
  CLI server, which ignores `.htaccess` and is what both `community:verify:api`
  and the E2E suite run on. Both are asserted there ("a handler fetched directly
  says nothing at all").
- **Never write `<Directory>` in a `.htaccess`.** It is valid only in server
  config, and Apache answers **every request on the whole site** with 500 if it
  appears — `/` included, not just the path it names. The deny therefore lives
  in `public/api/.htaccess`, per-directory, where `Require all denied` is legal.
  This is the one class of bug no harness here can catch: `php -S` ignores
  `.htaccess` entirely, so the tests, `community:verify:api` and all 51 E2E
  specs stayed green on a config that would have taken production down. Checked
  against a real Apache 2.4 before deploying; `apachectl -t` alone does **not**
  catch it either, since it reports "Syntax OK" and only fails at request time.
- **`scripts/deploy.sh` uploads `api/` before `api.php`.** The order is
  load-bearing: until `api.php` is replaced the old self-contained one is still
  serving, and the new handlers sit unused beside it. The other way round leaves
  every request 500ing for the rest of the transfer — and permanently, if the
  transfer then fails.

Actions: `chat`, `tts`, `tts.speak`, `bible.chapter`, `transcribe`, `auth.openaiKey.{status,set,clear}`, `cards.{list,upsert,delete,order.get,order.set}`, `boards.{list,upsert,delete,order.get,order.set}`, `readingLists.{list,upsert,delete}`, `readingProgress.{list,set}`, `recording.upload`, `account.delete`, `ambient.list`, and the community actions:
`profile.{get,set,delete}`, `profile.avatar.upload`, `spaces.{list,upsert,delete}`,
`spaces.code.set`, `posts.{list,upsert,delete}`, `items.{list,upsert,delete}`,
`members.{list,decide}`,
`subscriptions.{list,upsert,delete}`, `moderation.check`, and the three that cross
accounts — `space.request`, `space.feed`, `space.item` and `report.create` (see
"Community spaces").
Plus `feedback.create` (see "In-app feedback").

`feedback.create` is the odd one out: it is neither a community action nor an account
action, and it requires no profile — see "In-app feedback" above.

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

### The feed loop, and why the track player is injectable

`audioPlaybackManager` is the file where a mistake is silence or the wrong
audio, and it had no coverage at all — because it could not have any. The class
built its own `ElementTrackPlayer`, and jsdom has no media stack to drive.

`AudioPlaybackManager`'s constructor now takes a `(label) => TrackPlayer`
factory, defaulting to the real thing. `TrackPlayer` is `Pick`ed from
`ElementTrackPlayer` rather than written out, so it cannot drift: a member the
class loses breaks every fake that claimed it. A parameter with a default and
not a parameter property — `erasableSyntaxOnly` forbids
`constructor(private x: T)` here.

**This is a test seam, not a swappable strategy.** A media element is not an
implementation detail: the measurement above is why verses run on one, and no
other implementation is coming.

What that bought is `tests/int/audioPlayback.test.ts`, covering the three
fields that decide whether a streamed reading continues, waits, or hands off —
`feeding`, `awaitingFeed`, `feedGen`:

- a second `beginFeed` supersedes the first, and a stale generation's appended
  tracks are dropped — otherwise an interrupting reading gets the old one's
  verses;
- draining mid-stream **parks** (`awaitingFeed`, status `loading`, `current`
  kept so no thinking drone fires) rather than soft-ending, because a soft-end
  there hands a half-read chapter to auto-continuation;
- it soft-ends when the stream *closes* with nothing left, which is when the
  hand-off is right;
- and ducking puts back only what it took: a reading it paused resumes, one the
  user paused stays paused, and nothing starts that was not playing.

**What was deliberately not done: the class was not split.** The plan called
for extracting its three state machines, and that does not survive contact.
`appendTracks` calls `playQueue`/`playCurrent` — the core of the class — so
moving the feed loop out means designing an interface back into the queue,
which is a redesign rather than a move. Ducking is entangled with the gain
nodes, both players and the store. The alignment cache is seven lines. The
value here was the seam and the coverage; a file split would have been motion.

### Speech input
Native builds prefer on-device recognition (`nativeSpeech.ts`, `@capgo/capacitor-speech-recognition`).
The Web Speech API does not exist in either WebView, so the web build is Whisper-only, and
Whisper (`?action=transcribe`) remains the fallback everywhere.

The iOS workaround layer — `iosAudioRouting.ts`'s silent-WAV nudge, the AEC/AGC-disabling
`micConstraints()`, `DUCK_FACTOR = 0` — is now **only on the Whisper/push-to-talk path**, which
still uses `getUserMedia` and so still hijacks the audio session. It can't be deleted while that
fallback exists.
