import { usePlaybackStore } from '@/store/playbackStore';
import { useSettingsStore } from '@/store/settingsStore';
import { clamp01 } from './math';
import { fetchCached } from './mediaCache';

const AMBIENT_FADE_MS = 2000;
const VOLUME_RAMP_MS = 150;
const FADE_STEP_MS = 50;

/**
 * The ambient-music bus: one looping HTMLAudioElement running parallel to the
 * verse track. Fades in/out, honors the mic-duck factor (0 = muted while the
 * mic is open), and persists the chosen volume to settings.
 *
 * It used to be a looping AudioBufferSource on a GainNode. It moved to a media
 * element for the same measured reason verse playback did: WebKit suspends the
 * AudioContext when the page hides, so Web Audio goes silent the moment the app
 * is backgrounded or the screen locks. Music under a reading has to survive
 * exactly that. See elementTrackPlayer.ts for the measurement.
 *
 * Elements have no AudioParam automation, so the gain ramps became small
 * interval-driven fades. That also makes them immune to the frozen-clock bug
 * that used to strand ramps mid-fade when iOS suspended the context.
 */
export class AmbientAudioBus {
  private readonly onIdle: () => void;
  private el: HTMLAudioElement;
  private url: string | null = null;
  private objectUrl: string | null = null;
  private duckFactor = 1;
  private fadeTimer: number | null = null;
  private playing = false;

  constructor(onIdle: () => void) {
    this.onIdle = onIdle;
    this.el = new Audio();
    this.el.loop = true;
    this.el.preload = 'auto';
    this.el.setAttribute('playsinline', 'true');
    this.el.volume = 0;
    // In the document for the same reason the verse player is — WebKit treats
    // in-document media more consistently for background playback.
    if (typeof document !== 'undefined') {
      this.el.dataset.baAudio = 'ambient';
      this.el.style.display = 'none';
      const mount = () => document.body?.appendChild(this.el);
      if (document.body) mount();
      else document.addEventListener('DOMContentLoaded', mount, { once: true });
    }
  }

  async load(url: string): Promise<void> {
    if (this.url === url && this.el.src) return;
    this.cancelFade();
    const bytes = await fetchCached(url);
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }));
    this.el.src = this.objectUrl;
    this.url = url;
  }

  private cancelFade(): void {
    if (this.fadeTimer !== null) {
      clearInterval(this.fadeTimer);
      this.fadeTimer = null;
    }
  }

  /** Linear volume fade, replacing the old linearRampToValueAtTime. */
  private fadeTo(target: number, durationMs: number, onDone?: () => void): void {
    this.cancelFade();
    const from = this.el.volume;
    const clampedTarget = clamp01(target);
    if (durationMs <= 0 || from === clampedTarget) {
      this.el.volume = clampedTarget;
      onDone?.();
      return;
    }
    const steps = Math.max(1, Math.round(durationMs / FADE_STEP_MS));
    let step = 0;
    this.fadeTimer = window.setInterval(() => {
      step++;
      const t = Math.min(1, step / steps);
      this.el.volume = clamp01(from + (clampedTarget - from) * t);
      if (t >= 1) {
        this.cancelFade();
        onDone?.();
      }
    }, FADE_STEP_MS);
  }

  play(): void {
    if (!this.el.src) return;
    this.cancelFade();
    if (this.el.paused) {
      this.el.volume = 0; // so the ramp below reads as a fade-in
      void this.el.play().catch(() => {
        /* autoplay refused; the caller's state handling covers it */
      });
    }
    this.playing = true;
    const target = useSettingsStore.getState().ambient.volume * this.duckFactor;
    this.fadeTo(target, AMBIENT_FADE_MS);
    usePlaybackStore.getState().setAmbientPlaying(true);
  }

  pause(): void {
    if (this.el.paused && !this.playing) {
      usePlaybackStore.getState().setAmbientPlaying(false);
      return;
    }
    this.playing = false;
    this.fadeTo(0, AMBIENT_FADE_MS, () => {
      this.el.pause();
      // Ambient was potentially the last thing holding the context open.
      this.onIdle();
    });
    usePlaybackStore.getState().setAmbientPlaying(false);
  }

  setVolume(v: number): void {
    const clamped = clamp01(v);
    if (this.playing) this.fadeTo(clamped * this.duckFactor, VOLUME_RAMP_MS);
    useSettingsStore.getState().setAmbient({ volume: clamped });
  }

  /** Scale the bus by the mic-duck factor (1 normal, 0 ducked). */
  setDuckFactor(factor: number): void {
    this.duckFactor = factor;
    if (!this.playing) return;
    this.fadeTo(useSettingsStore.getState().ambient.volume * factor, VOLUME_RAMP_MS);
  }

  isPlaying(): boolean {
    return this.playing;
  }
}
