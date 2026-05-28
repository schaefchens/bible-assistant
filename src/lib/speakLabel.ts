import { useSettingsStore } from '@/store/settingsStore';

// Read a short button label aloud via Web Speech Synthesis. Used by the
// eyes-free overlay's long-press handler so the user can identify a zone
// without triggering its action.
//
// Cancels any prior label utterance so rapid long-presses always speak the
// latest. Note: this also cancels in-flight browser-voice readings, but
// the main reading pipeline uses OpenAI TTS via AudioContext (not
// speechSynthesis), so it is unaffected.

export function speakLabel(text: string): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  if (!text) return;
  try {
    window.speechSynthesis.cancel();
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
