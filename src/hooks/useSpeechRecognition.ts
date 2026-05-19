import { useCallback, useEffect, useRef, useState } from 'react';
import { useSettingsStore } from '@/store/settingsStore';
import { postTranscribe } from '@/services/api/transcribe';

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

  const speechCtor = getSpeechRecognitionCtor();
  const available = speechCtor !== null || useWhisperFallback;

  const startWhisper = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      chunksRef.current = [];
      mr.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
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
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'microphone unavailable');
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
        rec.onerror = async (ev: Event) => {
          const errName = (ev as Event & { error?: string }).error ?? 'speech error';
          setListening(false);
          // Fall back to Whisper for permission/availability errors when enabled.
          if (
            useWhisperFallback &&
            !producedTranscript &&
            (errName === 'not-allowed' || errName === 'service-not-allowed' || errName === 'audio-capture' || errName === 'network' || errName === 'aborted' || errName === 'no-speech')
          ) {
            const ok = await startWhisper();
            if (!ok) setError(`Web Speech ${errName}; Whisper failed`);
          } else {
            setError(`Web Speech ${errName}`);
          }
        };
        rec.onend = () => setListening(false);
        recognitionRef.current = rec;
        rec.start();
        setListening(true);
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
