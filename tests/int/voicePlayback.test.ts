import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlanItem } from '@/lib/playbackPlan';
import type { VerseSummary } from '@/types/domain';

/**
 * Which voice a reading *actually* plays in — the rules where a mistake is
 * wrong audio, a silent chapter, or an ElevenLabs bill the user did not agree
 * to:
 *
 * - a chapter downloaded in the chosen voice plays in it even when this
 *   session could not generate in it (offline, or before key status lands);
 * - an ElevenLabs refusal mid-chapter carries the rest of the chapter on in
 *   the fallback voice instead of skipping every remaining verse;
 * - deleting one voice's downloads never takes audio another voice still uses.
 *
 * Only the network is faked — `fetch` itself, so the real API client, its
 * error parsing and the provider-failure watcher all run — and the media
 * player's feed calls, which jsdom cannot play.
 */

const { db } = await import('@/db/dexie');
const { setIdentity } = await import('@/lib/identity');
const { audioPlayback } = await import('@/lib/audioPlaybackManager');
const { readingTtsVoice, streamReading } = await import('@/lib/startPlayback');
const { initProviderFailureWatch } = await import('@/lib/providerFailureWatch');
const { currentNarrationVoice } = await import('@/lib/narrationVoice');
const { useLibraryStore } = await import('@/store/libraryStore');
const { useSettingsStore } = await import('@/store/settingsStore');
const { DEFAULT_VOICE_SELECTION, SYSTEM_ECHO_ID } = await import('@/services/voices/voiceProfiles');
const { ECHO_VOICE } = await import('@/services/voices/ttsVoice');
const { verseKey } = await import('@/services/narration/narrationIndex');
const { deleteNarrationForVoice, narrationTargetKey } = await import(
  '@/services/narration/narrationDownload'
);

const ELEVEN_ID = 'JBFqnCBsd6RMkjVDRZzb';
const PROFILE_ID = '0b2c6f1e-3a4d-4c5e-9f60-718293a4b5c6';
const george = {
  provider: 'elevenlabs' as const,
  voiceId: ELEVEN_ID,
  model: 'eleven_v4' as const,
  stability: 0.5,
  similarity: 0.75,
};

const verse = (v: number): VerseSummary => ({
  translation: 'KJV',
  bookId: 19,
  chapter: 117,
  verse: v,
  text: `verse ${v}`,
  display: `Psalm 117:${v}`,
});
const plan: PlanItem[] = [1, 2].map((v, i) => ({
  kind: 'verse',
  verseIndex: i,
  verse: verse(v),
  pauseAfterMs: 0,
}));

/** Put one verse's narration on the device, as a download leaves it. */
async function hold(voice: Parameters<typeof verseKey>[0], v: number, url: string) {
  await db.narration.put({
    key: verseKey(voice, 'KJV', 19, 117, v),
    audioUrl: `${url}.mp3`,
    alignmentUrl: `${url}.json`,
    savedAt: 1,
  });
  for (const u of [`${url}.mp3`, `${url}.json`]) {
    await db.mediaCache.put({
      url: u,
      body: new ArrayBuffer(4),
      contentType: 'audio/mpeg',
      size: 4,
      createdAt: 1,
      lastUsedAt: 1,
      pinned: 1,
    });
  }
}

let online: ReturnType<typeof vi.spyOn>;
setIdentity({ userId: '00000000-0000-4000-8000-000000000001', userSecret: 'a'.repeat(64) });
initProviderFailureWatch();

beforeEach(async () => {
  await Promise.all([db.narration.clear(), db.mediaCache.clear(), db.voices.clear()]);
  // Made fresh per test: the config restores spies between tests.
  online = vi.spyOn(navigator, 'onLine', 'get');
  online.mockReturnValue(true);
  vi.unstubAllGlobals();
  useSettingsStore.setState({
    hasUserOpenAiKey: false,
    sessionPreferSharedKey: false,
    hasUserElevenLabsKey: true,
    elevenLabsFailure: null,
  });
  useLibraryStore.setState({
    voices: [{ v: 1, id: PROFILE_ID, name: 'George', config: george, createdAt: 1, updatedAt: 1 }],
    voiceSelection: { narration: PROFILE_ID, assistant: SYSTEM_ECHO_ID, updatedAt: 1 },
  });
});

describe('the voice a reading plays in', () => {
  it('online with the key: the chosen voice', async () => {
    expect(await readingTtsVoice(plan)).toBe(useLibraryStore.getState().voices[0].config);
  });

  it('offline, nothing downloaded: the device voice — never a silent reading', async () => {
    online.mockReturnValue(false);
    expect(await readingTtsVoice(plan)).toBeNull();
  });

  it('offline, downloaded in the chosen voice: that voice', async () => {
    online.mockReturnValue(false);
    await hold(george, 1, '/a/1');
    await hold(george, 2, '/a/2');
    expect(await readingTtsVoice(plan)).toEqual(george);
  });

  it('before the key status has arrived, a downloaded chapter still plays in its voice', async () => {
    useSettingsStore.setState({ hasUserElevenLabsKey: false });
    expect(currentNarrationVoice()).toBe(ECHO_VOICE);
    await hold(george, 1, '/a/1');
    await hold(george, 2, '/a/2');
    expect(await readingTtsVoice(plan)).toEqual(george);
  });

  it('half downloaded is not downloaded: all-or-nothing, so no chapter reads in two voices', async () => {
    useSettingsStore.setState({ hasUserElevenLabsKey: false });
    await hold(george, 1, '/a/1');
    expect(await readingTtsVoice(plan)).toBe(ECHO_VOICE);
  });
});

describe('an ElevenLabs refusal halfway through a chapter', () => {
  it('records why, falls back for the rest of the chapter, and keeps the choice', async () => {
    const requested: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? '{}')) as { provider?: string; verse: number };
        requested.push(`${body.provider ?? 'openai'}:${body.verse}`);
        if (body.provider === 'elevenlabs' && body.verse === 2) {
          return new Response(
            JSON.stringify({
              error: 'elevenlabs_quota_exceeded',
              provider: 'elevenlabs',
              payer: 'requester',
              voiceId: ELEVEN_ID,
            }),
            { status: 502 },
          );
        }
        return new Response(
          JSON.stringify({ audioUrl: `/x/${body.verse}.mp3`, alignmentUrl: `/x/${body.verse}.json`, cached: true }),
          { status: 200 },
        );
      }),
    );
    const enqueued: string[] = [];
    vi.spyOn(audioPlayback, 'beginFeed').mockReturnValue(1);
    vi.spyOn(audioPlayback, 'isFeed').mockReturnValue(true);
    vi.spyOn(audioPlayback, 'endFeed').mockImplementation(() => {});
    vi.spyOn(audioPlayback, 'playQueue').mockImplementation(async (tracks) => {
      enqueued.push(...tracks.map((t) => t.audioUrl));
    });
    vi.spyOn(audioPlayback, 'appendTracks').mockImplementation((tracks) => {
      enqueued.push(...tracks.map((t) => t.audioUrl));
    });

    await streamReading(plan, 'g1', george, undefined, { mode: 'playQueue' });

    // Verse 1 in George; verse 2 refused, then re-asked in Echo — not skipped.
    expect(requested).toEqual(['elevenlabs:1', 'elevenlabs:2', 'openai:2']);
    expect(enqueued).toHaveLength(2);
    expect(useSettingsStore.getState().elevenLabsFailure).toEqual({ kind: 'quota' });
    expect(currentNarrationVoice()).toBe(ECHO_VOICE);
    // The user's choice is untouched: a reload asks ElevenLabs again.
    expect(useLibraryStore.getState().voiceSelection.narration).toBe(PROFILE_ID);
  });
});

describe('what counts as ElevenLabs refusing narration', () => {
  const failure = async (action: string, body: object) => {
    const { ApiError, providerFailureOf } = await import('@/services/api/client');
    return providerFailureOf(new ApiError('x', 502, { provider: 'elevenlabs', ...body }), action);
  };

  it('a key without "user read" is not a narration failure — it just can’t show credits', async () => {
    const body = { error: 'elevenlabs_key_permissions', permission: 'user_read' };
    expect(await failure('elevenlabs.subscription', body)).toBeNull();
    expect(await failure('tts', { error: 'elevenlabs_key_permissions' })).toEqual({ kind: 'key' });
  });

  it('a refused key or spent credits stop narration whatever asked', async () => {
    expect(await failure('elevenlabs.voices', { error: 'elevenlabs_key_failed' })).toEqual({ kind: 'key' });
    expect(await failure('elevenlabs.design', { error: 'elevenlabs_quota_exceeded' })).toEqual({ kind: 'quota' });
  });

  it('an unusable voice is that voice only, and only from narration', async () => {
    const body = { error: 'elevenlabs_voice_unavailable', voiceId: ELEVEN_ID };
    expect(await failure('tts.speak', body)).toEqual({ kind: 'voice', voiceId: ELEVEN_ID, reason: 'unavailable' });
    expect(await failure('elevenlabs.design.save', body)).toBeNull();
  });

  it('a blip is not a failure: a rate limit, an outage', async () => {
    expect(await failure('tts', { error: 'elevenlabs_rate_limited' })).toBeNull();
    expect(await failure('tts', { error: 'elevenlabs_unavailable' })).toBeNull();
  });
});

describe('giving back one voice’s downloads', () => {
  it('removes its rows and bytes, and keeps a file another voice’s entry still points at', async () => {
    await hold(george, 1, '/el/1');
    await hold(ECHO_VOICE, 1, '/echo/1');
    // An announcement-style share: Echo's verse 2 entry points at a George file.
    await db.narration.put({
      key: verseKey(ECHO_VOICE, 'KJV', 19, 117, 2),
      audioUrl: '/el/1.mp3',
      alignmentUrl: '/el/1.json',
      savedAt: 1,
    });

    await deleteNarrationForVoice(george);

    expect(await db.narration.get(verseKey(george, 'KJV', 19, 117, 1))).toBeUndefined();
    expect(await db.narration.get(verseKey(ECHO_VOICE, 'KJV', 19, 117, 1))).toBeDefined();
    expect(await db.mediaCache.get('/echo/1.mp3')).toBeDefined();
    expect(await db.mediaCache.get('/el/1.mp3')).toBeDefined();
  });

  it('two styles of one base voice are two download targets, not one', () => {
    const subject = { kind: 'chapter' as const, translation: 'KJV' as const, bookId: 19, chapter: 117 };
    expect(
      narrationTargetKey({ ...subject, voice: { provider: 'openai', voice: 'nova', style: '' } }),
    ).not.toBe(narrationTargetKey({ ...subject, voice: { provider: 'openai', voice: 'nova', style: 'calm' } }));
  });
});

describe('resetting', () => {
  it('leaves the default selection usable', () => {
    useLibraryStore.setState({ voices: [], voiceSelection: DEFAULT_VOICE_SELECTION });
    expect(currentNarrationVoice()).toBe(ECHO_VOICE);
  });
});
