import { clamp } from '@/lib/math';
import type { SharedVoiceRef } from './voiceSharing';

/**
 * **The one copy of what a narration voice sounds like** — and therefore which
 * cached audio is "its" audio.
 *
 * A `TtsVoice` is the *audible* config only: the provider, the provider's voice
 * and the settings that change the sound. A user's voice profile (name, avatar,
 * which device chose it) wraps one of these, and none of that wrapping may ever
 * reach a cache key: two profiles with the same config play the same files,
 * and so do a voice shared on a shelf and everyone it is shared with — see
 * `SharedTtsVoice`.
 *
 * Pure, and imports nothing that imports a store: the settings migration and
 * the library store value-import this module, and both run while zustand is
 * still hydrating.
 */

/** OpenAI's gpt-4o-mini-tts voices, best first — OpenAI recommends marin and
 * cedar for quality — then alphabetical. */
export const OPENAI_VOICES = [
  'marin',
  'cedar',
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'fable',
  'nova',
  'onyx',
  'sage',
  'shimmer',
  'verse',
] as const;
export type OpenAiVoiceId = (typeof OPENAI_VOICES)[number];

/** The two ElevenLabs models a voice can use. v4 is the most expressive and
 * runs on the dialogue endpoint, which takes stability and similarity only;
 * Multilingual v2 is the steadiest over long readings and adds style + speed. */
export const ELEVEN_MODELS = ['eleven_v4', 'eleven_multilingual_v2'] as const;
export type ElevenModel = (typeof ELEVEN_MODELS)[number];

export type OpenAiTtsVoice = { provider: 'openai'; voice: OpenAiVoiceId; style: string };
export type ElevenV4Voice = {
  provider: 'elevenlabs';
  voiceId: string;
  model: 'eleven_v4';
  stability: number;
  similarity: number;
};
export type ElevenV2Voice = {
  provider: 'elevenlabs';
  voiceId: string;
  model: 'eleven_multilingual_v2';
  stability: number;
  similarity: number;
  style: number;
  speed: number;
};
export type ElevenLabsTtsVoice = ElevenV4Voice | ElevenV2Voice;
/** A voice api.php can narrate with. */
export type TtsVoice = OpenAiTtsVoice | ElevenLabsTtsVoice;
/** The on-device voice (SpeechSynthesis / native TTS): no server, no cache. */
export type DeviceVoice = { provider: 'device' };
/** Anything that can speak a reading. */
export type SpeechVoice = TtsVoice | DeviceVoice;

/**
 * Somebody else's voice, lent to a shelf the reader follows: its audible config
 * plus whose it is (`shared`, see voiceSharing.ts).
 *
 * The ref rides on the config so that every path that narrates — playback,
 * prefetch, downloads, a preview — carries it without being told, and every
 * request goes to `tts.shared` with it, where the voice's owner pays. It is
 * **never part of the identity**: `voiceKeyPart` builds from the audible
 * fields alone, so the owner and every reader share one cache, and
 * `normalizeTtsVoice` drops it, so a voice of the user's own can never carry
 * one.
 */
export type SharedTtsVoice = TtsVoice & { shared: SharedVoiceRef };

/** Whose voice this is, when it is somebody else's — or null for one's own. */
export function sharedRefOf(v: SpeechVoice): SharedVoiceRef | null {
  const ref = (v as Partial<SharedTtsVoice>).shared;
  return ref && typeof ref.code === 'string' && typeof ref.itemId === 'string' ? ref : null;
}

/** The system narration voice, and the only one the shared server key pays
 * for. Frozen and shared: the resolver hands out this exact object, so a
 * changed voice is a changed reference. */
export const ECHO_VOICE: OpenAiTtsVoice = Object.freeze({
  provider: 'openai',
  voice: 'echo',
  style: '',
});
export const DEVICE_VOICE: DeviceVoice = Object.freeze({ provider: 'device' });

/** api.php caps a style at 1000 **bytes** of UTF-8 — on `tts` and on a synced
 * voice alike, and a voice it refuses is a sync op dropped for good — so the
 * cap is counted the way the server counts it (an umlaut is two). */
export const MAX_STYLE_BYTES = 1000;

const utf8 = new TextEncoder();

/** How long a style is, the way api.php measures it. */
export function styleBytes(style: string): number {
  return utf8.encode(style).length;
}

/** A style cut to what api.php accepts, never inside a character. A style
 * already within the cap — every one there is — comes back untouched. */
export function clampStyle(style: string): string {
  const bytes = utf8.encode(style);
  if (bytes.length <= MAX_STYLE_BYTES) return style;
  let cut = MAX_STYLE_BYTES;
  // Back off continuation bytes (10xxxxxx) to the start of a character.
  while (cut > 0 && (bytes[cut] & 0xc0) === 0x80) cut--;
  return new TextDecoder().decode(bytes.subarray(0, cut));
}
const ELEVEN_VOICE_ID = /^[A-Za-z0-9]{16,32}$/;

export const ELEVEN_DEFAULTS = { stability: 0.5, similarity: 0.75, style: 0, speed: 1 } as const;
export const ELEVEN_SPEED_MIN = 0.7;
export const ELEVEN_SPEED_MAX = 1.2;

/**
 * Snap a setting onto the 0.05 grid the sliders move in. Two values that sound
 * the same must not be two caches the user pays for twice, and `*20 / 20` (not
 * `* 0.05`) lands on the shortest decimal — 0.3, never 0.30000000000000004.
 */
function quantize(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return Math.round(clamp(n, lo, hi) * 20) / 20;
}

export function isOpenAiVoiceId(v: unknown): v is OpenAiVoiceId {
  return typeof v === 'string' && (OPENAI_VOICES as readonly string[]).includes(v);
}

export function isElevenModel(v: unknown): v is ElevenModel {
  return typeof v === 'string' && (ELEVEN_MODELS as readonly string[]).includes(v);
}

export function isElevenLabsVoiceId(v: unknown): v is string {
  return typeof v === 'string' && ELEVEN_VOICE_ID.test(v);
}

export function isDeviceVoice(v: SpeechVoice): v is DeviceVoice {
  return v.provider === 'device';
}

/**
 * The canonical form of a voice config, from anything — a stored row, a
 * synced one, an editor draft. `null` when it does not describe a voice.
 *
 * Only the fields the model actually uses survive: a v4 voice carries no style
 * or speed, so a slider left over from Multilingual v2 can never enter its
 * cache identity. An OpenAI style is kept byte for byte — it already *is* a
 * cache key for every install that set one, and trimming it would orphan their
 * downloads.
 */
export function normalizeTtsVoice(raw: unknown): TtsVoice | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.provider === 'openai') {
    if (!isOpenAiVoiceId(r.voice)) return null;
    const style = typeof r.style === 'string' ? clampStyle(r.style) : '';
    return { provider: 'openai', voice: r.voice, style };
  }
  if (r.provider === 'elevenlabs') {
    if (!isElevenLabsVoiceId(r.voiceId) || !isElevenModel(r.model)) return null;
    const stability = quantize(r.stability, 0, 1, ELEVEN_DEFAULTS.stability);
    const similarity = quantize(r.similarity, 0, 1, ELEVEN_DEFAULTS.similarity);
    if (r.model === 'eleven_v4') {
      return { provider: 'elevenlabs', voiceId: r.voiceId, model: 'eleven_v4', stability, similarity };
    }
    return {
      provider: 'elevenlabs',
      voiceId: r.voiceId,
      model: 'eleven_multilingual_v2',
      stability,
      similarity,
      style: quantize(r.style, 0, 1, ELEVEN_DEFAULTS.style),
      speed: quantize(r.speed, ELEVEN_SPEED_MIN, ELEVEN_SPEED_MAX, ELEVEN_DEFAULTS.speed),
    };
  }
  return null;
}

const fixed = (n: number) => n.toFixed(2);

/**
 * The voice's part of a narration cache key (see narrationIndex.ts).
 *
 * For OpenAI this is `${voice}|${style}` **byte for byte** — the segment every
 * key has carried since before voices had names — so `v|echo||KJV|19|117|1` is
 * still the key of Psalm 117:1 in Echo and no download is orphaned.
 *
 * ElevenLabs keeps the same two-segment shape, "who" then "how":
 * `el:<voiceId>|<model>,<stability>,<similarity>[,<style>,<speed>]`. `el:`
 * cannot collide with an OpenAI voice, none of which contains a colon.
 */
export function voiceKeyPart(v: TtsVoice): string {
  if (v.provider === 'openai') return `${v.voice}|${v.style}`;
  const stability = fixed(quantize(v.stability, 0, 1, ELEVEN_DEFAULTS.stability));
  const similarity = fixed(quantize(v.similarity, 0, 1, ELEVEN_DEFAULTS.similarity));
  const how =
    v.model === 'eleven_v4'
      ? `${v.model},${stability},${similarity}`
      : `${v.model},${stability},${similarity},${fixed(quantize(v.style, 0, 1, ELEVEN_DEFAULTS.style))},${fixed(quantize(v.speed, ELEVEN_SPEED_MIN, ELEVEN_SPEED_MAX, ELEVEN_DEFAULTS.speed))}`;
  return `el:${v.voiceId}|${how}`;
}

/** Same audible voice — same cache identity. */
export function sameTtsVoice(a: TtsVoice, b: TtsVoice): boolean {
  return voiceKeyPart(a) === voiceKeyPart(b);
}

/** The ElevenLabs settings object api.php reads, model fields only. */
function elevenLabsWire(v: ElevenLabsTtsVoice) {
  const base = {
    voiceId: v.voiceId,
    model: v.model,
    stability: quantize(v.stability, 0, 1, ELEVEN_DEFAULTS.stability),
    similarity: quantize(v.similarity, 0, 1, ELEVEN_DEFAULTS.similarity),
  };
  if (v.model === 'eleven_v4') return base;
  return {
    ...base,
    style: quantize(v.style, 0, 1, ELEVEN_DEFAULTS.style),
    speed: quantize(v.speed, ELEVEN_SPEED_MIN, ELEVEN_SPEED_MAX, ELEVEN_DEFAULTS.speed),
  };
}

type VerseFields = {
  text: string;
  translation: string;
  bookId: number;
  chapter: number;
  verse: number;
};

/**
 * The `tts` request body for one verse.
 *
 * The OpenAI body is exactly the one this app has always sent, field order
 * included (`text`, `voice`, `voiceStyle` only when set, then the reference) —
 * e2e pins the server's answer to it. An ElevenLabs body also names the voice
 * in `voice`, so an api.php that predates providers fails loudly at OpenAI
 * instead of quietly reading in its default voice.
 *
 * A shared voice's body ends with `shared: {code, itemId}` — what the server
 * finds the owner's terms by — and goes to `tts.shared` (see `ttsAction`). For
 * every other voice the field is absent, and the body unchanged.
 */
export function ttsVerseBody(v: TtsVoice, f: VerseFields) {
  const shared = sharedWire(v);
  if (v.provider === 'openai') {
    return {
      text: f.text,
      voice: v.voice,
      voiceStyle: v.style || undefined,
      translation: f.translation,
      bookId: f.bookId,
      chapter: f.chapter,
      verse: f.verse,
      shared,
    };
  }
  return {
    text: f.text,
    provider: 'elevenlabs' as const,
    voice: v.voiceId,
    elevenlabs: elevenLabsWire(v),
    translation: f.translation,
    bookId: f.bookId,
    chapter: f.chapter,
    verse: f.verse,
    shared,
  };
}

/** The `tts.speak` request body for free text (a post paragraph, a heading,
 * an assistant reply). Same rules as `ttsVerseBody`. */
export function ttsSpeakBody(v: TtsVoice, f: { text: string; language?: 'en' | 'de' }) {
  const shared = sharedWire(v);
  if (v.provider === 'openai') {
    return { text: f.text, voice: v.voice, voiceStyle: v.style || undefined, language: f.language, shared };
  }
  return {
    text: f.text,
    provider: 'elevenlabs' as const,
    voice: v.voiceId,
    elevenlabs: elevenLabsWire(v),
    language: f.language,
    shared,
  };
}

/** What a request says about whose voice it is: the shelf and the item, and
 * nothing the server would have to trust (the scope is read from the owner's
 * own signed terms). */
function sharedWire(v: TtsVoice): { code: string; itemId: string } | undefined {
  const ref = sharedRefOf(v);
  return ref ? { code: ref.code, itemId: ref.itemId } : undefined;
}

/**
 * Which api.php action narrates with this voice. A shared voice has actions of
 * its own rather than a field on the usual ones, so that an api.php predating
 * them answers 404 — refused — instead of reading the request as the
 * listener's own and billing it to them.
 */
export function ttsAction(v: TtsVoice, kind: 'verse' | 'speak'): 'tts' | 'tts.speak' | 'tts.shared' | 'tts.speak.shared' {
  const shared = sharedRefOf(v) !== null;
  if (kind === 'verse') return shared ? 'tts.shared' : 'tts';
  return shared ? 'tts.speak.shared' : 'tts.speak';
}

/**
 * How many narration requests to build at once. Four keeps OpenAI comfortably
 * ahead of playback; the smaller ElevenLabs tiers cap concurrent requests
 * lower than that, and a refused request is a silent hole in a chapter. A
 * shared voice runs at most two of its owner's generations at once for all its
 * readers together (api/sponsorship.php), so asking for more only queues.
 */
export function ttsConcurrency(v: TtsVoice): number {
  return v.provider === 'elevenlabs' || sharedRefOf(v) !== null ? 2 : 4;
}
