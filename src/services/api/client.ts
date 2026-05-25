import { requireIdentity } from '@/lib/identity';
import { useSettingsStore } from '@/store/settingsStore';

// import.meta.env.BASE_URL is the value of `base` in vite.config.ts ('/assistant/' here),
// so the SPA can be served from any subpath without code changes.
const API_BASE = `${import.meta.env.BASE_URL}api.php`;

export class ApiError extends Error {
  status: number;
  body?: unknown;

  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

/** Returns true when the server tagged a 502 with `error: 'user_key_failed'`,
 * meaning the caller's personal OpenAI key was rejected. Callers can surface
 * the in-session shared-key fallback UI on this signal. */
export function isUserKeyFailure(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    typeof err.body === 'object' &&
    err.body !== null &&
    (err.body as { error?: unknown }).error === 'user_key_failed'
  );
}

/** Listener for user_key_failed errors. The KeyFailureBanner subscribes here
 * so we don't have to thread callbacks through every TTS / chat caller. */
type KeyFailureListener = () => void;
const keyFailureListeners = new Set<KeyFailureListener>();

export function onUserKeyFailure(fn: KeyFailureListener): () => void {
  keyFailureListeners.add(fn);
  return () => keyFailureListeners.delete(fn);
}

function notifyUserKeyFailure(): void {
  for (const fn of keyFailureListeners) {
    try {
      fn();
    } catch {
      /* swallow — bad listener shouldn't block others */
    }
  }
}

function authHeaders(): Record<string, string> {
  const identity = requireIdentity();
  const headers: Record<string, string> = {
    'X-User-Id': identity.userId,
    'X-User-Secret': identity.userSecret,
  };
  // After a user-key failure, the client opts into the shared server key for
  // this session. The server reads this header in its effectiveOpenAiKey()
  // resolver — see public/api.php.
  if (useSettingsStore.getState().sessionPreferSharedKey) {
    headers['X-Prefer-Shared-Key'] = '1';
  }
  return headers;
}

export async function apiPostJson<T = unknown>(
  action: string,
  body: unknown,
  opts?: { signal?: AbortSignal },
): Promise<T> {
  const res = await fetch(`${API_BASE}?action=${encodeURIComponent(action)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify(body ?? {}),
    signal: opts?.signal,
  });

  return parseResponse<T>(res);
}

export async function apiGetJson<T = unknown>(action: string): Promise<T> {
  const res = await fetch(`${API_BASE}?action=${encodeURIComponent(action)}`, {
    method: 'GET',
    headers: authHeaders(),
  });
  return parseResponse<T>(res);
}

export async function apiPostForm<T = unknown>(action: string, form: FormData): Promise<T> {
  const res = await fetch(`${API_BASE}?action=${encodeURIComponent(action)}`, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  });
  return parseResponse<T>(res);
}

async function parseResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  if (!res.ok) {
    let msg = `API ${res.status}`;
    if (parsed && typeof parsed === 'object' && 'error' in parsed) {
      const err = (parsed as { error: unknown }).error;
      if (err != null) msg = String(err);
    }
    const apiErr = new ApiError(msg, res.status, parsed);
    if (isUserKeyFailure(apiErr)) notifyUserKeyFailure();
    throw apiErr;
  }
  return parsed as T;
}
