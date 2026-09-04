import { spaceDisplayName, spaceLabel } from '@/services/community/spaceName';
import { useCommunityStore } from '@/store/communityStore';
import type { Subscription } from '@/types/domain';

/**
 * **Resolving a space from the name someone said out loud.**
 *
 * "Read Christoph's Today" is the ordinary phrasing, and matching `space.name`
 * alone answered *nothing* to it — half the people you follow have a space
 * called Today, and none of them is called "Christoph's Today". The model's
 * next move was to look for a book of the Bible called Christoph, which is the
 * failure the user actually sees.
 *
 * So matching runs over **aliases**: the localized name, the stored name (a
 * Today space is stored as the literal `'Today'` and shown as "Heute", so both
 * are needed), the author alone, and author-plus-name. Three tiers — exact
 * alias, alias containing the phrase, then every content word appearing in the
 * author-plus-name text — with the possessive folded away in both languages
 * and filler words dropped from the last tier only, so a space genuinely
 * called "The Room" still matches exactly one tier earlier.
 *
 * Lives here rather than with the tool handlers because it is a matcher, not a
 * dispatcher, and because it belongs beside `spaceName.ts`, which answers the
 * other half of the question — what a space is *called*.
 */

export type SpaceCandidate = {
  key: { spaceId?: string; code?: string };
  /** The space's name as the app shows it — localized, so a Today space is
   * "Heute" for a German user. */
  space: string;
  /** The stored name. For a Today space that is the literal `'Today'` in every
   * language (see `spaceDisplayName`), which is exactly why both are aliases:
   * a German user says "Heute", the model often says "Today". */
  stored: string;
  author: string;
  /** How it is named back to the user: `Christoph / Heute`. */
  label: string;
  mine: boolean;
  status?: Subscription['status'];
};

/**
 * Words that carry no identity: articles, prepositions, and the nouns for the
 * thing itself. Stripped only from the *token* tier, so they can never turn a
 * name someone actually chose into a non-match — a space really called "The
 * Room" still matches exactly, one tier earlier.
 */
const SPACE_FILLER_WORDS = new Set([
  'the', 'a', 'an', 'of', 'from', 'by', 'in', 'space', 'room', 'read', 'please',
  'der', 'die', 'das', 'den', 'dem', 'von', 'vom', 'im', 'raum', 'bitte', 'lies',
]);

/** "my Today" is not a loose name — it says whose. */
const SPACE_OWN_WORDS = new Set([
  'my', 'mine', 'own', 'mein', 'meine', 'meinen', 'meiner', 'meinem', 'eigenen',
]);

/**
 * Fold a name down to what matching should ignore: case, punctuation, and the
 * English possessive that every natural phrasing of this request carries —
 * "Christoph's Today". The German one ("Christophs Heute") has no apostrophe to
 * key on and is handled by {@link looselyEqual} instead.
 */
function normalizeSpaceQuery(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\u2019'`]s\b/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** The words in a name that identify it. Falls back to all of them rather than
 * returning nothing, so a space named only "The Room" still has tokens. */
function spaceContentWords(value: string): string[] {
  const words = normalizeSpaceQuery(value).split(' ').filter(Boolean);
  const kept = words.filter((w) => !SPACE_FILLER_WORDS.has(w) && !SPACE_OWN_WORDS.has(w));
  return kept.length > 0 ? kept : words;
}

/** Equal up to a trailing "s" — which is the German possessive ("Christophs")
 * and an English plural, and is never the difference between two real names. */
function looselyEqual(a: string, b: string): boolean {
  return a === b || a === `${b}s` || b === `${a}s`;
}

function saysOwn(value: string): boolean {
  return normalizeSpaceQuery(value)
    .split(' ')
    .some((w) => SPACE_OWN_WORDS.has(w));
}

/**
 * Every way a space might be named.
 *
 * The author is in here, and that is the fix: a space is one *person's*
 * collection, so it is named "Christoph's Today" far more often than "Today" —
 * which is a name half the people you follow will also have used. Matching the
 * space name alone meant the commonest phrasing resolved to nothing, and the
 * model's next move was to look for a book of the Bible called Christoph.
 */
function spaceAliases(c: SpaceCandidate): string[] {
  const names = [c.space, c.stored].filter(Boolean);
  const out = [...names];
  if (c.author) {
    out.push(c.author, ...names.map((n) => `${c.author} ${n}`));
  }
  return out.map(normalizeSpaceQuery).filter(Boolean);
}

export function spaceCandidates(): SpaceCandidate[] {
  const state = useCommunityStore.getState();
  const me = state.profile?.displayName ?? '';
  return [
    ...state.spaces.map((sp) => ({
      key: { spaceId: sp.id },
      space: spaceDisplayName(sp),
      stored: sp.name,
      author: me,
      label: spaceLabel(me, sp),
      mine: true,
    })),
    ...state.subscriptions.map((sub) => {
      const shape = { kind: sub.spaceKind ?? ('custom' as const), name: sub.spaceName };
      return {
        key: { code: sub.code },
        space: spaceDisplayName(shape),
        stored: sub.spaceName,
        author: sub.ownerName,
        label: spaceLabel(sub.ownerName, shape),
        mine: false,
        status: sub.status,
      };
    }),
  ];
}

/**
 * Resolve a space the user named loosely, across their own and the ones they
 * read. Same spirit as `resolveReadingList`: exact match first, then a unique
 * case-insensitive substring, and an ambiguous name is an error rather than a
 * guess — reading the wrong person's writing aloud is worse than asking.
 *
 * Three tiers rather than two, because a space has several honest names (see
 * {@link spaceAliases}): an exact alias, an alias containing what was said, and
 * finally every word of it appearing somewhere in the author-plus-name text, so
 * "the today space from christoph" still lands.
 */
export function resolveSpaceByName(
  name: string,
): { ok: true; key: { spaceId?: string; code?: string }; label: string; status?: Subscription['status'] } | { ok: false; error: string } {
  const candidates = spaceCandidates();
  if (candidates.length === 0) return { ok: false, error: 'there are no spaces yet' };

  const needle = normalizeSpaceQuery(name);
  if (needle === '') return { ok: false, error: 'no space name given' };
  const tokens = spaceContentWords(name);

  const tiers = [
    (c: SpaceCandidate) => spaceAliases(c).some((a) => a === needle),
    (c: SpaceCandidate) => spaceAliases(c).some((a) => a.includes(needle)),
    (c: SpaceCandidate) => {
      const words = spaceContentWords(`${c.author} ${c.space} ${c.stored}`);
      return tokens.every((t) => words.some((w) => looselyEqual(t, w)));
    },
  ];

  let hits: SpaceCandidate[] = [];
  for (const match of tiers) {
    hits = candidates.filter(match);
    if (hits.length > 0) break;
  }

  // "my Today" among several people's Today spaces is not ambiguous.
  if (hits.length > 1 && saysOwn(name)) {
    const own = hits.filter((c) => c.mine);
    if (own.length > 0) hits = own;
  }

  if (hits.length === 0) {
    // Name what there *is*, so the model's next turn can offer the real names
    // instead of guessing again (or reaching for read_verses).
    return {
      ok: false,
      error: `no space matches "${name}" — the spaces are: ${candidates.map((c) => c.label).join(', ')}`,
    };
  }
  if (hits.length > 1) {
    const named = hits.map((h) => (h.mine ? `${h.label} (your own)` : h.label));
    return { ok: false, error: `"${name}" matches several spaces: ${named.join(', ')}` };
  }
  return { ok: true, key: hits[0].key, label: hits[0].label, status: hits[0].status };
}
