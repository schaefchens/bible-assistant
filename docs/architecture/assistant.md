# The assistant, tools and voice input

> Part of the architecture notes indexed in [`CLAUDE.md`](../../CLAUDE.md). Moved there verbatim; "above" and "below" may refer to sections that now live in a sibling file.

## Random passages — the model must never roll its own

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

## Asking the assistant for a shelf

**A shelf's whole life is callable, and that is a product rule rather than a
convenience.** The app's selling point is that it can be driven without looking
at it, so "the user does that part themselves in the app" is not a design
option — it is the assumption that breaks the promise. Fifteen tools:
`list_shelves`, `create_shelf`, `update_shelf`, `delete_shelf`, `share_shelf`,
`decide_reader`, `write_piece`, `publish_piece`, `delete_piece`,
`add_to_shelf`, `remove_from_shelf`, `read_shelf`, `read_new`,
`unfollow_shelf`, `copy_from_shelf`.

Two acts are deliberately **not** there, and both are complaints rather than
housekeeping: **blocking an author** and **reporting content**. They are rare,
they are about a person, and a misheard word should not be able to cut somebody
off — they stay in the app, where each takes a deliberate tap.

**Following a shelf has no tool either**, for a different reason: a share code
is eighteen characters of base32, and neither a speech-to-text transcript nor a
language model reproduces one reliably. One transposed character is a shelf
that does not exist. So a code pasted into the **chat** is intercepted in
`useCommandPipeline` *before* `postChat`, beside the stop-command check, and
answered by `subscribe` directly — the code the user pasted is the code that is
used, it costs no model call, and the reply is one of two written sentences
rather than something the model narrates. `parseSpaceCodeInput` is the test,
liberal as it is everywhere else (a bare code, either link, or a whole
forwarded message): nobody types a share code into a Bible chat for another
reason. `subscribe-errors.spec.ts` pins the negative half — **no `action=chat`
request left the device** — because asserting only on the answer would pass
just as well if the model had been asked and had guessed right.

**Almost every handler is a name resolver in front of a store action**, and
`byName` is the one copy of the resolving: exact, then unique substring, then
*several is a question rather than a guess*. A miss names what there is, so the
model's next turn can offer real names. That last part is not politeness — it
is what stopped the model reaching for `read_verses` when a shelf name failed
to resolve, and it now applies to plans, boards, pieces and readers too.
`create_shelf` refuses a duplicate name for the same reason, at the one place a
name is chosen rather than at the dozen places one is read.

`read_shelf` and `read_new` are in `READ_TOOL_NAMES`, so like `read_verses` the
reading *is* the reply. Both open the **reader**, not the chat — chat has no representation
for a post (`ChatMessage` carries a list provenance but not a space's).

**Removing is not destroying, and the tools draw the app's own line.**
`remove_from_shelf` takes a plan, a board *or* a piece off: a plan and a board
are snapshots of something that lives in the library, so that is `deleteItem`
and the source is untouched; a piece lives only on the device, so that is
`unpublishPost` and the draft survives. `delete_piece` is the destructive one
and is its own tool, and both it and `delete_shelf` tell the model in as many
words to confirm in the previous turn. The Today shelf refuses to be renamed or
deleted — it is created with the profile and every resolver assumes it.

**The prompt used to contradict itself here.** It said, absolutely, "never say
something has been shared or published — sharing is an act the user performs in
the app", and two sentences later named two tools that publish. The first was
meant to scope to `write_piece` (a draft is not visible to anyone) and did not
say so, and an absolute prohibition is exactly what gpt-4o-mini takes
literally — so after a successful share it would deny having done it. The
prohibition is now scoped to drafts, with "otherwise say plainly what you did"
beside it.

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

## Speech input
Native builds prefer on-device recognition (`nativeSpeech.ts`, `@capgo/capacitor-speech-recognition`).
The Web Speech API does not exist in either WebView, so the web build is Whisper-only, and
Whisper (`?action=transcribe`) remains the fallback everywhere.

The iOS workaround layer — `iosAudioRouting.ts`'s silent-WAV nudge, the AEC/AGC-disabling
`micConstraints()`, `DUCK_FACTOR = 0` — is now **only on the Whisper/push-to-talk path**, which
still uses `getUserMedia` and so still hijacks the audio session. It can't be deleted while that
fallback exists.
