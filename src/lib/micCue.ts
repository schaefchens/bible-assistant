import { audioPlayback } from './audioPlaybackManager';
import { useSettingsStore } from '@/store/settingsStore';

/**
 * Brief synthesized chirp played when mic recording starts/stops. Uses the
 * shared AudioContext so iOS doesn't need a fresh user-gesture for it.
 */
export function playMicCue(kind: 'start' | 'stop'): void {
  if (!useSettingsStore.getState().micSoundEnabled) return;
  let ctx: AudioContext;
  try {
    ctx = audioPlayback.ensureContext();
  } catch {
    return;
  }
  try {
    const now = ctx.currentTime;
    const dur = 0.2;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    if (kind === 'start') {
      // Soft warm rise — "you can talk now".
      osc.frequency.setValueAtTime(150, now);
      osc.frequency.exponentialRampToValueAtTime(220, now + dur);
    } else {
      // Soft warm fall — "I heard you".
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.exponentialRampToValueAtTime(130, now + dur);
    }
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.22, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  } catch {
    /* ignore cue failures — they should never block mic capture */
  }
}
