import { useCallback, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import { usePushToTalk } from '@/hooks/usePushToTalk';
import { useCommandPipeline } from '@/hooks/useCommandPipeline';
import { useGlobalVoiceStore } from '@/store/globalVoiceStore';
import { useChatStore } from '@/store/chatStore';
import { audioPlayback } from '@/lib/audioPlaybackManager';

type GlobalVoiceApi = {
  listening: boolean;
  available: boolean;
  error: string | null;
  transcript: string;
  pttRecording: boolean;
  pttHotkey: string;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  dismissOverlay: () => void;
  openInChat: () => void;
  overlayOpen: boolean;
};

export function useGlobalVoice(): GlobalVoiceApi {
  const navigate = useNavigate();
  const location = useLocation();
  const { send } = useCommandPipeline();

  const listening = useGlobalVoiceStore((s) => s.listening);
  const overlayOpen = useGlobalVoiceStore((s) => s.overlayOpen);
  const lastResponse = useGlobalVoiceStore((s) => s.lastResponse);
  const setListening = useGlobalVoiceStore((s) => s.setListening);
  const setTranscript = useGlobalVoiceStore((s) => s.setTranscript);
  const setSource = useGlobalVoiceStore((s) => s.setSource);
  const setOverlayOpen = useGlobalVoiceStore((s) => s.setOverlayOpen);
  const setLastResponse = useGlobalVoiceStore((s) => s.setLastResponse);
  const reset = useGlobalVoiceStore((s) => s.reset);

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

  // Mirror speech state into our store so VoiceOverlay/GlobalMicButton can read it.
  useEffect(() => {
    setListening(speech.listening);
  }, [speech.listening, setListening]);
  useEffect(() => {
    setTranscript(speech.transcript);
  }, [speech.transcript, setTranscript]);

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

  const dismissOverlay = useCallback(() => {
    setOverlayOpen(false);
    setLastResponse(null);
  }, [setOverlayOpen, setLastResponse]);

  const openInChat = useCallback(() => {
    const messageId = lastResponse?.messageId ?? null;
    if (messageId) {
      useChatStore.getState().setHighlightedMessageId(messageId);
    }
    navigate('/');
    reset();
  }, [lastResponse, navigate, reset]);

  return {
    listening,
    available: speech.available,
    error: speech.error,
    transcript: speech.transcript,
    pttRecording: ptt.recording,
    pttHotkey: ptt.hotkey,
    start,
    stop,
    dismissOverlay,
    openInChat,
    overlayOpen,
  };
}
