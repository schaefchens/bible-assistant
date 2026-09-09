import { beforeEach, describe, expect, it } from 'vitest';
import { resolveSpaceByName } from '@/services/community/spaceNameMatch';
import { useCommunityStore } from '@/store/communityStore';
import type { Space, Subscription } from '@/types/domain';

/**
 * Resolving a shelf from what somebody said out loud.
 *
 * The rule this pins is the one the *rename* put at risk: the generic noun for
 * the thing itself has to be ignored when matching, or the commonest phrasing
 * resolves to nothing and the model's next move is to look for a book of the
 * Bible called Christoph. The UI now teaches users the word "shelf" / "Regal",
 * so those two joined "space", "room" and "Raum" in `SPACE_FILLER_WORDS` — and
 * all five have to keep working, because older invitations and older habits
 * still say the old ones.
 *
 * Unit rather than integration: the matcher is pure apart from reading the
 * store, which is three fields set below.
 */

const space = (id: string, name: string): Space => ({
  id,
  name,
  kind: 'custom',
  approval: 'manual',
  createdAt: 0,
  updatedAt: 0,
});

const sub = (code: string, ownerName: string, spaceName: string): Subscription => ({
  code,
  spaceName,
  spaceKind: 'custom',
  ownerName,
  status: 'accepted',
  pinnedKey: 'ab'.repeat(32),
  keyPinnedAt: 0,
  addedAt: 0,
  updatedAt: 0,
});

beforeEach(() => {
  useCommunityStore.setState({
    profile: { displayName: 'Christoph', authorKey: 'cd'.repeat(32), updatedAt: 0 },
    spaces: [space('s1', 'Gedanken')],
    subscriptions: [sub('CODEA', 'Anna', 'Notizen')],
  });
});

describe('the generic noun is not part of the name', () => {
  // Each of these is "the author's shelf" said with a different word for
  // "shelf" — the new one, and the two the app used to use.
  for (const said of [
    "Christoph's shelf",
    'Christophs Regal',
    "Christoph's space",
    'Christophs Raum',
    "Christoph's room",
  ]) {
    it(`resolves ${JSON.stringify(said)} to their own shelf`, () => {
      const hit = resolveSpaceByName(said);
      expect(hit.ok, `"${said}" did not resolve`).toBe(true);
      if (hit.ok) expect(hit.key.spaceId).toBe('s1');
    });
  }

  it('resolves somebody else\'s the same way, by code', () => {
    const hit = resolveSpaceByName("Anna's Regal");
    expect(hit.ok).toBe(true);
    if (hit.ok) expect(hit.key.code).toBe('CODEA');
  });

  it('still matches a shelf actually called "Regal"', () => {
    // The generic word being filler must not make a shelf named after it
    // unreachable — `spaceContentWords` falls back to every word when
    // filtering would leave none, and an exact alias matches a tier earlier.
    useCommunityStore.setState({ spaces: [space('s1', 'Gedanken'), space('s2', 'Regal')] });
    const hit = resolveSpaceByName('Regal');
    expect(hit.ok).toBe(true);
    if (hit.ok) expect(hit.key.spaceId).toBe('s2');
  });

  it('names the real shelves when nothing matches, rather than guessing', () => {
    const hit = resolveSpaceByName('Sonnenschein');
    expect(hit.ok).toBe(false);
    if (!hit.ok) expect(hit.error).toContain('Gedanken');
  });
});
