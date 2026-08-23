import { apiGetJson, apiPostJson } from './client';

export type OpenAiKeyStatus = {
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

/**
 * Erase everything the server holds for this identity — cards, boards, their
 * orders, the stored OpenAI key and any uploaded recordings.
 *
 * The counterpart to sync being opt-in. Idempotent, so it's safe to call for a
 * user who never had an account: api.php creates the directory lazily, so there
 * may simply be nothing there.
 */
export function deleteAccount(): Promise<{ deleted: boolean }> {
  return apiGetJson<{ deleted: boolean }>('account.delete');
}
