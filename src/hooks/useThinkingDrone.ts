import { useEffect } from 'react';
import { useChatStore } from '@/store/chatStore';
import { useGlobalVoiceStore } from '@/store/globalVoiceStore';
import { startThinkingDrone, stopThinkingDrone } from '@/lib/thinkingDrone';

/**
 * Plays the deep thinking drone while the assistant is processing a
 * request (transcribe → API → tool result). Suppressed while the mic is
 * open since the mic-open path already ducks all audio.
 */
export function useThinkingDrone(): void {
  const isProcessing = useChatStore((s) => s.isProcessing);
  const listening = useGlobalVoiceStore((s) => s.listening);

  useEffect(() => {
    if (isProcessing && !listening) {
      startThinkingDrone();
    } else {
      stopThinkingDrone();
    }
  }, [isProcessing, listening]);

  useEffect(() => {
    return () => {
      stopThinkingDrone();
    };
  }, []);
}
