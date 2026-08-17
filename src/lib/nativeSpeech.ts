import { Capacitor } from '@capacitor/core';
import { SpeechRecognition } from '@capgo/capacitor-speech-recognition';
import type { PluginListenerHandle } from '@capacitor/core';

/**
 * On-device speech recognition — iOS `SFSpeechRecognizer`, Android
 * `SpeechRecognizer` — replacing the MediaRecorder → Whisper round-trip on
 * native builds.
 *
 * Why this is worth having over Whisper:
 *   - No upload, so it responds while the user is still speaking (partial
 *     results) instead of after a round-trip.
 *   - No OpenAI cost per utterance, and it works with no network.
 *   - It never calls getUserMedia, so the WKWebView audio-session hijack that
 *     `iosAudioRouting.ts` exists to paper over simply doesn't happen.
 *
 * Whisper stays as the fallback: it's the only path on the web build, and it
 * handles the case where recognition is unavailable or permission is refused.
 */

export type NativeSpeechHandlers = {
  language: string;
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (message: string) => void;
  /** Fired once when the session has stopped, for any reason. */
  onEnd: () => void;
};

let handles: PluginListenerHandle[] = [];
/** Latest text seen this session; used as the final result when it stops. */
let accumulated = '';
let ended = false;

export function nativeSpeechSupported(): boolean {
  return Capacitor.isNativePlatform();
}

/** True when recognition is usable — installed, supported, and permitted. */
export async function nativeSpeechAvailable(): Promise<boolean> {
  if (!nativeSpeechSupported()) return false;
  try {
    const { available } = await SpeechRecognition.available();
    return available;
  } catch {
    return false;
  }
}

async function ensurePermission(): Promise<boolean> {
  try {
    const status = await SpeechRecognition.checkPermissions();
    if (status.speechRecognition === 'granted') return true;
    const asked = await SpeechRecognition.requestPermissions();
    return asked.speechRecognition === 'granted';
  } catch {
    return false;
  }
}

async function clearListeners(): Promise<void> {
  const current = handles;
  handles = [];
  await Promise.all(current.map((h) => h.remove().catch(() => {})));
}

/**
 * Begin a recognition session. Resolves true once listening has started.
 * Returns false when unavailable or not permitted, so the caller can fall
 * back to Whisper.
 */
export async function startNativeSpeech(h: NativeSpeechHandlers): Promise<boolean> {
  if (!nativeSpeechSupported()) return false;
  if (!(await nativeSpeechAvailable())) return false;
  if (!(await ensurePermission())) return false;

  await clearListeners();
  accumulated = '';
  ended = false;

  const finish = () => {
    if (ended) return;
    ended = true;
    const text = accumulated.trim();
    if (text) h.onFinal(text);
    h.onEnd();
    void clearListeners();
  };

  try {
    handles.push(
      await SpeechRecognition.addListener('partialResults', (ev) => {
        // The plugin reports partials differently per platform: an accumulated
        // string on iOS, a matches array on Android. Take whichever is present.
        const text = ev.accumulatedText ?? ev.accumulated ?? ev.matches?.[0] ?? '';
        if (!text) return;
        accumulated = text;
        h.onPartial(text);
      }),
    );

    handles.push(
      await SpeechRecognition.addListener('listeningState', (ev) => {
        if (ev.state === 'stopped' || ev.status === 'stopped') finish();
      }),
    );

    handles.push(
      await SpeechRecognition.addListener('error', (ev) => {
        // "No speech detected" is a normal end to a push-to-talk press, not a
        // failure worth showing the user.
        const benign = /no match|no speech|speech timeout|7|6/i.test(
          `${ev.code} ${ev.message}`,
        );
        if (!benign) h.onError(ev.message || ev.code || 'speech error');
        finish();
      }),
    );

    // `popup: false` keeps Android off the system recognition dialog — this is
    // a hands-free reader, a modal would defeat the point.
    const result = await SpeechRecognition.start({
      language: h.language,
      partialResults: true,
      popup: false,
      maxResults: 1,
      addPunctuation: true,
    });

    // Some platforms resolve start() with the final matches instead of (or as
    // well as) emitting listeningState:stopped.
    const direct = result?.matches?.[0];
    if (direct) {
      accumulated = direct;
      finish();
    }
    return true;
  } catch (e) {
    await clearListeners();
    h.onError(e instanceof Error ? e.message : 'speech start failed');
    return false;
  }
}

export async function stopNativeSpeech(): Promise<void> {
  if (!nativeSpeechSupported()) return;
  try {
    await SpeechRecognition.stop();
  } catch {
    // Already stopped, or never started.
  }
}
