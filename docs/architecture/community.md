# Community spaces

> Part of the architecture notes indexed in [`CLAUDE.md`](../../CLAUDE.md). Moved there verbatim; "above" and "below" may refer to sections that now live in a sibling file.

**The UI calls a space a "shelf" (`Regal` in German); the code calls it a
space.** A user makes a shelf, puts things on it and shares it — which says what
the feature is far better than "space" or "room" did. The rename stops at the
code: `Space`, `spaceId`, `spaces.upsert`, `space.feed`, `ReaderSource`'s
`'space'` kind and the `/spaces` and `/rooms` routes are all unchanged, and
renaming them would be a migration of persisted rows, wire actions and on-disk
paths for the sake of a word. So: when editing copy the noun is *shelf*, when
editing code it is *space*. German also changes gender with the noun — `der
Raum` became `das Regal` — so the articles moved too.

**The tool contract is on the copy side of that line**, not the code side:
`read_shelf`, `add_to_shelf`, `list_shelves`, and a `shelf` parameter. A tool
name is what the *model* reads and reasons with, and handed `read_space` while
every string it sees says "Regal" it has to make the connection itself — which
it did unreliably. Tool names are also the cheapest thing here to rename: they
are sent fresh with every request and persisted nowhere (`chatStore` is not a
persist store), unlike anything on the wire or on disk. The **files** stay
`tools/spaces.ts` and `handlers/spaces.ts`, because those are code.

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

## `VerseSummary.unit` — the one discriminant

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

## Rendered text must equal narrated text

`services/bible/verseSummaries.ts:10-17` records the rule: display and speech share one
string, or `WordHighlighter`'s word index space drifts from the alignment and the highlight
silently desyncs. **That is why posts are plain text.** Markdown would have to be stripped for
TTS and the two would no longer match.

`services/community/postUnits.ts` is therefore the single chunker, **and its output is a cache
key**: one unit per authored paragraph (the author chose those breaks — unlike Bible verses,
where `lib/readerParagraphs.ts` has to infer them), split at sentence boundaries only when a
paragraph exceeds `tts.speak`'s 4000-**byte** cap. Change how it splits and every existing
narration key changes with it, orphaning generated audio and pinned downloads.

## Where the reader had to grow

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
  reader store owns state, not loading" in [`reader.md`](reader.md). That one hardcoded `loadChapterSummaries` call
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

## Continuation — the one place a mistake produces wrong *audio*

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

## Audio, and why the server needs no new storage

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

## Signatures — what they prove, and what they don't

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

## The share code is an address, not a key

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

## Local-first ownership

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

## Sync and the backend

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

`space.request` was the first cross-user **write** (it appends a membership row, carrying the
caller's authenticated id and a name snapshot, into the owner's file; a requester can never set
its own status, and re-asking cannot clear a block). The second is a **sponsored narration**:
a reader narrating with a voice the owner lent to the shelf charges the owner's allowance, in
`users/{owner}/sponsored/{itemId}/` — counters only, written under the owner's terms and
removed with the item, the space, the profile and the account (see [`voices.md`](voices.md)).
`space.feed` is the cross-user **read** and answers only an accepted member, with projections
rather than stored records; `space.item` fetches one item's payload for the same members.
Signature verification server-side is defence in depth only, guarded on the sodium extension —
PHP has no private key, so it stores signatures and never mints them.

Avatars are the one exception to "nothing a user owns is served statically": an `<img src>`
needs a real URL, so they go to `storage/avatars/{sha256}.{ext}`, content-addressed and
world-readable once the URL is known. `public/.htaccess`'s CORS `FilesMatch` was extended to
image types so the native WebView can `fetch()` one into `mediaCache`.

## Verification

Two scripts, following `bible:verify`'s pattern rather than introducing a test runner:

- `npm run community:verify` — signing and share-code properties, plus the chunker's byte cap
  and determinism. Imports the real modules, which is why `postSignature.ts` and `spaceCode.ts`
  import nothing from the app.
- `npm run community:verify:api` — starts its own `php -S` in a temp docroot (so
  `public/storage` is never touched) and exercises the cross-user surface: approval gating,
  blocked subscribers, code rotation, expiry pruning, the feed projection leaking no uuid, and
  the ownership round trip.

## Reading across spaces

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

## Staying current — there is no push channel

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

## Known limitations

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
- **A shared plan or board is a snapshot with a manual republish** (see [`community-shared-items.md`](community-shared-items.md)). Deliberate, but
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
  (see [`community-moderation.md`](community-moderation.md)), with two gaps left on purpose: a **reader's block does not remove
  that person as a subscriber of the user's own spaces** — `Membership` is keyed by uuid and
  carries no author key, so the two identities cannot be matched without changing
  `space.request` — and the block list itself does not sync between the user's own devices.
  The owner's accept / deny / block of a subscriber is unchanged and unrelated.
