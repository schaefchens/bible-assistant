import { useEffect } from 'react';
import { useLibraryStore } from '@/store/libraryStore';
import {
  effectiveAssistantVoice,
  effectiveReadingVoice,
  useSettingsStore,
} from '@/store/settingsStore';
import { usePlaybackStore } from '@/store/playbackStore';
import { useLastReadingStore } from '@/store/lastReadingStore';
import { audioPlayback } from '@/lib/audioPlaybackManager';
import { readingHosts } from '@/lib/readingHosts';
import { getOpenAiKeyStatus } from '@/services/api/auth';
import { getAmbientTrackUrl } from '@/services/api/ambient';

/**
 * App-boot side effects, kept out of AppShell's render body so the shell is a
 * thin layout component. Owns five independent effects; all the
 * passphrase-gated ones no-op until `hasPassphrase` is true:
 *   1. tear down any audio session left alive by an iOS PWA suspend
 *   2. persist a "last reading" slot as the active verse advances
 *   3. library init + online/offline listeners
 *   4. hydrate the personal-OpenAI-key status (and prune now-disallowed voices)
 *   5. prefetch the selected ambient track
 */
export function useAppInitialization(hasPassphrase: boolean): void {
  const init = useLibraryStore((s) => s.init);
  const setOnline = useLibraryStore((s) => s.setOnline);
  const ambientEnabled = useSettingsStore((s) => s.ambient.enabled);
  const ambientTrackId = useSettingsStore((s) => s.ambient.trackId);

  // 1. Defensive: if an iOS PWA was suspended (not killed) the previous audio
  // session can still be alive when we boot. Tear down all buses once at
  // start so nothing keeps playing into a fresh session without a user
  // gesture.
  useEffect(() => {
    audioPlayback.stop();
  }, []);

  // 2. Persist a "last reading" slot whenever the active verse advances, so a
  // fresh app load (or cleared chat) can still resume what the user was
  // hearing. Guards on (groupId, verseIndex) since the playbackStore
  // subscription also fires per-frame on currentWordIndex ticks.
  useEffect(() => {
    let prevKey = '';
    const unsub = usePlaybackStore.subscribe((state) => {
      const cur = state.current;
      if (!cur) return;
      const key = `${cur.groupId}:${cur.verseIndex}`;
      if (key === prevKey) return;
      prevKey = key;
      // Resolved through the host registry, so a reading played from the reader
      // screen captures a resume point exactly like a chat reading does.
      const v = readingHosts.getGroup(cur.groupId)?.verses[cur.verseIndex];
      if (!v) return;
      useLastReadingStore.getState().setSlot({
        translation: v.translation,
        bookId: v.bookId,
        chapter: v.chapter,
        verse: v.verse,
        savedAt: Date.now(),
      });
    });
    return unsub;
  }, []);

  // 3. Library init + online/offline listeners.
  useEffect(() => {
    if (!hasPassphrase) return;
    void init();
    const onUp = () => setOnline(true);
    const onDown = () => setOnline(false);
    window.addEventListener('online', onUp);
    window.addEventListener('offline', onDown);
    return () => {
      window.removeEventListener('online', onUp);
      window.removeEventListener('offline', onDown);
    };
  }, [init, setOnline, hasPassphrase]);

  // 4. Hydrate the personal-OpenAI-key status from the server. On hasKey=false,
  // call the effective-voice helpers once so previously-stored non-allowed
  // values (reading or assistant voice) get force-reset to their locked
  // defaults before the first playback / chat reply.
  useEffect(() => {
    if (!hasPassphrase) return;
    let cancelled = false;
    const prune = () => {
      effectiveReadingVoice();
      effectiveAssistantVoice();
    };
    void getOpenAiKeyStatus()
      .then((s) => {
        if (cancelled) return;
        useSettingsStore.getState().setUserOpenAiKeyStatus(!!s.hasKey, s.masked ?? null);
        prune();
      })
      .catch(() => {
        if (!cancelled) prune();
      });
    return () => {
      cancelled = true;
    };
  }, [hasPassphrase]);

  // 5. Prefetch the selected ambient track so playback can start instantly.
  useEffect(() => {
    if (!hasPassphrase) return;
    if (!ambientEnabled || !ambientTrackId) return;
    let cancelled = false;
    void getAmbientTrackUrl(ambientTrackId)
      .then((url) => {
        if (cancelled || !url) return;
        return audioPlayback.ambient.load(url);
      })
      .catch((e) => {
        console.warn('ambient prefetch failed', e);
      });
    return () => {
      cancelled = true;
    };
  }, [hasPassphrase, ambientEnabled, ambientTrackId]);
}
