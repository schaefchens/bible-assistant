<?php
declare(strict_types=1);

// An include, not an endpoint — see APP_ROOT in api.php. Fetched directly this
// file must say nothing: it never runs api.php's ini_set('display_errors', '0').
if (!defined('APP_ROOT')) { http_response_code(404); exit; }

/**
 * What a narration voice is, on the server.
 *
 * Three things live here, and they are one file because each depends on the
 * one before:
 *
 *   - **The audible config** — the provider, its voice, and the settings that
 *     change the sound — validated and quantized by openAiVoiceConfig() and
 *     elevenLabsConfig(). The ElevenLabs narration path (api/elevenlabs.php)
 *     and sanitizeVoiceProfile() both normalize through them, so the config
 *     rules exist once on this side of the wire. They mirror
 *     normalizeTtsVoice() in src/services/voices/ttsVoice.ts — same
 *     whitelists, same defaults for a missing or non-numeric setting, same
 *     clamps, same 0.05 grid — because a voice has to mean the same audio on
 *     both sides of it.
 *   - **The cache identity** of an ElevenLabs config: audibleConfigCanonical()
 *     and audibleConfigHash(), the one hash every ElevenLabs cache path
 *     carries. Never in it: a profile's id, name, avatar, sourceName — or who
 *     pays. (OpenAI's identity is still its legacy path, {voice}/style-…, see
 *     voiceStyleSegment() in api/audio.php.)
 *   - **The voice profile** a user keeps — a name, maybe an avatar, exactly one
 *     config — plus the synced collection of them and the selection record
 *     ("which voice reads, which one replies"), all under the HTTP-denied
 *     users/ directory. A profile is user-authored, so it reaches disk only
 *     through sanitizeVoiceProfile()'s whitelist; a shelf that one day shares
 *     a voice would carry exactly that record.
 */

/** OpenAI's gpt-4o-mini-tts voices — the client's OPENAI_VOICES, unordered. */
const OPENAI_TTS_VOICES = [
    'alloy', 'ash', 'ballad', 'cedar', 'coral', 'echo', 'fable',
    'marin', 'nova', 'onyx', 'sage', 'shimmer', 'verse',
];
/** An OpenAI style is `instructions` text, capped in bytes exactly like the
 * `voiceStyle` handleTts accepts — a profile tts would refuse is refused here. */
const MAX_OPENAI_STYLE_BYTES = 1000;

/** The two models a voice can use: v4 on the dialogue endpoint (stability and
 * similarity only), Multilingual v2 on the speech endpoint (adds style, speed). */
const ELEVENLABS_MODELS = ['eleven_v4', 'eleven_multilingual_v2'];
const ELEVENLABS_VOICE_ID_RE = '/^[A-Za-z0-9]{16,32}$/';
/** What a missing or non-numeric setting becomes — ELEVEN_DEFAULTS on the client. */
const EL_DEFAULTS = ['stability' => 0.5, 'similarity' => 0.75, 'style' => 0.0, 'speed' => 1.0];
const EL_SPEED_MIN = 0.7;
const EL_SPEED_MAX = 1.2;

/**
 * Part of every ElevenLabs cache identity, so bumping it orphans — on purpose —
 * every generated ElevenLabs file. Bump it when the same config and text would
 * now produce different audio: a new text transform (see elevenLabsSpokenText),
 * a different output format, a model parameter sent differently. Not for
 * anything that only changes the alignment JSON.
 */
const EL_CONFIG_VERSION = 1;
/** The `output_format` every ElevenLabs request asks for: MP3, 44.1 kHz, 128 kbps. */
const EL_OUTPUT_FORMAT = 'mp3_44100_128';

const MAX_VOICES_PER_USER = 30;
const MAX_VOICE_NAME_CHARS = 80;
/** The whole data URL, in bytes — the client's MAX_AVATAR_CHARS. */
const MAX_VOICE_AVATAR_CHARS = 96 * 1024;

function voicesPath(string $userDir): string { return $userDir . '/voices.json'; }
function voiceSelectionPath(string $userDir): string { return $userDir . '/voiceSelection.json'; }

// ---------- the audible config ----------------------------------------------

/**
 * A setting snapped onto the 0.05 grid, as a count of steps (0.55 → 11).
 * The client's quantize(), step for step: not a finite number → the default;
 * clamped to [lo, hi]; then JavaScript's Math.round(x * 20).
 */
function elSettingSteps(mixed $v, float $lo, float $hi, float $default): int {
    $n = (is_int($v) || is_float($v)) && is_finite((float)$v) ? (float)$v : $default;
    $n = max($lo, min($hi, $n));
    return (int)floor($n * 20 + 0.5);
}

/** The quantized setting as a number — what a profile stores and what is
 * sent upstream: 11 / 20 = 0.55, never 0.55000000000000004. */
function elSetting(mixed $v, float $lo, float $hi, float $default): float {
    return elSettingSteps($v, $lo, $hi, $default) / 20;
}

/** A quantized setting as the fixed two-decimal string the cache identity is
 * built from — the client's `toFixed(2)`, without trusting float formatting. */
function elFixed(float $v): string {
    $hundredths = (int)floor($v * 20 + 0.5) * 5;
    return sprintf('%d.%02d', intdiv($hundredths, 100), $hundredths % 100);
}

/** An OpenAI voice config: one of the thirteen voices, and a style kept byte
 * for byte (it is already a cache key for every install that set one). */
function openAiVoiceConfig(array $raw): array {
    $voice = $raw['voice'] ?? null;
    if (!is_string($voice) || !in_array($voice, OPENAI_TTS_VOICES, true)) fail(400, 'unknown OpenAI voice');
    $style = is_string($raw['style'] ?? null) ? $raw['style'] : '';
    if (strlen($style) > MAX_OPENAI_STYLE_BYTES) fail(400, 'voice style too long');
    return ['provider' => 'openai', 'voice' => $voice, 'style' => $style];
}

/**
 * An ElevenLabs config, validated and quantized — the one copy of its rules,
 * used by narration (the `elevenlabs` object of a tts body) and by profiles.
 *
 * Only the fields the model actually uses survive: v4 carries no style or
 * speed, so a slider left over from Multilingual v2 can never enter its cache
 * identity. The voice id and the model are refused when wrong (they decide
 * *which* voice speaks); a setting is coerced like the client coerces it
 * (it only decides how).
 */
function elevenLabsConfig(mixed $raw): array {
    if (!is_array($raw)) fail(400, 'invalid ElevenLabs settings');
    $voiceId = $raw['voiceId'] ?? null;
    if (!is_string($voiceId) || !preg_match(ELEVENLABS_VOICE_ID_RE, $voiceId)) {
        fail(400, 'invalid ElevenLabs voice id');
    }
    $model = $raw['model'] ?? null;
    if (!is_string($model) || !in_array($model, ELEVENLABS_MODELS, true)) fail(400, 'unknown ElevenLabs model');

    $config = [
        'provider' => 'elevenlabs',
        'voiceId' => $voiceId,
        'model' => $model,
        'stability' => elSetting($raw['stability'] ?? null, 0.0, 1.0, EL_DEFAULTS['stability']),
        'similarity' => elSetting($raw['similarity'] ?? null, 0.0, 1.0, EL_DEFAULTS['similarity']),
    ];
    if ($model === 'eleven_multilingual_v2') {
        $config['style'] = elSetting($raw['style'] ?? null, 0.0, 1.0, EL_DEFAULTS['style']);
        $config['speed'] = elSetting($raw['speed'] ?? null, EL_SPEED_MIN, EL_SPEED_MAX, EL_DEFAULTS['speed']);
    }
    return $config;
}

/** Either provider's config, by its `provider` field. */
function voiceConfig(mixed $raw): array {
    if (!is_array($raw)) fail(400, 'voice config required');
    $provider = $raw['provider'] ?? null;
    if ($provider === 'openai') return openAiVoiceConfig($raw);
    if ($provider === 'elevenlabs') return elevenLabsConfig($raw);
    fail(400, 'unknown voice provider');
    return [];
}

/**
 * The canonical form of an ElevenLabs config's audible identity: a ksort'ed
 * JSON object of the settings as fixed two-decimal strings, plus what else
 * decides the bytes — the config version, the output format, the model, the
 * provider, the voice, and speaker boost on the speech endpoint (which always
 * sends it). Takes an elevenLabsConfig() result.
 */
function audibleConfigCanonical(array $config): string {
    $canonical = [
        'v' => EL_CONFIG_VERSION,
        'format' => EL_OUTPUT_FORMAT,
        'provider' => 'elevenlabs',
        'voiceId' => (string)$config['voiceId'],
        'model' => (string)$config['model'],
        'stability' => elFixed((float)$config['stability']),
        'similarity' => elFixed((float)$config['similarity']),
    ];
    if ($config['model'] === 'eleven_multilingual_v2') {
        $canonical['style'] = elFixed((float)$config['style']);
        $canonical['speed'] = elFixed((float)$config['speed']);
        $canonical['speakerBoost'] = true;
    }
    ksort($canonical, SORT_STRING);
    return (string)json_encode($canonical, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
}

/** The {cfgHash} segment of an ElevenLabs cache path: 20 hex characters. */
function audibleConfigHash(array $config): string {
    return substr(hash('sha256', audibleConfigCanonical($config)), 0, 20);
}

// ---------- the voice profile -----------------------------------------------

/**
 * Whitelist one voice profile — the only way a profile reaches disk.
 *
 *   {v: 1, id, name, sourceName?, avatar?, config, createdAt, updatedAt}
 *
 * Refused (400) when it cannot be a voice: a non-uuid id, a blank or
 * over-long name, an unknown provider/model/voice, an avatar that is not a
 * small inline JPEG/PNG/WebP. `sourceName` (the provider's own name for the
 * voice, e.g. "George" from the ElevenLabs library) is presentation only and
 * is *truncated* rather than refused: it is copied from upstream, where a
 * name may be longer than ours. Unknown fields are dropped; field order means
 * nothing. Settings stay numbers, quantized.
 */
function sanitizeVoiceProfile(array $raw): array {
    if (($raw['v'] ?? 1) !== 1) fail(400, 'unsupported voice version');

    $name = $raw['name'] ?? null;
    if (!is_string($name)) fail(400, 'voice name required');
    $name = trim($name);
    if ($name === '' || mb_strlen($name, 'UTF-8') > MAX_VOICE_NAME_CHARS) fail(400, 'invalid voice name');

    $profile = [
        'v' => 1,
        'id' => safeUuid($raw['id'] ?? '', 'voice id'),
        'name' => $name,
    ];

    $source = $raw['sourceName'] ?? null;
    if (is_string($source)) {
        $source = trim(mb_substr(trim($source), 0, MAX_VOICE_NAME_CHARS, 'UTF-8'));
        if ($source !== '') $profile['sourceName'] = $source;
    }

    $avatar = $raw['avatar'] ?? null;
    if ($avatar !== null && $avatar !== '') $profile['avatar'] = voiceAvatar($avatar);

    $profile['config'] = voiceConfig($raw['config'] ?? null);
    $profile['createdAt'] = voiceTimestamp($raw['createdAt'] ?? null);
    $profile['updatedAt'] = voiceTimestamp($raw['updatedAt'] ?? null);
    return $profile;
}

/**
 * An avatar: a small inline image, carried inside the record so it syncs and
 * works offline. Stored under users/, never in the public avatars/ store.
 * The bytes must be the image type the data URL claims.
 */
function voiceAvatar(mixed $v): string {
    if (!is_string($v) || strlen($v) > MAX_VOICE_AVATAR_CHARS) fail(400, 'invalid avatar');
    if (!preg_match('#^data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/]++={0,2})$#', $v, $m)) {
        fail(400, 'invalid avatar');
    }
    $bytes = base64_decode($m[2], true);
    $magic = [
        'jpeg' => fn(string $b): bool => strncmp($b, "\xFF\xD8\xFF", 3) === 0,
        'png' => fn(string $b): bool => strncmp($b, "\x89PNG\r\n\x1A\n", 8) === 0,
        'webp' => fn(string $b): bool => strncmp($b, 'RIFF', 4) === 0 && substr($b, 8, 4) === 'WEBP',
    ];
    if ($bytes === false || !$magic[$m[1]]($bytes)) fail(400, 'invalid avatar');
    return $v;
}

/** A client timestamp (ms): a finite, non-negative number, kept as sent. */
function voiceTimestamp(mixed $v): int|float {
    if ((!is_int($v) && !is_float($v)) || !is_finite((float)$v) || $v < 0) fail(400, 'invalid voice timestamp');
    return $v;
}

function handleVoiceUpsert(array $ctx): void {
    handleUpsertItem(voicesPath($ctx['userDir']), 'voice', 'voices', 'sanitizeVoiceProfile', MAX_VOICES_PER_USER);
}

// ---------- the selection ---------------------------------------------------

const DEFAULT_VOICE_SELECTION = ['narration' => 'system:echo', 'assistant' => 'system:device', 'updatedAt' => 0];

/** A selection names a system voice or a profile id. Whether that profile
 * exists is not checked: its upsert may simply not have arrived yet, and the
 * client falls back on a dangling id anyway. */
function isVoiceSelectionId(mixed $v): bool {
    return $v === 'system:echo' || $v === 'system:device'
        || (is_string($v) && preg_match('/^[0-9a-fA-F-]{36}$/', $v) === 1);
}

/** The stored selection, re-validated on the way out — field by field, so one
 * bad field costs only itself. The default when there is none. */
function readVoiceSelection(string $path): array {
    $stored = readJsonObjectFile($path);
    if ($stored === null) return DEFAULT_VOICE_SELECTION;
    $pick = fn(string $role): string => isVoiceSelectionId($stored[$role] ?? null)
        ? (string)$stored[$role]
        : DEFAULT_VOICE_SELECTION[$role];
    return [
        'narration' => $pick('narration'),
        'assistant' => $pick('assistant'),
        'updatedAt' => is_numeric($stored['updatedAt'] ?? null) ? (int)$stored['updatedAt'] : 0,
    ];
}

function handleVoiceSelectionGet(array $ctx): void {
    respond(200, readVoiceSelection(voiceSelectionPath($ctx['userDir'])));
}

/**
 * Last write wins by the client's `updatedAt`, exactly like handleOrderSet: a
 * stale write — an older device coming back online — is ignored rather than
 * allowed to clobber a newer choice, and answered with what is stored.
 */
function handleVoiceSelectionSet(array $ctx): void {
    $body = readJsonBody();
    $narration = $body['narration'] ?? null;
    $assistant = $body['assistant'] ?? null;
    $updatedAt = $body['updatedAt'] ?? null;
    if (!isVoiceSelectionId($narration) || !isVoiceSelectionId($assistant)) fail(400, 'invalid voice selection');
    if (!is_numeric($updatedAt)) fail(400, 'updatedAt required');

    $path = voiceSelectionPath($ctx['userDir']);
    $existing = readVoiceSelection($path);
    $incoming = (int)$updatedAt;
    if ($incoming < $existing['updatedAt']) {
        respond(200, $existing + ['ignored' => true]);
    }
    $selection = ['narration' => $narration, 'assistant' => $assistant, 'updatedAt' => $incoming];
    writeJsonFile($path, $selection);
    respond(200, $selection);
}
