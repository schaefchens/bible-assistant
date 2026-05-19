import { usePlaybackStore } from '@/store/playbackStore';
import type { Alignment } from '@/types/domain';
import { findCurrentWordIndex, fetchAlignment } from './alignment';

export type PlaybackTrack = {
  messageId: string;
  verseIndex: number;
  audioUrl: string;
  alignmentUrl?: string;
};

type LoadedTrack = PlaybackTrack & {
  buffer: AudioBuffer;
  alignment: Alignment;
};

class AudioPlaybackManager {
  private ctx: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private queue: PlaybackTrack[] = [];
  private currentIndex = 0;
  private currentLoaded: LoadedTrack | null = null;
  private currentStartTime = 0; // ctx.currentTime when source started
  private currentOffset = 0; // seconds into the buffer when we started
  private tickHandle: number | null = null;
  private decodeCache = new Map<string, AudioBuffer>();
  private alignmentCache = new Map<string, Alignment>();
  // When set, the next track to finish loading will start at the given word
  // index instead of from the beginning. Consumed (cleared) on use.
  private pendingSeekWord: number | null = null;

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
    this.stop();
    this.queue = tracks;
    this.currentIndex = Math.max(0, Math.min(tracks.length - 1, startIndex));
    if (startWordIndex !== undefined) this.pendingSeekWord = startWordIndex;
    if (tracks.length === 0) return;
    await this.playCurrent();
  }

  /** Jump to a specific verse in the current queue, optionally at a word. */
  goToVerseIndex(verseIdx: number, wordIdx?: number): void {
    if (verseIdx < 0 || verseIdx >= this.queue.length) return;
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
    const hasActiveQueue =
      this.queue.length > 0 && this.currentIndex < this.queue.length;
    if (hasActiveQueue) {
      this.queue = [...this.queue, ...tracks];
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
    src.connect(ctx.destination);
    src.onended = () => this.handleEnded();
    src.start(0, offset);
    this.source = src;
    this.currentStartTime = ctx.currentTime;
    this.currentOffset = offset;
    this.startTick();
  }

  private handleEnded(): void {
    if (usePlaybackStore.getState().status === 'paused') return;
    this.currentIndex++;
    if (this.currentIndex < this.queue.length) {
      void this.playCurrent();
    } else {
      this.stop();
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
      const elapsed = this.ctx.currentTime - this.currentStartTime + this.currentOffset;
      const wordIndex = findCurrentWordIndex(this.currentLoaded.alignment, elapsed);
      usePlaybackStore.getState().patchCurrent({
        position: elapsed,
        currentWordIndex: wordIndex,
      });
      this.tickHandle = requestAnimationFrame(tick);
    };
    this.tickHandle = requestAnimationFrame(tick);
  }

  pause(): void {
    if (!this.source || !this.ctx) return;
    if (usePlaybackStore.getState().status !== 'playing') return;
    const elapsed = this.ctx.currentTime - this.currentStartTime + this.currentOffset;
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
  }

  resume(): void {
    if (!this.currentLoaded) return;
    if (usePlaybackStore.getState().status !== 'paused') return;
    this.startSource(this.currentLoaded.buffer, this.currentOffset);
    usePlaybackStore.getState().setStatus('playing');
  }

  toggle(): void {
    const status = usePlaybackStore.getState().status;
    if (status === 'playing') this.pause();
    else if (status === 'paused') this.resume();
  }

  stop(): void {
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
    usePlaybackStore.getState().setStatus('idle');
    usePlaybackStore.getState().setCurrent(null);
  }

  next(): void {
    if (this.currentIndex >= this.queue.length - 1) return;
    this.currentIndex++;
    void this.playCurrent();
  }

  previous(): void {
    if (this.currentIndex <= 0) return;
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

  private getCurrentPosition(): number {
    if (!this.ctx) return this.currentOffset;
    if (!this.source) return this.currentOffset;
    return this.ctx.currentTime - this.currentStartTime + this.currentOffset;
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
}

export const audioPlayback = new AudioPlaybackManager();
