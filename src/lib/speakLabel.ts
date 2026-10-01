import { useSettingsStore } from '@/store/settingsStore';
import { postTtsSpeak } from '@/services/api/tts';
import { voiceKeyPart, type TtsVoice } from '@/services/voices/ttsVoice';
import { audioPlayback } from './audioPlaybackManager';
import { currentAssistantVoice } from './narrationVoice';

// Speak a short eyes-free button label using whatever the user picked as
// their *assistant* voice (the device voice or a narration voice). Mirrors
// the canonical pattern in useCommandPipeline (which speaks chat replies)
// but plays via a parallel AudioContext channel so the label rides on top
// of any active verse reading instead of pausing or queueing it.

let primed = false;

// iOS Safari refuses to play speechSynthesis utterances scheduled outside
// a user-gesture callback — our long-press fires from a setTimeout so it
// doesn't qualify. Call this synchronously inside pointerdown to "unlock"
// the API; subsequent timer-deferred speak() calls then work for the rest
// of the page lifetime. Non-empty, audible utterance — empty/zero-volume
// warmups were observed to silently no-op without unlocking.
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

// Lazy cache keyed by (audible voice, locale, text) — the whole voice, style
// included, or a style change would keep replaying the old one. Labels are stable for the
// session so the first long-press of a given button pays the TTS round
// trip and decode; subsequent presses are instant.
const bufferCache = new Map<string, AudioBuffer>();
// Latest label source so a rapid second long-press cuts the previous one
// short instead of stacking voices.
let activeSource: AudioBufferSourceNode | null = null;

export async function speakLabel(text: string): Promise<void> {
  if (!text) return;
  const voice = currentAssistantVoice();
  const locale = useSettingsStore.getState().locale;

  if (voice.provider === 'device') {
    speakViaBrowser(text, locale);
    return;
  }
  await speakViaServer(text, voice, locale);
}

function speakViaBrowser(text: string, locale: 'en' | 'de'): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  try {
    // iOS sometimes leaves the queue paused after cancel(); resume() is a
    // no-op when already running and recovers when it isn't.
    window.speechSynthesis.cancel();
    window.speechSynthesis.resume();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = locale === 'de' ? 'de-DE' : 'en-US';
    utterance.rate = 1.0;
    utterance.volume = 1.0;
    window.speechSynthesis.speak(utterance);
  } catch {
    /* ignore — speech synthesis is best-effort */
  }
}

async function speakViaServer(text: string, voice: TtsVoice, locale: 'en' | 'de'): Promise<void> {
  const key = `${voiceKeyPart(voice)}|${locale}|${text}`;
  let buf = bufferCache.get(key);
  if (!buf) {
    try {
      const tts = await postTtsSpeak({ text, voice, language: locale });
      const resp = await fetch(tts.audioUrl);
      const arr = await resp.arrayBuffer();
      const ctx = audioPlayback.ensureContext();
      buf = await ctx.decodeAudioData(arr);
      bufferCache.set(key, buf);
    } catch {
      return;
    }
  }
  try {
    const ctx = audioPlayback.ensureContext();
    if (activeSource) {
      try {
        activeSource.stop();
      } catch {
        /* may already be stopped */
      }
      activeSource = null;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    // Bypass ttsGain — same trick as playZoneTick. The label rides on top
    // of any active verse reading instead of pausing the queue.
    src.connect(ctx.destination);
    src.start();
    activeSource = src;
    src.onended = () => {
      if (activeSource === src) activeSource = null;
    };
  } catch {
    /* ignore */
  }
}
