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
