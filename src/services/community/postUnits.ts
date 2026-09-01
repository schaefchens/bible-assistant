import type { Translation } from '@/services/bible/bibleApi';
import type { Locale, Post, VerseSummary } from '@/types/domain';

/**
 * Turn a post into the reading units the reader renders and playback narrates.
 *
 * **This is the one place a post is cut up, and its output is a cache key.**
 * `resolveSpeechNarration` keys server-cached audio and word alignment by the
 * exact text of a unit, so changing how this splits changes every key: already
 * generated audio is orphaned and pinned downloads stop matching. Treat it as
 * a format, not an implementation detail.
 *
 * Two constraints shape it:
 *
 * - **One unit per authored paragraph.** The author chose those breaks, so
 *   unlike Bible verses (`lib/readerParagraphs.ts` has to *infer* paragraphs,
 *   because none of the eight source bibles carries paragraph markup) there is
 *   nothing to guess. It also makes each unit an independently narrated,
 *   independently seekable, independently highlighted block.
 * - **`text` is exactly what is spoken.** `services/bible/verseSummaries.ts`
 *   records the rule: display and speech share one string or the highlight
 *   silently desyncs from the audio. This is why posts are plain text — markup
 *   would have to be stripped for TTS and the two would drift apart.
 */

/**
 * api.php's `tts.speak` caps text at 4000 **bytes** (not characters), so the
 * limit here is in bytes too, with room for the cap to be approached rather
 * than met exactly.
 */
const MAX_UNIT_BYTES = 3500;

/** Sentence end followed by a space — where an over-long paragraph may be cut. */
const SENTENCE_BREAK = /(?<=[.!?][)\]"'”’»]?)\s+/;

/**
 * A stand-in translation for a post unit.
 *
 * `VerseSummary.translation` is required by the type, and `localeForTranslation()`
 * reads it to choose the TTS voice language — so the only thing that matters is
 * that it maps back to the post's own language. Nothing displays it: both places
 * that would (`publishNowPlaying` and the playback plan's heading) branch on
 * `unit` first. Kept here rather than imported from settingsStore because this
 * is about the post's language, not the user's preference.
 */
function voiceTranslationFor(language: Locale): Translation {
  return language === 'de' ? 'LUT' : 'KJV';
}

const encoder = new TextEncoder();

function byteLength(text: string): number {
  return encoder.encode(text).length;
}

/**
 * Split a paragraph that is too long for one TTS request.
 *
 * Prefers sentence boundaries; falls back to word boundaries for a single
 * sentence longer than the cap, and finally to a hard character cut, because
 * returning something unspeakable is worse than an inelegant break.
 */
function splitOversized(paragraph: string): string[] {
  if (byteLength(paragraph) <= MAX_UNIT_BYTES) return [paragraph];

  const pieces: string[] = [];
  let current = '';
  const flush = () => {
    if (current.trim() !== '') pieces.push(current.trim());
    current = '';
  };

  for (const sentence of paragraph.split(SENTENCE_BREAK)) {
    const candidate = current === '' ? sentence : `${current} ${sentence}`;
    if (byteLength(candidate) <= MAX_UNIT_BYTES) {
      current = candidate;
      continue;
    }
    flush();
    if (byteLength(sentence) <= MAX_UNIT_BYTES) {
      current = sentence;
      continue;
    }
    // One sentence over the cap: fall back to words, then to a hard cut.
    let chunk = '';
    for (const word of sentence.split(/\s+/)) {
      const next = chunk === '' ? word : `${chunk} ${word}`;
      if (byteLength(next) <= MAX_UNIT_BYTES) {
        chunk = next;
        continue;
      }
      if (chunk !== '') pieces.push(chunk);
      chunk = byteLength(word) <= MAX_UNIT_BYTES ? word : hardCut(word, pieces);
    }
    if (chunk !== '') pieces.push(chunk);
  }
  flush();
  return pieces.length > 0 ? pieces : [paragraph];
}

/** Last resort for a single "word" longer than the cap (a pasted URL, say). */
function hardCut(word: string, into: string[]): string {
  let rest = word;
  while (byteLength(rest) > MAX_UNIT_BYTES) {
    // Bytes per character vary, so step back until the slice fits.
    let take = MAX_UNIT_BYTES;
    while (take > 1 && byteLength(rest.slice(0, take)) > MAX_UNIT_BYTES) take -= 1;
    into.push(rest.slice(0, take));
    rest = rest.slice(take);
  }
  return rest;
}

/** The paragraphs of a post, in order. Blank lines separate; blanks collapse. */
export function postParagraphs(body: string): string[] {
  return body
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p !== '')
    .flatMap(splitOversized);
}

/**
 * The post as `VerseSummary[]` — the currency the whole playback path speaks.
 *
 * The synthetic fields are deliberate and each has one job:
 * - `unit` is the discriminant every display site branches on;
 * - `bookId`/`chapter` are 0, so a stray `getBookById()` misses loudly rather
 *   than resolving to Genesis;
 * - `verse` is the 1-based paragraph number, which is what `verseIndex` in a
 *   `PlaybackTrack` indexes into;
 * - `translation` exists only because the type requires it — see
 *   {@link voiceTranslationFor}.
 */
export function postToUnits(post: Post, spaceId: string, author: string): VerseSummary[] {
  const translation = voiceTranslationFor(post.language);
  return postParagraphs(post.body).map((text, index) => ({
    translation,
    bookId: 0,
    chapter: 0,
    verse: index + 1,
    text,
    display: post.title,
    unit: {
      kind: 'post' as const,
      spaceId,
      postId: post.id,
      index,
      language: post.language,
      title: post.title,
      author,
    },
  }));
}
