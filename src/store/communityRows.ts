import { getIdentity } from '@/lib/identity';
import { codeCarriesFingerprint, codeMatchesKey } from '@/lib/spaceCode';
import type { Membership, Post, Profile, Space } from '@/types/domain';

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

export function byPublishedDesc(a: Post, b: Post): number {
  // Drafts (publishedAt 0) sort to the top: they are what the author is
  // working on, and they are the only rows the author can act on next.
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
 * listed: the picker, `/spaces`, and the assistant's `read_space` lookup, where
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
