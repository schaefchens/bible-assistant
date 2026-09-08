import { audioPlayback } from './audioPlaybackManager';
import { useSettingsStore } from '@/store/settingsStore';

/**
 * Deep, subtle drone played while the assistant is "thinking" (transcribe →
 * API → tool result), so a long processing pause feels alive instead of dead.
 * Pulses: a hum (fade-in → hold → fade-out) followed by a 3 s silence,
 * looping until stopped — so the ear doesn't tune it out as a flat tone.
 * Uses the shared AudioContext so iOS doesn't need a fresh gesture mid-cycle.
 */

type DroneNodes = {
  ctx: AudioContext;
  master: GainNode;
  lfoGain: GainNode;
  filter: BiquadFilterNode;
  oscillators: OscillatorNode[];
  lfo: OscillatorNode;
  cycleTimer: number | null;
  stopTimer: number | null;
};

let active: DroneNodes | null = null;

const STOP_FADE_SEC = 0.4;
const TARGET_GAIN = 0.06;
const LFO_DEPTH = 0.015;
const LFO_HZ = 0.08;
const FILTER_Q = 0.7;

// One pulse: silent → rise → hold → fall → silent. Repeats.
const CYCLE_FADE_IN_SEC = 0.4;
const CYCLE_HOLD_SEC = 2.0;
const CYCLE_FADE_OUT_SEC = 0.8;
const CYCLE_SILENCE_SEC = 3.0;
// Wait this long after start() before the first pulse — short processing
// bursts finish inside the window and the drone never fires.
const INITIAL_DELAY_SEC = 3.0;

// Root + a perfect fifth (sine, paired ±3¢ detune for slow chorus).
// Desktop/laptop gets the deep C2 + G2 fundamentals — good speakers /
// headphones reproduce them and they sound warm. Phone speakers can't
// move sub-100 Hz air, so on mobile we bump the same chord up one octave
// (C3 + G3) and open the lowpass to let the new fundamentals through.
const DESKTOP_VOICES: Array<{ hz: number; detuneCents: number }> = [
  { hz: 65.41, detuneCents: -3 },
  { hz: 65.41, detuneCents: +3 },
  { hz: 98.0, detuneCents: -3 },
  { hz: 98.0, detuneCents: +3 },
];
const MOBILE_VOICES: Array<{ hz: number; detuneCents: number }> = [
  { hz: 130.81, detuneCents: -3 },
  { hz: 130.81, detuneCents: +3 },
  { hz: 196.0, detuneCents: -3 },
  { hz: 196.0, detuneCents: +3 },
];

const isMobile =
  typeof navigator !== 'undefined' &&
  /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
const VOICES = isMobile ? MOBILE_VOICES : DESKTOP_VOICES;
const FILTER_HZ = isMobile ? 1500 : 600;

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

    // Slow breath: LFO sums into master.gain via lfoGain (depth = LFO_DEPTH
    // while humming, 0 during the silent gap so the pause is truly silent).
    const lfo = ctx.createOscillator();
    lfo.type = 'triangle';
    lfo.frequency.setValueAtTime(LFO_HZ, now);
    const lfoGain = ctx.createGain();
    lfoGain.gain.setValueAtTime(0, now);
    lfo.connect(lfoGain);
    lfoGain.connect(master.gain);
    lfo.start(now);

    const state: DroneNodes = {
      ctx,
      master,
      lfoGain,
      filter,
      oscillators,
      lfo,
      cycleTimer: null,
      stopTimer: null,
    };
    active = state;
    scheduleCycle(state, now + INITIAL_DELAY_SEC);
  } catch {
    active = null;
  }
}

function scheduleCycle(state: DroneNodes, startAt: number): void {
  const { ctx, master, lfoGain } = state;
  const fadeInEnd = startAt + CYCLE_FADE_IN_SEC;
  const holdEnd = fadeInEnd + CYCLE_HOLD_SEC;
  const fadeOutEnd = holdEnd + CYCLE_FADE_OUT_SEC;
  const cycleEnd = fadeOutEnd + CYCLE_SILENCE_SEC;

  // Master volume envelope.
  master.gain.cancelScheduledValues(startAt);
  master.gain.setValueAtTime(0, startAt);
  master.gain.linearRampToValueAtTime(TARGET_GAIN, fadeInEnd);
  master.gain.setValueAtTime(TARGET_GAIN, holdEnd);
  master.gain.linearRampToValueAtTime(0, fadeOutEnd);

  // LFO depth tracks the envelope so the breath only sums in while we're
  // audible. Otherwise the LFO would add ±LFO_DEPTH around master.gain=0
  // during silence — an unwanted faint wobble.
  lfoGain.gain.cancelScheduledValues(startAt);
  lfoGain.gain.setValueAtTime(0, startAt);
  lfoGain.gain.linearRampToValueAtTime(LFO_DEPTH, fadeInEnd);
  lfoGain.gain.setValueAtTime(LFO_DEPTH, holdEnd);
  lfoGain.gain.linearRampToValueAtTime(0, fadeOutEnd);

  // Re-schedule slightly before the silent gap ends so cycles chain without
  // a perceptible seam. AudioContext time is the source of truth; the
  // setTimeout is just a wake-up call.
  const msUntilNext = (cycleEnd - ctx.currentTime) * 1000 - 150;
  state.cycleTimer = window.setTimeout(
    () => {
      if (active !== state) return;
      scheduleCycle(state, cycleEnd);
    },
    Math.max(50, msUntilNext),
  );
}

export function stopThinkingDrone(): void {
  const a = active;
  if (!a) return;
  active = null;
  if (a.cycleTimer !== null) {
    clearTimeout(a.cycleTimer);
    a.cycleTimer = null;
  }
  try {
    const now = a.ctx.currentTime;
    a.master.gain.cancelScheduledValues(now);
    a.master.gain.setValueAtTime(a.master.gain.value, now);
    a.master.gain.linearRampToValueAtTime(0, now + STOP_FADE_SEC);
    a.lfoGain.gain.cancelScheduledValues(now);
    a.lfoGain.gain.setValueAtTime(a.lfoGain.gain.value, now);
    a.lfoGain.gain.linearRampToValueAtTime(0, now + STOP_FADE_SEC);
    const stopAt = now + STOP_FADE_SEC + 0.05;
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
    }, (STOP_FADE_SEC + 0.1) * 1000);
  } catch {
    /* ignore */
  }
}
