import { useEffect, useRef, useState } from 'react';
import { postTtsSpeak } from '@/services/api/tts';
import { audioPlayback } from '@/lib/audioPlaybackManager';
import type { OpenAiVoiceId } from '@/types/domain';

/** One-shot OpenAI-TTS voice preview: fetch + decode + play a sample through
 * the shared AudioContext, tracking a `previewing` flag. Auto-stops on
 * unmount. Used by the onboarding voice picker. */
export function usePreviewVoice() {
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const stop = () => {
    if (sourceRef.current) {
      try {
        sourceRef.current.stop();
      } catch {
        /* may already be stopped */
      }
      sourceRef.current = null;
    }
    setPreviewing(false);
  };

  // Always stop the preview when this row unmounts (wizard exit, step change).
  useEffect(() => stop, []);

  const preview = async (
    voice: OpenAiVoiceId,
    locale: 'en' | 'de',
    text: string,
  ) => {
    stop();
    try {
      const tts = await postTtsSpeak({ text, voice, language: locale });
      const resp = await fetch(tts.audioUrl);
      const arr = await resp.arrayBuffer();
      const ctx = audioPlayback.ensureContext();
      const buf = await ctx.decodeAudioData(arr);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start();
      sourceRef.current = src;
      setPreviewing(true);
      src.onended = () => {
        if (sourceRef.current === src) {
          sourceRef.current = null;
          setPreviewing(false);
        }
      };
    } catch (e) {
      console.warn('voice preview failed', e);
      setPreviewing(false);
    }
  };

  return { previewing, preview, stop };
}
