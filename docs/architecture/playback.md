# Playback

> Part of the architecture notes indexed in [`CLAUDE.md`](../../CLAUDE.md). Moved there verbatim; "above" and "below" may refer to sections that now live in a sibling file.

## Reading hosts — how playback finds its verses

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

## Audio: why playback is an HTMLAudioElement, not Web Audio
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

## The feed loop, and why the track player is injectable

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
