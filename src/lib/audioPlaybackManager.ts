import { usePlaybackStore } from '@/store/playbackStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { Alignment } from '@/types/domain';
import { findCurrentWordIndex, fetchAlignment } from './alignment';
import { browserTts } from './browserTts';
import { cancelAutoPlayPrefetch } from './autoPlay';
import { AmbientAudioBus } from './ambientAudioBus';

export type PlaybackTrack = {
  messageId: string;
  verseIndex: number;
  audioUrl: string;
  alignmentUrl?: string;
  /** Wait this many ms before advancing to the next track. Music keeps
   * playing during the gap (ambient runs on a separate bus). */
  pauseAfterMs?: number;
  /** When false, the per-word highlight tick is suppressed — used for
   * heading / verse-number announcements whose alignment doesn't map onto
   * the rendered verse text. Defaults to true. */
  highlightVerse?: boolean;
};

type LoadedTrack = PlaybackTrack & {
  buffer: AudioBuffer;
  alignment: Alignment;
};

class SpeechBus {
  private parent: AudioPlaybackManager;
  constructor(parent: AudioPlaybackManager) {
    this.parent = parent;
  }
  setVolume(v: number): void {
    this.parent._speechSetVolume(v);
  }
}

/**
 * The Web Audio engine for OpenAI-TTS verse playback. A singleton (`audioPlayback`)
 * because it owns one AudioContext and one playback queue for the whole app.
 *
 * Five concerns live here, grouped by the section banners below:
 *   1. AudioContext graph + ducking — node setup, mic-open volume ramps
 *   2. Speech queue: scheduling & playback — playQueue/enqueue/playCurrent/handleEnded/tick
 *   3. Transport — pause/resume/stop/next/softEnd
 *   4. Seek & playback rate — word-level seeking, rate, loop
 *   5. Ambient music bus — extracted to `ambientAudioBus.ts`; this owns the
 *      shared graph + speech queue and routes ducking to the bus.
 */
class AudioPlaybackManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private ttsGain: GainNode | null = null;

  private source: AudioBufferSourceNode | null = null;
  private queue: PlaybackTrack[] = [];
  private currentIndex = 0;
  private currentLoaded: LoadedTrack | null = null;
  private currentStartTime = 0; // ctx.currentTime when source started
  private currentOffset = 0; // audio-time (seconds into the buffer) when we started
  private currentRate = 1;
  private loopCurrent = false;
  private tickHandle: number | null = null;
  private decodeCache = new Map<string, AudioBuffer>();
  private alignmentCache = new Map<string, Alignment>();
  // When set, the next track to finish loading will start at the given word
  // index instead of from the beginning. Consumed (cleared) on use.
  private pendingSeekWord: number | null = null;
  // setTimeout handle for the gap between two consecutive tracks (when the
  // just-finished track set pauseAfterMs > 0). Cleared on stop/pause/next/etc.
  private pauseTimer: number | null = null;
  // Queue has played to the end but we left state intact so a follow-up
  // enqueue can bridge into one continuous playlist. Set in softEnd, cleared
  // by enqueue/playQueue/stop.
  private softEnded = false;
  private softEndTimer: number | null = null;
  private readonly SOFT_END_GRACE_MS = 60_000;

  // Ducking — set while the mic is open. Fully mutes verse playback and
  // ambient (factor 0) so the speech recognizer hears only the user, not
  // any audio bleeding from the speaker into the mic.
  private ducked = false;
  // True when ducking paused an in-progress verse reading, so unducking knows
  // to resume it (rather than leaving it advancing silently behind the mic).
  private duckPausedReading = false;
  private readonly DUCK_FACTOR = 0;
  private readonly DUCK_RAMP_SEC = 0.15;

  // Streaming: a reading's verses are generated and appended one-by-one so the
  // first plays ASAP. `feeding` is true while a stream is still supplying
  // tracks; `awaitingFeed` means playback drained to the end and is waiting for
  // the next track. `feedGen` invalidates a stale stream when a new one starts
  // or playback is stopped (see beginFeed/appendTracks/endFeed).
  private feeding = false;
  private awaitingFeed = false;
  private feedGen = 0;

  // One-shot assistant-reply source (see interject) — plays over the speech
  // bus while the reading is paused, without touching the verse queue.
  private interjectionSrc: AudioBufferSourceNode | null = null;

  // Ambient music runs on its own bus (created with the context). The public
  // `ambient` facade tolerates calls before the context exists (e.g. a volume
  // change with nothing playing yet) by persisting to settings.
  private ambientBus: AmbientAudioBus | null = null;
  readonly ambient = {
    load: (url: string): Promise<void> => {
      this.ensureContext();
      return this.ambientBus!.load(url);
    },
    play: (): void => {
      this.ensureContext();
      this.ambientBus!.play();
    },
    pause: (): void => {
      if (this.ambientBus) this.ambientBus.pause();
      else usePlaybackStore.getState().setAmbientPlaying(false);
    },
    setVolume: (v: number): void => {
      if (this.ambientBus) this.ambientBus.setVolume(v);
      else useSettingsStore.getState().setAmbient({ volume: Math.max(0, Math.min(1, v)) });
    },
    isPlaying: (): boolean => this.ambientBus?.isPlaying() ?? false,
  };
  readonly speech = new SpeechBus(this);

  // ─── 1. AudioContext graph + ducking ─────────────────────────────────

  /** Read-only access to the shared AudioContext (or null if never
   * created). Callers should use this rather than reaching into private
   * state — handy for cross-cutting concerns like iOS routing nudges. */
  getContext(): AudioContext | null {
    return this.ctx;
  }

  /** True while the queue has reached its natural end but state is held
   * for the playlist-bridge grace window. Used by the auto-play
   * controller to distinguish a natural end from a user-initiated stop. */
  isSoftEnded(): boolean {
    return this.softEnded;
  }

  /**
   * Duck (lower) or unduck verse playback + ambient music. Used while the
   * mic is open so the user's voice carries cleanly over playback. The
   * settings volumes are unchanged — only the live gain is scaled.
   *
   * Also propagates to the browser TTS engine (which has no per-utterance
   * volume control), pausing/resuming SpeechSynthesis as the analog.
   */
  setDucked(ducked: boolean): void {
    if (this.ducked === ducked) return;
    this.ducked = ducked;
    if (ducked) {
      // Pause the verse reading so it doesn't keep advancing (silently) while
      // the mic is open — ducking the gain alone leaves the source playing, so
      // the user would lose their place. Remember to resume on unduck.
      // (Browser-voice readings pause via browserTts.duck() below.)
      this.duckPausedReading =
        usePlaybackStore.getState().status === 'playing' && this.source !== null;
      if (this.duckPausedReading) this.pause();
      browserTts.duck();
    } else {
      browserTts.unduck();
      if (this.duckPausedReading) {
        this.duckPausedReading = false;
        this.resume();
      }
    }
    this.applyDuckedGains();
  }

  private applyDuckedGains(): void {
    if (!this.ctx) return;
    // iOS suspends the AudioContext while the mic is open (getUserMedia). A
    // gain ramp scheduled against a suspended context's frozen clock never
    // completes — which left verse/ambient audio stuck quiet *after talking*
    // until a later foreground event happened to advance the clock. Resume
    // first so the ramp runs now; the onstatechange handler in ensureContext
    // re-asserts these gains if the resume lands after this call.
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    const settings = useSettingsStore.getState();
    const factor = this.ducked ? this.DUCK_FACTOR : 1;
    const now = this.ctx.currentTime;
    const ramp = this.DUCK_RAMP_SEC;
    const rampGain = (node: GainNode | null, target: number): void => {
      if (!node) return;
      node.gain.cancelScheduledValues(now);
      node.gain.setValueAtTime(node.gain.value, now);
      node.gain.linearRampToValueAtTime(target, now + ramp);
    };
    rampGain(this.ttsGain, settings.speechVolume * factor);
    // The ambient bus owns its own gain; let it apply the same duck factor.
    this.ambientBus?.setDuckFactor(factor);
  }

  /** Must be called inside a user gesture handler on iOS. */
  ensureContext(): AudioContext {
    if (!this.ctx) {
      const Ctor =
        (window as typeof window & {
          webkitAudioContext?: typeof AudioContext;
        }).AudioContext ||
        (window as typeof window & {
          webkitAudioContext?: typeof AudioContext;
        }).webkitAudioContext!;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 1;
      this.master.connect(this.ctx.destination);
      this.ttsGain = this.ctx.createGain();
      this.ttsGain.gain.value = useSettingsStore.getState().speechVolume;
      this.ttsGain.connect(this.master);
      // Ambient runs on its own bus, parallel to the speech gain into master.
      this.ambientBus = new AmbientAudioBus(this.ctx, this.master, () =>
        this.maybeSuspendContext(),
      );
      // When iOS resumes the context after a suspend (mic capture or
      // backgrounding), re-assert the current gain targets. A ramp scheduled
      // while suspended can be dropped; without this, audio could stay muted
      // after talking until some later foreground re-render fixed it.
      this.ctx.onstatechange = () => {
        if (this.ctx?.state === 'running') this.applyDuckedGains();
      };
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  // ─── 2. Speech queue: scheduling & playback ──────────────────────────

  async playQueue(
    tracks: PlaybackTrack[],
    startIndex = 0,
    startWordIndex?: number,
  ): Promise<void> {
    // A fresh playback supersedes any pending auto-play continuation.
    cancelAutoPlayPrefetch();
    browserTts.stop();
    this.softEnded = false;
    if (this.softEndTimer !== null) {
      clearTimeout(this.softEndTimer);
      this.softEndTimer = null;
    }
    this.resetQueue();
    this.queue = tracks;
    this.currentIndex = Math.max(0, Math.min(tracks.length - 1, startIndex));
    if (startWordIndex !== undefined) this.pendingSeekWord = startWordIndex;
    if (tracks.length === 0) return;
    await this.playCurrent();
  }

  /** Jump to a specific verse in the current queue, optionally at a word.
   * `verseIdx` is the verse's position in `message.verses`, not the queue
   * index — heading and verse-number announcement tracks sit between
   * verse tracks, so we have to look up the actual verse track. Returns false
   * when that verse isn't in the current queue (e.g. the queue was sliced to
   * start mid-message), so the caller can reload it instead. */
  goToVerseIndex(verseIdx: number, wordIdx?: number): boolean {
    if (verseIdx < 0) return false;
    const queueIdx = this.queue.findIndex(
      (t) => t.verseIndex === verseIdx && t.highlightVerse !== false,
    );
    if (queueIdx < 0) return false;
    if (this.pauseTimer !== null) {
      clearTimeout(this.pauseTimer);
      this.pauseTimer = null;
    }
    this.currentIndex = queueIdx;
    if (wordIdx !== undefined) this.pendingSeekWord = wordIdx;
    void this.playCurrent();
    return true;
  }

  // ─── Streaming a reading's verses in as they're generated ────────────

  /** Open a streaming session and return its generation token. Bumping the
   * generation invalidates any prior stream, so an interrupting reading (or a
   * stop) cleanly supersedes one still in flight. The first track is started
   * via enqueue/playQueue by the caller; subsequent tracks come through
   * appendTracks(tracks, gen). */
  beginFeed(): number {
    this.feeding = true;
    this.awaitingFeed = false;
    return ++this.feedGen;
  }

  /** True while `gen` is still the active streaming session. */
  isFeed(gen: number): boolean {
    return this.feeding && gen === this.feedGen;
  }

  /** Append streamed tracks to the live queue (no chapter-pause bridge, unlike
   * enqueue — these are the same reading's later verses). Resumes playback if
   * it had drained to the end while waiting for them. Ignores stale streams. */
  appendTracks(tracks: PlaybackTrack[], gen: number): void {
    if (tracks.length === 0 || gen !== this.feedGen) return;
    if (this.queue.length === 0) {
      void this.playQueue(tracks);
      return;
    }
    this.queue = [...this.queue, ...tracks];
    if (this.awaitingFeed) {
      // Playback was parked at the end waiting for this; currentIndex already
      // points at the first freshly-appended track.
      this.awaitingFeed = false;
      void this.playCurrent();
    }
  }

  /** Close a streaming session. If playback had drained to the end while we
   * were still generating (awaitingFeed), finalize with a normal soft-end so
   * auto-continuation can take over. */
  endFeed(gen: number): void {
    if (gen !== this.feedGen) return;
    this.feeding = false;
    if (this.awaitingFeed) {
      this.awaitingFeed = false;
      this.softEnd();
    }
  }

  /**
   * Append to the active queue; if nothing is playing/queued, start fresh.
   * Lets multiple back-to-back read_verses tool calls within a single AI
   * response play in order instead of stomping on each other.
   */
  async enqueue(tracks: PlaybackTrack[]): Promise<void> {
    if (tracks.length === 0) return;
    // Browser TTS owns playback — its queue is the active one. Stop it so
    // OpenAI audio can take over instead of double-playing.
    if (browserTts.isActive()) {
      browserTts.stop();
    }
    const stillPlaying =
      this.queue.length > 0 && this.currentIndex < this.queue.length;
    const bridgingFromSoftEnd = this.softEnded && this.queue.length > 0;

    if (stillPlaying || bridgingFromSoftEnd) {
      // Bridge the boundary between two readings with a chapter-length
      // pause — the prior queue's tail item was tagged pauseAfterMs:0
      // because it didn't know more was coming.
      const bridge = useSettingsStore.getState().pauseBetweenChaptersMs;
      if (bridge > 0) {
        const tailIdx = this.queue.length - 1;
        const tail = this.queue[tailIdx];
        this.queue[tailIdx] = { ...tail, pauseAfterMs: bridge };
        // If the tail is the track currently playing, patch the loaded
        // snapshot too — handleEnded reads from `currentLoaded`, not the
        // queue, so without this the bridge would be lost.
        if (this.currentLoaded && this.currentIndex === tailIdx) {
          this.currentLoaded = { ...this.currentLoaded, pauseAfterMs: bridge };
        }
      }
      const firstNewIdx = this.queue.length;
      this.queue = [...this.queue, ...tracks];

      if (bridgingFromSoftEnd) {
        // Cancel the hard-stop fallback and resume playback from the first
        // newly-appended track, after the chapter pause.
        this.softEnded = false;
        if (this.softEndTimer !== null) {
          clearTimeout(this.softEndTimer);
          this.softEndTimer = null;
        }
        this.currentIndex = firstNewIdx;
        const advance = () => {
          this.pauseTimer = null;
          void this.playCurrent();
        };
        if (bridge > 0) {
          if (this.pauseTimer !== null) clearTimeout(this.pauseTimer);
          this.pauseTimer = window.setTimeout(advance, bridge);
        } else {
          advance();
        }
      }
      return;
    }
    await this.playQueue(tracks);
  }

  private async playCurrent(): Promise<void> {
    if (this.currentIndex >= this.queue.length) {
      this.stop();
      return;
    }
    const track = this.queue[this.currentIndex];
    usePlaybackStore.getState().setStatus('loading');

    const [buffer, alignment] = await Promise.all([
      this.loadBuffer(track.audioUrl),
      track.alignmentUrl
        ? this.loadAlignment(track.alignmentUrl)
        : Promise.resolve({ words: [] } as Alignment),
    ]);

    this.currentLoaded = { ...track, buffer, alignment };

    // Apply any pending word-seek (e.g. from tap-on-word before the track was loaded).
    let startOffset = 0;
    let startWordIdx = -1;
    if (this.pendingSeekWord != null) {
      const w = alignment.words[this.pendingSeekWord];
      if (w) {
        startOffset = w.start;
        startWordIdx = this.pendingSeekWord;
      }
      this.pendingSeekWord = null;
    }

    this.currentOffset = startOffset;
    this.startSource(buffer, startOffset);

    usePlaybackStore.getState().setCurrent({
      messageId: track.messageId,
      verseIndex: track.verseIndex,
      totalVerses: this.queue.length,
      audioUrl: track.audioUrl,
      alignmentUrl: track.alignmentUrl,
      position: startOffset,
      duration: buffer.duration,
      currentWordIndex: startWordIdx,
      isVerse: track.highlightVerse !== false,
    });
    usePlaybackStore.getState().setStatus('playing');
  }

  private startSource(buffer: AudioBuffer, offset: number): void {
    const ctx = this.ensureContext();
    if (this.source) {
      try {
        this.source.onended = null;
        this.source.stop();
      } catch {
        /* ignore */
      }
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = this.currentRate;
    src.connect(this.ttsGain ?? ctx.destination);
    src.onended = () => this.handleEnded();
    src.start(0, offset);
    this.source = src;
    this.currentStartTime = ctx.currentTime;
    this.currentOffset = offset;
    this.startTick();
  }

  private handleEnded(): void {
    if (usePlaybackStore.getState().status === 'paused') return;
    if (this.loopCurrent && this.currentLoaded) {
      // Replay the same verse from the start.
      this.currentOffset = 0;
      this.startSource(this.currentLoaded.buffer, 0);
      usePlaybackStore.getState().patchCurrent({ position: 0, currentWordIndex: -1 });
      return;
    }
    const justFinished = this.currentLoaded;
    this.currentIndex++;
    if (this.currentIndex >= this.queue.length) {
      if (this.feeding) {
        // A reading is still being streamed in (verse N+1's TTS isn't ready
        // yet); wait for the next appendTracks instead of soft-ending — which
        // would otherwise hand off to auto-continuation mid-reading. Keep
        // `current` set so no thinking drone fires during the brief wait.
        this.awaitingFeed = true;
        usePlaybackStore.getState().setStatus('loading');
        return;
      }
      this.softEnd();
      return;
    }
    const advance = () => {
      this.pauseTimer = null;
      void this.playCurrent();
    };
    const gap = justFinished?.pauseAfterMs ?? 0;
    if (gap > 0) {
      if (this.pauseTimer !== null) clearTimeout(this.pauseTimer);
      this.pauseTimer = window.setTimeout(advance, gap);
    } else {
      advance();
    }
  }

  private startTick(): void {
    if (this.tickHandle !== null) return;
    const tick = () => {
      if (!this.ctx || !this.currentLoaded) {
        this.tickHandle = null;
        return;
      }
      if (usePlaybackStore.getState().status !== 'playing') {
        this.tickHandle = null;
        return;
      }
      const elapsed =
        (this.ctx.currentTime - this.currentStartTime) * this.currentRate +
        this.currentOffset;
      // Heading/verse-number tracks share their alignment with the
      // announcement audio (e.g. "Verse 16"), NOT the rendered verse text.
      // Skip the lookup so the WordHighlighter doesn't underline the wrong
      // words on the verse below the announcement.
      const highlight = this.currentLoaded.highlightVerse !== false;
      const wordIndex = highlight
        ? findCurrentWordIndex(this.currentLoaded.alignment, elapsed)
        : -1;
      usePlaybackStore.getState().patchCurrent({
        position: elapsed,
        currentWordIndex: wordIndex,
      });
      this.tickHandle = requestAnimationFrame(tick);
    };
    this.tickHandle = requestAnimationFrame(tick);
  }

  // ─── 3. Transport: pause / resume / stop / next ──────────────────────

  pause(): void {
    if (browserTts.isActive()) {
      browserTts.pause();
      return;
    }
    if (!this.source || !this.ctx) return;
    if (usePlaybackStore.getState().status !== 'playing') return;
    const elapsed =
      (this.ctx.currentTime - this.currentStartTime) * this.currentRate +
      this.currentOffset;
    try {
      this.source.onended = null;
      this.source.stop();
    } catch {
      /* ignore */
    }
    this.source = null;
    this.currentOffset = elapsed;
    usePlaybackStore.getState().setStatus('paused');
    if (this.tickHandle !== null) {
      cancelAnimationFrame(this.tickHandle);
      this.tickHandle = null;
    }
    if (this.pauseTimer !== null) {
      clearTimeout(this.pauseTimer);
      this.pauseTimer = null;
    }
  }

  resume(): void {
    if (browserTts.isActive()) {
      browserTts.resume();
      return;
    }
    if (!this.currentLoaded) return;
    if (usePlaybackStore.getState().status !== 'paused') return;
    this.startSource(this.currentLoaded.buffer, this.currentOffset);
    usePlaybackStore.getState().setStatus('playing');
  }

  toggle(): void {
    if (browserTts.isActive()) {
      browserTts.toggle();
      return;
    }
    const status = usePlaybackStore.getState().status;
    if (status === 'playing') this.pause();
    else if (status === 'paused') this.resume();
  }

  /**
   * Play a one-shot utterance (an assistant reply) over the speech bus,
   * pausing the current reading for its duration and resuming after — without
   * touching the verse queue. The reply is Web Audio, so it plays cleanly even
   * when the reading is on the browser-TTS engine (pause()/resume() route to
   * whichever engine is reading). If nothing is reading, it simply plays.
   */
  async interject(audioUrl: string): Promise<void> {
    let buffer: AudioBuffer;
    try {
      buffer = await this.loadBuffer(audioUrl);
    } catch {
      return;
    }
    const ctx = this.ensureContext();
    // Pause whatever's reading so the reply has the floor; resume it on end.
    const reading = usePlaybackStore.getState().status === 'playing';
    if (reading) this.pause();
    const resume = (): void => {
      if (reading) this.resume();
    };
    if (this.interjectionSrc) {
      try {
        this.interjectionSrc.onended = null;
        this.interjectionSrc.stop();
      } catch {
        /* ignore */
      }
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.ttsGain ?? ctx.destination);
    src.onended = () => {
      if (this.interjectionSrc === src) this.interjectionSrc = null;
      resume();
    };
    this.interjectionSrc = src;
    src.start(0);
  }

  /**
   * Queue played to completion. Tear down the audio source + tick but
   * preserve queue, currentIndex, and currentLoaded so a follow-up enqueue
   * can bridge into the same playlist. Ambient stays on through the grace
   * window; if no new reading arrives, a real stop fires after
   * SOFT_END_GRACE_MS so music doesn't play indefinitely.
   */
  private softEnd(): void {
    if (this.source) {
      try {
        this.source.onended = null;
        this.source.stop();
      } catch {
        /* ignore */
      }
      this.source = null;
    }
    if (this.tickHandle !== null) {
      cancelAnimationFrame(this.tickHandle);
      this.tickHandle = null;
    }
    if (this.pauseTimer !== null) {
      clearTimeout(this.pauseTimer);
      this.pauseTimer = null;
    }
    this.softEnded = true;
    usePlaybackStore.getState().setStatus('idle');
    usePlaybackStore.getState().setCurrent(null);
    if (this.softEndTimer !== null) clearTimeout(this.softEndTimer);
    this.softEndTimer = window.setTimeout(() => {
      this.softEndTimer = null;
      this.stop();
    }, this.SOFT_END_GRACE_MS);
  }

  stop(): void {
    // User-initiated stop also kills any pending auto-play continuation and
    // invalidates any in-flight streaming session (bump the generation so its
    // remaining appendTracks no-op).
    cancelAutoPlayPrefetch();
    browserTts.stop();
    this.feeding = false;
    this.awaitingFeed = false;
    this.feedGen++;
    if (this.interjectionSrc) {
      try {
        this.interjectionSrc.onended = null;
        this.interjectionSrc.stop();
      } catch {
        /* ignore */
      }
      this.interjectionSrc = null;
    }
    this.softEnded = false;
    if (this.softEndTimer !== null) {
      clearTimeout(this.softEndTimer);
      this.softEndTimer = null;
    }
    this.resetQueue();
    this.ambient.pause();
    usePlaybackStore.getState().setStatus('idle');
    usePlaybackStore.getState().setCurrent(null);
    this.maybeSuspendContext();
  }

  /**
   * Suspend the AudioContext once nothing is using it so iOS can power down
   * the audio hardware (a `running` context keeps the audio session — and the
   * CPU — awake, which warms the device long after reading stops). Safe to
   * call repeatedly: it no-ops while a tick, ambient source, or non-idle
   * status is live, and ensureContext() resumes the (already-unlocked) context
   * on the next play without needing a fresh user gesture.
   */
  private maybeSuspendContext(): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    if (this.tickHandle !== null) return;
    if (this.ambientBus?.isPlaying()) return;
    if (usePlaybackStore.getState().status !== 'idle') return;
    void this.ctx.suspend();
  }

  /** Tear down the TTS queue without touching ambient or playback-store state. */
  private resetQueue(): void {
    if (this.source) {
      try {
        this.source.onended = null;
        this.source.stop();
      } catch {
        /* ignore */
      }
      this.source = null;
    }
    if (this.tickHandle !== null) {
      cancelAnimationFrame(this.tickHandle);
      this.tickHandle = null;
    }
    this.queue = [];
    this.currentIndex = 0;
    this.currentLoaded = null;
    this.currentOffset = 0;
    this.pendingSeekWord = null;
    if (this.pauseTimer !== null) {
      clearTimeout(this.pauseTimer);
      this.pauseTimer = null;
    }
  }

  next(): void {
    if (this.currentIndex >= this.queue.length - 1) return;
    if (this.pauseTimer !== null) {
      clearTimeout(this.pauseTimer);
      this.pauseTimer = null;
    }
    this.currentIndex++;
    void this.playCurrent();
  }

  /** Read-only view of the queued tracks (for the playback controller's
   * rebuild logic). Returns a shallow copy to discourage mutation. */
  getQueueSnapshot(): { tracks: PlaybackTrack[]; currentIndex: number } {
    return { tracks: this.queue.slice(), currentIndex: this.currentIndex };
  }

  /**
   * Replace the contiguous block of upcoming tracks belonging to `messageId`
   * (the block immediately after the currently-playing track) with
   * `newTracks`. Used when settings change mid-playlist so the rest of the
   * current reading honors the new headings / verse-number / pause options.
   *
   * If no upcoming tracks for `messageId` are found, the new tracks are
   * inserted right after `currentIndex` (so a freshly-enabled toggle takes
   * effect from the next item).
   */
  replaceUpcomingFor(messageId: string, newTracks: PlaybackTrack[]): void {
    const startIdx = this.queue.findIndex(
      (t, i) => i > this.currentIndex && t.messageId === messageId,
    );
    if (startIdx < 0) {
      this.queue = [
        ...this.queue.slice(0, this.currentIndex + 1),
        ...newTracks,
        ...this.queue.slice(this.currentIndex + 1),
      ];
      return;
    }
    let endIdx = startIdx;
    while (
      endIdx < this.queue.length &&
      this.queue[endIdx].messageId === messageId
    ) {
      endIdx++;
    }
    this.queue = [
      ...this.queue.slice(0, startIdx),
      ...newTracks,
      ...this.queue.slice(endIdx),
    ];
  }

  previous(): void {
    if (this.currentIndex <= 0) return;
    if (this.pauseTimer !== null) {
      clearTimeout(this.pauseTimer);
      this.pauseTimer = null;
    }
    this.currentIndex--;
    void this.playCurrent();
  }

  /** Jump to an absolute word index within the currently-loaded verse. */
  // ─── 4. Seek & playback rate ─────────────────────────────────────────

  seekToWord(wordIndex: number): void {
    if (!this.currentLoaded || !this.ctx) return;
    const { alignment, buffer } = this.currentLoaded;
    if (wordIndex < 0 || wordIndex >= alignment.words.length) return;
    const targetTime = alignment.words[wordIndex].start;
    const wasPlaying = usePlaybackStore.getState().status === 'playing';
    if (this.source) {
      try {
        this.source.onended = null;
        this.source.stop();
      } catch {
        /* ignore */
      }
      this.source = null;
    }
    if (wasPlaying) {
      this.startSource(buffer, targetTime);
    } else {
      this.currentOffset = targetTime;
      usePlaybackStore.getState().patchCurrent({
        position: targetTime,
        currentWordIndex: wordIndex,
      });
    }
  }

  /** Jump backward/forward by `delta` words within the current verse. */
  seekByWord(delta: number): void {
    if (!this.currentLoaded || !this.ctx) return;
    const { alignment, buffer } = this.currentLoaded;
    if (alignment.words.length === 0) return;

    const position = this.getCurrentPosition();
    let idx = findCurrentWordIndex(alignment, position);
    if (idx === -1) {
      // In a gap — anchor to the nearest preceding word.
      for (let i = alignment.words.length - 1; i >= 0; i--) {
        if (alignment.words[i].start <= position) {
          idx = i;
          break;
        }
      }
    }
    if (idx === -1 && delta > 0) idx = -1;
    const target = Math.max(0, Math.min(alignment.words.length - 1, idx + delta));
    const targetTime = alignment.words[target].start;

    const wasPlaying = usePlaybackStore.getState().status === 'playing';
    if (this.source) {
      try {
        this.source.onended = null;
        this.source.stop();
      } catch {
        /* ignore */
      }
      this.source = null;
    }
    if (wasPlaying) {
      this.startSource(buffer, targetTime);
    } else {
      this.currentOffset = targetTime;
      usePlaybackStore.getState().patchCurrent({
        position: targetTime,
        currentWordIndex: target,
      });
    }
  }

  /** Change playback rate without losing position. */
  setPlaybackRate(rate: number): void {
    const clamped = Math.max(0.25, Math.min(4, rate));
    if (browserTts.isActive()) {
      browserTts.setRate(clamped);
      this.currentRate = clamped;
      return;
    }
    if (this.ctx && this.source && usePlaybackStore.getState().status === 'playing') {
      const now = this.ctx.currentTime;
      const elapsed =
        (now - this.currentStartTime) * this.currentRate + this.currentOffset;
      this.currentOffset = elapsed;
      this.currentStartTime = now;
      this.source.playbackRate.value = clamped;
    }
    this.currentRate = clamped;
  }

  getPlaybackRate(): number {
    return this.currentRate;
  }

  setLoopCurrent(loop: boolean): void {
    this.loopCurrent = loop;
  }

  isLoopCurrent(): boolean {
    return this.loopCurrent;
  }

  private getCurrentPosition(): number {
    if (!this.ctx) return this.currentOffset;
    if (!this.source) return this.currentOffset;
    return (
      (this.ctx.currentTime - this.currentStartTime) * this.currentRate +
      this.currentOffset
    );
  }

  isPlaying(messageId: string): boolean {
    const cur = usePlaybackStore.getState().current;
    return (
      !!cur &&
      cur.messageId === messageId &&
      usePlaybackStore.getState().status === 'playing'
    );
  }

  // ─── Buffer & alignment loaders ──────────────────────────────────────

  private async loadBuffer(url: string): Promise<AudioBuffer> {
    const cached = this.decodeCache.get(url);
    if (cached) return cached;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`audio fetch failed: ${res.status}`);
    const arr = await res.arrayBuffer();
    const ctx = this.ensureContext();
    const buf = await ctx.decodeAudioData(arr.slice(0));
    this.decodeCache.set(url, buf);
    return buf;
  }

  private async loadAlignment(url: string): Promise<Alignment> {
    const cached = this.alignmentCache.get(url);
    if (cached) return cached;
    const al = await fetchAlignment(url);
    this.alignmentCache.set(url, al);
    return al;
  }

  // ─── Speech-bus volume (ambient bus lives in ambientAudioBus.ts) ─────

  _speechSetVolume(v: number): void {
    const clamped = Math.max(0, Math.min(1, v));
    if (!this.ctx || !this.ttsGain) {
      useSettingsStore.getState().setSpeechVolume(clamped);
      return;
    }
    const factor = this.ducked ? this.DUCK_FACTOR : 1;
    const now = this.ctx.currentTime;
    this.ttsGain.gain.cancelScheduledValues(now);
    this.ttsGain.gain.setValueAtTime(this.ttsGain.gain.value, now);
    this.ttsGain.gain.linearRampToValueAtTime(clamped * factor, now + 0.15);
    useSettingsStore.getState().setSpeechVolume(clamped);
  }
}

export const audioPlayback = new AudioPlaybackManager();
