import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Narration voices follow the user to every device, so they are synced
 * library rows — and the sync rules are the ones testing.md always wants
 * integration-tested: an op sequence wrong means a voice lost, or one deleted
 * on the phone resurrected by the tablet.
 *
 * Mirrors the reading-list half of syncQueue.test.ts / libraryStore.test.ts:
 * only the wire (`apiGetJson` / `apiPostJson`) is faked.
 */

vi.mock('@/services/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/api/client')>()),
  apiPostJson: vi.fn(async () => ({})),
  apiGetJson: vi.fn(async () => ({})),
}));

const { apiGetJson, apiPostJson } = await import('@/services/api/client');
const { db } = await import('@/db/dexie');
const { useLibraryStore } = await import('@/store/libraryStore');
const { useSettingsStore } = await import('@/store/settingsStore');
const { DEFAULT_VOICE_SELECTION, SYSTEM_DEVICE_ID, SYSTEM_ECHO_ID } = await import(
  '@/services/voices/voiceProfiles'
);
const { currentNarrationVoice } = await import('@/lib/narrationVoice');
const { ECHO_VOICE } = await import('@/services/voices/ttsVoice');
const posted = vi.mocked(apiPostJson);
const fetched = vi.mocked(apiGetJson);

const ELEVEN_ID = 'JBFqnCBsd6RMkjVDRZzb';
const george = {
  provider: 'elevenlabs' as const,
  voiceId: ELEVEN_ID,
  model: 'eleven_v4' as const,
  stability: 0.5,
  similarity: 0.75,
};
const nova = { provider: 'openai' as const, voice: 'nova' as const, style: '' };

const queued = async () => (await db.syncQueue.orderBy('createdAt').toArray()).map((o) => o.op);
const lib = () => useLibraryStore.getState();

function serverHas(rows: { voices?: unknown[]; selection?: unknown }) {
  fetched.mockImplementation(async (action: string) => {
    if (action === 'cards.list') return { cards: [] };
    if (action === 'boards.list') return { boards: [] };
    if (action === 'readingLists.list') return { readingLists: [] };
    if (action === 'readingProgress.list') return { progress: [] };
    if (action === 'voices.list') return { voices: rows.voices ?? [] };
    if (action === 'voices.selection.get') return rows.selection ?? { ...DEFAULT_VOICE_SELECTION };
    return { order: [], updatedAt: 0 };
  });
}

beforeEach(async () => {
  await Promise.all([
    db.syncQueue.clear(),
    db.voices.clear(),
    db.preferences.clear(),
    db.cards.clear(),
    db.boards.clear(),
    db.readingLists.clear(),
    db.readingProgress.clear(),
  ]);
  posted.mockReset();
  posted.mockResolvedValue({});
  fetched.mockReset();
  serverHas({});
  useLibraryStore.setState({
    voices: [],
    voiceSelection: DEFAULT_VOICE_SELECTION,
    pendingOps: 0,
    // Offline, so writes queue and stay queued for the assertions below; the
    // flush tests flip it.
    online: false,
  });
  useSettingsStore.setState({
    syncEnabled: true,
    hasUserOpenAiKey: false,
    sessionPreferSharedKey: false,
    hasUserElevenLabsKey: true,
    elevenLabsFailure: null,
  });
});

describe('a voice is written like any synced row', () => {
  it('create → one upsert; edit → another; delete → a tombstone and a delete', async () => {
    const id = await lib().createVoice({ name: 'Grandpa', config: george });
    expect(await queued()).toEqual(['voice.upsert']);
    expect((await db.voices.get(id))?.dirty).toBe(1);

    await lib().updateVoice(id, { name: 'Opa' });
    expect(await queued()).toEqual(['voice.upsert', 'voice.upsert']);
    expect(lib().voices[0].name).toBe('Opa');

    await lib().deleteVoice(id);
    expect(await queued()).toEqual(['voice.upsert', 'voice.upsert', 'voice.delete']);
    expect(await db.voices.get(id)).toMatchObject({ deleted: 1, dirty: 1 });
    expect(lib().voices).toEqual([]);
    expect(lib().pendingOps).toBe(3);
  });

  it('a deleted voice is not brought back by the next pull', async () => {
    const id = await lib().createVoice({ name: 'Grandpa', config: george });
    const row = lib().voices[0];
    await lib().deleteVoice(id);
    // The server still has it — the delete has not been flushed yet.
    serverHas({ voices: [{ ...row, updatedAt: row.updatedAt + 1000 }] });
    await lib().pullFromServer();
    expect(lib().voices).toEqual([]);
  });

  it('flushes the ops to their endpoints and marks the row synced', async () => {
    const id = await lib().createVoice({ name: 'Grandpa', config: george });
    useLibraryStore.setState({ online: true });
    await lib().flushQueue();
    expect(posted.mock.calls.map((c) => c[0])).toEqual(['voices.upsert']);
    expect(posted.mock.calls[0][1]).toEqual({ voice: expect.objectContaining({ id, name: 'Grandpa' }) });
    // Wire rows never carry the local flags.
    expect(posted.mock.calls[0][1]).not.toHaveProperty('voice.dirty');
    expect((await db.voices.get(id))?.dirty).toBe(0);
  });

  it('queues nothing while Sync is off — the voice stays on this device', async () => {
    useSettingsStore.setState({ syncEnabled: false });
    await lib().createVoice({ name: 'Grandpa', config: george });
    await lib().selectVoice('narration', lib().voices[0].id);
    expect(await db.syncQueue.count()).toBe(0);
    expect(lib().voices).toHaveLength(1);
  });
});

describe('a pull adopts what other devices did', () => {
  it('a newer remote voice replaces the local copy', async () => {
    const id = await lib().createVoice({ name: 'Grandpa', config: george });
    await db.syncQueue.clear(); // as if flushed
    await db.voices.update(id, { dirty: 0 });
    const row = lib().voices[0];
    serverHas({ voices: [{ ...row, name: 'Opa', updatedAt: row.updatedAt + 1000 }] });
    await lib().pullFromServer();
    expect(lib().voices[0].name).toBe('Opa');
  });

  it('never over a local edit that is still waiting to go out', async () => {
    const id = await lib().createVoice({ name: 'Grandpa', config: george });
    const row = lib().voices[0];
    serverHas({ voices: [{ ...row, name: 'Remote', updatedAt: row.updatedAt + 1000 }] });
    await lib().pullFromServer();
    expect(lib().voices.find((v) => v.id === id)?.name).toBe('Grandpa');
  });

  it('a voice from another device arrives, picture and all; a malformed one does not', async () => {
    serverHas({
      voices: [
        {
          v: 1,
          id: '0b2c6f1e-3a4d-4c5e-9f60-718293a4b5c6',
          name: 'From the phone',
          avatar: 'data:image/jpeg;base64,QUJD',
          config: nova,
          createdAt: 1,
          updatedAt: 2,
        },
        { v: 1, id: 'bogus', name: 'Broken', config: { provider: 'nope' } },
      ],
    });
    await lib().pullFromServer();
    expect(lib().voices.map((v) => v.name)).toEqual(['From the phone']);
    expect(lib().voices[0].avatar).toBe('data:image/jpeg;base64,QUJD');
  });
});

describe('the selection is one synced record, last write wins', () => {
  it('collapses to one queued op however many times it changes', async () => {
    const id = await lib().createVoice({ name: 'Grandpa', config: george });
    await lib().selectVoice('narration', id);
    await lib().selectVoice('assistant', SYSTEM_ECHO_ID);
    await lib().selectVoice('narration', SYSTEM_DEVICE_ID);
    const ops = await queued();
    expect(ops.filter((o) => o === 'voiceSelection.set')).toHaveLength(1);
    expect(lib().voiceSelection).toMatchObject({ narration: SYSTEM_DEVICE_ID, assistant: SYSTEM_ECHO_ID });
    expect(lib().pendingOps).toBe(ops.length);
  });

  it('a newer remote choice wins; an older one does not; a pending local one blocks it', async () => {
    serverHas({ selection: { narration: SYSTEM_DEVICE_ID, assistant: SYSTEM_DEVICE_ID, updatedAt: 50 } });
    await lib().pullFromServer();
    expect(lib().voiceSelection.narration).toBe(SYSTEM_DEVICE_ID);

    serverHas({ selection: { narration: SYSTEM_ECHO_ID, assistant: SYSTEM_DEVICE_ID, updatedAt: 10 } });
    await lib().pullFromServer();
    expect(lib().voiceSelection.narration).toBe(SYSTEM_DEVICE_ID);

    await lib().selectVoice('narration', SYSTEM_ECHO_ID);
    serverHas({
      selection: { narration: SYSTEM_DEVICE_ID, assistant: SYSTEM_DEVICE_ID, updatedAt: Date.now() + 10_000 },
    });
    await lib().pullFromServer();
    expect(lib().voiceSelection.narration).toBe(SYSTEM_ECHO_ID);
  });

  it('deleting the voice in use falls back to Echo — and that change syncs too', async () => {
    const id = await lib().createVoice({ name: 'Grandpa', config: george });
    await lib().selectVoice('narration', id);
    expect(currentNarrationVoice()).toEqual(george);
    await lib().deleteVoice(id);
    expect(lib().voiceSelection.narration).toBe(SYSTEM_ECHO_ID);
    expect(currentNarrationVoice()).toBe(ECHO_VOICE);
    const ops = await queued();
    expect(ops.at(-1)).toBe('voiceSelection.set');
  });
});

describe('turning Sync on catches the server up', () => {
  it('seeds unsynced voices and tombstones, and a selection only if one was ever made', async () => {
    useSettingsStore.setState({ syncEnabled: false });
    const keep = await lib().createVoice({ name: 'Keep', config: george });
    const gone = await lib().createVoice({ name: 'Gone', config: nova });
    await lib().deleteVoice(gone);

    // enableSync seeds and then flushes, so what it caught up on is what
    // reached the wire.
    await lib().enableSync();
    const sent = posted.mock.calls.map(([action, body]) => [
      action,
      (body as { voice?: { id: string }; id?: string }).voice?.id ?? (body as { id?: string }).id,
    ]);
    expect(sent).toContainEqual(['voices.upsert', keep]);
    expect(sent).toContainEqual(['voices.delete', gone]);
    expect(sent.map(([action]) => action)).not.toContain('voices.selection.set');

    posted.mockClear();
    useSettingsStore.setState({ syncEnabled: false });
    await lib().selectVoice('narration', keep);
    await lib().enableSync();
    expect(posted.mock.calls.map(([action]) => action)).toContain('voices.selection.set');
  });
});
