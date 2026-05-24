import { usePlaybackStore } from '@/store/playbackStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { Alignment } from '@/types/domain';
import { findCurrentWordIndex, fetchAlignment } from './alignment';
import { browserTts } from './browserTts';

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

class AmbientBus {
  private parent: AudioPlaybackManager;
  constructor(parent: AudioPlaybackManager) {
    this.parent = parent;
  }
  async load(url: string): Promise<void> {
    await this.parent._ambientLoad(url);
  }
  play(): void {
    this.parent._ambientPlay();
  }
  pause(): void {
    this.parent._ambientPause();
  }
  setVolume(v: number): void {
    this.parent._ambientSetVolume(v);
  }
  isPlaying(): boolean {
    return this.parent._ambientIsPlaying();
  }
}

class SpeechBus {
  private parent: AudioPlaybackManager;
  constructor(parent: AudioPlaybackManager) {
    this.parent = parent;
  }
  setVolume(v: number): void {
    this.parent._speechSetVolume(v);
  }
}

class AudioPlaybackManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private ttsGain: GainNode | null = null;
  private ambientGain: GainNode | null = null;

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
  private readonly DUCK_FACTOR = 0;
  private readonly DUCK_RAMP_SEC = 0.15;

  // ambient
  private ambientSource: AudioBufferSourceNode | null = null;
  private ambientBuffer: AudioBuffer | null = null;
  private ambientUrl: string | null = null;
  private ambientDecodeCache = new Map<string, AudioBuffer>();
  private ambientStopTimer: number | null = null;
  private readonly AMBIENT_FADE_SEC = 2;
  readonly ambient = new AmbientBus(this);
  readonly speech = new SpeechBus(this);

  /** Read-only access to the shared AudioContext (or null if never
   * created). Callers should use this rather than reaching into private
   * state — handy for cross-cutting concerns like iOS routing nudges. */
  getContext(): AudioContext | null {
    return this.ctx;
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
    this.applyDuckedGains();
    if (ducked) browserTts.duck();
    else browserTts.unduck();
  }

  private applyDuckedGains(): void {
    if (!this.ctx) return;
    const settings = useSettingsStore.getState();
    const factor = this.ducked ? this.DUCK_FACTOR : 1;
    const now = this.ctx.currentTime;
    const ramp = this.DUCK_RAMP_SEC;
    if (this.ttsGain) {
      const target = settings.speechVolume * factor;
      this.ttsGain.gain.cancelScheduledValues(now);
      this.ttsGain.gain.setValueAtTime(this.ttsGain.gain.value, now);
      this.ttsGain.gain.linearRampToValueAtTime(target, now + ramp);
    }
    if (this.ambientGain) {
      const target = settings.ambient.volume * factor;
      this.ambientGain.gain.cancelScheduledValues(now);
      this.ambientGain.gain.setValueAtTime(this.ambientGain.gain.value, now);
      this.ambientGain.gain.linearRampToValueAtTime(target, now + ramp);
    }
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
      this.ambientGain = this.ctx.createGain();
      this.ambientGain.gain.value = useSettingsStore.getState().ambient.volume;
      this.ambientGain.connect(this.master);
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  async playQueue(
    tracks: PlaybackTrack[],
    startIndex = 0,
    startWordIndex?: number,
  ): Promise<void> {
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

  /** Jump to a specific verse in the current queue, optionally at a word. */
  goToVerseIndex(verseIdx: number, wordIdx?: number): void {
    if (verseIdx < 0 || verseIdx >= this.queue.length) return;
    if (this.pauseTimer !== null) {
      clearTimeout(this.pauseTimer);
      this.pauseTimer = null;
    }
    this.currentIndex = verseIdx;
    if (wordIdx !== undefined) this.pendingSeekWord = wordIdx;
    void this.playCurrent();
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
    browserTts.stop();
    this.softEnded = false;
    if (this.softEndTimer !== null) {
      clearTimeout(this.softEndTimer);
      this.softEndTimer = null;
    }
    this.resetQueue();
    this._ambientPause();
    usePlaybackStore.getState().setStatus('idle');
    usePlaybackStore.getState().setCurrent(null);
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

  // ─── Ambient bus (called via this.ambient) ───────────────────────────

  async _ambientLoad(url: string): Promise<void> {
    if (this.ambientUrl === url && this.ambientBuffer) return;
    const cached = this.ambientDecodeCache.get(url);
    if (cached) {
      this.ambientBuffer = cached;
      this.ambientUrl = url;
      return;
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ambient fetch failed: ${res.status}`);
    const arr = await res.arrayBuffer();
    const ctx = this.ensureContext();
    const buf = await ctx.decodeAudioData(arr.slice(0));
    this.ambientDecodeCache.set(url, buf);
    this.ambientBuffer = buf;
    this.ambientUrl = url;
  }

  _ambientPlay(): void {
    if (!this.ambientBuffer) return;
    const ctx = this.ensureContext();

    // Cancel any pending stop (e.g. user re-played during fade-out).
    if (this.ambientStopTimer !== null) {
      clearTimeout(this.ambientStopTimer);
      this.ambientStopTimer = null;
    }

    if (!this.ambientSource) {
      const src = ctx.createBufferSource();
      src.buffer = this.ambientBuffer;
      src.loop = true;
      src.connect(this.ambientGain ?? ctx.destination);
      src.start(0);
      this.ambientSource = src;
      // Begin silent so the upcoming ramp acts as a fade-in.
      if (this.ambientGain) {
        this.ambientGain.gain.cancelScheduledValues(ctx.currentTime);
        this.ambientGain.gain.setValueAtTime(0, ctx.currentTime);
      }
    }

    if (this.ambientGain) {
      const target = useSettingsStore.getState().ambient.volume;
      const now = ctx.currentTime;
      this.ambientGain.gain.cancelScheduledValues(now);
      this.ambientGain.gain.setValueAtTime(this.ambientGain.gain.value, now);
      this.ambientGain.gain.linearRampToValueAtTime(
        target,
        now + this.AMBIENT_FADE_SEC,
      );
    }
    usePlaybackStore.getState().setAmbientPlaying(true);
  }

  _ambientPause(): void {
    if (!this.ambientSource) {
      usePlaybackStore.getState().setAmbientPlaying(false);
      return;
    }
    const src = this.ambientSource;

    if (this.ctx && this.ambientGain) {
      const now = this.ctx.currentTime;
      this.ambientGain.gain.cancelScheduledValues(now);
      this.ambientGain.gain.setValueAtTime(this.ambientGain.gain.value, now);
      this.ambientGain.gain.linearRampToValueAtTime(
        0,
        now + this.AMBIENT_FADE_SEC,
      );
    }

    if (this.ambientStopTimer !== null) {
      clearTimeout(this.ambientStopTimer);
    }
    this.ambientStopTimer = window.setTimeout(() => {
      try {
        src.stop();
      } catch {
        /* ignore */
      }
      if (this.ambientSource === src) {
        this.ambientSource = null;
      }
      this.ambientStopTimer = null;
    }, this.AMBIENT_FADE_SEC * 1000 + 50);

    usePlaybackStore.getState().setAmbientPlaying(false);
  }

  _ambientSetVolume(v: number): void {
    const clamped = Math.max(0, Math.min(1, v));
    if (!this.ctx || !this.ambientGain) {
      useSettingsStore.getState().setAmbient({ volume: clamped });
      return;
    }
    const factor = this.ducked ? this.DUCK_FACTOR : 1;
    const now = this.ctx.currentTime;
    this.ambientGain.gain.cancelScheduledValues(now);
    this.ambientGain.gain.setValueAtTime(this.ambientGain.gain.value, now);
    this.ambientGain.gain.linearRampToValueAtTime(clamped * factor, now + 0.15);
    useSettingsStore.getState().setAmbient({ volume: clamped });
  }

  _ambientIsPlaying(): boolean {
    return this.ambientSource !== null;
  }

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
