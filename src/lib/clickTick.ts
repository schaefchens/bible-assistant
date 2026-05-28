import { audioPlayback } from './audioPlaybackManager';

// Per-zone sound profiles so blind taps in eyes-free mode are
// distinguishable by ear. Each profile is a single envelope + an optional
// second note (CENTER uses two for an "ascending chime" feel).
//
// Mixed straight to ctx.destination — bypasses ttsGain so ticks never
// duck or interrupt active reading.

export type ZoneSound = 'top' | 'left' | 'right' | 'center' | 'bottom';

type Note = {
  type: OscillatorType;
  fStart: number;
  fEnd: number;
  duration: number;
  peak: number;
  offset?: number;
};

const PROFILES: Record<ZoneSound, Note[]> = {
  // EXIT — descending sine, neutral "back" tone.
  top: [
    { type: 'sine', fStart: 660, fEnd: 330, duration: 0.09, peak: 0.18 },
  ],
  // PREV — short triangle dropping a minor third.
  left: [
    { type: 'triangle', fStart: 780, fEnd: 590, duration: 0.08, peak: 0.18 },
  ],
  // NEXT — short triangle rising a minor third (mirror of PREV).
  right: [
    { type: 'triangle', fStart: 590, fEnd: 780, duration: 0.08, peak: 0.18 },
  ],
  // PLAY/PAUSE — two-note arpeggio, a perfect fifth apart. Distinctive.
  center: [
    { type: 'triangle', fStart: 880, fEnd: 880, duration: 0.06, peak: 0.18 },
    {
      type: 'triangle',
      fStart: 1320,
      fEnd: 1320,
      duration: 0.07,
      peak: 0.18,
      offset: 0.065,
    },
  ],
  // MIC — bright single pulse, "voice input" feel.
  bottom: [
    { type: 'sine', fStart: 1600, fEnd: 1600, duration: 0.1, peak: 0.18 },
  ],
};

const MIN_INTERVAL_MS = 40;
let lastAt = 0;

function emitNote(ctx: AudioContext, base: number, n: Note): void {
  const t = base + (n.offset ?? 0);
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = n.type;
  osc.frequency.setValueAtTime(n.fStart, t);
  if (n.fEnd !== n.fStart) {
    osc.frequency.linearRampToValueAtTime(n.fEnd, t + n.duration);
  }
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(n.peak, t + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0008, t + n.duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t);
  osc.stop(t + n.duration + 0.01);
}

export function playZoneTick(zone: ZoneSound): void {
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
    const base = ctx.currentTime;
    for (const note of PROFILES[zone]) {
      emitNote(ctx, base, note);
    }
  } catch {
    /* never block taps */
  }
}
