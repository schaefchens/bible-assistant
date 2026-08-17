import { usePlaybackStore } from '@/store/playbackStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { Translation } from '@/services/bible/bibleApi';
import { bcp47ForTranslation } from './translationLocaleMap';
import { cancelNative, nativeTtsSupported, speakNative } from './nativeTts';

export type BrowserTtsItem = {
  messageId: string;
  verseIndex: number;
  text: string;
  /** Optional — picks a system voice matching the verse's language. */
  translation?: Translation;
  /** Wait this many ms before advancing to the next item. Music keeps
   * playing because ambient runs on a separate Web Audio bus. */
  pauseAfterMs?: number;
  /** False for heading / verse-number announcements (so tap-to-seek can
   * tell the difference). Defaults to true. */
  isVerse?: boolean;
};

/** True when the web SpeechSynthesis API exists. It does NOT in either native
 * WebView — measured: `speechSynthesis` is undefined in the Android WebView —
 * which is why the native engine below exists. */
function webSpeechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/** Native builds drive the system TTS plugin instead. (Not named use* — that
 * is reserved for React hooks, and ESLint rightly enforces it.) */
function nativeEngine(): boolean {
  return nativeTtsSupported();
}

function isSupported(): boolean {
  return nativeEngine() || webSpeechSupported();
}

function langForTranslation(t: Translation | undefined, fallback: string): string {
  if (!t) return fallback;
  return bcp47ForTranslation(t);
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
    // The plugin manages its own voice list; nothing to wait for.
    if (nativeEngine() || !webSpeechSupported()) return resolve();
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
  private pauseTimer: number | null = null;
  // Queue played out but state is held briefly so a follow-up enqueue can
  // bridge into one playlist.
  private softEnded = false;
  private softEndTimer: number | null = null;
  private readonly SOFT_END_GRACE_MS = 60_000;
  // Ducking. SpeechSynthesis has no per-utterance volume control we can
  // change mid-flight, so ducking pauses the engine; unduck resumes only
  // if it was actually playing when we ducked.
  private ducked = false;
  /** Identifies the in-flight native utterance, so a completion that arrives
   * after a stop/pause/supersede can be discarded. The native engine has no
   * utterance object to compare against the way the web one does. */
  private nativeSeq = 0;
  /** Native TTS has no pause, so paused-ness is tracked here and resume()
   * re-speaks the current item. */
  private nativePaused = false;
  private wasSpeakingWhenDucked = false;

  /** True while the engine owns playback (running, paused, OR soft-ended
   * within the playlist-bridge grace window). */
  isActive(): boolean {
    return this.active || this.softEnded;
  }

  /** True only when the queue played to its natural end and state is held
   * for the playlist-bridge grace window. */
  isSoftEnded(): boolean {
    return this.softEnded;
  }

  isSupported(): boolean {
    return isSupported();
  }

  /** Pause the SpeechSynthesis engine for the duration of a mic capture. */
  duck(): void {
    if (this.ducked || !isSupported()) return;
    this.ducked = true;
    if (nativeEngine()) {
      this.wasSpeakingWhenDucked = this.active && !this.nativePaused;
      if (this.wasSpeakingWhenDucked) this.pause();
      return;
    }
    this.wasSpeakingWhenDucked =
      window.speechSynthesis.speaking && !window.speechSynthesis.paused;
    if (this.wasSpeakingWhenDucked) {
      try {
        window.speechSynthesis.pause();
      } catch {
        /* ignore */
      }
    }
  }

  unduck(): void {
    if (!this.ducked) return;
    this.ducked = false;
    if (this.wasSpeakingWhenDucked && isSupported()) {
      if (nativeEngine()) {
        this.resume();
        this.wasSpeakingWhenDucked = false;
        return;
      }
      try {
        window.speechSynthesis.resume();
      } catch {
        /* ignore */
      }
    }
    this.wasSpeakingWhenDucked = false;
  }

  /** Snapshot of the queue + position (for the playback controller). */
  getQueueSnapshot(): { items: BrowserTtsItem[]; currentIndex: number } {
    return { items: this.queue.slice(), currentIndex: this.currentIndex };
  }

  /** Same semantics as audioPlayback.replaceUpcomingFor — replace the
   * contiguous block of upcoming items for `messageId`. */
  replaceUpcomingFor(messageId: string, newItems: BrowserTtsItem[]): void {
    const startIdx = this.queue.findIndex(
      (it, i) => i > this.currentIndex && it.messageId === messageId,
    );
    if (startIdx < 0) {
      this.queue = [
        ...this.queue.slice(0, this.currentIndex + 1),
        ...newItems,
        ...this.queue.slice(this.currentIndex + 1),
      ];
      return;
    }
    let endIdx = startIdx;
    while (endIdx < this.queue.length && this.queue[endIdx].messageId === messageId) {
      endIdx++;
    }
    this.queue = [
      ...this.queue.slice(0, startIdx),
      ...newItems,
      ...this.queue.slice(endIdx),
    ];
  }

  setRate(rate: number): void {
    this.rate = Math.max(0.25, Math.min(4, rate));
    if (this.current) this.current.rate = this.rate;
  }

  getRate(): number {
    return this.rate;
  }

  /**
   * Speak a single utterance immediately, OUTSIDE the reading queue (used for
   * an assistant reply that interjects over a reading). Deliberately does not
   * set `active`, so the engine isn't treated as "the reading engine" — the
   * caller pauses/resumes the actual reading around this. Calls onEnd when the
   * utterance finishes or errors.
   */
  async speakOneShot(text: string, lang: string, onEnd: () => void): Promise<void> {
    if (!isSupported() || !text.trim()) {
      onEnd();
      return;
    }
    await ensureVoicesReady();
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      onEnd();
    };

    if (nativeEngine()) {
      // Note: the plugin speaks one utterance at a time, so this necessarily
      // supersedes any in-flight reading utterance (speakNative bumps a shared
      // token). That's safe only because callers pause the reading before
      // interjecting and resume it from `onEnd` — see assistantSpeech.ts. Don't
      // call this while a reading is actively speaking.
      speakNative(
        text,
        {
          lang,
          rate: this.rate,
          volume: useSettingsStore.getState().speechVolume,
        },
        finish,
      );
      return;
    }

    const voice = pickVoice(lang);
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = voice?.lang || lang;
    if (voice) utter.voice = voice;
    utter.rate = this.rate;
    utter.volume = useSettingsStore.getState().speechVolume;
    utter.onend = finish;
    utter.onerror = finish;
    window.speechSynthesis.speak(utter);
  }

  async speakQueue(items: BrowserTtsItem[]): Promise<void> {
    if (!isSupported() || items.length === 0) return;
    // stop() already clears softEnded/softEndTimer.
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

    const stillPlaying = this.active && this.currentIndex < this.queue.length;
    const bridgingFromSoftEnd = this.softEnded && this.queue.length > 0;

    if (stillPlaying || bridgingFromSoftEnd) {
      // Bridge the boundary between two readings with a chapter-length pause.
      const bridge = useSettingsStore.getState().pauseBetweenChaptersMs;
      if (bridge > 0) {
        const tail = this.queue[this.queue.length - 1];
        this.queue[this.queue.length - 1] = {
          ...tail,
          pauseAfterMs: bridge,
        };
      }
      const firstNewIdx = this.queue.length;
      this.queue = [...this.queue, ...items];

      if (bridgingFromSoftEnd) {
        this.softEnded = false;
        if (this.softEndTimer !== null) {
          clearTimeout(this.softEndTimer);
          this.softEndTimer = null;
        }
        this.active = true;
        this.currentIndex = firstNewIdx;
        const advance = () => {
          this.pauseTimer = null;
          this.playCurrent();
        };
        if (bridge > 0) {
          if (this.pauseTimer !== null) clearTimeout(this.pauseTimer);
          this.pauseTimer = window.setTimeout(advance, bridge);
        } else {
          advance();
        }
      }
      return;
    }
    await this.speakQueue(items);
  }

  private playCurrent(): void {
    if (this.currentIndex >= this.queue.length) {
      this.softEnd();
      return;
    }
    const startedAt = this.currentIndex;
    const item = this.queue[startedAt];
    const { locale, speechVolume } = useSettingsStore.getState();
    const fallbackLang = locale === 'de' ? 'de-DE' : 'en-US';
    const lang = langForTranslation(item.translation, fallbackLang);

    const advanceFrom = (startIdx: number) => {
      // Re-read from the queue so a mid-flight enqueue that patched our
      // pauseAfterMs (to bridge two readings) is honored.
      const gap = this.queue[startIdx]?.pauseAfterMs ?? 0;
      this.currentIndex = startIdx + 1;
      if (gap > 0 && this.currentIndex < this.queue.length) {
        if (this.pauseTimer !== null) clearTimeout(this.pauseTimer);
        this.pauseTimer = window.setTimeout(() => {
          this.pauseTimer = null;
          this.playCurrent();
        }, gap);
      } else {
        this.playCurrent();
      }
    };

    const publish = () => {
      usePlaybackStore.getState().setCurrent({
        messageId: item.messageId,
        verseIndex: item.verseIndex,
        totalVerses: this.queue.length,
        audioUrl: '',
        position: 0,
        duration: 0,
        currentWordIndex: -1,
        isVerse: item.isVerse !== false,
      });
      usePlaybackStore.getState().setStatus('playing');
    };

    if (nativeEngine()) {
      // No utterance object to hang state off, so `nativeSeq` plays the role
      // `this.current` plays for the web engine: it identifies which utterance
      // a completion belongs to.
      const seq = ++this.nativeSeq;
      this.current = null;
      speakNative(item.text, { lang, rate: this.rate, volume: speechVolume }, () => {
        if (seq !== this.nativeSeq) return; // stopped, ducked, or superseded
        advanceFrom(startedAt);
      });
      publish();
      return;
    }

    const voice = pickVoice(lang);
    const utter = new SpeechSynthesisUtterance(item.text);
    utter.lang = voice?.lang || lang;
    if (voice) utter.voice = voice;
    utter.rate = this.rate;
    utter.volume = speechVolume;
    const advance = () => {
      // Only advance if this is still the active utterance — stop() nulls it.
      if (this.current !== utter) return;
      advanceFrom(startedAt);
    };
    utter.onend = advance;
    utter.onerror = advance;
    this.current = utter;
    window.speechSynthesis.speak(utter);
    publish();
  }

  pause(): void {
    if (!isSupported() || !this.active) return;
    if (nativeEngine()) {
      // The plugin has no pause. Stop, and remember that we're mid-item so
      // resume() can re-speak it. Items are per-verse, so the cost is
      // repeating one verse rather than losing the reading's place.
      if (this.nativePaused) return;
      this.nativePaused = true;
      this.nativeSeq++; // invalidate the in-flight completion
      cancelNative();
      usePlaybackStore.getState().setStatus('paused');
      return;
    }
    if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
      window.speechSynthesis.pause();
      usePlaybackStore.getState().setStatus('paused');
    }
  }

  resume(): void {
    if (!isSupported() || !this.active) return;
    if (nativeEngine()) {
      if (!this.nativePaused) return;
      this.nativePaused = false;
      // Re-speak the item we were on.
      this.playCurrent();
      return;
    }
    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
      usePlaybackStore.getState().setStatus('playing');
    }
  }

  toggle(): void {
    if (!this.active) return;
    if (nativeEngine()) {
      if (this.nativePaused) this.resume();
      else this.pause();
      return;
    }
    if (window.speechSynthesis.paused) this.resume();
    else this.pause();
  }

  stop(): void {
    const wasActive = this.active || this.softEnded;
    this.active = false;
    this.softEnded = false;
    if (this.pauseTimer !== null) {
      clearTimeout(this.pauseTimer);
      this.pauseTimer = null;
    }
    if (this.softEndTimer !== null) {
      clearTimeout(this.softEndTimer);
      this.softEndTimer = null;
    }
    if (this.current) this.current.onend = null;
    this.current = null;
    this.queue = [];
    this.currentIndex = 0;
    this.nativePaused = false;
    if (nativeEngine()) {
      this.nativeSeq++;
      cancelNative();
    } else if (webSpeechSupported()) {
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

  /**
   * Queue played to completion. Preserve queue + state for a brief grace
   * window so a follow-up enqueue can bridge into the same playlist; a
   * hard-stop fires if no follow-up arrives.
   */
  private softEnd(): void {
    this.active = false;
    if (this.pauseTimer !== null) {
      clearTimeout(this.pauseTimer);
      this.pauseTimer = null;
    }
    this.current = null;
    this.softEnded = true;
    usePlaybackStore.getState().setStatus('idle');
    usePlaybackStore.getState().setCurrent(null);
    if (this.softEndTimer !== null) clearTimeout(this.softEndTimer);
    this.softEndTimer = window.setTimeout(() => {
      this.softEndTimer = null;
      this.stop();
    }, this.SOFT_END_GRACE_MS);
  }
}

export const browserTts = new BrowserTtsManager();
