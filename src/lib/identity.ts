export type Identity = {
  userId: string;
  userSecret: string;
};

/**
 * The identity is *derived* from the recovery mnemonic (see
 * deriveIdentityFromPassphrase), so it is never persisted in its own right —
 * it's recomputed once at boot by hydrateIdentity() and held here.
 *
 * Keeping it in memory is what lets getIdentity()/requireIdentity() stay
 * synchronous: requireIdentity() runs on every single API call, and durable
 * native storage is async. Boot hydration bridges that gap once, up front.
 */
let cachedIdentity: Identity | null = null;

export function getIdentity(): Identity | null {
  return cachedIdentity;
}

export function requireIdentity(): Identity {
  if (!cachedIdentity) {
    throw new Error('No identity available — passphrase onboarding has not completed.');
  }
  return cachedIdentity;
}

export function setIdentity(identity: Identity): void {
  cachedIdentity = identity;
}

export function clearIdentity(): void {
  cachedIdentity = null;
}
