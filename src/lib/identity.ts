const USER_ID_KEY = 'ba.userId';
const USER_SECRET_KEY = 'ba.userSecret';

export type Identity = {
  userId: string;
  userSecret: string;
};

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function generateSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

export function getOrCreateIdentity(): Identity {
  let userId = localStorage.getItem(USER_ID_KEY);
  let userSecret = localStorage.getItem(USER_SECRET_KEY);

  if (!userId || !userSecret) {
    userId = crypto.randomUUID();
    userSecret = generateSecret();
    localStorage.setItem(USER_ID_KEY, userId);
    localStorage.setItem(USER_SECRET_KEY, userSecret);
  }

  return { userId, userSecret };
}

export function getIdentity(): Identity | null {
  const userId = localStorage.getItem(USER_ID_KEY);
  const userSecret = localStorage.getItem(USER_SECRET_KEY);
  if (!userId || !userSecret) return null;
  return { userId, userSecret };
}

export function setIdentity(identity: Identity): void {
  localStorage.setItem(USER_ID_KEY, identity.userId);
  localStorage.setItem(USER_SECRET_KEY, identity.userSecret);
}

export function exportIdentityString(identity: Identity): string {
  return `${identity.userId}:${identity.userSecret}`;
}

export function parseIdentityString(raw: string): Identity | null {
  const trimmed = raw.trim();
  const sep = trimmed.indexOf(':');
  if (sep === -1) return null;
  const userId = trimmed.slice(0, sep).trim();
  const userSecret = trimmed.slice(sep + 1).trim();
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return null;
  if (!/^[0-9a-f]{32,}$/i.test(userSecret)) return null;
  return { userId, userSecret };
}
