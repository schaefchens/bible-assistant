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
      'read_new', 'read_space', 'read_verses',
    ]);
    for (const name of READ_TOOL_NAMES) {
      expect(declared, `${name} is a read tool but is not declared`).toContain(name);
      expect(isReadTool(name)).toBe(true);
    }
    expect(isReadTool('create_card')).toBe(false);
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
