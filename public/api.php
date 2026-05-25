<?php
declare(strict_types=1);

/**
 * Bible Assistant — single-file PHP backend.
 *
 * Deploy this file to your Hetzner webspace alongside the built SPA.
 * It assumes:
 *   - The OpenAI key is set as `OPENAI_API_KEY` in a sibling `secrets.php`
 *     (preferred) or directly below in BIBLE_ASSISTANT_KEY (less preferred).
 *   - A writable `./storage/` directory exists next to this file (auto-created).
 *
 * Endpoints (POST unless noted, all under /api.php?action=NAME):
 *   chat                  Proxy OpenAI chat/completions (tool calling).
 *   tts                   Generate verse audio + word alignment (cached).
 *   transcribe (form)     Proxy OpenAI Whisper transcribe.
 *   cards.list (GET)      Per-user card array.
 *   cards.upsert          { card }
 *   cards.delete          { id }
 *   cards.order.get (GET) Per-user card order: { order: string[], updatedAt: number }.
 *   cards.order.set       { order: string[], updatedAt: number }
 *   boards.list (GET)
 *   boards.upsert         { board }
 *   boards.delete         { id }
 *   boards.order.get (GET) Per-user board tab order: { order: string[], updatedAt: number }.
 *   boards.order.set      { order: string[], updatedAt: number }
 *   recording.upload      multipart: audio + bookId, chapter, verse, translation
 *   ambient.list (GET)    List ambient music tracks under storage/ambient/.
 *
 * Auth: X-User-Id (UUID) + X-User-Secret (hex). First sighting registers.
 */

ini_set('display_errors', '0');
error_reporting(E_ALL);

// ---------- config ----------------------------------------------------------

$secretsPath = __DIR__ . '/secrets.php';
if (file_exists($secretsPath)) {
    require_once $secretsPath;
}

if (!defined('OPENAI_API_KEY')) {
    define('OPENAI_API_KEY', getenv('OPENAI_API_KEY') ?: '');
}

const STORAGE_DIR = __DIR__ . '/storage';
const USERS_DIR = STORAGE_DIR . '/users';
const AUDIO_DIR = STORAGE_DIR . '/audio';

/**
 * URL prefix under which the SPA + this api.php are served.
 * Production: '/assistant'. Resolution order:
 *   1) define('BASE_PATH', ...) in secrets.php
 *   2) BIBLE_ASSISTANT_BASE_PATH env var
 *   3) X-Base-Path request header (Vite dev proxy sets this)
 *   4) Auto-detect from REQUEST_URI
 */
if (!defined('BASE_PATH')) {
    $resolved = '';
    $envBase = getenv('BIBLE_ASSISTANT_BASE_PATH');
    $headerBase = $_SERVER['HTTP_X_BASE_PATH'] ?? '';
    $req = $_SERVER['REQUEST_URI'] ?? '';
    if ($envBase !== false && $envBase !== '') {
        $resolved = $envBase;
    } elseif ($headerBase !== '') {
        $resolved = $headerBase;
    } elseif (preg_match('#^(/[^/?]+)/(api\.php|storage)#', $req, $m)) {
        $resolved = $m[1];
    }
    define('BASE_PATH', rtrim($resolved, '/'));
}
const AUDIO_BASE_URL = '/storage/audio'; // joined with BASE_PATH below

/**
 * Translation code -> Zefania XML filename under public/bibles/ (a.k.a.
 * dist/bibles/ on the deployed server). Any code not in this map is
 * rejected by handleBibleChapter() with a 400.
 */
const BIBLE_XML_MAP = [
    'S00'  => 's00.xml',
    'ESV'  => 'esv.xml',
    'KJV'  => 'kjv.xml',
    'NKJV' => 'nkjv.xml',
    'LUT'  => 'lut.xml',
    'HFA'  => 'hfa.xml',
    'S51'  => 's51.xml',
    'ELB'  => 'elb.xml',
];

/** Cache schema marker. Bump when the verse JSON shape changes so stale
 * entries on disk get invalidated on next read. */
const BIBLE_CACHE_FORMAT = 'xml-v2';

const CHAT_MODEL_DEFAULT = 'gpt-4o-mini';
const TTS_MODEL = 'gpt-4o-mini-tts';
/** Plain STT for voice input — fastest/best for the chat composer. */
const STT_MODEL = 'gpt-4o-transcribe';
/** Forced word-alignment requires verbose_json + word timestamps; only whisper-1 supports both. */
const ALIGNMENT_MODEL = 'whisper-1';

@mkdir(STORAGE_DIR, 0775, true);
@mkdir(USERS_DIR, 0775, true);
@mkdir(AUDIO_DIR, 0775, true);
@mkdir(STORAGE_DIR . '/ambient', 0775, true);

// Deny directory listings within storage if writable
$htaccessPath = STORAGE_DIR . '/.htaccess';
if (!file_exists($htaccessPath)) {
    @file_put_contents($htaccessPath, "Options -Indexes\n");
}

// Tighter guard on users/ — UUIDs are sent on every request, so anyone who
// knows a userId could otherwise GET storage/users/{id}/secret.txt or
// openai_key.txt directly. Block all HTTP access to this subtree; PHP keeps
// reading via the filesystem.
$usersHtaccessPath = USERS_DIR . '/.htaccess';
if (!file_exists($usersHtaccessPath)) {
    @file_put_contents(
        $usersHtaccessPath,
        "Require all denied\n" .
        "<IfModule !mod_authz_core.c>\n" .
        "  Order deny,allow\n" .
        "  Deny from all\n" .
        "</IfModule>\n",
    );
}

// ---------- helpers ---------------------------------------------------------

function respond(int $status, array $body): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function fail(int $status, string $message, array $extra = []): void {
    respond($status, array_merge(['error' => $message], $extra));
}

function readJsonBody(): array {
    $raw = file_get_contents('php://input');
    if ($raw === '' || $raw === false) return [];
    $data = json_decode($raw, true);
    if (!is_array($data)) fail(400, 'invalid JSON body');
    return $data;
}

function safeSlug(string $s): string {
    $s = preg_replace('/[^a-zA-Z0-9_-]/', '_', $s) ?? '';
    return $s === '' ? '_' : $s;
}

function safeInt(mixed $v): int {
    if (!is_numeric($v)) fail(400, 'expected integer');
    return (int)$v;
}

function safeString(mixed $v, int $maxLen = 8000): string {
    if (!is_string($v)) fail(400, 'expected string');
    if (strlen($v) > $maxLen) fail(400, 'string too long');
    return $v;
}

/**
 * Resolve the OpenAI key to use for a request. Prefer the caller's saved
 * personal key (users/{id}/openai_key.txt) so usage is billed to their
 * account; fall back to OPENAI_API_KEY only when they haven't set one or
 * have explicitly opted into the shared key via X-Prefer-Shared-Key.
 * Returns '' when no key is configured anywhere.
 */
function effectiveOpenAiKey(array $ctx, bool $preferShared = false): string {
    if (!$preferShared && isset($ctx['userDir'])) {
        $f = $ctx['userDir'] . '/openai_key.txt';
        if (is_readable($f)) {
            $k = trim((string)@file_get_contents($f));
            if ($k !== '') return $k;
        }
    }
    return OPENAI_API_KEY;
}

function curlJson(string $url, array $payload, array $extraHeaders = [], ?string $apiKey = null): array {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 120,
        CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE),
        CURLOPT_HTTPHEADER => array_merge([
            'Content-Type: application/json',
            'Authorization: Bearer ' . ($apiKey ?? OPENAI_API_KEY),
        ], $extraHeaders),
    ]);
    $body = curl_exec($ch);
    if ($body === false) {
        $err = curl_error($ch);
        curl_close($ch);
        return ['_error' => $err, '_status' => 0];
    }
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    $decoded = json_decode($body, true);
    if (!is_array($decoded)) return ['_error' => 'invalid response', '_status' => $status, '_raw' => $body];
    $decoded['_status'] = $status;
    return $decoded;
}

function curlBinary(string $url, array $payload, ?string $apiKey = null): array {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 180,
        CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE),
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'Authorization: Bearer ' . ($apiKey ?? OPENAI_API_KEY),
        ],
    ]);
    $body = curl_exec($ch);
    if ($body === false) {
        $err = curl_error($ch);
        curl_close($ch);
        return ['_error' => $err, '_status' => 0];
    }
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $contentType = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
    curl_close($ch);
    if ($status !== 200) {
        $decoded = json_decode($body, true);
        return ['_error' => is_array($decoded) ? json_encode($decoded) : $body, '_status' => $status];
    }
    return ['_status' => $status, 'audio' => $body, 'contentType' => $contentType];
}

function curlMultipart(string $url, array $fields, string $fileField, string $filePath, string $fileName, ?string $apiKey = null): array {
    $ch = curl_init($url);
    $fields[$fileField] = new CURLFile($filePath, 'audio/webm', $fileName);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 180,
        CURLOPT_POSTFIELDS => $fields,
        CURLOPT_HTTPHEADER => [
            'Authorization: Bearer ' . ($apiKey ?? OPENAI_API_KEY),
        ],
    ]);
    $body = curl_exec($ch);
    if ($body === false) {
        $err = curl_error($ch);
        curl_close($ch);
        return ['_error' => $err, '_status' => 0];
    }
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    $decoded = json_decode($body, true);
    if (!is_array($decoded)) return ['_error' => 'invalid response', '_status' => $status, '_raw' => $body];
    $decoded['_status'] = $status;
    return $decoded;
}

// ---------- auth ------------------------------------------------------------

function requireAuth(): array {
    $userId = $_SERVER['HTTP_X_USER_ID'] ?? '';
    $userSecret = $_SERVER['HTTP_X_USER_SECRET'] ?? '';
    if (!$userId || !$userSecret) fail(401, 'missing identity headers');
    if (!preg_match('/^[0-9a-f-]{36}$/i', $userId)) fail(401, 'invalid userId');
    if (!preg_match('/^[0-9a-f]{32,}$/i', $userSecret)) fail(401, 'invalid secret');

    $userDir = USERS_DIR . '/' . $userId;
    $secretFile = $userDir . '/secret.txt';

    if (!is_dir($userDir)) {
        @mkdir($userDir, 0775, true);
        file_put_contents($secretFile, $userSecret);
    } else {
        $stored = @file_get_contents($secretFile);
        if ($stored === false || trim($stored) !== $userSecret) {
            fail(401, 'auth failed');
        }
    }
    return ['userId' => $userId, 'userDir' => $userDir];
}

// ---------- routing ---------------------------------------------------------

// Skip the router when included by a CLI test harness (no HTTP request).
if (PHP_SAPI === 'cli' && !defined('BIBLE_API_RUN_ROUTER')) return;

$action = $_GET['action'] ?? '';
if (!is_string($action) || $action === '') fail(400, 'missing action');

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$ctx = requireAuth();

// Resolve the effective OpenAI key once per request — prefer the caller's
// own key over the shared OPENAI_API_KEY so usage bills to their account.
// Honoured by every handler that touches OpenAI; the new auth.openaiKey.set
// handler ignores this and uses the freshly-submitted key for validation.
$OPENAI_ACTIONS = ['chat', 'tts', 'tts.speak', 'transcribe', 'recording.upload'];
$ctx['preferShared'] = (($_SERVER['HTTP_X_PREFER_SHARED_KEY'] ?? '') === '1');
if (in_array($action, $OPENAI_ACTIONS, true)) {
    $ctx['openaiKey'] = effectiveOpenAiKey($ctx, $ctx['preferShared']);
    if ($ctx['openaiKey'] === '') {
        fail(500, 'no OpenAI API key configured');
    }
}

switch ($action) {
    case 'chat':
        handleChat($ctx);
        break;
    case 'tts':
        handleTts($ctx);
        break;
    case 'tts.speak':
        handleTtsSpeak($ctx);
        break;
    case 'bible.chapter':
        handleBibleChapter();
        break;
    case 'transcribe':
        handleTranscribe($ctx);
        break;
    case 'auth.openaiKey.status':
        handleOpenAiKeyStatus($ctx);
        break;
    case 'auth.openaiKey.set':
        handleOpenAiKeySet($ctx);
        break;
    case 'auth.openaiKey.clear':
        handleOpenAiKeyClear($ctx);
        break;
    case 'cards.list':
        handleListJson($ctx['userDir'] . '/cards.json', 'cards');
        break;
    case 'cards.upsert':
        handleUpsertItem($ctx['userDir'] . '/cards.json', 'card', 'cards');
        break;
    case 'cards.delete':
        handleDeleteItem($ctx['userDir'] . '/cards.json', 'cards');
        break;
    case 'cards.order.get':
        handleOrderGet($ctx['userDir'] . '/cardOrder.json');
        break;
    case 'cards.order.set':
        handleOrderSet($ctx['userDir'] . '/cardOrder.json');
        break;
    case 'boards.list':
        handleListJson($ctx['userDir'] . '/boards.json', 'boards');
        break;
    case 'boards.upsert':
        handleUpsertItem($ctx['userDir'] . '/boards.json', 'board', 'boards');
        break;
    case 'boards.delete':
        handleDeleteItem($ctx['userDir'] . '/boards.json', 'boards');
        break;
    case 'boards.order.get':
        handleOrderGet($ctx['userDir'] . '/boardOrder.json');
        break;
    case 'boards.order.set':
        handleOrderSet($ctx['userDir'] . '/boardOrder.json');
        break;
    case 'recording.upload':
        handleRecordingUpload($ctx);
        break;
    case 'ambient.list':
        handleAmbientList();
        break;
    default:
        fail(404, 'unknown action');
}

// ---------- handlers --------------------------------------------------------

function handleChat(array $ctx): void {
    // Decode as stdClass (NOT assoc) so empty objects like `properties: {}` survive
    // a JSON round-trip — assoc arrays can't distinguish [] from {} and OpenAI rejects
    // any tool whose `parameters.properties` arrives as `[]` instead of `{}`.
    $raw = file_get_contents('php://input');
    if (!$raw) fail(400, 'empty body');
    $obj = json_decode($raw, false);
    if (!is_object($obj) || !isset($obj->messages) || !isset($obj->tools)) {
        fail(400, 'messages and tools required');
    }
    if (!isset($obj->model) || !is_string($obj->model)) $obj->model = CHAT_MODEL_DEFAULT;
    $obj->tool_choice = 'auto';
    if (!isset($obj->temperature)) $obj->temperature = 0.2;

    $payload = json_encode($obj, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $resp = curlRawJson('https://api.openai.com/v1/chat/completions', $payload, $ctx['openaiKey']);
    if (($resp['_status'] ?? 0) !== 200) {
        failOpenAi($ctx, 'openai chat failed', $resp);
    }
    $choice = $resp['choices'][0] ?? null;
    if (!$choice) fail(502, 'no choice returned');
    respond(200, [
        'message' => $choice['message'],
        'finish_reason' => $choice['finish_reason'] ?? null,
    ]);
}

/**
 * Surface an OpenAI error to the client. When the caller is using their own
 * key and OpenAI rejected it (401/403), tag the error with `user_key_failed`
 * so the client can offer a one-time fallback to the shared key for this
 * session.
 */
function failOpenAi(array $ctx, string $message, array $resp): void {
    $status = (int)($resp['_status'] ?? 0);
    $detail = $resp['_error'] ?? ($resp['error']['message'] ?? '');
    $usingPersonalKey = !($ctx['preferShared'] ?? false)
        && isset($ctx['userDir'])
        && is_readable($ctx['userDir'] . '/openai_key.txt');
    if ($usingPersonalKey && ($status === 401 || $status === 403)) {
        fail(502, 'user_key_failed', ['status' => $status, 'detail' => $detail]);
    }
    fail(502, $message, ['status' => $status, 'detail' => $detail]);
}

function curlRawJson(string $url, string $payload, ?string $apiKey = null): array {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 120,
        CURLOPT_POSTFIELDS => $payload,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'Authorization: Bearer ' . ($apiKey ?? OPENAI_API_KEY),
        ],
    ]);
    $body = curl_exec($ch);
    if ($body === false) {
        $err = curl_error($ch);
        curl_close($ch);
        return ['_error' => $err, '_status' => 0];
    }
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    $decoded = json_decode($body, true);
    if (!is_array($decoded)) return ['_error' => 'invalid response', '_status' => $status, '_raw' => $body];
    $decoded['_status'] = $status;
    return $decoded;
}

/**
 * Compose `instructions` for the OpenAI TTS request. A language hint based
 * on the Bible translation prevents the model from drifting into English
 * pronunciation on short German verses (or vice versa). Any user-provided
 * voiceStyle is appended after the language hint.
 */
function composeTtsInstructions(string $translation, string $voiceStyle): string {
    static $germanTranslations = ['S00' => 1, 'LUT' => 1, 'HFA' => 1, 'S51' => 1, 'ELB' => 1];
    $upper = strtoupper($translation);
    $hint = isset($germanTranslations[$upper])
        ? 'Read this Bible passage in clear, reverent German.'
        : 'Read this Bible passage in clear, reverent English.';
    return $voiceStyle !== '' ? "$hint $voiceStyle" : $hint;
}

/** Counterpart for the free-form tts.speak endpoint (no translation, just
 * an optional `language` code from the client). Returns '' if neither a
 * language nor a voiceStyle were supplied. */
function composeSpeakInstructions(string $language, string $voiceStyle): string {
    $lang = strtolower($language);
    $hint = '';
    if ($lang === 'de') $hint = 'Speak this in clear German.';
    elseif ($lang === 'en') $hint = 'Speak this in clear English.';
    if ($hint === '') return $voiceStyle;
    return $voiceStyle !== '' ? "$hint $voiceStyle" : $hint;
}

/** Hash of the inputs that determine TTS audio output. Stored alongside
 * the alignment so a cached mp3 can be detected as stale when the source
 * text (or voiceStyle) changes — e.g. after the bolls-to-XML migration
 * cleaned up inline footnote refs like "[16]" that had been baked into
 * the audio. Voice/translation/bookId/chapter/verse are already part of
 * the cache path so they don't need to be in the hash. */
function sha256ForCache(string $text, string $voiceStyle): string {
    return hash('sha256', $voiceStyle . "\x00" . $text);
}

function cachedAlignmentMatches(string $alignmentFile, string $expectedHash): bool {
    $raw = @file_get_contents($alignmentFile);
    if ($raw === false || $raw === '') return false;
    $decoded = json_decode($raw, true);
    if (!is_array($decoded)) return false;
    return isset($decoded['sourceTextHash']) && $decoded['sourceTextHash'] === $expectedHash;
}

function handleTts(array $ctx): void {
    $body = readJsonBody();
    $text = safeString($body['text'] ?? '');
    $voice = safeSlug(safeString($body['voice'] ?? 'alloy', 32));
    $voiceStyle = isset($body['voiceStyle']) ? safeString($body['voiceStyle'], 1000) : '';
    $translation = safeSlug(safeString($body['translation'] ?? '', 16));
    $bookId = safeInt($body['bookId'] ?? null);
    $chapter = safeInt($body['chapter'] ?? null);
    $verse = safeInt($body['verse'] ?? null);

    if (!$text || !$translation || $bookId <= 0 || $chapter <= 0 || $verse <= 0) {
        fail(400, 'missing tts params');
    }

    $dir = AUDIO_DIR . "/{$voice}/{$translation}/{$bookId}/{$chapter}";
    @mkdir($dir, 0775, true);
    $audioFile = "{$dir}/{$verse}.mp3";
    $alignmentFile = "{$dir}/{$verse}.json";

    // Treat audio as stale when its sourceTextHash doesn't match the current
    // text. Pre-migration audio (bolls.life pipeline) sometimes baked inline
    // footnote refs like "16" / "17" into the mp3 because textTts hadn't been
    // stripped yet — without this check those keep playing forever.
    $expectedHash = sha256ForCache($text, $voiceStyle);
    $cached = file_exists($audioFile)
        && file_exists($alignmentFile)
        && cachedAlignmentMatches($alignmentFile, $expectedHash);
    if (!$cached) {
        $ttsPayload = [
            'model' => TTS_MODEL,
            'voice' => $voice,
            'input' => $text,
            'response_format' => 'mp3',
            'instructions' => composeTtsInstructions($translation, $voiceStyle),
        ];
        $tts = curlBinary('https://api.openai.com/v1/audio/speech', $ttsPayload, $ctx['openaiKey']);
        if (($tts['_status'] ?? 0) !== 200 || empty($tts['audio'])) {
            failOpenAi($ctx, 'tts failed', $tts);
        }
        if (file_put_contents($audioFile, $tts['audio']) === false) {
            fail(500, 'could not write audio file');
        }
        // Forced word alignment via gpt-4o-transcribe on our freshly-generated audio.
        $align = curlMultipart(
            'https://api.openai.com/v1/audio/transcriptions',
            [
                'model' => ALIGNMENT_MODEL,
                'response_format' => 'verbose_json',
                'timestamp_granularities[]' => 'word',
            ],
            'file',
            $audioFile,
            $verse . '.mp3',
            $ctx['openaiKey'],
        );
        if (($align['_status'] ?? 0) !== 200) {
            // We still have the audio; write empty alignment so client falls back gracefully.
            file_put_contents($alignmentFile, json_encode([
                'words' => [],
                'sourceTextHash' => $expectedHash,
            ]));
        } else {
            $alignmentBody = [
                'words' => $align['words'] ?? [],
                'duration' => $align['duration'] ?? null,
                'text' => $align['text'] ?? null,
                'sourceTextHash' => $expectedHash,
            ];
            file_put_contents($alignmentFile, json_encode($alignmentBody, JSON_UNESCAPED_UNICODE));
        }
    }

    respond(200, [
        'audioUrl' => BASE_PATH . AUDIO_BASE_URL . "/{$voice}/{$translation}/{$bookId}/{$chapter}/{$verse}.mp3",
        'alignmentUrl' => BASE_PATH . AUDIO_BASE_URL . "/{$voice}/{$translation}/{$bookId}/{$chapter}/{$verse}.json",
        'cached' => $cached,
    ]);
}

/**
 * Free-form TTS for assistant chat replies (no bible coords). Cached by a
 * sha-256 hash of voice+style+text so identical lines reuse audio.
 */
function handleTtsSpeak(array $ctx): void {
    $body = readJsonBody();
    $text = safeString($body['text'] ?? '', 4000);
    $voice = safeSlug(safeString($body['voice'] ?? 'alloy', 32));
    $voiceStyle = isset($body['voiceStyle']) ? safeString($body['voiceStyle'], 1000) : '';
    // Optional language hint — short announcements (e.g. "Vers 16") benefit
    // from an explicit nudge so the model doesn't default to English.
    $language = safeSlug(safeString($body['language'] ?? '', 4));

    if (!$text) fail(400, 'missing tts.speak params');

    // Cache key includes language so a hint change naturally invalidates.
    $key = hash('sha256', $voice . ':' . $voiceStyle . ':' . $language . ':' . $text);
    $dir = AUDIO_DIR . "/speak/{$voice}";
    @mkdir($dir, 0775, true);
    $audioFile = "{$dir}/{$key}.mp3";
    $alignmentFile = "{$dir}/{$key}.json";

    $cached = file_exists($audioFile) && file_exists($alignmentFile);
    if (!$cached) {
        $instructions = composeSpeakInstructions($language, $voiceStyle);
        $ttsPayload = [
            'model' => TTS_MODEL,
            'voice' => $voice,
            'input' => $text,
            'response_format' => 'mp3',
        ];
        if ($instructions !== '') {
            $ttsPayload['instructions'] = $instructions;
        }
        $tts = curlBinary('https://api.openai.com/v1/audio/speech', $ttsPayload, $ctx['openaiKey']);
        if (($tts['_status'] ?? 0) !== 200 || empty($tts['audio'])) {
            failOpenAi($ctx, 'tts failed', $tts);
        }
        if (file_put_contents($audioFile, $tts['audio']) === false) {
            fail(500, 'could not write audio file');
        }
        $align = curlMultipart(
            'https://api.openai.com/v1/audio/transcriptions',
            [
                'model' => ALIGNMENT_MODEL,
                'response_format' => 'verbose_json',
                'timestamp_granularities[]' => 'word',
            ],
            'file',
            $audioFile,
            $key . '.mp3',
            $ctx['openaiKey'],
        );
        if (($align['_status'] ?? 0) !== 200) {
            file_put_contents($alignmentFile, json_encode(['words' => []]));
        } else {
            $alignmentBody = [
                'words' => $align['words'] ?? [],
                'duration' => $align['duration'] ?? null,
                'text' => $align['text'] ?? null,
            ];
            file_put_contents($alignmentFile, json_encode($alignmentBody, JSON_UNESCAPED_UNICODE));
        }
    }

    respond(200, [
        'audioUrl' => BASE_PATH . AUDIO_BASE_URL . "/speak/{$voice}/{$key}.mp3",
        'alignmentUrl' => BASE_PATH . AUDIO_BASE_URL . "/speak/{$voice}/{$key}.json",
        'cached' => $cached,
    ]);
}

/**
 * Fetch a Bible chapter from the local Zefania XML, cached per chapter to
 * storage/bible/{translation}/{bookId}/{chapter}.json so repeat reads are
 * disk-only. Translations must be registered in BIBLE_XML_MAP; unknown codes
 * return 400.
 */
function handleBibleChapter(): void {
    $body = readJsonBody();
    $translation = safeSlug(safeString($body['translation'] ?? '', 16));
    $bookId = safeInt($body['bookId'] ?? null);
    $chapter = safeInt($body['chapter'] ?? null);
    if (!$translation || $bookId <= 0 || $chapter <= 0) {
        fail(400, 'missing bible.chapter params');
    }

    $xmlSlug = BIBLE_XML_MAP[strtoupper($translation)] ?? null;
    if ($xmlSlug === null) {
        fail(400, 'unknown translation', ['translation' => $translation]);
    }

    $dir = STORAGE_DIR . "/bible/{$translation}/{$bookId}";
    @mkdir($dir, 0775, true);
    $file = "{$dir}/{$chapter}.json";

    if (file_exists($file)) {
        $raw = file_get_contents($file);
        if ($raw !== false && $raw !== '') {
            $cached = json_decode($raw, true);
            // Cache uses { format, verses } so future schema bumps via
            // BIBLE_CACHE_FORMAT invalidate stale entries automatically.
            if (is_array($cached) && ($cached['format'] ?? null) === BIBLE_CACHE_FORMAT) {
                respond(200, ['verses' => $cached['verses'] ?? [], 'cached' => true]);
                return;
            }
        }
    }

    $xmlPath = __DIR__ . '/bibles/' . $xmlSlug;
    if (!is_readable($xmlPath)) {
        fail(500, 'bible xml missing on server', ['translation' => $translation]);
    }
    $verses = parseZefaniaChapter($xmlPath, $bookId, $chapter);
    if ($verses === null) {
        fail(404, 'chapter not found', ['translation' => $translation, 'bookId' => $bookId, 'chapter' => $chapter]);
    }
    file_put_contents($file, json_encode([
        'format' => BIBLE_CACHE_FORMAT,
        'verses' => $verses,
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    respond(200, ['verses' => $verses, 'cached' => false]);
}

/**
 * Parse a single chapter out of a Zefania XML file. Returns an array of
 * verse rows, or null if the requested book/chapter wasn't found.
 *
 * Handles both Zefania flavours we ship:
 *   - simple:   <bible>/<testament>/<book number=>/<chapter number=>/<verse number=>
 *   - zef2005:  <XMLBIBLE>/<BIBLEBOOK bnumber=>/<CHAPTER cnumber=>/<VERS vnumber=>
 *
 * Uses XMLReader to skip past non-matching books cheaply (the Strong's bibles
 * are 12 MB each), then DOM-expands the matched book for mixed-content walks.
 */
function parseZefaniaChapter(string $xmlPath, int $bookId, int $chapter): ?array {
    $reader = new XMLReader();
    if (!$reader->open($xmlPath)) return null;
    $doc = new DOMDocument();

    while ($reader->read()) {
        if ($reader->nodeType !== XMLReader::ELEMENT) continue;
        $name = $reader->localName;
        if ($name !== 'book' && $name !== 'BIBLEBOOK') continue;
        $bnum = (int)($reader->getAttribute('number') ?: $reader->getAttribute('bnumber') ?: 0);
        if ($bnum !== $bookId) {
            $reader->next();
            continue;
        }
        $bookNode = $reader->expand($doc);
        $reader->close();
        if (!$bookNode instanceof DOMElement) return null;
        foreach ($bookNode->childNodes as $chapNode) {
            if (!$chapNode instanceof DOMElement) continue;
            $cname = $chapNode->nodeName;
            if ($cname !== 'chapter' && $cname !== 'CHAPTER') continue;
            $cnum = (int)($chapNode->getAttribute('number') ?: $chapNode->getAttribute('cnumber') ?: 0);
            if ($cnum === $chapter) {
                return parseZefaniaVerses($chapNode, $bookId, $chapter);
            }
        }
        return null;
    }
    $reader->close();
    return null;
}

function parseZefaniaVerses(DOMElement $chap, int $bookId, int $chapter): array {
    $verses = [];
    foreach ($chap->childNodes as $vnode) {
        if (!$vnode instanceof DOMElement) continue;
        $vname = $vnode->nodeName;
        if ($vname !== 'verse' && $vname !== 'VERS') continue;
        $vnum = (int)($vnode->getAttribute('number') ?: $vnode->getAttribute('vnumber') ?: 0);
        if ($vnum <= 0) continue;

        [$segments, $hasStrongs] = extractZefaniaSegments($vnode);
        $text = normalizeSpace(implode('', array_column($segments, 't')));
        $textTts = stripForTts($text);

        $verse = [
            'pk' => $bookId * 1_000_000 + $chapter * 1_000 + $vnum,
            'verse' => $vnum,
            'text' => $text,
            'textTts' => $textTts,
        ];
        if ($hasStrongs) {
            $verse['segments'] = array_map(
                fn($s) => $s['s'] !== null ? ['t' => $s['t'], 's' => $s['s']] : ['t' => $s['t']],
                $segments,
            );
        }
        $verses[] = $verse;
    }
    return $verses;
}

/**
 * Walk a <verse>/<VERS> element collecting [text, strong-number] segments.
 * Returns [segments, hasStrongs]. <NOTE> and <DIV> subtrees are dropped
 * entirely — they're study notes, not verse text.
 */
function extractZefaniaSegments(DOMElement $verse): array {
    $segments = [];
    $hasStrongs = false;
    foreach ($verse->childNodes as $node) {
        if ($node instanceof DOMText || $node instanceof DOMCdataSection) {
            $segments[] = ['t' => $node->nodeValue, 's' => null];
            continue;
        }
        if (!$node instanceof DOMElement) continue;
        $nm = $node->nodeName;
        if ($nm === 'gr') {
            $strong = $node->getAttribute('str');
            $segments[] = ['t' => $node->textContent, 's' => $strong !== '' ? $strong : null];
            if ($strong !== '') $hasStrongs = true;
            continue;
        }
        if ($nm === 'NOTE' || $nm === 'DIV') continue;
        // Anything else (rare): fold its plain text in so we don't lose content.
        $segments[] = ['t' => $node->textContent, 's' => null];
    }
    return [$segments, $hasStrongs];
}

function normalizeSpace(string $s): string {
    $s = preg_replace('/\s+/u', ' ', $s) ?? $s;
    // Some Zefania bibles (notably ELB1905) keep trailing spaces inside
    // <gr> tags, which surface as "Erde ." after concatenation. Trim space
    // before sentence punctuation so display and TTS both read cleanly.
    $s = preg_replace('/ +([.,;:!?»"])/u', '$1', $s) ?? $s;
    return trim($s);
}

/**
 * Produce a TTS-safe variant by removing bracketed editor inserts that read
 * aloud as noise — numeric footnote refs like "[37]", manuscript caveats like
 * "[SOME OF THE EARLIEST MANUSCRIPTS...]", and the bracketed alternate-reading
 * inserts found in ESV/NLT. Multi-verse "[[ ... ]]" spans (e.g. Mark 16:9-20)
 * leave orphan brackets when split per verse, so strip leftover bracket chars
 * too — the text in between is real verse content.
 */
function stripForTts(string $s): string {
    $s = preg_replace('/\[+[^\[\]]*\]+/u', '', $s) ?? $s;
    $s = preg_replace('/[\[\]]/u', '', $s) ?? $s;
    return normalizeSpace($s);
}

function handleTranscribe(array $ctx): void {
    if (empty($_FILES['audio'])) fail(400, 'no audio uploaded');
    $tmp = $_FILES['audio']['tmp_name'];
    $name = $_FILES['audio']['name'] ?? 'audio.webm';
    $language = is_string($_POST['language'] ?? null) ? $_POST['language'] : 'en';

    $resp = curlMultipart(
        'https://api.openai.com/v1/audio/transcriptions',
        [
            'model' => STT_MODEL,
            'response_format' => 'json',
            'language' => $language === 'de' ? 'de' : 'en',
        ],
        'file',
        $tmp,
        $name,
        $ctx['openaiKey'],
    );
    if (($resp['_status'] ?? 0) !== 200) {
        failOpenAi($ctx, 'transcribe failed', $resp);
    }
    respond(200, ['text' => $resp['text'] ?? '']);
}

function handleListJson(string $path, string $key): void {
    $items = [];
    if (file_exists($path)) {
        $raw = @file_get_contents($path);
        $items = $raw ? json_decode($raw, true) : [];
        if (!is_array($items)) $items = [];
    }
    respond(200, [$key => $items]);
}

function handleUpsertItem(string $path, string $itemKey, string $listKey): void {
    $body = readJsonBody();
    $item = $body[$itemKey] ?? null;
    if (!is_array($item) || empty($item['id'])) fail(400, "$itemKey required");

    $items = file_exists($path) ? json_decode(@file_get_contents($path) ?: '[]', true) : [];
    if (!is_array($items)) $items = [];
    $found = false;
    foreach ($items as $i => $existing) {
        if (($existing['id'] ?? null) === $item['id']) {
            $items[$i] = $item;
            $found = true;
            break;
        }
    }
    if (!$found) $items[] = $item;

    writeJsonFile($path, $items);
    respond(200, [$listKey => $items]);
}

function handleDeleteItem(string $path, string $listKey): void {
    $body = readJsonBody();
    $id = $body['id'] ?? null;
    if (!is_string($id) || $id === '') fail(400, 'id required');

    $items = file_exists($path) ? json_decode(@file_get_contents($path) ?: '[]', true) : [];
    if (!is_array($items)) $items = [];
    $items = array_values(array_filter($items, fn($it) => ($it['id'] ?? null) !== $id));

    writeJsonFile($path, $items);
    respond(200, [$listKey => $items]);
}

function handleOrderGet(string $path): void {
    $payload = ['order' => [], 'updatedAt' => 0];
    if (file_exists($path)) {
        $raw = @file_get_contents($path);
        $decoded = $raw ? json_decode($raw, true) : null;
        if (is_array($decoded)) {
            $order = isset($decoded['order']) && is_array($decoded['order'])
                ? array_values(array_filter($decoded['order'], 'is_string'))
                : [];
            $updatedAt = isset($decoded['updatedAt']) && is_numeric($decoded['updatedAt'])
                ? (int)$decoded['updatedAt']
                : 0;
            $payload = ['order' => $order, 'updatedAt' => $updatedAt];
        }
    }
    respond(200, $payload);
}

function handleOrderSet(string $path): void {
    $body = readJsonBody();
    $order = $body['order'] ?? null;
    $updatedAt = $body['updatedAt'] ?? null;
    if (!is_array($order)) fail(400, 'order array required');
    if (!is_numeric($updatedAt)) fail(400, 'updatedAt required');
    $clean = array_values(array_filter($order, 'is_string'));
    // Last-write-wins by client timestamp: ignore stale writes so an older
    // device coming back online cannot clobber a newer order from another device.
    $existingUpdatedAt = 0;
    if (file_exists($path)) {
        $raw = @file_get_contents($path);
        $decoded = $raw ? json_decode($raw, true) : null;
        if (is_array($decoded) && isset($decoded['updatedAt']) && is_numeric($decoded['updatedAt'])) {
            $existingUpdatedAt = (int)$decoded['updatedAt'];
        }
    }
    $incoming = (int)$updatedAt;
    if ($incoming < $existingUpdatedAt) {
        respond(200, ['order' => [], 'updatedAt' => $existingUpdatedAt, 'ignored' => true]);
        return;
    }
    writeJsonFile($path, ['order' => $clean, 'updatedAt' => $incoming]);
    respond(200, ['order' => $clean, 'updatedAt' => $incoming]);
}

function writeJsonFile(string $path, array $data): void {
    @mkdir(dirname($path), 0775, true);
    $fp = fopen($path, 'c+');
    if (!$fp) fail(500, 'cannot open data file');
    if (!flock($fp, LOCK_EX)) {
        fclose($fp);
        fail(500, 'cannot lock data file');
    }
    ftruncate($fp, 0);
    rewind($fp);
    fwrite($fp, json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT));
    fflush($fp);
    flock($fp, LOCK_UN);
    fclose($fp);
}

function handleRecordingUpload(array $ctx): void {
    if (empty($_FILES['audio'])) fail(400, 'no audio uploaded');
    $translation = safeSlug(safeString($_POST['translation'] ?? ''));
    $bookId = safeInt($_POST['bookId'] ?? 0);
    $chapter = safeInt($_POST['chapter'] ?? 0);
    $verse = safeInt($_POST['verse'] ?? 0);
    if ($translation === '_' || $bookId <= 0 || $chapter <= 0 || $verse <= 0) {
        fail(400, 'missing reference params');
    }

    $userId = $ctx['userId'];
    $dir = AUDIO_DIR . "/recordings/{$userId}/{$translation}/{$bookId}/{$chapter}";
    @mkdir($dir, 0775, true);
    $dest = "{$dir}/{$verse}.mp3";
    if (!move_uploaded_file($_FILES['audio']['tmp_name'], $dest)) {
        fail(500, 'failed to save recording');
    }

    // Word alignment from real recording (also via gpt-4o-transcribe).
    $align = curlMultipart(
        'https://api.openai.com/v1/audio/transcriptions',
        [
            'model' => ALIGNMENT_MODEL,
            'response_format' => 'verbose_json',
            'timestamp_granularities[]' => 'word',
        ],
        'file',
        $dest,
        "{$verse}.mp3",
        $ctx['openaiKey'] ?? null,
    );
    $alignmentPath = "{$dir}/{$verse}.json";
    if (($align['_status'] ?? 0) === 200) {
        file_put_contents($alignmentPath, json_encode([
            'words' => $align['words'] ?? [],
            'duration' => $align['duration'] ?? null,
            'text' => $align['text'] ?? null,
        ], JSON_UNESCAPED_UNICODE));
    }

    respond(200, [
        'audioUrl' => BASE_PATH . "/storage/audio/recordings/{$userId}/{$translation}/{$bookId}/{$chapter}/{$verse}.mp3",
        'alignmentUrl' => BASE_PATH . "/storage/audio/recordings/{$userId}/{$translation}/{$bookId}/{$chapter}/{$verse}.json",
    ]);
}

function handleAmbientList(): void {
    $dir = STORAGE_DIR . '/ambient';
    $tracks = [];
    if (is_dir($dir)) {
        $entries = scandir($dir) ?: [];
        sort($entries, SORT_NATURAL | SORT_FLAG_CASE);
        foreach ($entries as $name) {
            if ($name === '.' || $name === '..') continue;
            if (!preg_match('/\.mp3$/i', $name)) continue;
            $id = preg_replace('/\.mp3$/i', '', $name);
            $title = ucwords(str_replace(['-', '_'], ' ', $id));
            $tracks[] = [
                'id' => $id,
                'title' => $title,
                'url' => BASE_PATH . '/storage/ambient/' . rawurlencode($name),
            ];
        }
    }
    respond(200, ['tracks' => $tracks]);
}

/** Show last-4 chars of a key so the UI can confirm which one is saved
 * without exposing it. Anything shorter than 8 chars is masked entirely. */
function maskOpenAiKey(string $key): string {
    $len = strlen($key);
    if ($len <= 8) return str_repeat('•', $len);
    return substr($key, 0, 3) . '…' . substr($key, -4);
}

function handleOpenAiKeyStatus(array $ctx): void {
    $f = $ctx['userDir'] . '/openai_key.txt';
    $hasKey = is_readable($f);
    $payload = ['hasKey' => $hasKey];
    if ($hasKey) {
        $k = trim((string)@file_get_contents($f));
        if ($k !== '') $payload['masked'] = maskOpenAiKey($k);
        else $payload['hasKey'] = false;
    }
    respond(200, $payload);
}

function handleOpenAiKeySet(array $ctx): void {
    $body = readJsonBody();
    $key = trim(safeString($body['key'] ?? '', 512));
    if ($key === '') fail(400, 'missing key');

    // Validate by hitting /v1/models with the submitted key. Cheap, no
    // request body, and surfaces a clear error if the key is rejected.
    $ch = curl_init('https://api.openai.com/v1/models');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 30,
        CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $key],
    ]);
    $resp = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($resp === false || $status !== 200) {
        $detail = '';
        if (is_string($resp) && $resp !== '') {
            $decoded = json_decode($resp, true);
            if (is_array($decoded) && isset($decoded['error']['message'])) {
                $detail = (string)$decoded['error']['message'];
            }
        }
        fail(400, 'key rejected by OpenAI', ['status' => $status, 'detail' => $detail]);
    }

    $f = $ctx['userDir'] . '/openai_key.txt';
    if (@file_put_contents($f, $key, LOCK_EX) === false) {
        fail(500, 'could not store key');
    }
    @chmod($f, 0600);
    respond(200, ['hasKey' => true, 'masked' => maskOpenAiKey($key)]);
}

function handleOpenAiKeyClear(array $ctx): void {
    $f = $ctx['userDir'] . '/openai_key.txt';
    if (file_exists($f)) @unlink($f);
    respond(200, ['hasKey' => false]);
}
