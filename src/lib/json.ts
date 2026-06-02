/** Parse a JSON object string that is expected to be an object (e.g. an LLM
 * tool-call's `arguments`). On malformed input, returns `{ raw: <input> }`
 * instead of throwing so callers can degrade gracefully and still surface the
 * original text. */
export function parseJsonSafe(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s);
  } catch {
    return { raw: s };
  }
}
