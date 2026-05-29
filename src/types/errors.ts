/** Shape of the JSON error body our PHP backend returns on failures. Both
 * fields are optional; `detail` is the human-readable message, `error` is a
 * machine code (e.g. 'user_key_failed'). */
export type ApiErrorBody = { detail?: string; error?: string };

/** Narrow an `unknown` (typically `ApiError.body`) to {@link ApiErrorBody} so
 * callers can read `.detail`/`.error` without an unchecked `as` cast. */
export function isApiErrorBody(val: unknown): val is ApiErrorBody {
  return typeof val === 'object' && val !== null;
}
