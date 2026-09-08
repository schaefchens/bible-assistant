/**
 * iOS Safari does not give us direct control over the AVAudioSession, but
 * playing a silent HTMLAudioElement after the mic has been released is a
 * documented workaround that often nudges the session back from the
 * "voice" category (in which the volume buttons control the ringer and
 * media playback is quieter) to the "playback" category. Pair it with an
 * AudioContext.resume() so any in-flight TTS playback picks up the new
 * routing.
 *
 * Cheap, idempotent, safe on non-iOS browsers.
 */

// 100ms of silent WAV (mono, 8kHz, 8-bit) as a data URL.
const SILENT_WAV =
  'data:audio/wav;base64,UklGRkQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YSAAAAAAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA';

let silentEl: HTMLAudioElement | null = null;

export function nudgeIosPlaybackRouting(audioContext?: AudioContext | null): void {
  try {
    if (!silentEl) {
      silentEl = new Audio(SILENT_WAV);
      silentEl.volume = 0;
      silentEl.preload = 'auto';
      // playsInline keeps iOS from putting up its inline-video chrome.
      silentEl.setAttribute('playsinline', 'true');
    }
    silentEl.currentTime = 0;
    void silentEl.play().catch(() => {
      /* user gesture may have lapsed — best-effort only */
    });
  } catch {
    /* ignore */
  }
  if (audioContext && audioContext.state === 'suspended') {
    void audioContext.resume().catch(() => {});
  }
}
