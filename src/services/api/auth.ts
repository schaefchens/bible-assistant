import { apiGetJson, apiPostJson } from './client';

type OpenAiKeyStatus = {
  hasKey: boolean;
  masked?: string;
};

export function getOpenAiKeyStatus(): Promise<OpenAiKeyStatus> {
  return apiGetJson<OpenAiKeyStatus>('auth.openaiKey.status');
}

export function setOpenAiKey(key: string): Promise<OpenAiKeyStatus> {
  return apiPostJson<OpenAiKeyStatus>('auth.openaiKey.set', { key });
}

export function clearOpenAiKey(): Promise<OpenAiKeyStatus> {
  return apiPostJson<OpenAiKeyStatus>('auth.openaiKey.clear', {});
}

/** What an ElevenLabs account has left this billing period. */
export type ElevenLabsSubscription = {
  tier: string | null;
  characterCount: number;
  characterLimit: number;
  /** When `characterCount` resets, in epoch **milliseconds** (api.php
   * converts ElevenLabs' seconds), or null when ElevenLabs did not say. */
  resetsAt: number | null;
  status: string;
};

export type ElevenLabsKeyStatus = {
  hasKey: boolean;
  masked?: string;
  /** A genuine key without the "user read" permission — it narrates fine,
   * but the remaining credits can't be shown. */
  restricted?: boolean;
  subscription?: ElevenLabsSubscription;
};

/** Whether the server holds an ElevenLabs key for this identity. A file check
 * on the server — no call to ElevenLabs — so it is cheap enough for boot. */
export function getElevenLabsKeyStatus(): Promise<ElevenLabsKeyStatus> {
  return apiGetJson<ElevenLabsKeyStatus>('auth.elevenlabsKey.status');
}

/**
 * Validate and store an ElevenLabs key. Like the OpenAI key it lives only on
 * the server (users/{id}/, never served); the app only ever sees the masked
 * form. Saving one creates the account, as any server write does.
 */
export function setElevenLabsKey(key: string): Promise<ElevenLabsKeyStatus> {
  return apiPostJson<ElevenLabsKeyStatus>('auth.elevenlabsKey.set', { key });
}

export function clearElevenLabsKey(): Promise<ElevenLabsKeyStatus> {
  return apiPostJson<ElevenLabsKeyStatus>('auth.elevenlabsKey.clear', {});
}

/**
 * Erase everything the server holds for this identity — cards, boards, their
 * orders, voices, the stored OpenAI and ElevenLabs keys and any uploaded
 * recordings.
 *
 * The counterpart to sync being opt-in. Idempotent, so it's safe to call for a
 * user who never had an account: api.php creates the directory lazily, so there
 * may simply be nothing there.
 */
export function deleteAccount(): Promise<{ deleted: boolean }> {
  return apiGetJson<{ deleted: boolean }>('account.delete');
}
