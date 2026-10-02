import { beforeEach, describe, expect, it } from 'vitest';
import type { ToolName } from '@/services/ai/tools';

/**
 * `dispatch.ts` is "the routing table and nothing else" (783630f) — it was a
 * 1,380-line file before the handlers moved out. What is worth pinning here is
 * the **contract at the seam**, because the model is on the other side of it: a
 * result the model cannot read as "done" makes it try again, and the whole
 * `random_passage` triple-read episode came from exactly that.
 *
 * Integration rather than unit: importing the dispatcher pulls in every
 * handler, both stores, Dexie and `audioPlayback` (which constructs real
 * `<audio>` elements at module load). That is the point of the jsdom project.
 */

const { dispatchTool } = await import('@/services/ai/dispatch');
const { TOOL_DEFINITIONS, READ_TOOL_NAMES, isReadTool } = await import('@/services/ai/tools');
const { useSettingsStore } = await import('@/store/settingsStore');
const { systemPrompt } = await import('@/services/ai/prompts');
const { useLibraryStore } = await import('@/store/libraryStore');
const { db } = await import('@/db/dexie');

const ctx = { messageId: 'm1', signal: new AbortController().signal };

beforeEach(async () => {
  await Promise.all([db.cards.clear(), db.syncQueue.clear()]);
  useLibraryStore.setState({ cards: [], cardOrder: [], online: false, pendingOps: 0 });
  useSettingsStore.setState({ syncEnabled: false, locale: 'en', translation: 'KJV' });
});

/**
 * The declared surface and the routing table are two lists that must agree.
 * The registry's mapped type already makes a *missing* handler a compile error,
 * so what is left to check at runtime is the other direction and the schema
 * shape OpenAI actually requires.
 */
describe('the tool contract the model is handed', () => {
  const declared = TOOL_DEFINITIONS.map((d) => d.function.name);

  it('declares every tool exactly once', () => {
    expect(new Set(declared).size).toBe(declared.length);
  });

  it('gives every tool a description — it is the model’s only documentation', () => {
    for (const d of TOOL_DEFINITIONS) {
      expect(d.function.description, d.function.name).toBeTruthy();
      expect(d.type).toBe('function');
    }
  });

  /**
   * api.php decodes the chat body as stdClass specifically so an empty
   * `properties: {}` survives the JSON round-trip — OpenAI rejects any tool
   * whose `properties` arrives as `[]`. So `properties` must always be an
   * object here, never an array.
   */
  it('never declares parameters.properties as an array', () => {
    for (const d of TOOL_DEFINITIONS) {
      const params = d.function.parameters as { type?: string; properties?: unknown };
      expect(params.type, d.function.name).toBe('object');
      expect(Array.isArray(params.properties), d.function.name).toBe(false);
      expect(typeof params.properties, d.function.name).toBe('object');
    }
  });

  it('only marks reading tools as reading tools', () => {
    // These are the tools whose audio *is* the reply, so chat text is
    // suppressed for them. A tool wrongly in this set goes silent.
    expect([...READ_TOOL_NAMES].sort()).toEqual([
      'continue_from_ribbon', 'play_reading_list', 'random_passage',
      'read_new', 'read_shelf', 'read_verses',
    ]);
    for (const name of READ_TOOL_NAMES) {
      expect(declared, `${name} is a read tool but is not declared`).toContain(name);
      expect(isReadTool(name)).toBe(true);
    }
    expect(isReadTool('create_card')).toBe(false);
  });

  /**
   * ESV, NKJV and Hoffnung für Alle are hidden for want of a licence
   * (translationCatalog `offered`). The model learns which translations exist
   * from the schemas and the prompts, so neither may name one.
   */
  it('names no translation the app does not offer', () => {
    const handed = [JSON.stringify(TOOL_DEFINITIONS), systemPrompt('en', 'KJV'), systemPrompt('de', 'LUT')];
    for (const code of ['ESV', 'NKJV', 'HFA']) {
      for (const text of handed) expect(text).not.toMatch(new RegExp(`\\b${code}\\b`));
    }
  });
});

/**
 * Every failure mode returns `{ok: false, error}` rather than throwing, because
 * the pipeline feeds `error` straight back to the model as the tool result. A
 * throw would abort the turn instead of letting it recover.
 */
describe('dispatchTool — the failure contract', () => {
  it('reports malformed arguments instead of throwing', async () => {
    expect(await dispatchTool('read_verses', '{not json', ctx)).toEqual({
      ok: false, error: 'invalid JSON arguments',
    });
  });

  it('names an unknown tool in the error', async () => {
    const r = await dispatchTool('no_such_tool' as ToolName, '{}', ctx);
    expect(r).toEqual({ ok: false, error: 'unknown tool: no_such_tool' });
  });

  it('treats empty arguments as {}, not as a parse failure', async () => {
    // The model omits `arguments` entirely for a no-arg tool.
    const r = await dispatchTool('list_cards', '', ctx);
    expect(r.ok).toBe(true);
  });

  it('turns a handler throw into an error result', async () => {
    // read_verses with no reference cannot resolve; whatever it does, it must
    // not escape as an exception.
    const r = await dispatchTool('read_verses', '{}', ctx);
    expect(r.ok).toBe(false);
    expect(typeof r.error).toBe('string');
  });

  it('never resolves to undefined', async () => {
    for (const args of ['', '{}', '{"reference":""}']) {
      const r = await dispatchTool('lookup_verses', args, ctx);
      expect(r).toBeDefined();
      expect(typeof r.ok).toBe('boolean');
    }
  });
});

describe('dispatchTool — settings tools reach the store', () => {
  it('sets the language', async () => {
    expect(await dispatchTool('set_language', '{"language":"de"}', ctx)).toEqual({ ok: true });
    expect(useSettingsStore.getState().locale).toBe('de');
  });

  it('sets the translation and marks it user-chosen', async () => {
    // The `true` second argument is what stops a later locale change
    // "correcting" a translation the user picked on purpose.
    await dispatchTool('set_translation', '{"translation":"LUT"}', ctx);
    expect(useSettingsStore.getState().translation).toBe('LUT');
    expect(useSettingsStore.getState().translationOverridden).toBe(true);
  });

  it('refuses a translation the app does not offer, and keeps the current one', async () => {
    // An enum does not bind the model: "switch to ESV" can still arrive.
    const r = await dispatchTool('set_translation', '{"translation":"ESV"}', ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not available/);
    expect(useSettingsStore.getState().translation).toBe('KJV');
  });

  it('moves the mic to any of its five positions', async () => {
    for (const position of ['tl', 'tr', 'bl', 'br', 'bar']) {
      const r = await dispatchTool('set_mic_position', JSON.stringify({ position }), ctx);
      expect(r).toEqual({ ok: true, data: { position } });
      expect(useSettingsStore.getState().micCorner).toBe(position);
    }
  });

  it('refuses a non-numeric playback rate rather than storing NaN', async () => {
    const r = await dispatchTool('set_playback_rate', '{"rate":"fast"}', ctx);
    expect(r).toEqual({ ok: false, error: 'rate must be a number' });
  });

  it('clamps a playback rate into the supported range', async () => {
    expect(await dispatchTool('set_playback_rate', '{"rate":99}', ctx))
      .toEqual({ ok: true, data: { rate: 3 } });
    expect(await dispatchTool('set_playback_rate', '{"rate":0.01}', ctx))
      .toEqual({ ok: true, data: { rate: 0.25 } });
  });
});

/**
 * `set_voice` resolves a *spoken* name, so it gets the resolver's three tiers
 * and its honesty rule: a voice the session cannot pay for is still chosen (it
 * is a preference, like in Settings), but the reply says what will be heard.
 */
describe('dispatchTool — set_voice chooses a voice by name', () => {
  const GRANDPA = '0b2c6f1e-3a4d-4c5e-9f60-718293a4b5c6';
  const GRANNY = '1c2d3e4f-5a6b-4c7d-8e9f-a0b1c2d3e4f5';
  const voice = (id: string, name: string, config: object) => ({
    v: 1 as const, id, name, config, createdAt: 1, updatedAt: 1,
  });

  beforeEach(async () => {
    await db.voices.clear();
    useLibraryStore.setState({
      voices: [
        voice(GRANDPA, 'Grandpa Joe', { provider: 'openai', voice: 'onyx', style: 'warm' }),
        voice(GRANNY, 'Granny', { provider: 'elevenlabs', voiceId: 'JBFqnCBsd6RMkjVDRZzb', model: 'eleven_v4', stability: 0.5, similarity: 0.75 }),
      ] as never,
      voiceSelection: { narration: 'system:echo', assistant: 'system:device', updatedAt: 0 },
    });
    useSettingsStore.setState({
      hasUserOpenAiKey: true, sessionPreferSharedKey: false,
      hasUserElevenLabsKey: false, elevenLabsFailure: null,
    });
  });

  it.each([
    ['an exact name', 'Granny', GRANNY],
    ['a unique substring, any case', 'grandpa', GRANDPA],
    ['the device voice by any of its names', 'Gerätestimme', 'system:device'],
    ['the system voice', 'echo', 'system:echo'],
  ])('%s', async (_, name, id) => {
    const r = await dispatchTool('set_voice', JSON.stringify({ name }), ctx);
    expect(r.ok).toBe(true);
    expect(useLibraryStore.getState().voiceSelection.narration).toBe(id);
  });

  it('"several match" is a question, and a miss names what there is', async () => {
    const several = await dispatchTool('set_voice', '{"name":"gran"}', ctx);
    expect(several).toEqual({ ok: false, error: expect.stringContaining('ask which') });
    const miss = await dispatchTool('set_voice', '{"name":"Gandalf"}', ctx);
    expect(miss).toEqual({ ok: false, error: expect.stringContaining('Grandpa Joe') });
    expect(useLibraryStore.getState().voiceSelection.narration).toBe('system:echo');
  });

  it('`for: assistant` chooses the voice for replies, not for reading', async () => {
    await dispatchTool('set_voice', '{"name":"Grandpa","for":"assistant"}', ctx);
    expect(useLibraryStore.getState().voiceSelection).toMatchObject({
      narration: 'system:echo', assistant: GRANDPA,
    });
  });

  it('chooses a voice that needs a missing key, and says what plays instead', async () => {
    const r = await dispatchTool('set_voice', '{"name":"Granny"}', ctx);
    expect(r).toMatchObject({ ok: true, data: { selected: 'Granny', nowPlaysIn: 'Echo' } });
    expect(useLibraryStore.getState().voiceSelection.narration).toBe(GRANNY);
  });

  it('finds a voice somebody lent to a shelf, by its name, and chooses it by its item', async () => {
    const ITEM = '7e1f0c2a-9b3d-4e5f-8a6b-c7d8e9f0a1b2';
    const { useCommunityStore } = await import('@/store/communityStore');
    useCommunityStore.setState({
      mirroredVoices: [{
        itemId: ITEM, code: 'ROOM', spaceId: 'S', author: 'Olivia', authorKey: 'b'.repeat(64), name: 'Opa Georg',
        sharing: { scope: 'scripture' },
        config: { provider: 'openai', voice: 'onyx', style: '', shared: { code: 'ROOM', itemId: ITEM, spaceId: 'S', scope: 'scripture' } },
        payloadHash: 'h', updatedAt: 1,
      }],
    });
    const r = await dispatchTool('set_voice', '{"name":"Opa Georg"}', ctx);
    expect(r).toMatchObject({ ok: true, data: { selected: 'Opa Georg' } });
    expect(useLibraryStore.getState().voiceSelection.narration).toBe(ITEM);

    // Lent for reading only: chosen for replies, it says so, and what replies instead.
    const replies = await dispatchTool('set_voice', '{"name":"Opa Georg","for":"assistant"}', ctx);
    expect(replies).toMatchObject({ ok: true, data: { nowPlaysIn: expect.any(String), reason: expect.stringContaining('reading only') } });
    useCommunityStore.setState({ mirroredVoices: [] });
  });

  it('a bare OpenAI voice name makes that voice, with a key — and only with one', async () => {
    const r = await dispatchTool('set_voice', '{"name":"nova"}', ctx);
    expect(r.ok).toBe(true);
    const made = useLibraryStore.getState().voices.find((v) => v.name === 'Nova');
    expect(made?.config).toEqual({ provider: 'openai', voice: 'nova', style: '' });
    expect(useLibraryStore.getState().voiceSelection.narration).toBe(made?.id);

    useSettingsStore.setState({ hasUserOpenAiKey: false });
    expect((await dispatchTool('set_voice', '{"name":"shimmer"}', ctx)).ok).toBe(false);
  });
});

describe('dispatchTool — library tools reach Dexie and the store', () => {
  it('creates a card the store and the database both have', async () => {
    const r = await dispatchTool(
      'create_card',
      JSON.stringify({ title: 'Hope', references: ['Romans 15:13'] }),
      ctx,
    );
    expect(r.ok).toBe(true);

    const cards = useLibraryStore.getState().cards;
    expect(cards).toHaveLength(1);
    expect(cards[0].title).toBe('Hope');
    expect(await db.cards.get(cards[0].id)).toBeTruthy();
  });

  it('lists cards back', async () => {
    await dispatchTool('create_card', JSON.stringify({ title: 'A', references: [] }), ctx);
    const r = await dispatchTool('list_cards', '{}', ctx);
    expect(r.ok).toBe(true);
    expect(JSON.stringify(r.data)).toContain('A');
  });

  it('queues nothing while sync is off, however many tools run', async () => {
    await dispatchTool('create_card', JSON.stringify({ title: 'A', references: [] }), ctx);
    await dispatchTool('set_language', '{"language":"de"}', ctx);
    expect(await db.syncQueue.count()).toBe(0);
  });
});

/**
 * `opensReader` cannot be inferred from the tool name — `read_verses` also
 * reads, but into chat — so it is reported per result. Getting it wrong leaves
 * the user on the chat screen watching the previous turn while a post plays,
 * which is how this shipped the first time (374c8d7).
 */
describe('opensReader is opt-in per tool, not per name', () => {
  it('is not set by a chat reading', async () => {
    const r = await dispatchTool('read_verses', '{}', ctx);
    expect(r.opensReader).toBeFalsy();
  });

  it('is not set by a tool that does not read at all', async () => {
    const r = await dispatchTool('set_language', '{"language":"en"}', ctx);
    expect(r.opensReader).toBeFalsy();
  });
});
