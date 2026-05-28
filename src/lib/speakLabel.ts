import { useSettingsStore } from '@/store/settingsStore';

// Read a short button label aloud via Web Speech Synthesis. Used by the
// eyes-free overlay's long-press handler so the user can identify a zone
// without triggering its action.
//
// Cancels any prior label utterance so rapid long-presses always speak
// the latest. Note: this also cancels in-flight browser-voice readings,
// but the main reading pipeline uses OpenAI TTS via AudioContext (not
// speechSynthesis), so it is unaffected.

let primed = false;

// iOS Safari refuses to play speechSynthesis utterances that were
// scheduled outside a user-gesture callback — and our long-press fires
// from a setTimeout, so it doesn't qualify. Call this synchronously
// inside pointerdown to "unlock" the API; subsequent timer-deferred
// speak() calls then work for the rest of the page lifetime.
//
// iOS specifically wants a non-empty utterance with audible volume and
// no overridden language to count as a real "speak" event for the
// gesture lock. Empty strings or volume-0 utterances were observed to
// silently no-op without unlocking.
export function primeSpeechSynthesis(): void {
  if (primed) return;
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  try {
    const warmup = new SpeechSynthesisUtterance(' ');
    window.speechSynthesis.speak(warmup);
    primed = true;
  } catch {
    /* ignore — best effort */
  }
}

export function speakLabel(text: string): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  if (!text) return;
  try {
    // iOS sometimes leaves the queue paused after cancel(); resume()
    // is a no-op when already running and recovers when it isn't.
    window.speechSynthesis.cancel();
    window.speechSynthesis.resume();
    const utterance = new SpeechSynthesisUtterance(text);
    const locale = useSettingsStore.getState().locale;
    utterance.lang = locale === 'de' ? 'de-DE' : 'en-US';
    utterance.rate = 1.0;
    utterance.volume = 1.0;
    window.speechSynthesis.speak(utterance);
  } catch {
    /* ignore — speech synthesis is best-effort */
  }
}
