import { getOrCreateIdentity } from '@/lib/identity';

const API_BASE = '/api.php';

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

function authHeaders(): Record<string, string> {
  const identity = getOrCreateIdentity();
  return {
    'X-User-Id': identity.userId,
    'X-User-Secret': identity.userSecret,
  };
}

export async function apiPostJson<T = unknown>(action: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}?action=${encodeURIComponent(action)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify(body ?? {}),
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
    throw new ApiError(msg, res.status, parsed);
  }
  return parsed as T;
}
