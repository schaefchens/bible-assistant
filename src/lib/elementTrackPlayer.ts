import { clamp01 } from './math';
import { fetchCached } from './mediaCache';

/**
 * Plays one track at a time through an HTMLAudioElement.
 *
 * This exists because of a measured platform constraint, not a preference:
 * WebKit suspends the AudioContext as soon as the page is hidden, so
 * AudioBufferSourceNode playback stops dead when the app is backgrounded or
 * the screen locks — `UIBackgroundModes: audio` does not change that. A media
 * element keeps playing. Measured side by side on iOS over a 13 s background
 * window: AudioContext.currentTime froze at 7.97 while the element's
 * currentTime advanced 9.02 → 22.17.
 *
 * Media elements are also the only thing iOS will attach lock-screen /
 * Control Center transport controls to.
 *
 * Web Audio is still the right tool for the UI cues (tick, mic chirp, thinking
 * drone) — they are foreground-only by nature, so context suspension is fine.
 */

/** ~100ms of silence — a real, decodable resource for gesture priming. */
const SILENT_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=';

/** Blob URLs for decoded-from-cache audio, bounded so we don't leak. */
const BLOB_CACHE_MAX = 12;
const blobUrls = new Map<string, string>();

function rememberBlob(sourceUrl: string, blobUrl: string): void {
  blobUrls.set(sourceUrl, blobUrl);
  while (blobUrls.size > BLOB_CACHE_MAX) {
    const oldest = blobUrls.keys().next().value;
    if (oldest === undefined) break;
    const stale = blobUrls.get(oldest);
    blobUrls.delete(oldest);
    if (stale) URL.revokeObjectURL(stale);
  }
}

/**
 * Resolve a track URL to something the element can play, going through the
 * persistent media cache so a cached verse works with no network.
 */
async function resolveSrc(url: string): Promise<string> {
  const hit = blobUrls.get(url);
  if (hit) return hit;
  const bytes = await fetchCached(url);
  const blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }));
  rememberBlob(url, blobUrl);
  return blobUrl;
}

/**
 * Put the element in the document rather than leaving it detached.
 *
 * WebKit is more consistent about treating in-document media as real page
 * media — which is what governs background playback and whether MediaSession
 * now-playing info is honoured. It also makes the element inspectable when
 * debugging playback.
 */
function attachHidden(el: HTMLAudioElement, label: string): void {
  if (typeof document === 'undefined') return;
  el.dataset.baAudio = label;
  el.style.display = 'none';
  const mount = () => document.body?.appendChild(el);
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount, { once: true });
}

export type TrackHandle = { src: string; duration: number };

export class ElementTrackPlayer {
  private el: HTMLAudioElement;
  /** Set by the owner; called when the current track plays to its end. */
  onEnded: (() => void) | null = null;
  /**
   * The element was paused by something other than us — a phone call, Siri,
   * another app taking the audio session, or headphones being unplugged.
   *
   * This is the whole reason interruptions are tractable now: the platform
   * pauses a media element and says so. An AudioBufferSourceNode gave no such
   * signal, which is why an interrupted reading used to leave the app
   * believing it was still playing.
   */
  onExternalPause: (() => void) | null = null;
  /** Resumed by something other than us (lock-screen or headphone button). */
  onExternalPlay: (() => void) | null = null;

  /** >0 while we're performing our own transport op, so its resulting
   * play/pause event isn't mistaken for an external one. */
  private ownOp = 0;

  constructor(label = 'track') {
    this.el = new Audio();
    this.el.preload = 'auto';
    // Keeps iOS from taking over with its own inline media chrome.
    this.el.setAttribute('playsinline', 'true');
    this.el.addEventListener('ended', () => this.onEnded?.());
    this.el.addEventListener('pause', () => {
      // Reaching the end also fires `pause`; that's `ended`'s business.
      if (this.ownOp > 0 || this.el.ended) return;
      this.onExternalPause?.();
    });
    this.el.addEventListener('play', () => {
      if (this.ownOp > 0) return;
      this.onExternalPlay?.();
    });
    attachHidden(this.el, label);
  }

  /** Run one of our own transport ops without tripping the external listeners. */
  private own(fn: () => void): void {
    this.ownOp++;
    try {
      fn();
    } finally {
      // play/pause are dispatched as tasks, so release on the next turn.
      setTimeout(() => {
        this.ownOp = Math.max(0, this.ownOp - 1);
      }, 0);
    }
  }

  /** The element itself — needed to attach MediaSession position state. */
  get element(): HTMLAudioElement {
    return this.el;
  }

  /**
   * iOS only lets a media element start from a user gesture. Playback here is
   * always *triggered* by one, but the tap is separated from `play()` by an
   * async chain (chat round-trip, TTS generation, cache read), by which point
   * the gesture has lapsed. Playing a muted no-op inside the gesture marks the
   * element as user-activated for the rest of the page's life.
   *
   * It must be primed with a REAL resource. Calling play() on a src-less
   * element leaves it stuck in the resource-selection algorithm: a later
   * `src = …` then never fires loadedmetadata, so loading hangs forever and
   * playback sits on a spinner. (Observed exactly that; the element only
   * recovered after an explicit load().)
   */
  private primed = false;
  prime(): void {
    if (this.primed || this.el.src) return;
    this.primed = true;
    this.own(() => {
      this.el.muted = true;
      this.el.src = SILENT_WAV;
      this.el.load();
      void this.el
        .play()
        .then(() => {
          this.el.pause();
          this.el.muted = false;
        })
        .catch(() => {
          this.el.muted = false;
        });
    });
    // NB: deliberately does NOT clear `src` afterwards. This callback resolves
    // ~100 ms later, by which time load() has usually already assigned the real
    // track — clearing it there wiped the src out from under the element, which
    // then sat at readyState=HAVE_NOTHING with no src and never loaded.
  }

  /**
   * Wait for metadata on the current src, or give up after `timeoutMs`.
   * Resolves the duration, or null if nothing arrived in time.
   */
  private awaitMetadata(timeoutMs: number): Promise<number | null> {
    return new Promise((resolve) => {
      if (this.el.readyState >= 1 && Number.isFinite(this.el.duration)) {
        resolve(this.el.duration);
        return;
      }
      let settled = false;
      const finish = (value: number | null) => {
        if (settled) return;
        settled = true;
        this.el.removeEventListener('loadedmetadata', onMeta);
        this.el.removeEventListener('error', onErr);
        clearTimeout(timer);
        resolve(value);
      };
      const onMeta = () => finish(Number.isFinite(this.el.duration) ? this.el.duration : 0);
      const onErr = () => finish(0);
      const timer = setTimeout(() => finish(null), timeoutMs);
      this.el.addEventListener('loadedmetadata', onMeta);
      this.el.addEventListener('error', onErr);
    });
  }

  /**
   * Fetch (cache-first) and attach a track, resolving once its duration is known.
   *
   * The reset-then-load dance is not defensive noise; it fixes an observed
   * hang. Assigning a new `src` over an element that still has an in-flight
   * play() (from gesture priming) can leave it wedged at
   * networkState=LOADING / readyState=HAVE_NOTHING with no `error` event —
   * loadedmetadata never fires, so this promise never settles and playback sits
   * on a spinner forever. Emptying the element first, then an explicit load(),
   * and finally one retry if metadata still doesn't arrive, clears it.
   */
  async load(url: string): Promise<TrackHandle> {
    const src = await resolveSrc(url);

    this.own(() => {
      this.el.pause();
      this.el.src = src;
      // Explicit load() rather than relying on the src assignment alone.
      this.el.load();
    });

    let duration = await this.awaitMetadata(4000);
    if (duration === null) {
      // Nothing arrived — re-assert src and load once more before giving up.
      this.own(() => {
        this.el.src = src;
        this.el.load();
      });
      duration = await this.awaitMetadata(6000);
    }
    return { src, duration: duration ?? 0 };
  }

  start(offset: number): void {
    this.own(() => {
      try {
        this.el.currentTime = offset;
      } catch {
        // Seeking before metadata is ready throws; playback still starts at 0.
      }
      void this.el.play().catch(() => {
        /* autoplay refused — the owner's status handling covers it */
      });
    });
  }

  pause(): void {
    this.own(() => this.el.pause());
  }

  resume(): void {
    this.own(() => {
      void this.el.play().catch(() => {});
    });
  }

  stop(): void {
    this.own(() => {
      this.el.pause();
      try {
        this.el.currentTime = 0;
      } catch {
        /* ignore */
      }
    });
  }

  seek(seconds: number): void {
    try {
      this.el.currentTime = seconds;
    } catch {
      /* ignore */
    }
  }

  get currentTime(): number {
    return this.el.currentTime;
  }

  get duration(): number {
    return Number.isFinite(this.el.duration) ? this.el.duration : 0;
  }

  get paused(): boolean {
    return this.el.paused;
  }

  setRate(rate: number): void {
    this.el.playbackRate = rate;
  }

  /** 0..1. Replaces the GainNode ducking the Web Audio graph used to do. */
  setVolume(v: number): void {
    this.el.volume = clamp01(v);
  }
}
