import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackHandle, TrackPlayer } from '@/lib/elementTrackPlayer';
import type { PlaybackTrack } from '@/lib/audioPlaybackManager';

/**
 * `audioPlaybackManager` is 941 lines and had no coverage at all — and it is
 * the file where a mistake is silence or the wrong audio, the top row of
 * CLAUDE.md's risk table.
 *
 * It could not *have* coverage until now: the class constructs its own
 * `ElementTrackPlayer`, and jsdom has no media stack to drive. That is not an
 * implementation detail waiting to be swapped for Web Audio, either —
 * CLAUDE.md records the measurement that put verses on a media element (over a
 * 13-second background window WebKit froze `ctx.currentTime` at 7.97 while a
 * media element's went 9.02 -> 22.17). So the seam is a constructor parameter,
 * and the fake below is the whole reason these tests exist.
 *
 * What is under test is the **feed loop**: `feeding` / `awaitingFeed` /
 * `feedGen`, the three fields that decide whether a reading streamed in verse
 * by verse continues, waits, or hands off to auto-continuation. Getting that
 * wrong is a reading that stops mid-chapter, or one that starts Genesis after
 * a blog post.
 */

/** A `TrackPlayer` that reports what it was told and ends when asked. */
function fakePlayer(): TrackPlayer & { end: () => void; loaded: string[] } {
  const p = {
    onEnded: null as (() => void) | null,
    onExternalPause: null as (() => void) | null,
    onExternalPlay: null as (() => void) | null,
    currentTime: 0,
    loaded: [] as string[],
    load: vi.fn(async (url: string): Promise<TrackHandle> => {
      p.loaded.push(url);
      return { src: url, duration: 10 };
    }),
    prime: vi.fn(),
    start: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(),
    seek: vi.fn(),
    setRate: vi.fn(),
    setVolume: vi.fn(),
    /** What a real element's `ended` event does. */
    end: () => p.onEnded?.(),
  };
  return p;
}

const { AudioPlaybackManager } = await import('@/lib/audioPlaybackManager');
const { usePlaybackStore } = await import('@/store/playbackStore');

const track = (n: number): PlaybackTrack =>
  ({
    audioUrl: `verse-${n}.mp3`,
    groupId: 'g1',
    verseIndex: n,
    totalVerses: 99,
    isVerse: true,
  }) as PlaybackTrack;

let verse: ReturnType<typeof fakePlayer>;
let audio: InstanceType<typeof AudioPlaybackManager>;

/** Let the awaited `load` inside playCurrent settle. */
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  usePlaybackStore.setState({ status: 'idle', current: null });
  audio = new AudioPlaybackManager((label) => {
    const p = fakePlayer();
    // The manager builds two: 'verse' for the reading, 'reply' for an
    // assistant interjection. Only the first one matters here.
    if (label === 'verse') verse = p;
    return p;
  });
});

describe('a feed generation is what invalidates a stale stream', () => {
  it('hands out a live token', () => {
    const gen = audio.beginFeed();
    expect(audio.isFeed(gen)).toBe(true);
  });

  it('a second stream supersedes the first', () => {
    // An interrupting reading must not have the old one's verses appended to
    // it — that is the failure this counter exists for.
    const first = audio.beginFeed();
    const second = audio.beginFeed();
    expect(audio.isFeed(first)).toBe(false);
    expect(audio.isFeed(second)).toBe(true);
  });

  it('ignores tracks appended against a stale generation', async () => {
    const stale = audio.beginFeed();
    await audio.playQueue([track(1)]);
    await settle();
    audio.beginFeed();

    audio.appendTracks([track(2)], stale);
    await settle();

    // The superseded stream's verse never reached the queue.
    expect(verse.loaded).toEqual(['verse-1.mp3']);
  });

  it('ignores a stale stream closing', () => {
    const stale = audio.beginFeed();
    const live = audio.beginFeed();
    audio.endFeed(stale);
    // Closing the old one must not close the new one.
    expect(audio.isFeed(live)).toBe(true);
  });

  it('closing the live stream ends it', () => {
    const gen = audio.beginFeed();
    audio.endFeed(gen);
    expect(audio.isFeed(gen)).toBe(false);
  });

  it('stopping invalidates the stream', async () => {
    // Otherwise a verse still being generated lands on a reading the user
    // already stopped.
    const gen = audio.beginFeed();
    await audio.playQueue([track(1)]);
    await settle();
    audio.stop();
    expect(audio.isFeed(gen)).toBe(false);

    audio.appendTracks([track(2)], gen);
    await settle();
    expect(verse.loaded).toEqual(['verse-1.mp3']);
  });
});

describe('draining mid-stream waits rather than handing off', () => {
  it('parks at the end instead of soft-ending', async () => {
    // The bug this prevents: verse N ends before verse N+1's speech is
    // generated, the queue looks finished, and auto-continuation takes over
    // *mid-reading* — which is how a reading ends up followed by the wrong
    // chapter.
    const gen = audio.beginFeed();
    await audio.playQueue([track(1)]);
    await settle();

    verse.end();
    await settle();

    expect(audio.isSoftEnded()).toBe(false);
    // `current` stays set so no thinking drone fires during the wait.
    expect(usePlaybackStore.getState().current).not.toBeNull();
    expect(usePlaybackStore.getState().status).toBe('loading');
    expect(audio.isFeed(gen)).toBe(true);
  });

  it('picks up the next verse when it arrives', async () => {
    const gen = audio.beginFeed();
    await audio.playQueue([track(1)]);
    await settle();
    verse.end();
    await settle();

    audio.appendTracks([track(2)], gen);
    await settle();

    expect(verse.loaded).toEqual(['verse-1.mp3', 'verse-2.mp3']);
    expect(audio.isSoftEnded()).toBe(false);
  });

  it('soft-ends once the stream closes with nothing more to play', async () => {
    // Now the hand-off *is* right: the reading really did reach its end, so
    // auto-continuation should get it.
    const gen = audio.beginFeed();
    await audio.playQueue([track(1)]);
    await settle();
    verse.end();
    await settle();
    expect(audio.isSoftEnded()).toBe(false);

    audio.endFeed(gen);
    await settle();

    expect(audio.isSoftEnded()).toBe(true);
  });

  it('soft-ends immediately when the queue drains outside a stream', async () => {
    // No feed open at all: the end of the queue is simply the end.
    await audio.playQueue([track(1)]);
    await settle();

    verse.end();
    await settle();

    expect(audio.isSoftEnded()).toBe(true);
  });

  it('plays a queued run through in order before ending', async () => {
    await audio.playQueue([track(1), track(2)]);
    await settle();
    expect(verse.loaded).toEqual(['verse-1.mp3']);

    verse.end();
    await settle();
    expect(verse.loaded).toEqual(['verse-1.mp3', 'verse-2.mp3']);
    expect(audio.isSoftEnded()).toBe(false);

    verse.end();
    await settle();
    expect(audio.isSoftEnded()).toBe(true);
  });
});

describe('ducking, and putting back only what it took', () => {
  it('pauses a live reading and resumes it', async () => {
    // The mic is open: verse audio must be fully muted, and it has to come
    // back afterwards rather than advancing silently behind the recognizer.
    await audio.playQueue([track(1)]);
    await settle();
    expect(usePlaybackStore.getState().status).toBe('playing');

    audio.setDucked(true);
    expect(usePlaybackStore.getState().status).toBe('paused');

    audio.setDucked(false);
    await settle();
    expect(usePlaybackStore.getState().status).toBe('playing');
  });

  it('does not start anything that was not playing', async () => {
    // Unducking must not resume a reading the duck never paused — the mic
    // closing is not a play command.
    audio.setDucked(true);
    audio.setDucked(false);
    await settle();

    expect(usePlaybackStore.getState().status).toBe('idle');
    expect(verse.resume).not.toHaveBeenCalled();
  });

  it('leaves a deliberately paused reading paused', async () => {
    await audio.playQueue([track(1)]);
    await settle();
    audio.pause();
    expect(usePlaybackStore.getState().status).toBe('paused');

    audio.setDucked(true);
    audio.setDucked(false);
    await settle();

    // The user paused it. The mic closing does not undo that.
    expect(usePlaybackStore.getState().status).toBe('paused');
  });
});
