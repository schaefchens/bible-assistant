# Testing — three layers, three jobs

> Part of the architecture notes indexed in [`CLAUDE.md`](../../CLAUDE.md). Moved there verbatim; "above" and "below" may refer to sections that now live in a sibling file.

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

`bible:verify`, `community:verify*` and `voices:verify:api` are part of the integration
layer and predate the naming; they stay exactly as they are. `voices:verify:api` is the
only place ElevenLabs is exercised, and it never calls ElevenLabs: `secrets.php` points
`ELEVENLABS_API_BASE` at an in-process Node stub whose behaviour is chosen by the key
value, so every error code, the v4 chunk-and-join and the character-to-word alignment
are checked offline in seconds — against `lib/wordTokens.ts`, the very tokenizer
`WordHighlighter` uses.

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

## Definition of done for a new feature

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

## Known gap

The **duplicate-read guard** (`useCommandPipeline`: a repeated `read_verses`, or an identical
`random_passage`, must not play a second passage — see "Random passages" in [`assistant.md`](assistant.md)) has no test.
Its logic is inline in the hook and keyed by two module-private helpers, so covering it needs
one of: exporting `referenceKey`/`drawKey`, adding a React renderer to the integration layer,
or asserting "exactly once" against a live model — which is not deterministic. Left uncovered
deliberately; `tests/int/toolDispatch.test.ts` pins the result shapes either side of it, which
is what made the model retry in the first place.
