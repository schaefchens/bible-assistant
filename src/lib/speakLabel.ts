import {
  effectiveAssistantVoice,
  effectiveVoiceStyle,
  useSettingsStore,
} from '@/store/settingsStore';
import { isBrowserVoice, type OpenAiVoiceId } from '@/types/domain';
import { postTtsSpeak } from '@/services/api/tts';
import { audioPlayback } from './audioPlaybackManager';

// Speak a short eyes-free button label using whatever the user picked as
// their *assistant* voice (browser or one of the OpenAI voices). Mirrors
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

// Lazy cache keyed by (voice, locale, text). Labels are stable for the
// session so the first long-press of a given button pays the TTS round
// trip and decode; subsequent presses are instant.
const bufferCache = new Map<string, AudioBuffer>();
// Latest label source so a rapid second long-press cuts the previous one
// short instead of stacking voices.
let activeSource: AudioBufferSourceNode | null = null;

export async function speakLabel(text: string): Promise<void> {
  if (!text) return;
  const voice = effectiveAssistantVoice();
  const locale = useSettingsStore.getState().locale;

  if (isBrowserVoice(voice)) {
    speakViaBrowser(text, locale);
    return;
  }
  await speakViaOpenAi(text, voice as OpenAiVoiceId, locale);
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

async function speakViaOpenAi(
  text: string,
  voice: OpenAiVoiceId,
  locale: 'en' | 'de',
): Promise<void> {
  const key = `${voice}|${locale}|${text}`;
  let buf = bufferCache.get(key);
  if (!buf) {
    try {
      const tts = await postTtsSpeak({
        text,
        voice,
        voiceStyle: effectiveVoiceStyle() || undefined,
        language: locale,
      });
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
