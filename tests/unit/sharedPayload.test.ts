import { describe, expect, it } from 'vitest';
import {
  buildBoardPayload,
  buildPlanPayload,
  payloadHash,
} from '@/services/community/sharedPayload';
import { parseBoardPayload, parsePlanPayload } from '@/services/community/sharedItems';
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
});
