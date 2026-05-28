import { audioPlayback } from './audioPlaybackManager';
import { useSettingsStore } from '@/store/settingsStore';

/**
 * Deep, subtle drone played while the assistant is "thinking" (transcribe →
 * API → tool result), so a long processing pause feels alive instead of dead.
 * Uses the shared AudioContext so iOS doesn't need a fresh gesture mid-cycle.
 */

type DroneNodes = {
  ctx: AudioContext;
  master: GainNode;
  lfoGain: GainNode;
  filter: BiquadFilterNode;
  oscillators: OscillatorNode[];
  lfo: OscillatorNode;
  stopTimer: number | null;
};

let active: DroneNodes | null = null;

const FADE_IN_SEC = 0.35;
const FADE_OUT_SEC = 0.25;
const TARGET_GAIN = 0.06;
const LFO_DEPTH = 0.015;
const LFO_HZ = 0.08;
const FILTER_HZ = 600;
const FILTER_Q = 0.7;

// Root (low C2 ≈ 65 Hz) + a perfect fifth (G2 ≈ 98 Hz). Each gets a paired
// detuned voice for slow chorus — keeps the drone from sounding sterile.
const VOICES: Array<{ hz: number; detuneCents: number }> = [
  { hz: 65.41, detuneCents: -3 },
  { hz: 65.41, detuneCents: +3 },
  { hz: 98.0, detuneCents: -3 },
  { hz: 98.0, detuneCents: +3 },
];

export function startThinkingDrone(): void {
  if (!useSettingsStore.getState().thinkingSoundEnabled) return;
  if (active) return;
  let ctx: AudioContext;
  try {
    ctx = audioPlayback.ensureContext();
  } catch {
    return;
  }
  try {
    const now = ctx.currentTime;

    const master = ctx.createGain();
    master.gain.setValueAtTime(0, now);
    master.gain.linearRampToValueAtTime(TARGET_GAIN, now + FADE_IN_SEC);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(FILTER_HZ, now);
    filter.Q.setValueAtTime(FILTER_Q, now);

    const oscillators = VOICES.map((v) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(v.hz, now);
      osc.detune.setValueAtTime(v.detuneCents, now);
      osc.connect(filter);
      osc.start(now);
      return osc;
    });

    filter.connect(master);
    master.connect(ctx.destination);

    // Slow breath: LFO sums into master.gain via lfoGain (depth = LFO_DEPTH).
    const lfo = ctx.createOscillator();
    lfo.type = 'triangle';
    lfo.frequency.setValueAtTime(LFO_HZ, now);
    const lfoGain = ctx.createGain();
    lfoGain.gain.setValueAtTime(LFO_DEPTH, now);
    lfo.connect(lfoGain);
    lfoGain.connect(master.gain);
    lfo.start(now);

    active = { ctx, master, lfoGain, filter, oscillators, lfo, stopTimer: null };
  } catch {
    active = null;
  }
}

export function stopThinkingDrone(): void {
  const a = active;
  if (!a) return;
  active = null;
  try {
    const now = a.ctx.currentTime;
    a.master.gain.cancelScheduledValues(now);
    a.master.gain.setValueAtTime(a.master.gain.value, now);
    a.master.gain.linearRampToValueAtTime(0, now + FADE_OUT_SEC);
    a.lfoGain.gain.cancelScheduledValues(now);
    a.lfoGain.gain.setValueAtTime(a.lfoGain.gain.value, now);
    a.lfoGain.gain.linearRampToValueAtTime(0, now + FADE_OUT_SEC);
    const stopAt = now + FADE_OUT_SEC + 0.05;
    for (const osc of a.oscillators) osc.stop(stopAt);
    a.lfo.stop(stopAt);
    a.stopTimer = window.setTimeout(() => {
      try {
        a.master.disconnect();
        a.filter.disconnect();
        a.lfoGain.disconnect();
      } catch {
        /* ignore */
      }
    }, (FADE_OUT_SEC + 0.1) * 1000);
  } catch {
    /* ignore */
  }
}
