import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * An install from before narration voices has its voice in three device-local
 * settings. Upgrading must leave it hearing the same voice — and, because a
 * voice's identity is its cache key, keep every chapter it downloaded playable.
 *
 * Two halves, because settings hydrate synchronously and Dexie is async: the
 * persist migration parks the old values, `libraryStore.init` turns them into
 * synced rows. Integration, because the rule spans localStorage, the settings
 * store, Dexie and the library store.
 */

vi.mock('@/services/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/api/client')>()),
  apiPostJson: vi.fn(async () => ({})),
  apiGetJson: vi.fn(async () => ({})),
}));

const { apiGetJson } = await import('@/services/api/client');
const { db } = await import('@/db/dexie');
const { useSettingsStore } = await import('@/store/settingsStore');
const { useLibraryStore } = await import('@/store/libraryStore');
const { DEFAULT_VOICE_SELECTION, SYSTEM_DEVICE_ID, legacyVoiceId } = await import(
  '@/services/voices/voiceProfiles'
);
const { voiceKeyPart } = await import('@/services/voices/ttsVoice');
const { verseKey } = await import('@/services/narration/narrationIndex');
const fetched = vi.mocked(apiGetJson);

/** A v17 `ba.settings` blob, as an install from before voices wrote it. */
function seedV17(fields: Record<string, unknown>) {
  localStorage.setItem(
    'ba.settings',
    JSON.stringify({
      state: { locale: 'en', theme: 'dark', translation: 'KJV', speakAssistant: true, ...fields },
      version: 17,
    }),
  );
}

const persisted = () => JSON.parse(localStorage.getItem('ba.settings') ?? '{}');

beforeEach(async () => {
  // Offline, so `init` does not fire its background pull — which would
  // otherwise land in the *next* test and overwrite what it asserts on.
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  localStorage.clear();
  await Promise.all([db.voices.clear(), db.syncQueue.clear(), db.preferences.clear()]);
  fetched.mockReset();
  fetched.mockImplementation(async (action: string) => {
    if (action === 'voices.list') return { voices: [] };
    if (action === 'voices.selection.get') return { ...DEFAULT_VOICE_SELECTION };
    if (action.endsWith('.list')) return { cards: [], boards: [], readingLists: [], progress: [] };
    return { order: [], updatedAt: 0 };
  });
  useSettingsStore.setState({ legacyVoices: undefined, syncEnabled: true });
  useLibraryStore.setState({
    initialized: false,
    voices: [],
    voiceSelection: DEFAULT_VOICE_SELECTION,
    pendingOps: 0,
  });
});

describe('the v18 settings migration', () => {
  it('parks a non-default voice and removes the old keys from what is stored', async () => {
    seedV17({ voice: 'onyx', voiceStyle: 'calm', assistantVoice: 'browser', hasUserOpenAiKey: true });
    await useSettingsStore.persist.rehydrate();

    expect(useSettingsStore.getState().legacyVoices).toEqual({
      voice: 'onyx',
      voiceStyle: 'calm',
      assistantVoice: 'browser',
    });
    const stored = persisted();
    expect(stored.version).toBe(18);
    expect(stored.state).not.toHaveProperty('voice');
    expect(stored.state).not.toHaveProperty('voiceStyle');
    expect(stored.state).not.toHaveProperty('assistantVoice');
    // Transient key status is never written, migrated or not.
    expect(stored.state).not.toHaveProperty('hasUserOpenAiKey');
    expect(stored.state).not.toHaveProperty('hasUserElevenLabsKey');
    expect(stored.state).not.toHaveProperty('elevenLabsFailure');
  });

  it('parks nothing for an install that never changed the defaults', async () => {
    seedV17({ voice: 'echo', voiceStyle: '', assistantVoice: 'browser' });
    await useSettingsStore.persist.rehydrate();
    expect(useSettingsStore.getState().legacyVoices).toBeUndefined();
    expect(persisted().state).not.toHaveProperty('legacyVoices');
  });
});

describe('libraryStore.init turns the parked settings into synced voices', () => {
  it('once — the same voice, the same cache keys, then the stash is gone', async () => {
    useSettingsStore.setState({ legacyVoices: { voice: 'onyx', voiceStyle: 'calm' } });
    await useLibraryStore.getState().init();

    const { voices, voiceSelection } = useLibraryStore.getState();
    expect(voices).toHaveLength(1);
    expect(voiceSelection.narration).toBe(voices[0].id);
    expect(voiceSelection.assistant).toBe(SYSTEM_DEVICE_ID);
    // What a chapter downloaded in Onyx-calm was keyed under, before and after.
    expect(verseKey(voices[0].config, 'KJV', 19, 117, 1)).toBe('v|onyx|calm|KJV|19|117|1');
    expect(useSettingsStore.getState().legacyVoices).toBeUndefined();
    // Dirty and queued, so the migrated voice reaches the user's other devices.
    expect((await db.voices.get(voices[0].id))?.dirty).toBe(1);
    expect((await db.syncQueue.toArray()).map((o) => o.op)).toEqual(
      expect.arrayContaining(['voice.upsert', 'voiceSelection.set']),
    );
  });

  it('a second device upgrading with the same voice adds no duplicate', async () => {
    const config = { provider: 'openai' as const, voice: 'onyx' as const, style: 'calm' };
    // Already pulled from the first device.
    await db.voices.put({
      v: 1,
      id: legacyVoiceId(config),
      name: 'Onyx',
      config,
      createdAt: 1,
      updatedAt: 1,
      dirty: 0,
      deleted: 0,
    });
    useSettingsStore.setState({ legacyVoices: { voice: 'onyx', voiceStyle: 'calm' } });
    await useLibraryStore.getState().init();
    expect(useLibraryStore.getState().voices).toHaveLength(1);
    expect(voiceKeyPart(useLibraryStore.getState().voices[0].config)).toBe('onyx|calm');
  });

  it('a choice already synced from another device is not overwritten by a migrated guess', async () => {
    await db.preferences.put({
      key: 'voiceSelection',
      value: { narration: SYSTEM_DEVICE_ID, assistant: SYSTEM_DEVICE_ID, updatedAt: 500 },
    });
    useSettingsStore.setState({ legacyVoices: { voice: 'onyx' } });
    await useLibraryStore.getState().init();
    expect(useLibraryStore.getState().voiceSelection.narration).toBe(SYSTEM_DEVICE_ID);
  });
});
