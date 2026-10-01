# Store internals — the split stores

> Part of the architecture notes indexed in [`CLAUDE.md`](../../CLAUDE.md). Moved there verbatim; "above" and "below" may refer to sections that now live in a sibling file.

## The community store, in six modules

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

## The library, in five modules

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
| `store/libraryVoices.ts` | narration voices and the voice selection: their writes, the selection's collapse and adoption, the one-time import of the old voice settings |

Three things about it are load-bearing:

- **`syncEnabled` is still enforced in exactly three places.** `flushQueue` and
  `pullFromServer` moved but did not multiply — `syncQueueManager.enqueueOp` is
  the third, as before. A new caller still cannot bypass the opt-in.
- **`librarySync` is a factory over `(set, get)`**, so the four action bodies
  moved *verbatim*. Nothing inside them was rewritten, which is what let the
  integration tests stand as the net rather than being rewritten alongside.
- **`librarySync` and `libraryVoices` import only `type LibraryState` from the store**, which
  `verbatimModuleSyntax` erases. `expandStoredSpans` and `seedSyncQueue` take
  `get` for the same reason: they used to reach the store through its own module
  import, which from there would be a cycle. Don't add a value import back.

`lib/` and `services/` read stores directly via `useXStore.getState()`; React components use
the `useXStore(selector)` hooks for reactivity. The one read path that *is* behind a contract
is playback-group → verses, via `src/lib/readingHosts.ts` (see [`playback.md`](playback.md)).

**Voices sit in the library, not in settings, because they sync.** A voice is
user content made on one device and used on another, exactly like a reading list,
so it has the same row flags, the same one-op-per-change and the same adoption on
pull; the selection is one record that collapses and adopts like an order
(`libraryVoices.adoptedVoiceSelection` mirrors `libraryOrder.adoptedOrder`). What
stays in `settingsStore` is what a *session* may spend — key status and an
ElevenLabs failure — which never syncs and never persists. The two meet only in
the pure resolver, through `lib/narrationVoice.ts` and `hooks/useSpeechVoice.ts`;
neither store imports the other's voice state. See [`voices.md`](voices.md).
