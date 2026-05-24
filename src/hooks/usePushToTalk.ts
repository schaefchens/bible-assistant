import { useCallback, useEffect, useRef, useState } from 'react';
import { useSettingsStore } from '@/store/settingsStore';
import { postTranscribe } from '@/services/api/transcribe';
import { describeMicError, micConstraints, pickMicMime } from '@/lib/micRecord';
import { playMicCue } from '@/lib/micCue';
import { nudgeIosPlaybackRouting } from '@/lib/iosAudioRouting';
import { audioPlayback } from '@/lib/audioPlaybackManager';

const HOTKEY_CODE = 'Backquote';

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || t.isContentEditable;
}

/**
 * Hold-the-backtick-key push-to-talk: starts recording on keydown, stops and
 * transcribes on keyup. Independent of the tap-to-toggle mic button, so both
 * can coexist.
 */
export function usePushToTalk(onTranscript: (text: string) => void) {
  const locale = useSettingsStore((s) => s.locale);
  const [recording, setRecording] = useState(false);

  const onTranscriptRef = useRef(onTranscript);
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startingRef = useRef(false);

  const start = useCallback(async () => {
    if (startingRef.current) return;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      return;
    }
    startingRef.current = true;
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia(micConstraints());
      streamRef.current = stream;
      const mime = pickMicMime();
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = async () => {
        playMicCue('stop');
        stream?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        setRecording(false);
        // Nudge iOS back to the playback audio category so system volume
        // and TTS loudness return to normal.
        nudgeIosPlaybackRouting(audioPlayback.getContext());
        const type = mr.mimeType || mime || 'application/octet-stream';
        const blob = new Blob(chunksRef.current, { type });
        if (blob.size === 0) return;
        try {
          const { text } = await postTranscribe(blob, locale);
          const trimmed = text?.trim();
          if (trimmed) onTranscriptRef.current(trimmed);
        } catch (e) {
          console.warn('push-to-talk transcribe failed', e);
        }
      };
      mediaRecorderRef.current = mr;
      mr.start();
      setRecording(true);
      playMicCue('start');
    } catch (e) {
      stream?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setRecording(false);
      nudgeIosPlaybackRouting(audioPlayback.getContext());
      console.warn('push-to-talk mic unavailable', describeMicError(e), e);
    } finally {
      startingRef.current = false;
    }
  }, [locale]);

  const stop = useCallback(() => {
    const mr = mediaRecorderRef.current;
    if (mr && mr.state !== 'inactive') {
      mr.stop();
    }
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.code !== HOTKEY_CODE) return;
      if (e.repeat) return;
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      void start();
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.code !== HOTKEY_CODE) return;
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      stop();
    }
    function onBlur() {
      // Window lost focus mid-press — release the mic to avoid stuck state.
      stop();
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [start, stop]);

  return { recording, hotkey: '`' };
}
