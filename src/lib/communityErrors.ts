/**
 * **One answer to "which `community.errors.*` key is this refusal?"**
 *
 * A subscribe attempt can be refused by the store before it touches the network
 * (terms not accepted, author blocked, your own code) or by api.php (403
 * `profile_required`, 404 for a code it cannot resolve, 409 `own_space`). Both
 * arrive as an `Error` whose message is the server's `error` string, and the UI
 * has to turn that into something a reader can act on.
 *
 * This lived in two places. `SubscribePage` grew an `errorKeyFor` after its
 * three catch blocks "previously mapped the same thrown strings three slightly
 * different ways — which is how 'unknown share code' came to be shown as 'that
 * does not look like a share code'". That consolidated the three, and left a
 * fourth copy in `SubscribeField` — an inline list missing `unknown_code`
 * entirely and doing none of the folding below. So an unknown code pasted into
 * the header field (the commonest way a code arrives) said "That did not work.
 * Try again.", while the same code in a link said what was actually wrong.
 */

/** Keys that have a `community.errors.*` message of their own. */
const KNOWN_COMMUNITY_ERRORS = [
  'invalid_code',
  'unknown_code',
  'key_mismatch',
  'profile_required',
  'space_not_ready',
  'terms_required',
  'author_blocked',
  'own_space',
] as const;

/**
 * The server's word for a code it cannot resolve. Not a message key — it comes
 * back as prose — so it is folded to one here rather than at each call site.
 */
const UNKNOWN_CODE_PROSE = 'unknown share code';

/**
 * Which `community.errors.*` key a thrown refusal should be shown as, or `null`
 * when there is no known key — leaving the caller to fall back to the server's
 * own detail, or to a generic message.
 */
export function communityErrorKey(e: unknown): string | null {
  const raw = e instanceof Error ? e.message : '';
  if (raw === UNKNOWN_CODE_PROSE) return 'unknown_code';
  return (KNOWN_COMMUNITY_ERRORS as readonly string[]).includes(raw) ? raw : null;
}
