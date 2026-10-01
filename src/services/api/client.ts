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
  const body = err.body as { error?: unknown; provider?: unknown; voiceId?: unknown; payer?: unknown };
  // Never somebody else's account: a shared voice's owner paying is
  // `sharedVoiceRefusalOf`'s, and must not touch the listener's own status.
  if (body.provider !== 'elevenlabs' || body.payer === 'owner') return null;
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

/**
 * A voice somebody shared that the server refused to narrate with — always on
 * the *owner's* account (`payer: 'owner'`), never the listener's: their own
 * keys and their own ElevenLabs status are untouched by any of these.
 *
 *   unavailable   the owner's key will not pay (none, refused, out of credits,
 *                 the voice gone) or the user may no longer use the voice —
 *                 for the rest of the session
 *   budget        the owner's allowance is spent, until the day or month turns
 *   out_of_scope  this reading is not one the owner lent the voice for
 *   mismatch      the owner has changed the voice since this copy was fetched
 *   busy          try again — the owner's generations are all in use
 *
 * An api.php that predates shared voices answers their actions 404, and that
 * reads as `unavailable` too: refused, never re-sent as the listener's own.
 */
export type SharedVoiceRefusal = {
  itemId: string;
  kind: 'unavailable' | 'budget' | 'out_of_scope' | 'mismatch' | 'busy';
};

const SHARED_REFUSALS: Record<string, SharedVoiceRefusal['kind']> = {
  shared_voice_unavailable: 'unavailable',
  shared_voice_budget: 'budget',
  shared_voice_out_of_scope: 'out_of_scope',
  shared_voice_mismatch: 'mismatch',
  shared_voice_busy: 'busy',
};

export function sharedVoiceRefusalOf(err: unknown): SharedVoiceRefusal | null {
  if (!(err instanceof ApiError) || typeof err.body !== 'object' || err.body === null) return null;
  const body = err.body as { error?: unknown; payer?: unknown; itemId?: unknown };
  const kind = typeof body.error === 'string' ? SHARED_REFUSALS[body.error] : undefined;
  if (body.payer !== 'owner' || !kind || typeof body.itemId !== 'string') return null;
  return { itemId: body.itemId, kind };
}

/** The shared-voice actions, which an older api.php does not have. */
const SHARED_ACTIONS = new Set(['tts.shared', 'tts.speak.shared']);

/** An "unknown action" from an api.php without shared voices, restated as the
 * refusal of that one voice it is — the item id comes from the request. */
function olderServerRefusal(res: Response, action: string, request: unknown): ApiError | null {
  if (res.status !== 404 || !SHARED_ACTIONS.has(action)) return null;
  const itemId = (request as { shared?: { itemId?: unknown } } | null)?.shared?.itemId;
  if (typeof itemId !== 'string') return null;
  return new ApiError('shared_voice_unavailable', 404, {
    error: 'shared_voice_unavailable',
    payer: 'owner',
    itemId,
  });
}

type SharedVoiceRefusalListener = (refusal: SharedVoiceRefusal) => void;
const sharedVoiceRefusalListeners = new Set<SharedVoiceRefusalListener>();

/** Listener for `sharedVoiceRefusalOf` refusals — lib/providerFailureWatch.ts
 * records the lasting ones in settings, exactly as it does provider failures. */
export function onSharedVoiceRefusal(fn: SharedVoiceRefusalListener): () => void {
  sharedVoiceRefusalListeners.add(fn);
  return () => sharedVoiceRefusalListeners.delete(fn);
}

function notifySharedVoiceRefusal(refusal: SharedVoiceRefusal): void {
  for (const fn of sharedVoiceRefusalListeners) {
    try {
      fn(refusal);
    } catch {
      /* swallow — bad listener shouldn't block others */
    }
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

  return parseResponse<T>(res, action, body);
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

async function parseResponse<T>(res: Response, action: string, request?: unknown): Promise<T> {
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
    const apiErr = olderServerRefusal(res, action, request) ?? new ApiError(msg, res.status, parsed);
    if (isUserKeyFailure(apiErr)) notifyUserKeyFailure();
    // Synchronously, before the throw: whoever catches this re-resolves its
    // voice and must already see the failure recorded (see streamReading).
    const providerFailure = providerFailureOf(apiErr, action);
    if (providerFailure) notifyProviderFailure(providerFailure, msg);
    const sharedRefusal = sharedVoiceRefusalOf(apiErr);
    if (sharedRefusal) notifySharedVoiceRefusal(sharedRefusal);
    throw apiErr;
  }
  return parsed as T;
}
