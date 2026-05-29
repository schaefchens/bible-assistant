import { usePlaybackStore } from '@/store/playbackStore';
import { useSettingsStore } from '@/store/settingsStore';

const AMBIENT_FADE_SEC = 2;
const VOLUME_RAMP_SEC = 0.15;

/**
 * The ambient-music bus: one looping AudioBufferSource on its own gain node,
 * running parallel to the verse/TTS bus through the shared master gain. Fades
 * in/out over AMBIENT_FADE_SEC, honors the mic-duck factor (0 = muted while the
 * mic is open), and persists the chosen volume to settings.
 *
 * Extracted from AudioPlaybackManager so the engine's music path and speech
 * path are reasoned about separately. The bus owns its gain node; the manager
 * routes ducking through {@link setDuckFactor} and supplies an `onIdle`
 * callback (called once the fade-out finishes) so it can suspend the shared
 * AudioContext when nothing else is playing.
 */
export class AmbientAudioBus {
  private readonly ctx: AudioContext;
  private readonly gain: GainNode;
  private readonly onIdle: () => void;
  private source: AudioBufferSourceNode | null = null;
  private buffer: AudioBuffer | null = null;
  private url: string | null = null;
  private readonly decodeCache = new Map<string, AudioBuffer>();
  private stopTimer: number | null = null;
  private duckFactor = 1;

  constructor(ctx: AudioContext, destination: AudioNode, onIdle: () => void) {
    this.ctx = ctx;
    this.onIdle = onIdle;
    this.gain = ctx.createGain();
    this.gain.gain.value = useSettingsStore.getState().ambient.volume;
    this.gain.connect(destination);
  }

  async load(url: string): Promise<void> {
    if (this.url === url && this.buffer) return;
    // Track switching: tear down the live source synchronously so the next
    // play() spins up the new buffer instead of short-circuiting on the old one.
    if (this.source) {
      if (this.stopTimer !== null) {
        clearTimeout(this.stopTimer);
        this.stopTimer = null;
      }
      try {
        this.source.stop();
      } catch {
        /* may already be stopped */
      }
      this.source = null;
    }
    const cached = this.decodeCache.get(url);
    if (cached) {
      this.buffer = cached;
      this.url = url;
      return;
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ambient fetch failed: ${res.status}`);
    const arr = await res.arrayBuffer();
    const buf = await this.ctx.decodeAudioData(arr.slice(0));
    this.decodeCache.set(url, buf);
    this.buffer = buf;
    this.url = url;
  }

  play(): void {
    if (!this.buffer) return;
    // Cancel any pending stop (e.g. user re-played during fade-out).
    if (this.stopTimer !== null) {
      clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }
    if (!this.source) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.buffer;
      src.loop = true;
      src.connect(this.gain);
      src.start(0);
      this.source = src;
      // Begin silent so the upcoming ramp acts as a fade-in.
      this.gain.gain.cancelScheduledValues(this.ctx.currentTime);
      this.gain.gain.setValueAtTime(0, this.ctx.currentTime);
    }
    const target = useSettingsStore.getState().ambient.volume * this.duckFactor;
    const now = this.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setValueAtTime(this.gain.gain.value, now);
    this.gain.gain.linearRampToValueAtTime(target, now + AMBIENT_FADE_SEC);
    usePlaybackStore.getState().setAmbientPlaying(true);
  }

  pause(): void {
    if (!this.source) {
      usePlaybackStore.getState().setAmbientPlaying(false);
      return;
    }
    const src = this.source;
    const now = this.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setValueAtTime(this.gain.gain.value, now);
    this.gain.gain.linearRampToValueAtTime(0, now + AMBIENT_FADE_SEC);

    if (this.stopTimer !== null) clearTimeout(this.stopTimer);
    this.stopTimer = window.setTimeout(() => {
      try {
        src.stop();
      } catch {
        /* ignore */
      }
      if (this.source === src) this.source = null;
      this.stopTimer = null;
      // Ambient was potentially the last thing holding the context open.
      this.onIdle();
    }, AMBIENT_FADE_SEC * 1000 + 50);

    usePlaybackStore.getState().setAmbientPlaying(false);
  }

  setVolume(v: number): void {
    const clamped = Math.max(0, Math.min(1, v));
    const now = this.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setValueAtTime(this.gain.gain.value, now);
    this.gain.gain.linearRampToValueAtTime(clamped * this.duckFactor, now + VOLUME_RAMP_SEC);
    useSettingsStore.getState().setAmbient({ volume: clamped });
  }

  /** Scale the bus by the mic-duck factor (1 normal, 0 ducked); ramps the live
   * gain to `settingsVolume * factor`. Called by the manager's ducking. */
  setDuckFactor(factor: number): void {
    this.duckFactor = factor;
    const target = useSettingsStore.getState().ambient.volume * factor;
    const now = this.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setValueAtTime(this.gain.gain.value, now);
    this.gain.gain.linearRampToValueAtTime(target, now + VOLUME_RAMP_SEC);
  }

  isPlaying(): boolean {
    return this.source !== null;
  }
}
