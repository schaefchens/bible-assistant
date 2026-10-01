import { describe, expect, it } from 'vitest';
import type { PlanItem } from '@/lib/playbackPlan';
import {
  DEVICE_VOICE,
  ECHO_VOICE,
  voiceKeyPart,
  type SharedTtsVoice,
  type TtsVoice,
} from '@/services/voices/ttsVoice';
import {
  voiceCovers,
  voiceCoversSubject,
  type SharedVoiceRef,
  type VoiceShareScope,
} from '@/services/voices/voiceSharing';
import type { VerseSummary } from '@/types/domain';
import {
  DEFAULT_VOICE_SELECTION,
  SYSTEM_DEVICE_ID,
  SYSTEM_ECHO_ID,
  legacyVoiceId,
  legacyVoicesWorthKeeping,
  migrateLegacyVoices,
  normalizeVoiceProfile,
  normalizeVoiceSelection,
  resolveVoice,
  selectedVoice,
  voiceAvailability,
  type VoiceAccess,
  type VoiceProfile,
  type VoiceResolutionInput,
} from '@/services/voices/voiceProfiles';

/**
 * Which voice speaks is decided here, and three of its rules cost something
 * real when wrong: a migrated voice that no longer matches its downloads
 * (orphaned audio), a fallback that pays the shared key for a voice it must
 * not (a bill), and a resolver that hands out fresh objects (an infinite
 * render loop as a zustand selector).
 */

const ELEVEN_ID = 'JBFqnCBsd6RMkjVDRZzb';
const UUID = '0b2c6f1e-3a4d-4c5e-9f60-718293a4b5c6';

const nova: TtsVoice = { provider: 'openai', voice: 'nova', style: 'calm' };
const george: TtsVoice = {
  provider: 'elevenlabs',
  voiceId: ELEVEN_ID,
  model: 'eleven_v4',
  stability: 0.5,
  similarity: 0.75,
};
const profile = (id: string, config: TtsVoice, name = 'Grandpa'): VoiceProfile => ({
  v: 1,
  id,
  name,
  config,
  createdAt: 1,
  updatedAt: 1,
});

const NO_KEYS: VoiceAccess = { openAiKey: false, elevenLabsKey: false, elevenLabsFailure: null, sharedFailures: {} };
const ALL_KEYS: VoiceAccess = { openAiKey: true, elevenLabsKey: true, elevenLabsFailure: null, sharedFailures: {} };

describe('migrating the voice settings this replaced', () => {
  it.each([
    ['defaults', {}, SYSTEM_ECHO_ID, SYSTEM_DEVICE_ID, 0],
    ['the device voice', { voice: 'browser' }, SYSTEM_DEVICE_ID, SYSTEM_DEVICE_ID, 0],
    ['plain Echo', { voice: 'echo', voiceStyle: '' }, SYSTEM_ECHO_ID, SYSTEM_DEVICE_ID, 0],
    ['a styled Echo', { voice: 'echo', voiceStyle: 'calm' }, 'profile', SYSTEM_DEVICE_ID, 1],
    ['another voice', { voice: 'onyx' }, 'profile', SYSTEM_DEVICE_ID, 1],
    ['an unknown voice', { voice: 'gandalf' }, SYSTEM_ECHO_ID, SYSTEM_DEVICE_ID, 0],
    [
      'the same voice for both',
      { voice: 'onyx', voiceStyle: 'warm', assistantVoice: 'onyx' },
      'profile',
      'same',
      1,
    ],
    ['a different assistant voice', { voice: 'onyx', assistantVoice: 'nova' }, 'profile', 'profile', 2],
  ])('%s', (_, legacy, narration, assistant, rows) => {
    const { voices, selection } = migrateLegacyVoices(legacy, 5);
    expect(voices).toHaveLength(rows);
    if (narration === 'profile') expect(voices.map((v) => v.id)).toContain(selection.narration);
    else expect(selection.narration).toBe(narration);
    if (assistant === 'same') expect(selection.assistant).toBe(selection.narration);
    else if (assistant === 'profile') expect(voices.map((v) => v.id)).toContain(selection.assistant);
    else expect(selection.assistant).toBe(assistant);
    // Older than any real choice, so a selection synced from another device wins.
    expect(selection.updatedAt).toBe(1);
  });

  it('keeps the legacy cache identity exactly — so every downloaded chapter still resolves', () => {
    const { voices, selection } = migrateLegacyVoices({ voice: 'onyx', voiceStyle: 'calm, reverent' }, 5);
    const migrated = voices.find((v) => v.id === selection.narration)!;
    expect(voiceKeyPart(migrated.config)).toBe('onyx|calm, reverent');
  });

  it('gives a legacy assistant voice the old shared style, as it was heard', () => {
    const { voices, selection } = migrateLegacyVoices({ voiceStyle: 'warm', assistantVoice: 'nova' }, 5);
    expect(voiceKeyPart(voices.find((v) => v.id === selection.assistant)!.config)).toBe('nova|warm');
  });

  it('mints the same id on every device for the same voice', () => {
    const a = migrateLegacyVoices({ voice: 'onyx' }, 5);
    const b = migrateLegacyVoices({ voice: 'onyx' }, 99);
    expect(a.voices[0].id).toBe(b.voices[0].id);
    expect(a.voices[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(legacyVoiceId(nova)).not.toBe(legacyVoiceId({ ...nova, style: '' }));
  });

  it('only parks settings worth migrating', () => {
    expect(legacyVoicesWorthKeeping({})).toBeUndefined();
    expect(legacyVoicesWorthKeeping({ voice: 'echo', voiceStyle: '', assistantVoice: 'browser' })).toBeUndefined();
    expect(legacyVoicesWorthKeeping({ voice: 'browser' })).toEqual({ voice: 'browser' });
  });
});

describe('which voice speaks', () => {
  const voices = [profile(UUID, nova, 'Nova'), profile('1c2d3e4f-5a6b-4c7d-8e9f-a0b1c2d3e4f5', george)];
  const input = (narration: string, assistant: string, access: VoiceAccess): VoiceResolutionInput => ({
    voices,
    shared: [],
    selection: { narration, assistant, updatedAt: 1 },
    access,
  });

  it.each([
    ['Echo on the shared key', 'narration', SYSTEM_ECHO_ID, NO_KEYS, ECHO_VOICE],
    ['the device voice, always', 'narration', SYSTEM_DEVICE_ID, NO_KEYS, DEVICE_VOICE],
    ['an OpenAI voice with the key', 'narration', UUID, ALL_KEYS, nova],
    ['an OpenAI voice without it → Echo', 'narration', UUID, NO_KEYS, ECHO_VOICE],
    ['ElevenLabs with the key', 'narration', '1c2d3e4f-5a6b-4c7d-8e9f-a0b1c2d3e4f5', ALL_KEYS, george],
    ['ElevenLabs without it → Echo', 'narration', '1c2d3e4f-5a6b-4c7d-8e9f-a0b1c2d3e4f5', NO_KEYS, ECHO_VOICE],
    [
      'ElevenLabs after its credits ran out → Echo',
      'narration',
      '1c2d3e4f-5a6b-4c7d-8e9f-a0b1c2d3e4f5',
      { ...ALL_KEYS, elevenLabsFailure: { kind: 'quota' } },
      ECHO_VOICE,
    ],
    [
      'another ElevenLabs voice failing does not stop this one',
      'narration',
      '1c2d3e4f-5a6b-4c7d-8e9f-a0b1c2d3e4f5',
      { ...ALL_KEYS, elevenLabsFailure: { kind: 'voice', voiceId: 'Xx0Xx0Xx0Xx0Xx0Xx0Xx', reason: 'unavailable' } },
      george,
    ],
    ['a voice deleted elsewhere → the role default', 'narration', '99999999-9999-4999-8999-999999999999', ALL_KEYS, ECHO_VOICE],
    ['replies: Echo without a key → the device voice', 'assistant', SYSTEM_ECHO_ID, NO_KEYS, DEVICE_VOICE],
    ['replies: an OpenAI voice with the key', 'assistant', UUID, ALL_KEYS, nova],
  ] as const)('%s', (_, role, id, access, expected) => {
    const sel = role === 'narration' ? input(id, SYSTEM_DEVICE_ID, access) : input(SYSTEM_ECHO_ID, id, access);
    expect(resolveVoice(role, sel)).toEqual(expected);
  });

  it('a profile that sounds exactly like Echo is as free as Echo', () => {
    const echoTwin = [profile(UUID, { provider: 'openai', voice: 'echo', style: '' }, 'Brother Echo')];
    const v = resolveVoice('narration', { voices: echoTwin, shared: [], selection: { narration: UUID, assistant: SYSTEM_DEVICE_ID, updatedAt: 1 }, access: NO_KEYS });
    expect(voiceKeyPart(v as TtsVoice)).toBe('echo|');
    expect(voiceAvailability('narration', echoTwin[0].config, NO_KEYS)).toBe('ok');
  });

  it('hands out the same object every time — safe as a zustand selector', () => {
    const sel = input(UUID, SYSTEM_DEVICE_ID, ALL_KEYS);
    expect(resolveVoice('narration', sel)).toBe(voices[0].config);
    expect(resolveVoice('narration', sel)).toBe(resolveVoice('narration', sel));
    expect(resolveVoice('narration', input(UUID, SYSTEM_DEVICE_ID, NO_KEYS))).toBe(ECHO_VOICE);
    expect(selectedVoice('narration', input(UUID, SYSTEM_DEVICE_ID, NO_KEYS))).toBe(voices[0].config);
  });

  it('never consults anything but the audible config: names and pictures are not identity', () => {
    const a = profile(UUID, nova, 'Nova');
    const b = { ...profile('1c2d3e4f-5a6b-4c7d-8e9f-a0b1c2d3e4f5', { ...nova }, 'Grandma'), avatar: 'data:image/jpeg;base64,AAAA' };
    expect(voiceKeyPart(a.config)).toBe(voiceKeyPart(b.config));
  });
});

describe('a voice somebody shared on a shelf', () => {
  const ITEM = '7e1f0c2a-9b3d-4e5f-8a6b-c7d8e9f0a1b2';
  const SPACE = '3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f';
  const ref = (scope: VoiceShareScope, itemId = ITEM): SharedVoiceRef => ({ code: 'CODE', itemId, spaceId: SPACE, scope });
  const sharedGeorge = (scope: VoiceShareScope, itemId = ITEM): SharedTtsVoice => ({ ...george, shared: ref(scope, itemId) });
  const inputFor = (
    shared: { itemId: string; config: SharedTtsVoice }[],
    narration: string,
    access: VoiceAccess,
    assistant = SYSTEM_DEVICE_ID,
  ): VoiceResolutionInput => ({ voices: [], shared, selection: { narration, assistant, updatedAt: 1 }, access });

  it('is chosen by its item id, and speaks without a key of the listener’s own — the owner pays', () => {
    const mirror = { itemId: ITEM, config: sharedGeorge('scripture') };
    expect(resolveVoice('narration', inputFor([mirror], ITEM, NO_KEYS))).toBe(mirror.config);
    // The same object every time, so a feed refresh is not a voice change.
    expect(selectedVoice('narration', inputFor([mirror], ITEM, NO_KEYS))).toBe(mirror.config);
  });

  it('a voice of the user’s own wins an id it shares with a mirror', () => {
    const own = profile(ITEM, nova, 'Mine');
    const mirror = { itemId: ITEM, config: sharedGeorge('anything') };
    const sel: VoiceResolutionInput = { ...inputFor([mirror], ITEM, ALL_KEYS), voices: [own] };
    expect(resolveVoice('narration', sel)).toBe(own.config);
  });

  it('refused by its owner it falls back — for that voice only', () => {
    const mirror = { itemId: ITEM, config: sharedGeorge('scripture') };
    const other = { itemId: UUID, config: sharedGeorge('scripture', UUID) };
    for (const failure of ['unavailable', 'budget'] as const) {
      const access = { ...NO_KEYS, sharedFailures: { [ITEM]: failure } };
      expect(resolveVoice('narration', inputFor([mirror, other], ITEM, access))).toBe(ECHO_VOICE);
      expect(resolveVoice('narration', inputFor([mirror, other], UUID, access))).toBe(other.config);
    }
    expect(voiceAvailability('narration', mirror.config, { ...NO_KEYS, sharedFailures: { [ITEM]: 'budget' } })).toBe('shared-budget');
  });

  it('the listener’s own ElevenLabs trouble is not the owner’s', () => {
    const access = { ...ALL_KEYS, elevenLabsKey: false, elevenLabsFailure: { kind: 'quota' } as const };
    expect(voiceAvailability('narration', sharedGeorge('scripture'), access)).toBe('ok');
  });

  it('replies only on a voice shared for anything', () => {
    const reading = { itemId: ITEM, config: sharedGeorge('pieces') };
    const anything = { itemId: UUID, config: sharedGeorge('anything', UUID) };
    expect(voiceAvailability('assistant', reading.config, NO_KEYS)).toBe('shared-cannot-reply');
    expect(resolveVoice('assistant', inputFor([reading], SYSTEM_ECHO_ID, NO_KEYS, ITEM))).toBe(DEVICE_VOICE);
    expect(resolveVoice('assistant', inputFor([anything], SYSTEM_ECHO_ID, NO_KEYS, UUID))).toBe(anything.config);
  });

  it('a mirror that vanished is a dangling choice: the role default', () => {
    expect(resolveVoice('narration', inputFor([], ITEM, ALL_KEYS))).toBe(ECHO_VOICE);
  });

  describe('what it may read — voiceCovers', () => {
    const verse = (unit?: VerseSummary['unit']): PlanItem => ({
      kind: 'verse',
      verseIndex: 0,
      pauseAfterMs: 0,
      verse: { translation: 'KJV', bookId: 19, chapter: 117, verse: 1, text: 'x', display: '', unit },
    });
    const piece = (spaceId: string): VerseSummary['unit'] => ({
      kind: 'post',
      spaceId,
      postId: 'p',
      index: 0,
      language: 'en',
      title: 'T',
      author: 'A',
      publishedAt: 1,
    });
    const heading: PlanItem = { kind: 'heading', verseIndex: 0, text: 'Psalms, chapter 117', translation: 'KJV', pauseAfterMs: 0 };

    it.each([
      ['scripture', 'scripture', [heading, verse()], true],
      ['scripture', 'a piece', [verse(piece(SPACE))], false],
      ['scripture', 'scripture, then a piece', [verse(), verse(piece(SPACE))], false],
      ['pieces', 'a piece on its own shelf', [heading, verse(piece(SPACE))], true],
      ['pieces', 'a piece from another shelf', [verse(piece('another'))], false],
      ['pieces', 'scripture', [verse()], true],
      ['anything', 'a piece from anywhere', [verse(piece('another'))], true],
    ] as const)('%s reads %s: %s', (scope, _, plan, expected) => {
      expect(voiceCovers(ref(scope), plan)).toBe(expected);
    });

    it.each([
      ['scripture', { kind: 'chapter' }, true],
      ['scripture', { kind: 'post', spaceId: SPACE }, false],
      ['pieces', { kind: 'post', spaceId: SPACE }, true],
      ['pieces', { kind: 'post', spaceId: 'another' }, false],
      ['anything', { kind: 'post', spaceId: 'another' }, true],
    ] as const)('a download: %s, %j → %s', (scope, subject, expected) => {
      expect(voiceCoversSubject(ref(scope), subject)).toBe(expected);
    });
  });
});

describe('a voice row from anywhere', () => {
  it('keeps what a voice is and drops everything else', () => {
    const row = normalizeVoiceProfile({
      v: 1,
      id: UUID,
      name: '  Grandpa  ',
      sourceName: 'George',
      avatar: 'data:image/jpeg;base64,QUJD',
      config: { ...george, style: 0.4 },
      createdAt: 3,
      updatedAt: 4,
      dirty: 1,
      evil: '<script>',
    });
    expect(row).toEqual({
      v: 1,
      id: UUID,
      name: 'Grandpa',
      sourceName: 'George',
      avatar: 'data:image/jpeg;base64,QUJD',
      config: george,
      createdAt: 3,
      updatedAt: 4,
    });
  });

  it('refuses a row that is not a voice, and an avatar that is not an inline image', () => {
    expect(normalizeVoiceProfile({ id: 'not-a-uuid', config: nova })).toBeNull();
    expect(normalizeVoiceProfile({ id: UUID, config: { provider: 'openai', voice: 'gandalf' } })).toBeNull();
    expect(normalizeVoiceProfile({ id: UUID, config: nova, avatar: 'https://evil.example/x.png' })).not.toHaveProperty('avatar');
    expect(normalizeVoiceProfile({ id: UUID, config: nova, name: '' })!.name).toBe('Nova');
  });

  it('reads a selection defensively', () => {
    expect(normalizeVoiceSelection(null)).toBe(DEFAULT_VOICE_SELECTION);
    expect(normalizeVoiceSelection({ narration: 'drop table', assistant: UUID, updatedAt: 7 })).toEqual({
      narration: SYSTEM_ECHO_ID,
      assistant: UUID,
      updatedAt: 7,
    });
  });
});
