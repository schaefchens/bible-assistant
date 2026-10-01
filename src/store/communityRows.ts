import type { FeedItem, LocalSharedItem } from '@/db/dexie';
import { getIdentity } from '@/lib/identity';
import { codeCarriesFingerprint, codeMatchesKey } from '@/lib/spaceCode';
import {
  parseBoardPayload,
  parsePlanPayload,
  parseVoicePayload,
} from '@/services/community/sharedItems';
import { authorName } from '@/services/community/spaceName';
import type { SharedTtsVoice } from '@/services/voices/ttsVoice';
import type {
  Membership,
  MirroredBoard,
  MirroredList,
  MirroredVoice,
  Profile,
  SharedItem,
  Space,
  Subscription,
} from '@/types/domain';

/**
 * The shaping rules the halves of this feature share.
 *
 * Their own module for the same reason `libraryRows` is — `init`, the polled
 * feed reads and the writers have to shape the same rows the same way — but
 * here the
 * consequence of getting it wrong is sharper than a warning: with these
 * living in either module, the two import each other, TypeScript gives up on
 * inferring `CommunityState`, and it silently becomes `any` for **every
 * component that reads the store**. `tsc` reports that as a dozen implicit-any
 * errors in `SpaceDetail` and nothing at all about the cycle.
 */

/**
 * Drop a membership request the user made to their own space.
 *
 * Older installs have one: asking to read your own space used to be allowed,
 * and it left a request from yourself sitting in your own inbox — a decision
 * nobody can sensibly make, and a "1 pending" badge that never clears. The row
 * stays in the owner's file on the server (nothing here deletes another
 * record's history); it is simply not a request, so it is not shown as one.
 */
export function withoutSelf(rows: Membership[]): Membership[] {
  const me = getIdentity()?.userId;
  return me ? rows.filter((m) => m.userId !== me) : rows;
}

export function byPublishedDesc(
  a: { publishedAt: number },
  b: { publishedAt: number },
): number {
  // Drafts (publishedAt 0) sort to the top: they are what the author is
  // working on, and they are the only rows the author can act on next. A
  // shared item never has one — its source list or board *is* the draft — so
  // for those this is a plain newest-first.
  const ak = a.publishedAt || Number.MAX_SAFE_INTEGER;
  const bk = b.publishedAt || Number.MAX_SAFE_INTEGER;
  return bk - ak;
}

export function byUpdatedDesc(a: { updatedAt: number }, b: { updatedAt: number }): number {
  return b.updatedAt - a.updatedAt;
}

/**
 * Is this share code one of the user's **own** spaces?
 *
 * You cannot read your own writing as a subscriber. Asking to anyway appends a
 * membership request to your own file — an invitation from yourself, sitting in
 * your own inbox — and then the space is listed twice everywhere a space can be
 * listed: the picker, `/spaces`, and the assistant's `read_shelf` lookup, where
 * two identical names are also an ambiguity error.
 *
 * Two tests, because the obvious one is not enough. The stored `shareCode`
 * catches the code as it is today; the fingerprint catches every other code
 * that was ever *theirs* — one they have since rotated away, or one minted for a
 * space that only exists on another device — because it commits to the signing
 * key, and that key is the same for every space one author owns.
 * `codeCarriesFingerprint` guards the second test: `codeMatchesKey` is
 * vacuously true for a code that carries none.
 *
 * **Exported because `/subscribe/:code` has to reach the same answer.** That
 * route used to ask the question its own way — the stored `shareCode`, or the
 * author key the *server* reported for the code — which meant a code the server
 * no longer resolves (rotated away, or minted on another device that has not
 * synced) failed its lookup and was reported as a malformed code, while the
 * Rooms field refused the very same code as the user's own. One question, one
 * answer.
 */
export function isOwnCode(code: string, profile: Profile | null, spaces: Space[]): boolean {
  if (spaces.some((sp) => sp.shareCode === code)) return true;
  return !!profile && codeCarriesFingerprint(code) && codeMatchesKey(code, profile.authorKey);
}

/**
 * Everything the app derives from the cached items of subscribed rooms: the
 * headers each room lists, and the items it can render, one array per kind.
 *
 * Written only through `mirrorsFrom` (or `NO_MIRRORS`), and always as a whole —
 * the four places that rebuild them (`init`, the feed refresh, `unsubscribe`,
 * `disableCommunity`) spread one of these into the store, so a kind added here
 * reaches all four, and none can update one shape and forget another.
 */
export type FeedMirrors = {
  feedItems: Record<string, SharedItem[]>;
  mirroredLists: MirroredList[];
  mirroredBoards: MirroredBoard[];
  mirroredVoices: MirroredVoice[];
};

export const NO_MIRRORS: FeedMirrors = Object.freeze({
  feedItems: {},
  mirroredLists: [],
  mirroredBoards: [],
  mirroredVoices: [],
});

/**
 * Turn the cached item headers of subscribed rooms into what the app renders.
 *
 * Shared by every writer of the derived shapes (see `FeedMirrors`), because
 * "same rows, same shaping" is exactly the kind of rule that ends up written
 * twice and drifting. It answers all of them at once so they cannot disagree
 * about which items made the cut.
 *
 * Five rules, and each has a failure it prevents:
 *
 * - **Only rooms the owner has let the user into.** A pending or revoked
 *   subscription's cached rows are not shown — and for a voice that is the
 *   difference between a voice the reader may select and one every request
 *   with would be refused.
 * - **Unverified rows are skipped.** They should never have been stored, but a
 *   build that changed the canonicalization could leave one behind — the same
 *   guard `init` already applies to cached posts.
 * - **A row with no payload yet is skipped.** Its header is known-genuine, but
 *   `space.feed` carries headers only and the payload is fetched separately, so
 *   between the two there is nothing to show. It still appears in `feedItems`,
 *   which is what lets a room list it as pending.
 * - **A payload that will not parse is skipped**, not rendered empty. It is the
 *   same refusal a failed signature gets: better an absent plan than a plan
 *   with its days silently missing.
 * - **A voice keeps its config object** while its payload is unchanged
 *   (`previousVoices`, matched on item and hash). The voice resolver hands that
 *   object out, and auto-play reads a new reference as "the voice changed" —
 *   without this every poll would restart a prefetch.
 *
 * The author's key comes from the *subscription's* `pinnedKey`, never from the
 * item's own `authorKey`: the pinned one is what the reader decided to trust,
 * and it is the identity blocking and author-grouping key on.
 */
export function mirrorsFrom(
  rows: FeedItem[],
  subs: Subscription[],
  previousVoices: readonly MirroredVoice[] = [],
): FeedMirrors {
  const byCode = new Map(subs.filter((s) => s.status === 'accepted').map((s) => [s.code, s]));
  const kept = new Map(previousVoices.map((m) => [m.itemId, m]));
  const feedItems: Record<string, SharedItem[]> = {};
  const mirroredLists: MirroredList[] = [];
  const mirroredBoards: MirroredBoard[] = [];
  const mirroredVoices: MirroredVoice[] = [];

  for (const row of rows) {
    const sub = byCode.get(row.code);
    if (!row.verified || !sub) continue;

    const { code: _c, verified: _v, fetchedAt: _f, payload, ...header } = row;
    (feedItems[row.code] ??= []).push(header);
    if (!payload) continue;

    const common = {
      code: row.code,
      itemId: row.id,
      author: authorName(sub.ownerName),
      authorKey: sub.pinnedKey,
      updatedAt: row.updatedAt,
    };
    switch (row.kind) {
      case 'plan': {
        const list = parsePlanPayload(payload);
        if (list) mirroredLists.push({ list, ...common });
        break;
      }
      case 'board': {
        const bundle = parseBoardPayload(payload);
        if (bundle) mirroredBoards.push({ ...bundle, ...common });
        break;
      }
      case 'voice': {
        const before = kept.get(row.id);
        const same = before && before.code === row.code && before.payloadHash === row.payloadHash;
        const voice = same ? before : voiceMirror(row, payload);
        if (voice) mirroredVoices.push({ ...voice, author: common.author, authorKey: common.authorKey, updatedAt: row.updatedAt });
        break;
      }
    }
  }

  for (const items of Object.values(feedItems)) items.sort(byPublishedDesc);
  mirroredLists.sort(byUpdatedDesc);
  mirroredBoards.sort(byUpdatedDesc);
  mirroredVoices.sort(byUpdatedDesc);
  return { feedItems, mirroredLists, mirroredBoards, mirroredVoices };
}

/** A shared voice, parsed, with whose it is on its config — or null. */
function voiceMirror(row: FeedItem, payload: string): MirroredVoice | null {
  const parsed = parseVoicePayload(payload);
  if (!parsed) return null;
  const config: SharedTtsVoice = {
    ...parsed.config,
    shared: { code: row.code, itemId: row.id, spaceId: row.spaceId, scope: parsed.sharing.scope },
  };
  return {
    itemId: row.id,
    code: row.code,
    spaceId: row.spaceId,
    author: '',
    authorKey: '',
    name: parsed.voice.name,
    ...(parsed.voice.sourceName ? { sourceName: parsed.voice.sourceName } : {}),
    ...(parsed.voice.avatar ? { avatar: parsed.voice.avatar } : {}),
    sharing: parsed.sharing,
    config,
    updatedAt: row.updatedAt,
    payloadHash: row.payloadHash,
  };
}

/**
 * The wire shape of one of the user's own shared items.
 *
 * `stripLocal` drops `dirty`/`deleted`/`shared`, but a `LocalSharedItem` also
 * carries two columns that exist only on this device — the payload itself, and
 * the source's timestamp — and neither belongs in the store or in a request.
 * Doing it here rather than at each call site is what stops a 100KB payload
 * ending up in a zustand snapshot by accident.
 */
export function itemHeader(row: LocalSharedItem): SharedItem {
  const { payload: _p, sourceUpdatedAt: _s, dirty: _d, deleted: _x, shared: _sh, ...header } = row;
  return header;
}

/**
 * Which list or board a shared item was snapshotted from.
 *
 * The item's own id is minted fresh, so it cannot answer this; the source id
 * lives inside the payload, which is the one copy of it. Parsing is cheap
 * enough at boot (once per shared item) and on an explicit republish, and it
 * beats a second local column that could disagree with the payload.
 */
export function sourceIdOfPayload(kind: SharedItem['kind'], payload: string): string | null {
  if (!payload) return null;
  try {
    const root = JSON.parse(payload) as Record<string, { id?: unknown } | undefined>;
    const id = root[PAYLOAD_SOURCE_KEY[kind]]?.id;
    return typeof id === 'string' ? id : null;
  } catch {
    return null;
  }
}

/** Where each kind's payload keeps its source (see `buildPlanPayload` and its
 * siblings) — a `Record` over the kind, so a new kind fails to compile here
 * rather than quietly reading as a board. */
const PAYLOAD_SOURCE_KEY: Record<SharedItem['kind'], string> = {
  plan: 'list',
  board: 'board',
  voice: 'voice',
};
