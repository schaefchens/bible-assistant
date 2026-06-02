import { ApiError } from '@/services/api/client';
import { isApiErrorBody } from '@/types/errors';

/** Pull the most specific human-readable message out of an unknown thrown
 * value: prefer the server's `detail` then `error` body fields on an
 * {@link ApiError}, otherwise fall back to the Error message. Returns null
 * when nothing usable is present so callers can supply their own default.
 *
 * Shared by SettingsPage and OnboardingWizard (the OpenAI-key flows). */
export function extractErrorDetail(e: unknown): string | null {
  if (e instanceof ApiError && isApiErrorBody(e.body)) {
    if (typeof e.body.detail === 'string' && e.body.detail) return e.body.detail;
    if (typeof e.body.error === 'string' && e.body.error) return e.body.error;
  }
  return e instanceof Error ? e.message : null;
}
