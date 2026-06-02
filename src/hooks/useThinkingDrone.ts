import { useEffect } from 'react';
import { useChatStore } from '@/store/chatStore';
import { useGlobalVoiceStore } from '@/store/globalVoiceStore';
import { usePlaybackStore } from '@/store/playbackStore';
import { startThinkingDrone, stopThinkingDrone } from '@/lib/thinkingDrone';

/**
 * Plays the deep thinking drone while the assistant is preparing the next
 * thing the user is waiting for. Two trigger sources:
 *   • `chatStore.isProcessing` — AI roundtrip in flight (mic → transcribe →
 *     tool result).
 *   • `playbackStore.status === 'loading'` with no `current` — fresh audio
 *     being fetched (e.g. continuation cold-fetch from the next button,
 *     first track of a brand-new reading). Between-verse loads keep
 *     `current` set, so this doesn't fire on those transitions.
 *
 * Suppressed while the mic is open — that path already ducks all audio — and
 * while a reading is actively playing: if the user asks for something (or the
 * next chunk is being fetched/TTS'd) mid-reading, they're still listening to
 * the current verse and aren't waiting on a silent gap, so the hum would just
 * talk over the reading.
 */
export function useThinkingDrone(): void {
  const isProcessing = useChatStore((s) => s.isProcessing);
  const listening = useGlobalVoiceStore((s) => s.listening);
  const playbackStatus = usePlaybackStore((s) => s.status);
  const hasCurrent = usePlaybackStore((s) => s.current !== null);

  const waitingForPlayback = playbackStatus === 'loading' && !hasCurrent;
  const readingActive = playbackStatus === 'playing';
  const shouldHum =
    (isProcessing || waitingForPlayback) && !listening && !readingActive;

  useEffect(() => {
    if (shouldHum) {
      startThinkingDrone();
    } else {
      stopThinkingDrone();
    }
  }, [shouldHum]);

  useEffect(() => {
    return () => {
      stopThinkingDrone();
    };
  }, []);
}
