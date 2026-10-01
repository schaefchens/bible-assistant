import { requireIdentity } from '@/lib/identity';
import { useSettingsStore } from '@/store/settingsStore';
import type { ElevenLabsFailure } from '@/services/voices/voiceProfiles';
// Resolves to the same '/assistant/api.php' on the web build; on the native
// build it carries the absolute backend origin, which the WebView can't infer.
import { API_BASE } from './origin';

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
function isUserKeyFailure(err: unknown): boolean {
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

/**
 * An ElevenLabs refusal that will keep happening for the rest of the session —
 * the key is missing or refused, the credits are gone, or one voice can no
 * longer be used — as opposed to a blip (a rate limit, an outage, a busy
 * server), which is `null` here and simply retried by whoever asked.
 *
 * Recognised by the `provider` the server stamps on every ElevenLabs error, so
 * it can never be confused with `user_key_failed`, which means "your OpenAI key
 * was refused, offer the shared one" and must not fire for ElevenLabs.
 *
 * `action` is the request that failed. A missing or refused key and spent
 * credits stop narration whatever asked; a missing *permission* or an unusable
 * voice only does when narration asked — a key without "user read" can't show
 * the credits, and that must not silence a key that narrates perfectly well.
 * Defaults to narration, which is what every caller outside this module is.
 */
export function providerFailureOf(err: unknown, action = 'tts'): ElevenLabsFailure | null {
  if (!(err instanceof ApiError) || typeof err.body !== 'object' || err.body === null) return null;
  const body = err.body as { error?: unknown; provider?: unknown; voiceId?: unknown };
  if (body.provider !== 'elevenlabs') return null;
  const narration = action === 'tts' || action === 'tts.speak';
  switch (body.error) {
    case 'elevenlabs_key_missing':
    case 'elevenlabs_key_failed':
      return { kind: 'key' };
    case 'elevenlabs_key_permissions':
      return narration ? { kind: 'key' } : null;
    case 'elevenlabs_quota_exceeded':
      return { kind: 'quota' };
    case 'elevenlabs_voice_unavailable':
    case 'elevenlabs_not_allowed':
      if (!narration) return null;
      return typeof body.voiceId === 'string'
        ? {
            kind: 'voice',
            voiceId: body.voiceId,
            reason: body.error === 'elevenlabs_not_allowed' ? 'not_allowed' : 'unavailable',
          }
        : { kind: 'key' };
    default:
      return null;
  }
}

/** Listener for `providerFailureOf` failures, the counterpart of
 * `onUserKeyFailure`: lib/providerFailureWatch.ts records them in settings so
 * every voice resolver falls back at once, rather than each caller learning it
 * from its own failed request. The second argument is the server's code. */
type ProviderFailureListener = (failure: ElevenLabsFailure, code: string) => void;
const providerFailureListeners = new Set<ProviderFailureListener>();

export function onProviderFailure(fn: ProviderFailureListener): () => void {
  providerFailureListeners.add(fn);
  return () => providerFailureListeners.delete(fn);
}

function notifyProviderFailure(failure: ElevenLabsFailure, code: string): void {
  for (const fn of providerFailureListeners) {
    try {
      fn(failure, code);
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

  return parseResponse<T>(res, action);
}

export async function apiGetJson<T = unknown>(action: string): Promise<T> {
  const res = await fetch(`${API_BASE}?action=${encodeURIComponent(action)}`, {
    method: 'GET',
    headers: authHeaders(),
  });
  return parseResponse<T>(res, action);
}

export async function apiPostForm<T = unknown>(action: string, form: FormData): Promise<T> {
  const res = await fetch(`${API_BASE}?action=${encodeURIComponent(action)}`, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  });
  return parseResponse<T>(res, action);
}

async function parseResponse<T>(res: Response, action: string): Promise<T> {
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
    // Synchronously, before the throw: whoever catches this re-resolves its
    // voice and must already see the failure recorded (see streamReading).
    const providerFailure = providerFailureOf(apiErr, action);
    if (providerFailure) notifyProviderFailure(providerFailure, msg);
    throw apiErr;
  }
  return parsed as T;
}
