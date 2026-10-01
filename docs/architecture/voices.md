# Narration voices — who reads, and how

> Part of the architecture notes indexed in [`CLAUDE.md`](../../CLAUDE.md).

A **narration voice** is something the user makes and names: "Grandpa", with
his photo, reading in a warm, unhurried ElevenLabs voice. Two are built in: **Echo**
(OpenAI, paid for by the shared server key) and the **Device voice** (the
platform's own speech, which works offline). Everything else is the user's, made in
Settings › Narration voices (`/settings/voices`), on one of two providers:

| provider | the voice | how it speaks | needs |
| --- | --- | --- | --- |
| OpenAI `gpt-4o-mini-tts` | one of 13 (`marin` and `cedar` are OpenAI's best) | a free-text style, sent as instructions | the user's own OpenAI key |
| ElevenLabs | any voice in the user's ElevenLabs library, or one designed from a description | model (`eleven_v4` or `eleven_multilingual_v2`) + stability/similarity (+ style/speed on v2) | the user's ElevenLabs key |

Two voices are chosen at a time: one **reads** (scripture, chapter headings, verse
numbers, a shelf's posts) and one **replies** (the assistant's spoken answers and the
eyes-free labels). The reply voice defaults to the device voice, because assistant
text is unbounded and the shared key should not pay for it.

## A voice is three things kept apart

`services/voices/voiceProfiles.ts` — `VoiceProfile`:

- **the audible config** (`config: TtsVoice`) — what it sounds like. This *is* the
  voice's cache identity (below), and the only part that ever reaches a cache key;
- **presentation** — `name`, an optional `avatar` (an inline data URL), and
  `sourceName` (the provider's own name for the voice, "George");
- and *not* a field at all: **which voice is in use**. That is the separate
  `VoiceSelection` record, `{ narration, assistant, updatedAt }`.

The split is what lets a voice be lent to a shelf (see the last section): its name,
picture and config travel, its listeners share the owner's audio files, and the
selection stays each listener's own.

## Identity — the one rule that costs money when wrong

`services/voices/ttsVoice.ts` is the one copy. `voiceKeyPart(config)` is the voice's
part of every narration index key (`narrationIndex.ts`), and the request bodies are
built by `ttsVerseBody` / `ttsSpeakBody`.

- **OpenAI is `${voice}|${style}`, byte for byte** — exactly the segment every key
  carried when the app had two voice settings. `v|echo||KJV|19|117|1` is still Psalm
  117:1 in Echo, and the Echo request body is still byte-identical to the one the
  server's warm cache answers (pinned in `tests/unit/ttsVoice.test.ts`; e2e asserts
  the resolved path). A style is kept *untrimmed*: it is already a key for every
  install that set one.
- **ElevenLabs is `el:<voiceId>|<model>,<stability>,<similarity>[,<style>,<speed>]`.**
  `el:` cannot collide with an OpenAI voice (none contains a colon). Only the fields
  the model uses exist on the type at all — a v4 voice has no style or speed — so a
  slider left over from the other model can never enter its identity.
- **Settings snap to a 0.05 grid** on both sides of the wire (`normalizeTtsVoice`,
  and the server's own canonical form), because two values that sound the same must
  not be two caches the user pays for twice. `*20/20`, not `*0.05`, so the stored
  number is the short decimal.
- **Never in the identity:** the profile's id, name, picture or who pays. Two
  profiles of one sound play the same files.

## Who speaks — chosen versus resolved

`selectedVoice(role, input)` is what the user chose; `resolveVoice(role, input)` is
what actually speaks: the chosen voice if this session can use it, else the role's
default — **Echo** reads, the **device voice** replies. `voiceAvailability` decides,
by *identity* rather than by "is it custom":

- the shared key reads exactly Echo-with-no-style and nothing else (so a profile of
  plain Echo, avatar and all, is free too) and replies with the device voice only —
  the same limits api.php enforces when the operator is the payer;
- an OpenAI voice otherwise needs the personal key (`hasUserOpenAiKey &&
  !sessionPreferSharedKey`);
- an ElevenLabs voice needs the key, and no failure this session for it
  (`elevenLabsFailure`: the key, the quota, or that one voice);
- a selection naming a voice that no longer exists is the role's default.

Three properties of the resolver are load-bearing:

1. **It never writes.** The settings it replaced *reset* the stored voice to Echo
   whenever the key looked unavailable — including on every offline cold start,
   before key status had arrived, which forgot a custom voice for good. Now the
   choice survives any session that cannot pay for it, and is back the moment the
   key is.
2. **It returns references, never new objects** — a shared frozen constant
   (`ECHO_VOICE`, `DEVICE_VOICE`) or the profile's own `config`. So `!==` means
   "changed" (auto-play's prefetch relies on it) and it is safe in a render.
3. **It is pure and imports no store.** The library store and the settings
   migration value-import `services/voices/*` while zustand is still hydrating; a
   cycle there would crash boot for every upgrading install. Callers join the two
   stores themselves: `lib/narrationVoice.ts` outside React,
   `hooks/useSpeechVoice.ts` inside it. Display names (`t()`) live in
   `voiceNames.ts` and the components, never here.

**A downloaded chapter plays in the voice it was downloaded in.**
`startPlayback.readingTtsVoice(plan)` asks about the *chosen* voice first: if the
whole plan is on the device in it, it plays in it — offline, or before the key status
lands. Only then the resolved voice, then the offline rules in
[`offline.md`](offline.md).

## Storage and sync — voices follow the user

Voices are user content, so they ride the same sync as cards and reading lists, on
the same opt-in Sync switch — nothing leaves the device while Sync is off, and no
fourth network path exists.

| | voices | the selection |
| --- | --- | --- |
| Dexie (v12) | `voices` rows with `dirty`/`deleted` | a `preferences` row, `VOICE_SELECTION_KEY` |
| store | `libraryStore.voices`; writes in `store/libraryVoices.ts` | `libraryStore.voiceSelection` |
| ops | `voice.upsert`, `voice.delete` (tombstone) | `voiceSelection.set`, collapsing like an order |
| server | `voices.list/upsert/delete` → `users/{id}/voices.json` | `voices.selection.get/set` → `voiceSelection.json`, last write wins |

The selection syncs too, deliberately: pick a voice once and every device reads with
it. A device that can't use it right now falls back on its own, through the resolver,
without changing the choice. Deleting the voice in use resets that role to its system
voice and syncs the reset — otherwise the other devices would go on resolving a voice
that no longer exists.

**The avatar travels inside the record** (`avatar: data:image/jpeg;base64,…`, 256 px,
quality stepped down until it fits 96 KB — `lib/imageResize.avatarDataUrl`). Inline
so it syncs and works offline without an upload, and so it stays under the denied
`users/{id}/` rather than in the public avatar store. The server's
`sanitizeVoiceProfile` refuses anything else.

**Key status is not synced and not persisted** — `hasUserElevenLabsKey`,
`userElevenLabsKeyMasked` and `elevenLabsFailure` are transient settings, hydrated at
boot from `auth.elevenlabsKey.status` (a file check on the server, never a call to
ElevenLabs).

### Upgrading from the voice settings

An install from before voices had `voice` / `voiceStyle` / `assistantVoice` in
`ba.settings`. The migration comes in two halves, because settings hydrate
synchronously and Dexie is async:

1. settings v18 **deletes** the three keys — zustand's shallow merge would otherwise
   carry them forever — and parks anything non-default in `legacyVoices`;
2. `libraryStore.init` turns the stash into rows (`migrateLegacyVoices`), dirty so
   they sync, then clears it.

Each migrated profile's `voiceKeyPart` equals the old `${voice}|${voiceStyle}`, so
every chapter downloaded in it still resolves. Its id is **derived from that
identity** (a uuid-shaped sha256), so two devices upgrading with the same voice
converge on one synced row rather than two identical ones. The migrated selection
carries `updatedAt: 1`, older than any real choice, so one already synced from
another device wins.

## Providers and keys

Keys live on the server, per account, exactly like the OpenAI key always has
(`account.php`; `users/{id}/*_key.txt`, mode 0600). The app only ever sees a masked
hint. Saving one validates it first, and an ElevenLabs key without the "user read"
permission is still accepted (it narrates fine; it just can't show the remaining
credits). Both key cards are one component, `ProviderKeySection`; the OpenAI card is
also reachable from Settings › Account, because that key pays for chat and
transcription too.

Who pays for a request is decided on the server, in one function per provider,
**on a cache miss only** — see [`backend.md`](backend.md). Narration requests carry
the audible config; never a key.

### When ElevenLabs says no

An ElevenLabs refusal that will keep happening this session — the key refused or
missing, the credits gone, one voice gone from the user's library — is stamped
`provider: 'elevenlabs'` by api.php and never uses `user_key_failed` (which means
"offer the shared OpenAI key"). The client's `providerFailureOf` recognises it and
`parseResponse` notifies listeners **synchronously, before the throw**;
`lib/providerFailureWatch.ts` records it in `elevenLabsFailure`. So:

- every resolver falls back at once — the next verse, the next reply, the download
  buttons;
- `streamReading`, which catches the error after the failure is recorded,
  re-resolves **once** and reads the rest of the chapter in the fallback instead of
  skipping verse after verse (`tests/int/voicePlayback.test.ts`);
- `KeyFailureBanner` says why, once per failure, and links to the keys.

A transient error — a rate limit (api.php retries once), an outage, a busy server —
is not a provider failure; the item is retried or skipped like any other.

ElevenLabs narration is built **two at a time** (`ttsConcurrency`), not four: the
smaller ElevenLabs plans limit concurrent requests, and a refused request is a
silent hole in a chapter.

### ElevenLabs on the server

`eleven_v4` runs on the Text to Dialogue endpoint with timestamps (one input, one
voice), at most 2,000 characters a request — so api.php chunks longer text at
sentence boundaries and joins the MP3 frames. `eleven_multilingual_v2` runs on the
plain text-to-speech endpoint. Both return **character timings**, which api.php
turns into the same alignment file Whisper used to produce — cut into words exactly
as `WordHighlighter` cuts them (`lib/wordTokens.ts` is the oracle the server
harness checks against), so highlighting needs no client change and no Whisper call.
The cache is content-addressed by audible config and text. Details, and the harness
that proves them without a real ElevenLabs call, are in [`backend.md`](backend.md)
and `scripts/voices/`.

## The screens

- `/settings/voices` — a Reading | Replies switch, the chosen voice with what reads
  instead and why, the built-in voices, the user's voices and "Create a voice", and
  the two key cards. `?for=assistant` and `?focus=providers` are query state — never a
  `#fragment`, which *is* the route under the native HashRouter.
- `/settings/voices/:id` (or `new`) — `VoiceEditor`: picture, name, provider, the
  provider's fields, and a sticky "Hear a sample" (Psalm 23; a constant text, so a
  second listen is a server cache hit). It edits a local draft and commits on Save —
  one synced write, not one per slider movement — and saving is allowed whether or not
  the voice can speak yet: a voice made before its key reads in its fallback until
  the key arrives.
- Settings › Voice & playback keeps its title and the "Speak assistant replies
  automatically" checkbox **exactly** — the e2e harness quiets replies by those labels
  (`tests/e2e/support/onboard.ts`).
- The assistant chooses by name (`set_voice { name, for? }`), through `byName`: a voice
  that can't speak yet is still chosen, and the reply says what will be heard.

## Lending a voice to a shelf

An owner can **lend** one of their voices to one of their shelves. The shelf's
readers — the ones the owner accepted — can then read (and, if allowed, hear
replies) in it, and **the owner's server-stored key pays** for what they generate.
The key is never shown to anyone, and taking the voice off the shelf revokes it at
once. In effect the owner shares the *use* of their key, on terms they set:

- **what it may read** — `scripture` (verses and the app's own announcements around
  them; the default), `pieces` (that, and the owner's own pieces on the same
  shelf), or `anything` (any text, the assistant's replies included);
- **how much** — a monthly allowance for all readers together and/or a daily one
  per reader, in characters (the unit both providers bill in), or no limit. **On a
  shelf with automatic approval the monthly pool is required**: anyone holding the
  code gets in, and every throwaway identity would bring a fresh day. That is
  checked when the server spends, not when the voice was lent, so switching a
  shelf to automatic later opens no hole.

Everything that protects the owner's money is enforced on the server
(`public/api/sponsorship.php`, below). The app only reflects it, so it can pick
the right voice up front rather than be refused verse by verse.

### What travels — a shared item of kind `voice`

The same machinery as a plan or a board ([`community-shared-items.md`](community-shared-items.md)):
a signed snapshot (`ba.item.v1`, kind inside the signed message), a header in
`space.feed`, the payload fetched once through `space.item`, **Update** when the
voice changed, **Remove** to take it off. The payload (`buildVoicePayload`, the only
producer; fixed field order):

```
{"v":1,"voice":{"id","name","sourceName"?,"config":{…the audible config…}},
 "sharing":{"scope","monthly"?,"dailyPerReader"?},
 "avatar":"data:image/…"?}
```

- **The terms are inside the signed payload**, so the server enforces exactly what
  the owner published and readers can see it. api.php reads them back out of these
  bytes on every sponsored miss (`sharedVoiceOf()` in `voices.php`), and **refuses a
  field it does not know** rather than ignoring it — a limit a newer app adds must
  never be published to a server that would not apply it. Changing the terms is an
  Update; the item keeps its id, so readers keep their choice and this month's
  count still counts.
- **The picture stays inline and goes last.** Only accepted members can fetch a
  payload, where the public avatar store would make it everybody's. Last, because
  the moderation pre-check (`moderation.check`, 8,000 bytes) is sent the payload
  without it (`voiceModerationText`) — with it, the check would be refused for size
  and silently skipped. The server's own check skips inline pictures the same way
  (`moderationTextOf`), and `report.create` keeps the picture beside the excerpt, so
  a reported voice's evidence survives its removal.
- No Today shelf: its items expire after a day, and a voice vanishing from its
  readers overnight would look like a fault.

### The reader's side — a mirror, chosen by its item

`communityStore.mirroredVoices` (`MirroredVoice`) is built in `mirrorsFrom` with
the other mirrors, **only from accepted subscriptions** (which closed the same gap
for plans and boards), and every writer of the derived shapes spreads one
`FeedMirrors` result — `init`, the feed refresh, `unsubscribe`, `disableCommunity` —
so none can update one kind and forget another.

- **The reader selects a shared voice by its item id**, never the owner's voice id:
  a migrated voice's id is derived from its sound and can equal one of the
  reader's own, and the same voice on two shelves must not leave "who pays"
  ambiguous. Remove-and-reshare mints a new item, so the selection dangles and
  falls back like any other.
- **Who pays is part of the voice.** The mirror's `config` is a `SharedTtsVoice` —
  the audible config plus `shared: {code, itemId, spaceId, scope}` — so every path
  that narrates (playback, prefetch, downloads, a preview) carries it without being
  told. `voiceKeyPart` builds from the audible fields alone, so the cache identity
  and the files are the owner's and every reader's alike; `normalizeTtsVoice`
  drops the ref, so a voice of one's own can never carry one.
- **It keeps its object identity** across feed refreshes while the payload hash is
  the same — the resolver's stable-reference guarantee, which auto-play compares by.
- A shared voice's requests go to **their own actions, `tts.shared` /
  `tts.speak.shared`** (`ttsAction`), with `shared: {code, itemId}` last in the body.
  An api.php that predates them answers 404 `unknown action` — refused, never read
  as the reader's own and billed to them; `parseResponse` restates that 404 as
  `shared_voice_unavailable` for that item.
- **What it may read, decided up front** — `voiceSharing.voiceCovers(ref, plan)`:
  scripture and announcements always, a piece only on `pieces` from that same
  shelf or on `anything`. `readingTtsVoice`, the mid-reading rebuild
  (`narrationVoiceFor`) and the download buttons (`useNarrationVoiceFor`, per
  subject) all ask it, so a piece on a scripture-only voice reads in the fallback
  from its first word. A shared voice replies only on `anything` (`voiceCanReply`).
- Its sample is **Psalm 23:1, as a verse** (`usePreviewVoice`), which every scope may
  read — the app's own sample sentence would be refused.

### When the owner's account says no

Every refusal is `{error: 'shared_voice_*', payer: 'owner', itemId}` — never a
provider code, so nothing the owner's account does ever touches the reader's own
key status (`providerFailureOf` ignores `payer: 'owner'`). `sharedVoiceRefusalOf`
recognises them, `parseResponse` announces them before the throw, and
`providerFailureWatch` acts:

| refusal | means | the app |
| --- | --- | --- |
| `shared_voice_unavailable` | the owner's key will not pay (none, refused, out of credits, the voice gone), or the reader may no longer use it | recorded for that item for the session (`sharedVoiceFailures`); the resolver falls back |
| `shared_voice_budget` | an allowance is spent | the same, until a reload asks again |
| `shared_voice_out_of_scope` | this reading is not one it was lent for | this reading reroutes; the voice stays chosen |
| `shared_voice_mismatch` | the owner updated the voice; this copy is stale | this reading reroutes, and the shelves are fetched again (throttled) |
| `shared_voice_busy` | the owner's generations are all in use, or upstream is busy | a blip: that item is skipped like any other |

`streamReading` reroutes once on any but `busy` — through `fallbackAfter`, which for
a shared voice asks the resolver *without* that voice, because out-of-scope and
mismatch are not recorded anywhere it would see. The banner names the shelf's
owner, not "your credits".

**Revoking stops spending, not listening.** Audio already generated plays by URL for
anyone. When a mirror vanishes — removed, blocked, a new code, the shelf or the
owner gone, or the reader unsubscribed — `lib/sharedVoiceDownloads.ts` gives its
pinned downloads back, unless Echo, one of the reader's own voices or another
mirror sounds the same.

### The server — sponsored narration

`tts.shared` / `tts.speak.shared` are `handleTts` / `handleTtsSpeak` (and the
ElevenLabs handler) with one difference: on a **miss**, `withSponsorPayer()` replaces
the requester's payer. A hit is free to anyone, exactly as through plain `tts`. The
checks, read-only and in order; the first four refuse identically so nothing is
learned about a shelf the caller may not read:

1. the caller has a community profile — the proof `authenticate()` checked a secret
   at all (it checks none for an identity with no directory), so nobody can claim
   the id of an accepted member who has since left;
2. the code names a space that exists and whose owner is published (the owner
   asking pays as always);
3. the membership is `accepted`;
4. the item is listed in **that** space and is a voice;
5. the config asked for equals the shared one, canonically → else `mismatch`;
6. the scope allows the text → else `out_of_scope`:
   - a verse must equal `bibleChapterVerses()`' `textTts` for the reference (the
     translation checked against `BIBLE_XML_MAP` first);
   - an announcement must match the app's own templates and book names —
     `api/announcements.php`, **generated** by `npm run voices:announcements` from
     `src/i18n/*.json`, the book catalog and `Intl.ListFormat`, and pinned by
     `tests/unit/announcements.test.ts`, which feeds every announcement the real
     `buildPlaybackPlan` makes through the real matcher;
   - on `pieces`, a piece's spoken heading, one of its paragraphs (split as
     `postParagraphs` splits, JavaScript whitespace), or — only inside a paragraph
     over one reading unit — a run of whole sentences;
7. an automatic-approval shelf has a monthly pool → else `budget`;
8. the owner's own stored key for the provider — never the operator's, never
   `openAiPayer()` (it honours the *reader's* session fallback), never an empty key
   (the OpenAI curl wrappers would fall back to the shared key on one).

Then, **after the per-entry lock and the cache's second look** — so a request that
finds the audio waiting pays nothing, and two readers asking at once are charged
once — `sponsorAdmit()` reserves `max(characters, 50)` against every allowance the
voice has (`users/{owner}/sponsored/{itemId}/pool.json` and `daily-{reader}.json`,
UTC periods, one flock'd read-check-write, pool first), and takes one of the
owner's **two generation slots**, so readers cannot trip the owner's provider
concurrency limit. A reservation is given back only if no audio came back
(`NarrationJob`); a v4 text whose first chunk came back before a later one failed
stays charged.

Owner-side upstream failures say only whether they will last
(`shared_voice_unavailable`) or not (`shared_voice_busy`) — never the upstream
detail, which can quote part of the key or a billing state. OpenAI narration now
generates the way ElevenLabs always did — per-entry lock, re-check, temp file and
rename — for every payer, because fifty readers missing one chapter on somebody
else's key must cost one generation.

The counters are the second write into another person's directory, after
`space.request`; they go with the item, the space, the community profile and the
account. `npm run voices:verify:api` proves all of it (checks 19–31) against the
ElevenLabs stub and an OpenAI stub (`OPENAI_API_BASE`), with canary keys for owner
and reader.

### The screens

- **The owner**: "Lend to a shelf" in the voice editor (`ShareVoiceSheet` — the
  terms, then every shelf with Lend / Update / Remove), and a **Voices** tab on
  their shelf (`SpaceDetail`, with `ShelfVoiceSheet` to lend one or change its
  terms; a row warns when an automatic shelf has no monthly pool). Deleting a voice
  takes it off every shelf it was lent to.
- **The reader**: a **Voices** section in the room (`RoomPage` — terms, a sample,
  "Read with it", and "Reply with it" on `anything`), and **Shared with you** in the
  voices gallery, which polls the shelves while open.
- The assistant may take a voice off a shelf (`remove_from_shelf { voice }` — it
  only reduces spending) but never put one on: lending spends the user's key, so it
  is decided in the app, like blocking and reporting. `set_voice` finds shared
  voices by name.

Known limits: the owner's *other* devices hold a lent voice's header without its
payload (only the lending device has it), so its terms show as "lent from another
device" there and are changed where it was lent; and a piece's spoken heading is
matched against the owner's current name, so a reader whose copy of the shelf still
has an old one hears that reading in Echo until the next refresh.
