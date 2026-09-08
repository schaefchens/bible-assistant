/**
 * Byte-exact JS ports of the text-normalization helpers in public/api.php.
 *
 * These MUST agree with the PHP character-for-character: the packs they
 * produce replace what `bible.chapter` returns today, and any drift shows up
 * as verses that read differently offline than online.
 *
 * The traps are subtle and all involve whitespace, so read before editing.
 */

/**
 * PHP's `preg_replace('/\s+/u', ...)`.
 *
 * Whitespace is the one place these two languages could plausibly disagree,
 * so it was checked against the live PHP output rather than assumed:
 * s00.xml contains 450 U+202F (narrow no-break space) characters inside verse
 * text, and the PHP-generated fixtures show every one of them collapsed to a
 * plain U+0020. So PCRE2 under `/u` treats `\s` as Unicode-aware here, and
 * JavaScript's `\s` — which also matches U+202F — is the faithful port.
 *
 * (An ASCII-only class looks like the "safe" choice and is actively wrong:
 * it leaves U+202F intact and diverges from the server on 290 S00 verses.)
 *
 * The only residual difference is U+FEFF, which JS `\s` matches and PCRE does
 * not. It appears exactly twice per file — the BOM — never inside verse text,
 * so it cannot affect output.
 */
const PHP_WS = /\s+/g;

/**
 * PHP `trim()` with its default charlist " \t\n\r\0\x0B".
 * Note it includes NUL and vertical tab but EXCLUDES form feed (\f), which is
 * why this can't just be String.prototype.trim().
 */
const PHP_TRIM = /^[ \t\n\r\0\v]+|[ \t\n\r\0\v]+$/g;

export function phpTrim(s) {
  return s.replace(PHP_TRIM, '');
}

/** Port of normalizeSpace() — api.php:877. */
export function normalizeSpace(s) {
  s = s.replace(PHP_WS, ' ');
  // Some Zefania bibles (notably ELB1905) keep trailing spaces inside <gr>
  // tags, which surface as "Erde ." after concatenation.
  s = s.replace(/ +([.,;:!?»"])/g, '$1');
  return phpTrim(s);
}

/** Port of stripForTts() — api.php:894. */
export function stripForTts(s) {
  s = s.replace(/\[+[^[\]]*\]+/g, '');
  s = s.replace(/[[\]]/g, '');
  return normalizeSpace(s);
}

/** Port of the pk formula — api.php:833. */
export function makePk(bookId, chapter, verse) {
  return bookId * 1_000_000 + chapter * 1_000 + verse;
}

/** Translation code -> source XML filename. Mirrors BIBLE_XML_MAP, api.php:80. */
export const BIBLE_XML_MAP = {
  S00: 's00.xml',
  ESV: 'esv.xml',
  KJV: 'kjv.xml',
  NKJV: 'nkjv.xml',
  LUT: 'lut.xml',
  HFA: 'hfa.xml',
  S51: 's51.xml',
  ELB: 'elb.xml',
};

/** Public-domain texts, safe to redistribute inside a shipped binary. */
export const BUNDLED_TRANSLATIONS = ['LUT', 'KJV'];
