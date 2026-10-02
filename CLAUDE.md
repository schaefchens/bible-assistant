# Bible Assistant — Architecture Map

Mobile-first app for voice-controlled Bible reading: speak (or type) a reference, hear it read aloud. React 19 + Vite + TypeScript + Tailwind v3 + Zustand; a PHP backend (`public/api.php` routing over `public/api/*.php`) proxies OpenAI (chat / TTS / Whisper) and serves Bible text from local Zefania XML.

**Three build targets from one codebase**: the web PWA (`npm run build` → `dist/`, deployed to
https://bibleassistant.apps.schaefchens.de) and native iOS + Android via Capacitor 8
(`npm run build:native` → `dist-native/`, then `cap sync`). Several things differ per target —
see "Native builds" below; getting them wrong is the usual source of breakage.

This file is the orientation map: where things live, and the rules that break things when
ignored. **The reasoning behind each subsystem lives in `docs/architecture/`** (indexed at the
end). Read the relevant file before changing a subsystem, and update it when a design decision
changes — that is where new rationale goes, not here.

## Commands
- `npm run dev` — Vite dev server. The maintainer usually has it up on `localhost:5173` already; probe before starting.
- `npm run build` — `tsc -b && vite build`. **The primary correctness gate** — keep it green.
- `npm test` — `test:unit` (pure functions, node), `test:component` (a React render, jsdom), `test:int` (stores + Dexie + queue, jsdom). Seconds; run it like you run `tsc`.
- `npm run lint` — ESLint, **zero errors** (the one standing warning is an `exhaustive-deps` in `CardStack.tsx`). Two rules bite: `set-state-in-effect` is an error, so adjust state during render behind a guard, as `AppShell`, `MicDock` and `EyesFreeMode`'s ticker do; `react-refresh/only-export-components` is an error, so a `.tsx` exports components **only** and a shared helper goes in a `.ts`.
- `npm run verify` — the whole gate: `tsc -b`, lint, the four `*:verify` scripts, `npm test`. Run before a release. It **exits 0** — keep it that way, or nobody can tell a new failure from a standing one.
- `npm run e2e` — end-to-end against the **built** app; needs a current `dist/` and refuses a stale one. Minutes, and makes real OpenAI chat calls — run it after a risky feature or refactor, not every change. `npm run e2e:live` is the only thing that makes OpenAI *generate* speech.
- `npm run bible:build` / `bible:verify` — regenerate the offline Bible packs / diff them against golden fixtures from the PHP parser. **Run verify after touching either parser.**
- `npm run bible:counts` — regenerate `src/services/bible/verseCounts.ts` from the KJV pack. Only when the packs or the book catalog change.
- `npm run community:verify` / `community:verify:api` — signing, share-code and chunking properties; then the community endpoints, `feedback.create`, and "no file in `public/api/` is servable on its own", against a throwaway `php -S`. **Run both after touching signatures, share codes, `postUnits`, `api.php`'s community actions or `feedback.create`, or after adding a handler file.**
- `npm run voices:verify:api` — keys, the voices collection, ElevenLabs narration (chunking, MP3 joins, the character-to-word alignment, every error code) and **shared voices** (who pays, the scope, the allowances, the owner's slots) against a throwaway `php -S` and in-process ElevenLabs and OpenAI stubs — never the real APIs. **Run after touching `audio.php`, `elevenlabs.php`, `voices.php`, `sponsorship.php`, the payer resolvers or `lib/wordTokens.ts`.**
- `npm run voices:announcements` — regenerate `public/api/announcements.php` (the announcement templates and book names a voice lent for scripture may read) from `src/i18n/*.json` and the book catalog. **Run after changing an `announce.*` string or a book's name** — `tests/unit/announcements.test.ts` fails until you do.
- `npm run build:native` / `npm run sync` — the Capacitor build; `sync` also runs `cap sync`.
- `npm run icons` — regenerate every app icon from `resources/source/icon.png` (`scripts/icons/buildIcons.mjs`); splash screens stay `capacitor-assets`' job. Sizing is per role (full-bleed vs genuinely masked) — don't "simplify" it back to one shared bitmap.
- `./scripts/deploy.sh [--dry-run]` — deploy the PWA + PHP over SFTP from an explicit allow-list. It must never upload `storage/` (live user data) or `secrets.php`, and it names **`api.php` and the whole of `api/`** — one without the other 500s on every request.
- TypeScript runs with `erasableSyntaxOnly`, so **constructor parameter properties (`constructor(private x: T)`) do not compile** — declare the field and assign it.

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
| What a narration voice *is* (identity, cache key, request body) | `src/services/voices/ttsVoice.ts` |
| Voice profiles, the selection, which voice speaks | `src/services/voices/voiceProfiles.ts` — `resolveVoice`; read through `src/lib/narrationVoice.ts` (outside React) / `src/hooks/useSpeechVoice.ts` |
| The voices screen (gallery + editor) and the key cards | `src/routes/VoicesPage.tsx` + `src/components/voiceProfiles/*` |
| An ElevenLabs refusal becoming session state | `src/lib/providerFailureWatch.ts` + `services/api/client.ts` `providerFailureOf` |
| A voice lent to a shelf: its terms, what it may read | `src/services/voices/voiceSharing.ts` (`voiceCovers`); the reader's copy is `communityStore.mirroredVoices`; the screens are `ShareVoiceSheet` / `ShelfVoiceSheet` |
| Whose key pays for a lent voice, and on what terms | `public/api/sponsorship.php` — `withSponsorPayer`, `sharedScopeAllows`, `sponsorAdmit` |
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

## Stores (Zustand) — who owns what
All in `src/store/`. `(persist)` = survives reload via `zustand/middleware`.
| Store | Owns |
| --- | --- |
| `usePlaybackStore` | **Source of truth for audio state**: status, current track, word index (drives `WordHighlighter`), volumes |
| `useChatStore` | Conversation history, `isProcessing`, `currentTool` |
| `useSettingsStore` *(persist v18 + migrations)* | User prefs: locale, `theme`, `readingAppearance`, translation, reading/announcement prefs, ambient, mic position, `syncEnabled`; transient key status (OpenAI, ElevenLabs), `elevenLabsFailure` and `sharedVoiceFailures`. **Not** which voice speaks — that syncs, settings don't |
| `useLibraryStore` | Cards + boards + their order, reading lists + per-list progress, **narration voices + the voice selection**, and `pendingOps`. Split across five modules — see [`stores.md`](docs/architecture/stores.md) |
| `useRibbonsStore` *(persist)* | Colored bookmarks ("ribbons") |
| `useGlobalVoiceStore` | Mic listening state, last voice response |
| `useLastReadingStore` *(persist)* | Resume point for "play last reading" — **audio-owned**, written only from the playback subscription. The reader's scroll position deliberately does not write here, or idle scrolling would move it |
| `useReaderStore` *(persist v2 — `position` + `source`)* | The reader screen: what it is walking through (the Bible, or a reading list), the current segment, the loaded-segment cache + the mounted window |
| `useBiblePacksStore` *(persist — `wanted` only)* | Offline Bible packs: per-translation status/progress, and which translations the user has asked for |
| `useCommunityStore` | The community profile, the user's own spaces and posts (drafts included, plus which are `shared`), subscriptions, subscribers, and the mirrors of what others share — plans, boards, **voices**. The state and the lifecycle only — the writers live in five sibling modules, see [`stores.md`](docs/architecture/stores.md) |
| `useNarrationStore` | Per-target narration download state (status/progress/error) for a chapter *or* a post — `NarrationTarget` is a union. Transient — the truth is in Dexie and `check()` re-derives from it |
| `useUiLayoutStore` | Transient layout — `bottomBarHeight`, the height of whichever bar the current page puts above the nav (chat composer, reader pager), so floaters clear it |
| `useUpdateStore` (in `lib/pwaUpdate.ts`) | PWA update-available flag *(named `use*` though it's a store, not a hook — a known, intentionally-left naming exception)* |

## Layer rules
- `components/` → call hooks + store selector hooks; presentational.
- `hooks/` → orchestrate; call `lib/` and `services/`.
- `lib/` → stateful singletons & logic (audio, gestures, sound cues); read stores via `getState()`.
- `services/` → stateless data access. `services/api/*` = HTTP; `services/bible/*` = reference parsing + verse fetch/format; `services/ai/*` = tool contract (`tools/`), routing table (`dispatch.ts`) and handlers (`handlers/*`).
- `store/` → Zustand state. `types/domain.ts` = canonical shared types. `utils/` = pure helpers.

## Naming conventions
- `use*` is reserved for **React hooks** (`hooks/`) and **Zustand store hooks** (`store/`).
- `lib/` singletons are camelCase nouns: `audioPlayback`, `browserTts`.
- `services/` modules export plain functions, not singletons.

## Testing

| Layer | What | Mocks? |
| --- | --- | --- |
| `tests/unit` | pure functions | none needed — that is the entry criterion |
| `tests/component` | a rule that only exists once React renders: hook reactivity, render-time state, a memo's deps. If it needs no `act()`, it is in the wrong layer | rarely |
| `tests/int` | stores + Dexie + queue, the tool dispatcher, the segment loader | at the outer edges |
| `tests/e2e` | a user clicking through the real app | **none**, and **no source changes** |

- **E2E serves `dist/` under one `php -S -t dist`** — the production topology. There is no `data-testid` in `src/`: specs use roles, accessible names (locale pinned to `en-US`) and `data-*` attributes production already reads. Every spec asserts every narration response was a **cache hit** (Psalm 117, voice `echo`) — that is what stops the suite billing OpenAI on every run.
- **A test is earned by a risk, not by a feature.** Name the rules a feature introduces as sentences that can be true or false; rank them by what a mistake costs (wrong audio, cache keys / wire formats, sync op sequences, progress, access control and offline paths are always tested; layout and copy usually are not); subtract what is already proven; write one line per rule in the commit naming its layer, or "none needed, because…". One fact, one layer — the lowest that can see it. E2E grows by journeys, not by features.
- **Read [`testing.md`](docs/architecture/testing.md) before writing a spec.** It has the risk table and the traps: every bottom sheet is mounted and "visible" at once; all specs in a project share one identity, so names must be unique per spec; a screen is not storage (wait on `support/persisted.ts`); a long-press drag needs `support/gestures.ts`; a sharing journey gates on the wire, not the screen.
- Known gap, left deliberately: the duplicate-read guard in `useCommandPipeline` has no test.

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
| what a narration voice sounds like, as a cache key and a request body | `services/voices/ttsVoice.ts` — `voiceKeyPart`, `ttsVerseBody`, `ttsSpeakBody` | a `(voice, voiceStyle)` pair threaded through 20 files, with three caches keyed three different ways (one dropped the style) |
| which voice speaks right now | `services/voices/voiceProfiles.ts` — `resolveVoice` | `effectiveReadingVoice` / `effectiveAssistantVoice` / `effectiveVoiceStyle`, which *wrote* the store back to Echo whenever a key looked missing |
| how a verse is cut into highlighted words | `lib/wordTokens.ts` | inline in `WordHighlighter`; now also the oracle the server's ElevenLabs alignment is checked against |
| matching a spoken name to a thing | `services/ai/handlers/match.ts` — `byName` | module-private in `handlers/spaces.ts`, out of reach of `set_voice` |
| the shapes derived from a feed (`feedItems`, a mirror array per kind) | `store/communityRows.ts` — `mirrorsFrom` → `FeedMirrors`, spread by all four writers | four writers, one of which (`unsubscribe`) filtered the arrays by hand |
| how a narration miss is generated, whoever pays | `public/api/audio.php` — `NarrationJob` (lock, re-check, temp files, rename, clean-up) | ElevenLabs only; OpenAI wrote in place, unlocked — fifty listeners, fifty generations |

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

Audio on the native targets is in [`playback.md`](docs/architecture/playback.md); speech input in [`assistant.md`](docs/architecture/assistant.md).

## Load-bearing rules, by subsystem

One line each; the linked file has the why. Several of these fail silently — no compile error,
no failing test — which is why they are here rather than only there.

**Playback** — [`playback.md`](docs/architecture/playback.md)
- A track's `groupId` is an opaque playback-group key. Anything in the playback path that needs the verses behind it goes through `readingHosts.getGroup(id)` — **never** re-introduce `useChatStore.messages.find(...)` there.
- "What plays next" lives only in `readingContinuation.nextReadingAfter()`. `ReadingGroup.provenance` is a union (list | space) and *absent* means canonical Bible order — so a host that teaches the reader a new kind of segment must extend `provenanceOf(ref)`, or auto-play reads a blog post and then starts Genesis.
- Reader group ids are deterministic and `appendReading` must stay idempotent; a list continuation adopts the list's own segment (`findListSegment`) rather than rebuilding one.
- Verses, replies and ambient play on `HTMLAudioElement`s, not Web Audio — iOS suspends the `AudioContext` when the page is hidden. In `elementTrackPlayer`: prime with a real silent WAV, always `.load()` after assigning `src`, never clear `src` from an async callback.

**Assistant** — [`assistant.md`](docs/architecture/assistant.md)
- A random pick goes only through `random_passage` (crypto random; a verse draw is weighted by `VERSE_COUNTS`). A reading tool's result must read as *done* or gpt-4o-mini retries — `useCommandPipeline` swallows a repeated `read_verses` (`playedKeys`) and an identical `random_passage` (`drawnKeys`).
- Tools in `READ_TOOL_NAMES` emit no chat text: the reading is the reply. A tool cannot navigate — it sets `ToolDispatchResult.opensReader` and the pipeline routes.
- Tool names say *shelf* (`read_shelf`, `add_to_shelf`, …) because that is what the model reads. Blocking, reporting and following deliberately have **no** tool; a share code pasted into chat is intercepted before `postChat`.

**Stores** — [`stores.md`](docs/architecture/stores.md)
- The split stores' sibling modules (`community*.ts`, `library*.ts`) import only `type` from their store. A value import is a runtime cycle; a type cycle silently turns `CommunityState` into `any` — if unrelated components suddenly grow implicit-any errors (`SpaceDetail` first), look at `communityRows`. Action parameters in those factories need explicit annotations.
- `syncEnabled` is enforced at exactly three chokepoints: `syncQueueManager.enqueue*`, `flushQueue`, `pullFromServer`. Don't open a fourth network path.
- `libraryStore.updateProgress` reads the current record inside the same synchronous block as the write, and updates the store before awaiting Dexie.

**Reader** — [`reader.md`](docs/architecture/reader.md)
- Its unit is a *segment* — usually a chapter, or a list entry's verse range (`isWholeChapter`). Prev/next goes through the source's sequence (`readerSequence.ts`), never `nextChapterRef`.
- Versification gaps are normal: a step walks past them, an explicit jump errors. Test with `isChapterMissing()`, never `instanceof` alone. A segment with `translationPinned` is exempt from a translation switch.
- Only `position` and `source` persist. `MAX_VISIBLE = 6` is the render-cost mitigation — don't raise it without profiling. Endless scroll re-pins by pinning a chapter element, not by scrollHeight arithmetic.
- `segmentLoader` reads no store, and `readerProgress` is handed the segments rather than importing `readerStore` (a value cycle).
- Which translations may be *chosen* is `translationCatalog`'s `offered`, and only that — the picker, the tool enums and prompts, the handlers (`asOffered`) and settings hydration all read it. A translation's `notice` is listed in Settings › Data & app › Bible texts, not under each reading; a rights holder's wording is verbatim (S00's is pinned by a test).

**Mic dock** — [`mic-dock.md`](docs/architecture/mic-dock.md)
- `CAPSULE_H`, `MIC_SIZE` and `OVERLAP` are coupled geometry — change one and re-check the tuck. `MicSnapTargets` derives from `BAR_DROP_BAND`.
- The docked bar's outer columns are `minmax(0, 1fr)`, not `1fr`, and the mic is passed *into* the grid — both are what keep Play centred. `canSeek` selects a boolean, never `current` (rewritten ~60×/s).

**Cards and boards** — [`cards-and-boards.md`](docs/architecture/cards-and-boards.md)
- `activeBoardId === null` means All cards; derive the selection from the board that actually exists. A shared board's selection lives in the route (`TabSelection` union), never in `activeBoardId`.
- Every draggable takes `MouseSensor + TouchSensor`, never `PointerSensor`. Don't hide the tab strip's native scrollbar (`no-scrollbar`). The z-indices 999 / 1000 / 2000 (raised card / sticky strip / dragged card) are coupled.

**Reading lists** — [`reading-lists.md`](docs/architecture/reading-lists.md)
- A stored entry is one chapter, or verses within one — `expandEntryToChapters` runs before every save. `isFlatList` is the one answer to "does this list have days", `listWindow.resumeSegment` the one answer to "where am I".
- Progress `completed` is union-merged, client and server alike, never last-write-wins. The narration tick does not depend on auto-play. The reader marks a passage only on a `turn`/`scroll` intent after a dwell scaled by verse count.

**Community** — [`community.md`](docs/architecture/community.md) and the `community-*.md` siblings
- The UI says *shelf* (`Regal`); the code, routes, wire actions and stored rows say *space*. Don't rename the code side.
- Posts are plain text because rendered text must equal narrated text. `postUnits`' output is a narration **cache key** — change how it splits and every existing narration and pinned download is orphaned.
- A share code is an **address, not a key**; access control is the owner's accept/deny. Widen `normalizeSpaceCode` together with api.php's `normalizeShareCode`.
- Posts absent from the server are never deleted locally. The feed (other people's writing) sits outside the sync machinery entirely.
- Shared plans, boards and voices ([`community-shared-items.md`](docs/architecture/community-shared-items.md)): `sharedPayload.ts` is the only producer and received bytes are stored verbatim. A shared plan keeps the author's list id; `sameSource` does not compare `code`; don't put `code` on `SegmentRef`; find lists by id via `resolveListById`. A fork mints fresh ids at every level. Mirrors come only from **accepted** subscriptions, and the four writers spread one `mirrorsFrom` result. A voice's payload is the one the server reads (`sharedVoiceOf`) — it refuses a field it does not know.
- `MODERATION_POLICY` mirrors `community.terms.*` — change both and bump `COMMUNITY_TERMS_VERSION`. Moderation runs server-side in the write path and fails open ([`community-moderation.md`](docs/architecture/community-moderation.md)).
- The invite route is the pending state: onboarding's `onDone` must leave `/subscribe/:code` alone ([`community-invites.md`](docs/architecture/community-invites.md)).

**Voices** — [`voices.md`](docs/architecture/voices.md)
- A voice's cache identity is `voiceKeyPart(config)` and nothing else — never its id, name, picture or payer. For OpenAI it is `${voice}|${style}` byte for byte: Echo's keys and request bodies must stay identical, or every e2e run misses the warm cache and bills OpenAI.
- `resolveVoice` never writes and returns a shared constant or the profile's own `config` (stable references). The *choice* lives in the library and syncs; what this session may *spend* (key status, `elevenLabsFailure`) is transient settings.
- `services/voices/ttsVoice.ts`, `voiceProfiles.ts` and `voiceSharing.ts` import no store, no i18n, no `services/api` — stores value-import them during hydration.
- A voice lent to a shelf ([`voices.md`](docs/architecture/voices.md#lending-a-voice-to-a-shelf)): the reader selects it by its **item id**; its `shared` ref rides on its config and never enters `voiceKeyPart`; its requests go to `tts.shared` / `tts.speak.shared`, never a field on `tts` (an older api.php must answer 404, not bill the reader). Ask `voiceCovers` wherever a voice is chosen for a plan — `readingTtsVoice`, the mid-reading rebuild (`narrationVoiceFor`), downloads (`useNarrationVoiceFor`). A `shared_voice_*` refusal is `payer: 'owner'` and must never touch the reader's own key status.
- Everything that protects a lending owner's money is on the server (`sponsorship.php`): the access checks refuse alike; the allowance is charged **after** the entry lock and the second cache look, and given back only when no audio came back; never the operator key, never `openAiPayer()`; an automatic-approval shelf needs a monthly pool, checked at spend time.
- An ElevenLabs refusal never uses `user_key_failed`; `parseResponse` notifies the provider-failure watcher *before* throwing, which is what lets `streamReading` re-resolve mid-chapter. Settings › Voice & playback keeps its title and the "Speak assistant replies automatically" label — the e2e harness clicks them.

**Theming** — [`theming.md`](docs/architecture/theming.md)
- Colour tokens are named by role (`surface`, `ink`, `brand`, `on-brand`, `on-fill`), and their values are space-separated RGB channels, **not hex** — every Tailwind alpha modifier depends on it. Colour lives in `src/index.css` on `[data-theme]`; `lib/theme.ts` only picks the palette.
- Reading appearance: saturation is always a fraction of the gamut at that lightness, never an absolute chroma (a mistake made three times). Type is written through a ref, never a `style` prop.

**Offline** — [`offline.md`](docs/architecture/offline.md)
- "Can I read this without the network?" is `isPreinstalled()`, not `isBundled()`. Narration URLs are recorded from api.php's response, never recomputed; a local hit needs an index entry **and** the bytes.
- The mnemonic is minted silently on first run and shown only when sync is turned on — never put "create an account" in front of a first-run user.
- Group-download selectors return primitives. A failed or cancelled download sets `'unknown'` before re-deriving.

**Backend** — [`backend.md`](docs/architecture/backend.md)
- Accounts are lazy: only `$ACCOUNT_ACTIONS` create `storage/users/{id}`. No eager `mkdir` in `authenticate()`.
- Never write `__DIR__` in `public/api/` — use `APP_ROOT`. Every file there opens with the `if (!defined('APP_ROOT'))` 404 guard.
- Never write `<Directory>` in a `.htaccess`: Apache 500s the whole site, and `php -S` — which every harness here uses — cannot catch it.
- Who pays is resolved in one function per provider — `openAiPayer`, `elevenLabsPayer`, and `ttsPayer` for narration, on a cache miss only; `withSponsorPayer` for a lent voice, whose owner pays — and only `account.php`'s stored-key helpers touch `users/{id}/*_key.txt`. Only `elevenLabsRequest()` builds an `xi-api-key` header; never send another provider a request through the OpenAI curl wrappers, which fall back to the shared OpenAI key.
- `api.php` and `api/` deploy together, `api/` first; any harness that stages the backend names both. Nothing user-authored crosses accounts except through a `sanitize*` whitelist, and a caller-supplied id becomes a path only via `safe*` (`safeUuid`).

**In-app feedback** — [`feedback.md`](docs/architecture/feedback.md)
- The bug button's placement (right edge, vertically centred, tucked 12px off-screen, `z-30`) *is* the design — re-read the doc before moving it. `feedback.create` is outside sync and outside `$ACCOUNT_ACTIONS`, deliberately.

## Architecture notes — `docs/architecture/`

| file | covers |
| --- | --- |
| [`testing.md`](docs/architecture/testing.md) | the four layers, E2E traps, definition of done and the risk table |
| [`playback.md`](docs/architecture/playback.md) | reading hosts and continuation, why audio is a media element, the feed loop |
| [`assistant.md`](docs/architecture/assistant.md) | random passages, the shelf tools, speech input |
| [`stores.md`](docs/architecture/stores.md) | how the community and library stores are split, and why |
| [`reader.md`](docs/architecture/reader.md) | `/read`: segments, sources, paragraphs, endless vs paged, the loader |
| [`mic-dock.md`](docs/architecture/mic-dock.md) | the mic + transport control: floating, docked, the width ladder |
| [`cards-and-boards.md`](docs/architecture/cards-and-boards.md) | `/cards`, the tab strip, dragging a card onto a board |
| [`reading-lists.md`](docs/architecture/reading-lists.md) | lists, plans, the picker, progress and the dwell rule |
| [`community.md`](docs/architecture/community.md) | spaces and posts: the reader reuse, signatures, share codes, sync, known limitations |
| [`community-invites.md`](docs/architecture/community-invites.md) | invite links, the app hand-off, where the opt-in is offered |
| [`community-moderation.md`](docs/architecture/community-moderation.md) | terms, blocking, reporting, the automated judge |
| [`community-shared-items.md`](docs/architecture/community-shared-items.md) | shared plans and boards: payloads, `ba.item.v1`, the room screen |
| [`community-screens.md`](docs/architecture/community-screens.md) | resharing, the shelf screen, the index tabs, the code field |
| [`feedback.md`](docs/architecture/feedback.md) | the bug button and `feedback.create` |
| [`voices.md`](docs/architecture/voices.md) | narration voices: identity and cache keys, who speaks, sync, keys and providers, ElevenLabs, the screens, lending a voice to a shelf |
| [`theming.md`](docs/architecture/theming.md) | colour tokens, palettes, reading appearance |
| [`offline.md`](docs/architecture/offline.md) | sync opt-in, packs, the narration source chain, downloads |
| [`backend.md`](docs/architecture/backend.md) | `api.php` and its files, lazy accounts, the action list, who pays (narration payers, the stored keys, ElevenLabs) |
