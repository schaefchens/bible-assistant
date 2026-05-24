import { usePlaybackStore } from '@/store/playbackStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { Translation } from '@/services/bible/bibleApi';

export type BrowserTtsItem = {
  messageId: string;
  verseIndex: number;
  text: string;
  /** Optional — picks a system voice matching the verse's language. */
  translation?: Translation;
};

function isSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

function langForTranslation(t: Translation | undefined, fallback: string): string {
  if (!t) return fallback;
  if (t === 'S00' || t === 'LUT' || t === 'HFA') return 'de-DE';
  return 'en-US';
}

function pickVoice(targetLang: string): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return null;
  const target = targetLang.toLowerCase();
  const base = target.split('-')[0];
  // Prefer exact match, then language-family match, then default.
  return (
    voices.find((v) => v.lang.toLowerCase() === target && v.default) ||
    voices.find((v) => v.lang.toLowerCase() === target) ||
    voices.find((v) => v.lang.toLowerCase().startsWith(base) && v.default) ||
    voices.find((v) => v.lang.toLowerCase().startsWith(base)) ||
    voices.find((v) => v.default) ||
    voices[0]
  );
}

// SpeechSynthesis fires `voiceschanged` asynchronously on some browsers
// (notably Chrome). Resolve once at least one voice is available.
function ensureVoicesReady(timeoutMs = 1500): Promise<void> {
  return new Promise((resolve) => {
    if (!isSupported()) return resolve();
    if (window.speechSynthesis.getVoices().length > 0) return resolve();
    const onChange = () => {
      window.speechSynthesis.removeEventListener('voiceschanged', onChange);
      resolve();
    };
    window.speechSynthesis.addEventListener('voiceschanged', onChange);
    setTimeout(() => {
      window.speechSynthesis.removeEventListener('voiceschanged', onChange);
      resolve();
    }, timeoutMs);
  });
}

class BrowserTtsManager {
  private queue: BrowserTtsItem[] = [];
  private currentIndex = 0;
  private current: SpeechSynthesisUtterance | null = null;
  private rate = 1;
  private active = false;

  /** True while the engine owns playback (queue running or paused). */
  isActive(): boolean {
    return this.active;
  }

  isSupported(): boolean {
    return isSupported();
  }

  setRate(rate: number): void {
    this.rate = Math.max(0.25, Math.min(4, rate));
    if (this.current) this.current.rate = this.rate;
  }

  getRate(): number {
    return this.rate;
  }

  async speakQueue(items: BrowserTtsItem[]): Promise<void> {
    if (!isSupported() || items.length === 0) return;
    this.stop();
    await ensureVoicesReady();
    this.queue = items;
    this.currentIndex = 0;
    this.active = true;
    this.playCurrent();
  }

  /**
   * Append to an active queue, or start fresh. Mirrors audioPlayback.enqueue.
   */
  async enqueue(items: BrowserTtsItem[]): Promise<void> {
    if (items.length === 0) return;
    if (this.active && this.currentIndex < this.queue.length) {
      this.queue = [...this.queue, ...items];
      return;
    }
    await this.speakQueue(items);
  }

  private playCurrent(): void {
    if (this.currentIndex >= this.queue.length) {
      this.cleanup();
      return;
    }
    const item = this.queue[this.currentIndex];
    const { locale, speechVolume } = useSettingsStore.getState();
    const fallbackLang = locale === 'de' ? 'de-DE' : 'en-US';
    const lang = langForTranslation(item.translation, fallbackLang);
    const voice = pickVoice(lang);

    const utter = new SpeechSynthesisUtterance(item.text);
    utter.lang = voice?.lang || lang;
    if (voice) utter.voice = voice;
    utter.rate = this.rate;
    utter.volume = speechVolume;
    utter.onend = () => {
      // Only advance if this is still the active utterance — stop() nulls it.
      if (this.current !== utter) return;
      this.currentIndex++;
      this.playCurrent();
    };
    utter.onerror = () => {
      if (this.current !== utter) return;
      this.currentIndex++;
      this.playCurrent();
    };
    this.current = utter;
    window.speechSynthesis.speak(utter);

    usePlaybackStore.getState().setCurrent({
      messageId: item.messageId,
      verseIndex: item.verseIndex,
      totalVerses: this.queue.length,
      audioUrl: '',
      position: 0,
      duration: 0,
      currentWordIndex: -1,
    });
    usePlaybackStore.getState().setStatus('playing');
  }

  pause(): void {
    if (!isSupported() || !this.active) return;
    if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
      window.speechSynthesis.pause();
      usePlaybackStore.getState().setStatus('paused');
    }
  }

  resume(): void {
    if (!isSupported() || !this.active) return;
    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
      usePlaybackStore.getState().setStatus('playing');
    }
  }

  toggle(): void {
    if (!this.active) return;
    if (window.speechSynthesis.paused) this.resume();
    else this.pause();
  }

  stop(): void {
    const wasActive = this.active;
    this.active = false;
    if (this.current) this.current.onend = null;
    this.current = null;
    this.queue = [];
    this.currentIndex = 0;
    if (isSupported()) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        /* ignore */
      }
    }
    if (wasActive) {
      usePlaybackStore.getState().setStatus('idle');
      usePlaybackStore.getState().setCurrent(null);
    }
  }

  private cleanup(): void {
    this.active = false;
    this.current = null;
    this.queue = [];
    this.currentIndex = 0;
    usePlaybackStore.getState().setStatus('idle');
    usePlaybackStore.getState().setCurrent(null);
  }
}

export const browserTts = new BrowserTtsManager();
