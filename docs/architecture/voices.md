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

The split is what lets a voice later be published on a shelf (see the last section):
a record that travels as-is, whose listeners share the owner's audio files, and whose
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

## Later: sharing a voice on a shelf

Not built. The seams are in place: the profile is a plain versioned record with a
whitelisting coercer on both sides (`normalizeVoiceProfile`, `sanitizeVoiceProfile`);
its cache identity carries no owner, so owner and listeners share files; the server
decides the payer in one function per provider, which is where "the owner pays,
because this listener is on their shelf" would go; and a dangling selection already
falls back, which is what revocation would look like. The inline avatar would be
uploaded to an https URL at publish time, as a board's background is.
