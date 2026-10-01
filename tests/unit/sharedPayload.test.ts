import { describe, expect, it } from 'vitest';
import {
  buildBoardPayload,
  buildPlanPayload,
  buildVoicePayload,
  payloadHash,
  voiceModerationText,
} from '@/services/community/sharedPayload';
import { parseBoardPayload, parsePlanPayload, parseVoicePayload } from '@/services/community/sharedItems';
import type { VoiceProfile } from '@/services/voices/voiceProfiles';
import type { Board, Card, ReadingList } from '@/types/domain';

/**
 * The payload is a **format**, not an implementation detail.
 *
 * `canonicalItemMessage` signs `sha256(payload)`, so any change to how this
 * serialises invalidates every signature already published: existing shared
 * plans stop verifying on every subscriber's device and are refused rather
 * than rendered. Same standing as `postUnits`, whose output is a TTS cache key.
 *
 * `community:verify` asserts the *properties* — determinism, sorted keys, no
 * nulls. This file pins the exact bytes, which is the part determinism cannot
 * see: reorder two fields and both runs change together, so a property test
 * stays green while every signature in the wild breaks. If one of these
 * strings has to change, `ITEM_SIG_VERSION` changes with it.
 */

const T = 1_700_000_000_000;

const plan: ReadingList = {
  id: 'L1',
  name: 'Jona in drei Tagen',
  description: 'Ein kurzer Plan.',
  days: [
    {
      id: 'd1',
      title: 'Tag 1',
      entries: [
        { id: 'e1', bookId: 32, chapter: 1, label: 'Morgens' },
        { id: 'e2', bookId: 32, chapter: 2, ranges: [{ start: 1, end: 4 }], translation: 'LUT' },
      ],
    },
  ],
  emoji: '🐟',
  createdAt: T,
  updatedAt: T,
};

const card: Card = {
  id: 'c1',
  title: 'John 3:16',
  references: [{ bookId: 43, chapter: 3, ranges: [{ start: 16, end: 16 }] }],
  notes: 'For God so loved',
  createdAt: T,
  updatedAt: T,
};

const board: Board = {
  id: 'B1',
  name: 'Merkverse',
  cardIds: ['c1'],
  viewMode: 'freeform',
  freeform: { c1: { x: 0.1, y: 0.2, w: 0.3, h: 0.4, rotation: 2, z: 1 } },
  createdAt: T,
  updatedAt: T,
};

describe('the shared payload format', () => {
  it('serialises a plan to exactly these bytes', () => {
    expect(buildPlanPayload(plan)).toBe(
      '{"v":1,"list":{"id":"L1","name":"Jona in drei Tagen","description":"Ein kurzer Plan.",' +
        '"days":[{"id":"d1","title":"Tag 1","entries":[' +
        '{"id":"e1","bookId":32,"chapter":1,"label":"Morgens"},' +
        '{"id":"e2","bookId":32,"chapter":2,"ranges":[{"start":1,"end":4}],"translation":"LUT"}' +
        ']}],"emoji":"🐟","createdAt":1700000000000,"updatedAt":1700000000000}}',
    );
  });

  it('serialises a board to exactly these bytes', () => {
    expect(buildBoardPayload(board, [card])).toBe(
      '{"v":1,"board":{"id":"B1","name":"Merkverse","cardIds":["c1"],"viewMode":"freeform",' +
        '"freeform":{"c1":{"x":0.1,"y":0.2,"w":0.3,"h":0.4,"rotation":2,"z":1}},' +
        '"createdAt":1700000000000,"updatedAt":1700000000000},' +
        '"cards":[{"id":"c1","title":"John 3:16","references":[' +
        '{"bookId":43,"chapter":3,"ranges":[{"start":16,"end":16}]}],' +
        '"notes":"For God so loved","createdAt":1700000000000,"updatedAt":1700000000000}]}',
    );
  });

  // A voice is the one payload the server also *reads* — its terms decide
  // what the owner's key pays for — so its bytes are a contract with
  // api/voices.php's sharedVoiceOf() as well as with the signature.
  it.each([
    [
      'an ElevenLabs voice with a picture, on scripture with both limits',
      {
        v: 1,
        id: '0b2c6f1e-3a4d-4c5e-9f60-718293a4b5c6',
        name: 'Opa Georg',
        sourceName: 'George',
        avatar: 'data:image/png;base64,QUJD',
        config: { provider: 'elevenlabs', voiceId: 'JBFqnCBsd6RMkjVDRZzb', model: 'eleven_v4', stability: 0.5, similarity: 0.75 },
        createdAt: T,
        updatedAt: T,
      },
      { scope: 'scripture', monthly: 50000, dailyPerReader: 7000 },
      '{"v":1,"voice":{"id":"0b2c6f1e-3a4d-4c5e-9f60-718293a4b5c6","name":"Opa Georg","sourceName":"George",' +
        '"config":{"provider":"elevenlabs","voiceId":"JBFqnCBsd6RMkjVDRZzb","model":"eleven_v4","stability":0.5,"similarity":0.75}},' +
        '"sharing":{"scope":"scripture","monthly":50000,"dailyPerReader":7000},"avatar":"data:image/png;base64,QUJD"}',
    ],
    [
      'an OpenAI voice with a style, on anything with no limits',
      {
        v: 1,
        id: '0b2c6f1e-3a4d-4c5e-9f60-718293a4b5c6',
        name: 'Nova',
        config: { provider: 'openai', voice: 'nova', style: 'calm' },
        createdAt: T,
        updatedAt: T,
      },
      { scope: 'anything' },
      '{"v":1,"voice":{"id":"0b2c6f1e-3a4d-4c5e-9f60-718293a4b5c6","name":"Nova",' +
        '"config":{"provider":"openai","voice":"nova","style":"calm"}},"sharing":{"scope":"anything"}}',
    ],
  ] as const)('serialises a voice to exactly these bytes: %s', (_, voice, sharing, bytes) => {
    expect(buildVoicePayload(voice as VoiceProfile, sharing)).toBe(bytes);
  });

  it('a voice publishes its sound alone — never a shared ref, never a stray field — and its picture last', () => {
    const voice = {
      v: 1,
      id: '0b2c6f1e-3a4d-4c5e-9f60-718293a4b5c6',
      name: 'Nova',
      avatar: 'data:image/png;base64,QUJD',
      config: { provider: 'openai', voice: 'nova', style: '', shared: { code: 'X', itemId: 'Y' }, evil: 1 },
      createdAt: T,
      updatedAt: T,
    } as unknown as VoiceProfile;
    const payload = buildVoicePayload(voice, { scope: 'pieces', monthly: 12.5, dailyPerReader: 0 });
    expect(payload).not.toMatch(/shared|evil|12\.5|"dailyPerReader"/);
    expect(payload.endsWith(',"avatar":"data:image/png;base64,QUJD"}')).toBe(true);
    // The moderation pre-check reads it without the picture.
    expect(voiceModerationText(voice, { scope: 'pieces' })).not.toContain('base64');
  });

  it('hashes to exactly this, which is what the signature commits to', () => {
    expect(payloadHash(buildPlanPayload(plan))).toBe(
      '6860a95f8061e1b0a437c8875dbcec58cad0f9053f5e03b80e628dfeea08138a',
    );
  });
});

/**
 * A round trip is what a subscriber actually experiences, so it is worth
 * asserting directly rather than inferring from the two halves.
 */
describe('parsing what was built', () => {
  it('returns a plan equal to the one that was shared', () => {
    expect(parsePlanPayload(buildPlanPayload(plan))).toEqual(plan);
  });

  it('returns the board and its cards', () => {
    const parsed = parseBoardPayload(buildBoardPayload(board, [card]));
    expect(parsed?.board).toEqual(board);
    expect(parsed?.cards).toEqual([card]);
  });

  it('refuses junk rather than rendering half a plan', () => {
    expect(parsePlanPayload('not json')).toBeNull();
    expect(parsePlanPayload('{"v":1}')).toBeNull();
    expect(parseBoardPayload('{"v":1,"board":{}}')).toBeNull();
  });

  it('returns a voice, its sound and its terms', () => {
    const voice: VoiceProfile = {
      v: 1,
      id: '0b2c6f1e-3a4d-4c5e-9f60-718293a4b5c6',
      name: 'Opa Georg',
      sourceName: 'George',
      avatar: 'data:image/png;base64,QUJD',
      config: { provider: 'elevenlabs', voiceId: 'JBFqnCBsd6RMkjVDRZzb', model: 'eleven_v4', stability: 0.5, similarity: 0.75 },
      createdAt: T,
      updatedAt: T,
    };
    expect(parseVoicePayload(buildVoicePayload(voice, { scope: 'pieces', monthly: 9000 }))).toEqual({
      voice: { id: voice.id, name: 'Opa Georg', sourceName: 'George', avatar: voice.avatar },
      config: voice.config,
      sharing: { scope: 'pieces', monthly: 9000 },
    });
  });

  it('refuses a voice this build could not narrate with, rather than offering one every request would fail', () => {
    const good = JSON.parse(
      buildVoicePayload(
        { v: 1, id: '0b2c6f1e-3a4d-4c5e-9f60-718293a4b5c6', name: 'Nova', config: { provider: 'openai', voice: 'nova', style: '' }, createdAt: T, updatedAt: T },
        { scope: 'scripture' },
      ),
    );
    expect(parseVoicePayload(JSON.stringify(good))).not.toBeNull();
    for (const bad of [
      { ...good, v: 2 },
      { ...good, sharing: { scope: 'everything' } },
      { ...good, voice: { ...good.voice, config: { provider: 'azure' } } },
      { ...good, voice: { ...good.voice, name: '  ' } },
    ]) {
      expect(parseVoicePayload(JSON.stringify(bad))).toBeNull();
    }
    expect(parseVoicePayload('not json')).toBeNull();
  });
});
