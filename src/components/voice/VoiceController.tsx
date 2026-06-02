import { useVoiceController } from '@/hooks/useGlobalVoice';

/**
 * Mounts the single global voice pipeline (speech recognition + push-to-talk)
 * exactly once and renders nothing. Every other component reads mic state from
 * `useGlobalVoiceStore` and drives it via `voiceControl` — so the mic, the
 * `~`-key listener, and the start/stop cues exist once, not once per consumer.
 */
export function VoiceController(): null {
  useVoiceController();
  return null;
}
