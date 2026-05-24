import { useCallback, useEffect, useRef, useState } from 'react';
import { useSettingsStore } from '@/store/settingsStore';
import { postTranscribe } from '@/services/api/transcribe';
import { describeMicError, micConstraints, pickMicMime } from '@/lib/micRecord';
import { playMicCue } from '@/lib/micCue';
import { nudgeIosPlaybackRouting } from '@/lib/iosAudioRouting';
import { audioPlayback } from '@/lib/audioPlaybackManager';

type SpeechRecognitionAlternative = { transcript: string; confidence: number };
type SpeechRecognitionResultLike = ArrayLike<SpeechRecognitionAlternative> & {
  isFinal: boolean;
  length: number;
};
type SpeechRecognitionEventLike = Event & {
  results: ArrayLike<SpeechRecognitionResultLike> & { length: number };
  resultIndex: number;
};

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: Event) => void) | null;
  onend: (() => void) | null;
};

function getSpeechRecognitionCtor(): { new (): SpeechRecognitionLike } | null {
  const w = window as typeof window & {
    SpeechRecognition?: { new (): SpeechRecognitionLike };
    webkitSpeechRecognition?: { new (): SpeechRecognitionLike };
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// iOS Safari exposes `webkitSpeechRecognition` but it's unreliable — it
// often fires `onerror` ('audio-capture'/'no-speech') almost immediately,
// which forced a Whisper fallback that flickered the listening state and
// triggered duplicate start/stop cues. Skipping it on iOS goes straight to
// Whisper and avoids the start → stop → start dance.
function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS 13+ identifies as MacIntel with touch points.
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

export type UseSpeechResult = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  listening: boolean;
  transcript: string;
  available: boolean;
  error: string | null;
};

export function useSpeechRecognition(onFinal: (text: string) => void): UseSpeechResult {
  const locale = useSettingsStore((s) => s.locale);
  const useWhisperFallback = useSettingsStore((s) => s.useWhisperFallback);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const onFinalRef = useRef(onFinal);

  useEffect(() => {
    onFinalRef.current = onFinal;
  }, [onFinal]);

  const rawSpeechCtor = getSpeechRecognitionCtor();
  // On iOS prefer Whisper directly when it's available.
  const speechCtor =
    isIos() && useWhisperFallback ? null : rawSpeechCtor;
  const available = speechCtor !== null || useWhisperFallback;

  const startWhisper = useCallback(async (silent = false) => {
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia(micConstraints());
      const mime = pickMicMime();
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      mr.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      mr.onstop = async () => {
        playMicCue('stop');
        stream?.getTracks().forEach((t) => t.stop());
        // Nudge iOS back to the playback audio category so system volume
        // and TTS loudness return to normal.
        nudgeIosPlaybackRouting(audioPlayback.getContext());
        const type = mr.mimeType || mime || 'application/octet-stream';
        const blob = new Blob(chunksRef.current, { type });
        setListening(false);
        try {
          const { text } = await postTranscribe(blob, locale);
          setTranscript(text);
          if (text) onFinalRef.current(text);
        } catch (e) {
          setError(e instanceof Error ? e.message : 'transcribe failed');
        }
      };
      mediaRecorderRef.current = mr;
      mr.start();
      setListening(true);
      if (!silent) playMicCue('start');
      return true;
    } catch (e) {
      stream?.getTracks().forEach((t) => t.stop());
      nudgeIosPlaybackRouting(audioPlayback.getContext());
      const msg = describeMicError(e);
      setError(msg);
      return false;
    }
  }, [locale]);

  const start = useCallback(async () => {
    setError(null);
    setTranscript('');
    if (speechCtor) {
      try {
        const rec = new speechCtor();
        rec.lang = locale === 'de' ? 'de-DE' : 'en-US';
        rec.continuous = false;
        rec.interimResults = true;
        let producedTranscript = false;
        let fallingBack = false;
        rec.onresult = (e: SpeechRecognitionEventLike) => {
          let finalText = '';
          let interim = '';
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const result = e.results[i];
            const alt = result[0];
            if (result.isFinal) finalText += alt.transcript;
            else interim += alt.transcript;
          }
          setTranscript(interim || finalText);
          if (finalText) {
            producedTranscript = true;
            onFinalRef.current(finalText.trim());
          }
        };
        rec.onerror = (ev: Event) => {
          const errName = (ev as Event & { error?: string }).error ?? 'speech error';
          const shouldFallback =
            useWhisperFallback &&
            !producedTranscript &&
            (errName === 'not-allowed' ||
              errName === 'service-not-allowed' ||
              errName === 'audio-capture' ||
              errName === 'network' ||
              errName === 'aborted' ||
              errName === 'no-speech');
          if (shouldFallback) {
            // Set BEFORE the async work so onend (which may fire next) skips
            // both the listening flicker and the duplicate stop cue.
            fallingBack = true;
            void startWhisper(true).then((ok) => {
              if (!ok) {
                setError(`Web Speech ${errName}; Whisper failed`);
                setListening(false);
              }
            });
            return;
          }
          setListening(false);
          setError(`Web Speech ${errName}`);
        };
        rec.onend = () => {
          if (fallingBack) return;
          setListening(false);
          playMicCue('stop');
        };
        recognitionRef.current = rec;
        rec.start();
        setListening(true);
        playMicCue('start');
        return;
      } catch (e) {
        console.warn('SpeechRecognition failed, falling back', e);
      }
    }

    if (!useWhisperFallback) {
      setError('Speech recognition not available');
      return;
    }
    await startWhisper();
  }, [speechCtor, locale, useWhisperFallback, startWhisper]);

  const stop = useCallback(async () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        /* ignore */
      }
      recognitionRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  }, []);

  return { start, stop, listening, transcript, available, error };
}
