const USER_ID_KEY = 'ba.userId';
const USER_SECRET_KEY = 'ba.userSecret';

export type Identity = {
  userId: string;
  userSecret: string;
};

export function getIdentity(): Identity | null {
  const userId = localStorage.getItem(USER_ID_KEY);
  const userSecret = localStorage.getItem(USER_SECRET_KEY);
  if (!userId || !userSecret) return null;
  return { userId, userSecret };
}

export function requireIdentity(): Identity {
  const id = getIdentity();
  if (!id) throw new Error('No identity available — passphrase onboarding has not completed.');
  return id;
}

export function setIdentity(identity: Identity): void {
  localStorage.setItem(USER_ID_KEY, identity.userId);
  localStorage.setItem(USER_SECRET_KEY, identity.userSecret);
}
