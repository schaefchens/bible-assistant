import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import {
  DEVICE_VOICE,
  ECHO_VOICE,
  isOpenAiVoiceId,
  normalizeTtsVoice,
  voiceKeyPart,
  type SpeechVoice,
  type TtsVoice,
} from './ttsVoice';

/**
 * A narration voice as the user knows it — a name, maybe a face, and the
 * audible config it wraps — plus the rule that decides which voice actually
 * speaks.
 *
 * The record is synced (libraryStore, librarySync), so it is shaped like the
 * other synced rows: a versioned, plain-JSON record with a uuid. Three kinds of
 * thing stay deliberately apart:
 *
 * - **the audible config** (`config`) — the cache identity, see ttsVoice.ts;
 * - **presentation** (`name`, `avatar`) — never part of any cache key;
 * - **local state** — which voice reads and which one replies is the separate
 *   `VoiceSelection` record, never a field on a profile.
 *
 * That split is what lets a voice later be published on a shelf: the record
 * travels as-is and its listeners share the owner's audio files.
 *
 * Pure: imports no store (the settings migration and libraryStore both run
 * this while zustand is still hydrating), and builds no display text — system
 * voice names are `t()`'s job, in components.
 */

/** The two voices every install has. Constants, never stored rows. */
export const SYSTEM_ECHO_ID = 'system:echo';
export const SYSTEM_DEVICE_ID = 'system:device';
export type SystemVoiceId = typeof SYSTEM_ECHO_ID | typeof SYSTEM_DEVICE_ID;

export function isSystemVoiceId(id: string): id is SystemVoiceId {
  return id === SYSTEM_ECHO_ID || id === SYSTEM_DEVICE_ID;
}

export type VoiceProfile = {
  v: 1;
  id: string;
  name: string;
  /** A small inline image (`data:image/jpeg;base64,…`) — inline so it syncs
   * with the record and works offline. A shared voice would swap it for an
   * uploaded URL at publish time; nothing else reads the bytes. */
  avatar?: string;
  /** The provider's own name for the voice it wraps ("George", from the
   * user's ElevenLabs library), shown beside the user's name for it. Pure
   * presentation: not part of the audible config, so never of a cache key. */
  sourceName?: string;
  config: TtsVoice;
  createdAt: number;
  updatedAt: number;
};

/** Which voice reads (`narration`) and which one speaks replies
 * (`assistant`): a system id or a profile id. Synced as one record,
 * last-write-wins on `updatedAt` like the card order. */
export type VoiceSelection = { narration: string; assistant: string; updatedAt: number };

export const DEFAULT_VOICE_SELECTION: VoiceSelection = Object.freeze({
  narration: SYSTEM_ECHO_ID,
  assistant: SYSTEM_DEVICE_ID,
  updatedAt: 0,
});

export type VoiceRole = 'narration' | 'assistant';

export const MAX_VOICE_NAME = 80;
/** api.php refuses a bigger avatar; the client steps JPEG quality down to fit. */
export const MAX_AVATAR_CHARS = 96 * 1024;
const AVATAR_DATA_URL = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isAvatarDataUrl(v: unknown): v is string {
  return typeof v === 'string' && v.length <= MAX_AVATAR_CHARS && AVATAR_DATA_URL.test(v);
}

/**
 * What this session may spend, as far as voices are concerned.
 *
 * `elevenLabsFailure` is a *session* fact — the key was refused, the credits
 * ran out, or one voice vanished from the user's ElevenLabs library — so that
 * narration stops asking for what will fail and falls back instead. Nothing
 * about the user's choice changes; a reload asks again.
 */
export type ElevenLabsFailure =
  | { kind: 'key' }
  | { kind: 'quota' }
  /** One voice, not the account: it is gone from the user's ElevenLabs
   * library (`unavailable`), or their plan may not use it (`not_allowed`). */
  | { kind: 'voice'; voiceId: string; reason: 'unavailable' | 'not_allowed' };

export type VoiceAccess = {
  /** A personal OpenAI key on file, not overridden this session. */
  openAiKey: boolean;
  /** An ElevenLabs key on file. */
  elevenLabsKey: boolean;
  elevenLabsFailure: ElevenLabsFailure | null;
};

export type VoiceResolutionInput = {
  voices: readonly VoiceProfile[];
  selection: VoiceSelection;
  access: VoiceAccess;
};

/** The fields of settings that decide access — structural, so this module
 * never needs the settings store's type (or its module). */
export function voiceAccessOf(s: {
  hasUserOpenAiKey: boolean;
  sessionPreferSharedKey: boolean;
  hasUserElevenLabsKey: boolean;
  elevenLabsFailure: ElevenLabsFailure | null;
}): VoiceAccess {
  return {
    openAiKey: s.hasUserOpenAiKey && !s.sessionPreferSharedKey,
    elevenLabsKey: s.hasUserElevenLabsKey,
    elevenLabsFailure: s.elevenLabsFailure,
  };
}

export function findVoice(
  id: string,
  voices: readonly VoiceProfile[],
): VoiceProfile | undefined {
  return voices.find((v) => v.id === id);
}

/** What a role falls back to: Echo reads (the shared key pays for it), the
 * device voice replies (assistant text is unbounded, so it stays free). */
export function roleDefault(role: VoiceRole): SpeechVoice {
  return role === 'narration' ? ECHO_VOICE : DEVICE_VOICE;
}

/**
 * The voice a role has *chosen*, available or not. A selection naming a voice
 * that no longer exists — deleted on another device, or one day withdrawn from
 * a shelf — is the role's default.
 *
 * Returns a shared constant or the profile's own `config` object, never a new
 * one, so it is safe as a zustand selector result and `!==` means "changed".
 */
export function selectedVoice(role: VoiceRole, input: VoiceResolutionInput): SpeechVoice {
  const id = input.selection[role];
  if (id === SYSTEM_ECHO_ID) return ECHO_VOICE;
  if (id === SYSTEM_DEVICE_ID) return DEVICE_VOICE;
  return findVoice(id, input.voices)?.config ?? roleDefault(role);
}

export type VoiceAvailability = 'ok' | 'needs-openai-key' | 'needs-elevenlabs-key' | 'elevenlabs-failed';

/**
 * Can this voice speak for this role right now?
 *
 * Decided by *identity*, not by "is it a custom voice": on the shared key the
 * narration may be exactly Echo-without-a-style and nothing else — so a profile
 * someone made of plain Echo, avatar and all, is free too — and the assistant
 * may only use the device voice. These are the same limits the server
 * enforces for the shared key.
 */
export function voiceAvailability(
  role: VoiceRole,
  voice: SpeechVoice,
  access: VoiceAccess,
): VoiceAvailability {
  if (voice.provider === 'device') return 'ok';
  if (voice.provider === 'elevenlabs') {
    if (!access.elevenLabsKey) return 'needs-elevenlabs-key';
    const failure = access.elevenLabsFailure;
    if (failure && (failure.kind !== 'voice' || failure.voiceId === voice.voiceId)) {
      return 'elevenlabs-failed';
    }
    return 'ok';
  }
  if (access.openAiKey) return 'ok';
  if (role === 'narration' && voiceKeyPart(voice) === voiceKeyPart(ECHO_VOICE)) return 'ok';
  return 'needs-openai-key';
}

/** The voice that actually speaks: the chosen one if it can, else the role's
 * default. Never writes anything — the choice survives a missing key, and is
 * back the moment the key is. Same stable-reference guarantee as above. */
export function resolveVoice(role: VoiceRole, input: VoiceResolutionInput): SpeechVoice {
  const chosen = selectedVoice(role, input);
  return voiceAvailability(role, chosen, input.access) === 'ok' ? chosen : roleDefault(role);
}

/** A name for a voice nobody named — locale-free, because it is stored. */
export function defaultVoiceName(config: TtsVoice): string {
  if (config.provider === 'openai') {
    return config.voice.charAt(0).toUpperCase() + config.voice.slice(1);
  }
  return 'ElevenLabs';
}

/**
 * The whitelisting coercer for a voice row from anywhere — Dexie, a pull, a
 * hand-edited server file. `null` for something that is not a voice, which the
 * caller drops; mirrors `normalizeReadingList`'s role for lists, and is what a
 * shared voice's payload would be parsed with.
 */
export function normalizeVoiceProfile(raw: unknown): VoiceProfile | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !UUID.test(r.id)) return null;
  const config = normalizeTtsVoice(r.config);
  if (!config) return null;
  const name = typeof r.name === 'string' ? r.name.trim().slice(0, MAX_VOICE_NAME) : '';
  const sourceName =
    typeof r.sourceName === 'string' ? r.sourceName.trim().slice(0, MAX_VOICE_NAME) : '';
  const createdAt = typeof r.createdAt === 'number' && Number.isFinite(r.createdAt) ? r.createdAt : 0;
  const updatedAt = typeof r.updatedAt === 'number' && Number.isFinite(r.updatedAt) ? r.updatedAt : createdAt;
  return {
    v: 1,
    id: r.id,
    name: name || defaultVoiceName(config),
    ...(isAvatarDataUrl(r.avatar) ? { avatar: r.avatar } : {}),
    ...(sourceName ? { sourceName } : {}),
    config,
    createdAt,
    updatedAt,
  };
}

/** Oldest first: the order they were made in, which is how people remember
 * them. Stable across devices because it is not a per-device order. */
export function sortVoices(voices: VoiceProfile[]): VoiceProfile[] {
  return voices.slice().sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

export function normalizeVoiceSelection(raw: unknown): VoiceSelection {
  if (!raw || typeof raw !== 'object') return DEFAULT_VOICE_SELECTION;
  const r = raw as Record<string, unknown>;
  const pick = (v: unknown, fallback: string) =>
    typeof v === 'string' && (isSystemVoiceId(v) || UUID.test(v)) ? v : fallback;
  return {
    narration: pick(r.narration, DEFAULT_VOICE_SELECTION.narration),
    assistant: pick(r.assistant, DEFAULT_VOICE_SELECTION.assistant),
    updatedAt: typeof r.updatedAt === 'number' && Number.isFinite(r.updatedAt) ? r.updatedAt : 0,
  };
}

// ─── The voice settings this replaced ─────────────────────────────────────

/** What an install from before voices had: three device-local settings. */
export type LegacyVoices = { voice?: string; voiceStyle?: string; assistantVoice?: string };

/** A legacy setup worth migrating — anything but the defaults, which the new
 * defaults already equal. */
export function legacyVoicesWorthKeeping(l: LegacyVoices): LegacyVoices | undefined {
  const isDefault =
    (l.voice === undefined || l.voice === 'echo') &&
    !l.voiceStyle &&
    (l.assistantVoice === undefined || l.assistantVoice === 'browser');
  return isDefault ? undefined : l;
}

/**
 * A stable uuid for a migrated voice, derived from its identity, so two
 * devices that upgrade with the same legacy voice create the *same* synced row
 * instead of two identical ones side by side.
 */
export function legacyVoiceId(config: TtsVoice): string {
  const hex = bytesToHex(sha256(utf8ToBytes(`legacy-voice:${voiceKeyPart(config)}`)));
  // Shaped as an RFC 9562 version-8 (custom) uuid.
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Turn the old settings into profiles plus a selection.
 *
 * The one invariant that matters: a migrated profile's `voiceKeyPart` equals
 * the legacy `${voice}|${voiceStyle}` exactly, so every chapter downloaded in
 * that voice still resolves. The old style was shared by reading and replies,
 * so a legacy assistant voice inherits it too.
 *
 * The selection carries `updatedAt: 1` — older than any real choice — so a
 * selection another device already synced wins over a migrated guess.
 */
export function migrateLegacyVoices(
  legacy: LegacyVoices,
  now: number,
): { voices: VoiceProfile[]; selection: VoiceSelection } {
  const style = typeof legacy.voiceStyle === 'string' ? legacy.voiceStyle : '';
  const voices: VoiceProfile[] = [];

  const idFor = (raw: string | undefined, role: VoiceRole): string => {
    if (raw === 'browser') return SYSTEM_DEVICE_ID;
    if (!isOpenAiVoiceId(raw)) return role === 'narration' ? SYSTEM_ECHO_ID : SYSTEM_DEVICE_ID;
    const config: TtsVoice = { provider: 'openai', voice: raw, style };
    if (voiceKeyPart(config) === voiceKeyPart(ECHO_VOICE)) return SYSTEM_ECHO_ID;
    const id = legacyVoiceId(config);
    if (!voices.some((v) => v.id === id)) {
      voices.push({
        v: 1,
        id,
        name: defaultVoiceName(config),
        config,
        createdAt: now,
        updatedAt: now,
      });
    }
    return id;
  };

  const narration = idFor(legacy.voice ?? 'echo', 'narration');
  const assistant = idFor(legacy.assistantVoice ?? 'browser', 'assistant');
  return { voices, selection: { narration, assistant, updatedAt: 1 } };
}
