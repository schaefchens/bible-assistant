import { useCallback, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import { usePushToTalk } from '@/hooks/usePushToTalk';
import { useCommandPipeline } from '@/hooks/useCommandPipeline';
import { useGlobalVoiceStore } from '@/store/globalVoiceStore';
import { audioPlayback } from '@/lib/audioPlaybackManager';

type VoiceAction = () => Promise<void>;

let registeredStart: VoiceAction | null = null;
let registeredStop: VoiceAction | null = null;

/**
 * Imperative control surface for the single global voice pipeline. Components
 * (GlobalMicButton, EyesFreeMode) drive the mic through this instead of
 * mounting their own `useSpeechRecognition`/`usePushToTalk` — there must be
 * exactly one pipeline (one mic capture, one `~`-key listener, one set of
 * cues). Read state from `useGlobalVoiceStore`.
 */
export const voiceControl = {
  start: (): Promise<void> => (registeredStart ? registeredStart() : Promise.resolve()),
  stop: (): Promise<void> => (registeredStop ? registeredStop() : Promise.resolve()),
  /** Called by the single VoiceController to (un)register its handlers. */
  register(start: VoiceAction | null, stop: VoiceAction | null): void {
    registeredStart = start;
    registeredStop = stop;
  },
};

/**
 * Owns the one-and-only voice pipeline: speech recognition + push-to-talk.
 * Mounted exactly once via <VoiceController/>. Mirrors mic state into
 * globalVoiceStore and registers start/stop on `voiceControl`. Renders
 * nothing of its own — see VoiceController.
 */
export function useVoiceController(): void {
  const location = useLocation();
  const { send } = useCommandPipeline();

  const setListening = useGlobalVoiceStore((s) => s.setListening);
  const setTranscript = useGlobalVoiceStore((s) => s.setTranscript);
  const setSource = useGlobalVoiceStore((s) => s.setSource);
  const setOverlayOpen = useGlobalVoiceStore((s) => s.setOverlayOpen);
  const setLastResponse = useGlobalVoiceStore((s) => s.setLastResponse);
  const setPttRecording = useGlobalVoiceStore((s) => s.setPttRecording);
  const setAvailable = useGlobalVoiceStore((s) => s.setAvailable);
  const setError = useGlobalVoiceStore((s) => s.setError);

  const onFinal = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      const source = location.pathname === '/' ? 'chat' : 'global';
      setSource(source);
      if (source === 'global') {
        setOverlayOpen(true);
      }
      void send(text, { source });
    },
    [location.pathname, send, setOverlayOpen, setSource],
  );

  const speech = useSpeechRecognition(onFinal);
  const ptt = usePushToTalk(onFinal);

  // Mirror pipeline state into the store so any component can read it.
  useEffect(() => setListening(speech.listening), [speech.listening, setListening]);
  useEffect(() => setTranscript(speech.transcript), [speech.transcript, setTranscript]);
  useEffect(() => setPttRecording(ptt.recording), [ptt.recording, setPttRecording]);
  useEffect(() => setAvailable(speech.available), [speech.available, setAvailable]);
  useEffect(() => setError(speech.error), [speech.error, setError]);

  const start = useCallback(async () => {
    audioPlayback.ensureContext();
    setLastResponse(null);
    if (location.pathname !== '/') {
      setOverlayOpen(true);
    }
    await speech.start();
  }, [location.pathname, speech, setLastResponse, setOverlayOpen]);

  const stop = useCallback(async () => {
    await speech.stop();
  }, [speech]);

  useEffect(() => {
    voiceControl.register(start, stop);
    return () => voiceControl.register(null, null);
  }, [start, stop]);
}

/** Constant for the push-to-talk hotkey label shown in tooltips. */
export const PTT_HOTKEY = '`';
