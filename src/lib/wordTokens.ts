/**
 * How a verse's text is cut into the words that word highlighting counts.
 *
 * `WordHighlighter` renders `splitWordsAndSpaces(text)` and numbers every token
 * that is not a whitespace run — *including* an empty string, which `split`
 * produces when the text starts or ends with whitespace. Word index N in an
 * alignment file is the Nth of those tokens, so whatever writes alignments has
 * to cut the text exactly this way: the ElevenLabs converter in
 * public/api/audio.php does, and scripts/voices/verifyVoicesBackend.mjs imports
 * `wordTokens` as the oracle it is checked against.
 *
 * Dependency-free on purpose — Node imports it directly in that harness.
 */

const SPACE_RUN = /(\s+)/;
const ALL_SPACE = /^\s+$/;

/** The text as alternating word and whitespace tokens, as rendered. */
export function splitWordsAndSpaces(text: string): string[] {
  return text.split(SPACE_RUN);
}

/** True for a whitespace token — the ones that are not counted as words. */
export function isSpaceToken(token: string): boolean {
  return ALL_SPACE.test(token);
}

/** The counted words, in order: word index N is `wordTokens(text)[N]`. */
export function wordTokens(text: string): string[] {
  return splitWordsAndSpaces(text).filter((t) => !isSpaceToken(t));
}
