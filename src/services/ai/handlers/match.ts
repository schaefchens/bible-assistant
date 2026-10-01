/**
 * Resolving a thing the user *named* — a shelf, a plan, a piece, a voice —
 * against the things that exist. The one copy, because almost every handler is
 * a name resolver in front of a store action (docs/architecture/assistant.md).
 */

/**
 * The shape every resolver returns: found it, or a sentence for the model
 * saying what there is instead.
 */
export type Found<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Match a thing the user named against a list of things that have names.
 *
 * Exact first, then a unique substring, and **several matches is a question
 * rather than a guess** — the same three tiers `resolveSpaceByName` uses, and
 * for the same reason: acting on the wrong plan is worse than asking which.
 * A miss names everything there is, because the model's next turn is only as
 * good as what the failure told it.
 */
export function byName<T>(
  named: string,
  things: T[],
  nameOf: (t: T) => string,
  kind: string,
): Found<T> {
  if (things.length === 0) return { ok: false, error: `the user has no ${kind}` };
  const wanted = named.trim().toLowerCase();
  const all = () => things.map(nameOf).filter(Boolean).join(', ');
  const exact = things.filter((t) => nameOf(t).toLowerCase() === wanted);
  const hits =
    exact.length > 0 ? exact : things.filter((t) => nameOf(t).toLowerCase().includes(wanted));
  if (hits.length === 0) {
    return { ok: false, error: `no ${kind} called "${named}". They have: ${all()}` };
  }
  if (hits.length > 1) {
    return {
      ok: false,
      error: `"${named}" matches several ${kind}: ${hits.map(nameOf).join(', ')} — ask which`,
    };
  }
  return { ok: true, value: hits[0] };
}
