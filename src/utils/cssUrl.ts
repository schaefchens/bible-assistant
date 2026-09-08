/** Build a CSS `url("…")` token from a user-supplied URL, escaping the
 * characters that could otherwise break out of the quoted string (so a stray
 * quote/backslash in a board's background URL can't corrupt the inline style).
 * Newlines are stripped. */
export function cssUrl(raw: string): string {
  const safe = raw.replace(/[\\"]/g, '\\$&').replace(/[\r\n]/g, '');
  return `url("${safe}")`;
}
