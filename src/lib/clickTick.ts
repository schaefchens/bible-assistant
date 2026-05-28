import { audioPlayback } from './audioPlaybackManager';

// Bypasses ttsGain on purpose: connects straight to ctx.destination so the
// tick layers on top of any active reading instead of ducking or interrupting
// it.
const MIN_INTERVAL_MS = 40;
let lastAt = 0;

export function playClickTick(): void {
  const now = performance.now();
  if (now - lastAt < MIN_INTERVAL_MS) return;
  lastAt = now;
  let ctx: AudioContext;
  try {
    ctx = audioPlayback.ensureContext();
  } catch {
    return;
  }
  try {
    const t = ctx.currentTime;
    const dur = 0.045;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1200, t);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.18, t + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.01);
  } catch {
    /* never block taps */
  }
}
