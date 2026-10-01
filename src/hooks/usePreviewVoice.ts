import { useCallback, useEffect, useRef, useState } from 'react';
import { postTts, postTtsSpeak } from '@/services/api/tts';
import { audioPlayback } from '@/lib/audioPlaybackManager';
import { browserTts } from '@/lib/browserTts';
import { loadChapterSummaries } from '@/services/bible/verseSummaries';
import { sharedRefOf, type SpeechVoice, type TtsVoice } from '@/services/voices/ttsVoice';
import { useSettingsStore } from '@/store/settingsStore';

/**
 * What a voice somebody shared says when auditioned: Psalm 23:1, in the
 * listener's translation, as a *verse*. Any sample sentence of the app's own
 * would be refused — a voice lent for scripture may read scripture and the
 * announcements around it, and nothing else — and a verse every voice may
 * read is also one its owner's other readers have likely already paid for.
 */
async function sharedSample(voice: TtsVoice, locale: 'en' | 'de', signal: AbortSignal) {
  const translation = useSettingsStore.getState().translation;
  const [verse] = await loadChapterSummaries(translation, 19, 23, locale);
  if (!verse) throw new Error('no sample verse');
  return postTts(
    { text: verse.text, voice, translation, bookId: 19, chapter: 23, verse: verse.verse },
    { signal },
  );
}

/**
 * One-shot voice previews: a sample sentence in a voice (through api.php, so
 * it is cached server-side and a second tap is free), or a provider's own
 * sample file (ElevenLabs' `preview_url`, which costs nothing at all).
 *
 * `previewing` names *which* preview is active — the caller's key — so a list
 * of voices can show the stop button on the right row, and `loading` says it
 * is still being fetched (a spinner, not yet a stop). Only one plays at a
 * time: starting one stops the last, and a tap that is overtaken by a newer
 * one while its request is still in flight is dropped (the generation counter)
 * rather than playing over it.
 *
 * Stops itself on unmount.
 */
export function usePreviewVoice() {
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const elementRef = useRef<HTMLAudioElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  // Refs and state setters only, so stable for the hook's lifetime — which is
  // what lets the unmount cleanup below depend on it honestly.
  const stop = useCallback(() => {
    generation.current++;
    abortRef.current?.abort();
    abortRef.current = null;
    if (sourceRef.current) {
      try {
        sourceRef.current.stop();
      } catch {
        /* may already be stopped */
      }
      sourceRef.current = null;
    }
    if (elementRef.current) {
      elementRef.current.pause();
      elementRef.current = null;
    }
    setPreviewing(null);
    setLoading(false);
  }, []);

  // Always stop when the owner unmounts (leaving the screen, a step change).
  useEffect(() => stop, [stop]);

  /** Speak `text` in `voice`. `key` identifies this preview to the caller. */
  const preview = async (
    voice: SpeechVoice,
    locale: 'en' | 'de',
    text: string,
    key = 'preview',
  ): Promise<void> => {
    stop();
    const gen = ++generation.current;
    setFailed(null);
    setPreviewing(key);
    if (voice.provider === 'device') {
      void browserTts.speakOneShot(text, locale === 'de' ? 'de-DE' : 'en-US', () => {
        if (generation.current === gen) setPreviewing(null);
      });
      return;
    }
    setLoading(true);
    // Inside the tap, before any await: iOS only lets an AudioContext start
    // from a user gesture.
    const ctx = audioPlayback.ensureContext();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const tts = sharedRefOf(voice)
        ? await sharedSample(voice, locale, controller.signal)
        : await postTtsSpeak({ text, voice, language: locale }, { signal: controller.signal });
      const resp = await fetch(tts.audioUrl, { signal: controller.signal });
      const buf = await ctx.decodeAudioData(await resp.arrayBuffer());
      if (generation.current !== gen) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start();
      sourceRef.current = src;
      setLoading(false);
      src.onended = () => {
        if (sourceRef.current === src) {
          sourceRef.current = null;
          if (generation.current === gen) setPreviewing(null);
        }
      };
    } catch (e) {
      if (generation.current !== gen) return;
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        console.warn('voice preview failed', e);
        setFailed(key);
      }
      setPreviewing(null);
      setLoading(false);
    }
  };

  /**
   * Play a sample file the provider hosts. A media element rather than the
   * AudioContext: it plays a cross-origin URL without CORS, and it is started
   * synchronously in the tap, which is what iOS asks of media too.
   */
  const previewUrl = (url: string, key = url): void => {
    stop();
    const gen = ++generation.current;
    setFailed(null);
    setPreviewing(key);
    setLoading(true);
    const el = new Audio(url);
    elementRef.current = el;
    const done = () => {
      if (elementRef.current === el) elementRef.current = null;
      if (generation.current === gen) {
        setPreviewing(null);
        setLoading(false);
      }
    };
    el.onplaying = () => {
      if (generation.current === gen) setLoading(false);
    };
    el.onended = done;
    el.onerror = () => {
      if (generation.current === gen) setFailed(key);
      done();
    };
    void el.play().catch(() => {
      if (generation.current === gen) setFailed(key);
      done();
    });
  };

  return { previewing, loading, failed, preview, previewUrl, stop };
}
