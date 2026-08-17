import { Capacitor } from '@capacitor/core';
import { TextToSpeech } from '@capacitor-community/text-to-speech';

/**
 * System text-to-speech for the "browser voice" reading path on native builds.
 *
 * This is not an optimisation — it's the only way that path works at all.
 * Measured in the Android WebView: `window.speechSynthesis` and
 * `SpeechSynthesisUtterance` are both **undefined**. Since the browser voice is
 * the default reading voice for anyone without a personal OpenAI key
 * (settingsStore's `assistantVoice: 'browser'`), the free-tier path was
 * silently dead on Android. The plugin reports 81 languages / 472 voices on the
 * same device.
 *
 * The plugin's surface is much thinner than SpeechSynthesis: `speak()` resolves
 * when the utterance finishes, and there is no pause/resume. `browserTts`
 * therefore emulates pause by stopping and re-speaking the current item — items
 * are per-verse, so the worst case is repeating one verse rather than losing the
 * reading's place.
 */

export function nativeTtsSupported(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Guards against a stale completion: `stop()` can't cancel an already-pending
 * `speak()` promise, so a bumped token makes the old resolution a no-op instead
 * of letting it advance the queue behind a newer utterance.
 */
let token = 0;

export type NativeSpeakOptions = {
  lang: string;
  rate: number;
  volume: number;
};

/** Speak one utterance; `onDone` fires once, on success or failure. */
export function speakNative(
  text: string,
  opts: NativeSpeakOptions,
  onDone: () => void,
): void {
  const mine = ++token;
  const settle = () => {
    if (mine !== token) return; // superseded by a stop() or a newer utterance
    onDone();
  };
  void TextToSpeech.speak({
    text,
    lang: opts.lang,
    // The plugin's rate is a plain multiplier like SpeechSynthesis's.
    rate: opts.rate,
    volume: opts.volume,
    // Replace anything queued: this manager owns sequencing itself, and
    // letting the platform queue would double up on the gap timing.
    queueStrategy: 0,
  })
    .then(settle)
    .catch(settle);
}

/** Stop immediately and invalidate any in-flight completion. */
export function cancelNative(): void {
  token++;
  void TextToSpeech.stop().catch(() => {
    /* nothing was speaking */
  });
}
