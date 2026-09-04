/**
 * The lock screen, Control Center, and headphone / Bluetooth transport
 * buttons — everything the OS knows about what the app is playing.
 *
 * **Only works because playback runs on a media element.** iOS attaches
 * now-playing info and remote commands to media elements, never to Web Audio;
 * see the note at the top of `elementTrackPlayer.ts` for the measurement that
 * settled that. Registering the handlers is also what lets a headphone button
 * reach the app at all.
 *
 * Its own module because none of it is about queueing or decoding audio: it
 * needs five commands to call and one reading of where playback is, and every
 * call is wrapped in a try/catch for a platform that implements half the API.
 * Inside `audioPlaybackManager` it was ~100 lines with its two fields declared
 * in the middle of the class, and the metadata object built twice.
 */

/** What the OS's transport buttons do. Supplied by the playback manager. */
export type MediaSessionCommands = {
  play(): void;
  pause(): void;
  stop(): void;
  next(): void;
  previous(): void;
};

/** Where playback is right now, read on demand rather than pushed. */
export type MediaSessionPosition = {
  duration: number;
  position: number;
  rate: number;
};

const ALBUM = 'Bible Assistant';

export class MediaSessionBridge {
  private handlersReady = false;
  private title: string | null = null;
  private artist = '';

  // Explicit fields rather than constructor parameter properties: this project
  // compiles with `erasableSyntaxOnly`, which forbids them.
  private readonly commands: MediaSessionCommands;
  private readonly readPosition: () => MediaSessionPosition;

  constructor(commands: MediaSessionCommands, readPosition: () => MediaSessionPosition) {
    this.commands = commands;
    this.readPosition = readPosition;
  }

  /** Called when a reading starts, so the lock screen shows the reference. */
  setNowPlaying(title: string, subtitle?: string): void {
    this.title = title;
    this.artist = subtitle ?? '';
    this.publishMetadata();
  }

  /** Called when a *track* starts: metadata plus the new position. */
  trackStarted(duration: number, position: number): void {
    if (!this.available()) return;
    this.registerHandlers();
    this.publishMetadata();
    this.syncState('playing', position, duration);
  }

  /**
   * Push the playback state and position. Both arguments default to what
   * `readPosition()` reports, which is what the seek and rate paths want.
   */
  syncState(state?: 'playing' | 'paused', position?: number, duration?: number): void {
    if (!this.available()) return;
    const ms = navigator.mediaSession;
    if (state) ms.playbackState = state;
    const here = this.readPosition();
    const dur = duration ?? here.duration;
    const pos = position ?? here.position;
    // setPositionState throws if position > duration, which can happen for a
    // frame around track transitions.
    if (dur > 0 && pos <= dur) {
      this.attempt(() =>
        ms.setPositionState({ duration: dur, position: pos, playbackRate: here.rate }),
      );
    }
  }

  /** Nothing is playing any more: take the app off the lock screen. */
  clear(): void {
    if (!this.available()) return;
    this.attempt(() => {
      navigator.mediaSession.playbackState = 'none';
      navigator.mediaSession.metadata = null;
    });
  }

  private available(): boolean {
    return 'mediaSession' in navigator;
  }

  /** Every call into the API is best-effort: a platform may implement some of
   * it, and a missing piece must not take the rest of a reading down. */
  private attempt(fn: () => void): void {
    if (!this.available()) return;
    try {
      fn();
    } catch {
      // Unsupported on this platform.
    }
  }

  private publishMetadata(): void {
    this.attempt(() => {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: this.title ?? ALBUM,
        artist: this.artist,
        album: ALBUM,
      });
    });
  }

  private registerHandlers(): void {
    if (this.handlersReady || !this.available()) return;
    this.handlersReady = true;
    const c = this.commands;
    const handlers: [MediaSessionAction, () => void][] = [
      ['play', () => c.play()],
      ['pause', () => c.pause()],
      ['stop', () => c.stop()],
      ['nexttrack', () => c.next()],
      ['previoustrack', () => c.previous()],
    ];
    for (const [action, handler] of handlers) {
      // Per action, so an unsupported one skips rather than aborting the rest.
      this.attempt(() => navigator.mediaSession.setActionHandler(action, handler));
    }
  }
}
