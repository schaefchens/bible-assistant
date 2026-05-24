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

function curlJson(string $url, array $payload, array $extraHeaders = []): array {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 120,
        CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE),
        CURLOPT_HTTPHEADER => array_merge([
            'Content-Type: application/json',
            'Authorization: Bearer ' . OPENAI_API_KEY,
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

function curlBinary(string $url, array $payload): array {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 180,
        CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE),
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'Authorization: Bearer ' . OPENAI_API_KEY,
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

function curlMultipart(string $url, array $fields, string $fileField, string $filePath, string $fileName): array {
    $ch = curl_init($url);
    $fields[$fileField] = new CURLFile($filePath, 'audio/webm', $fileName);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 180,
        CURLOPT_POSTFIELDS => $fields,
        CURLOPT_HTTPHEADER => [
            'Authorization: Bearer ' . OPENAI_API_KEY,
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

$action = $_GET['action'] ?? '';
if (!is_string($action) || $action === '') fail(400, 'missing action');

if (OPENAI_API_KEY === '' && in_array($action, ['chat', 'tts', 'transcribe'], true)) {
    fail(500, 'OPENAI_API_KEY not configured on server');
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$ctx = requireAuth();

switch ($action) {
    case 'chat':
        handleChat();
        break;
    case 'tts':
        handleTts();
        break;
    case 'tts.speak':
        handleTtsSpeak();
        break;
    case 'bible.chapter':
        handleBibleChapter();
        break;
    case 'transcribe':
        handleTranscribe();
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

function handleChat(): void {
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
    $resp = curlRawJson('https://api.openai.com/v1/chat/completions', $payload);
    if (($resp['_status'] ?? 0) !== 200) {
        fail(502, 'openai chat failed', ['status' => $resp['_status'] ?? 0, 'detail' => $resp['_error'] ?? ($resp['error']['message'] ?? '')]);
    }
    $choice = $resp['choices'][0] ?? null;
    if (!$choice) fail(502, 'no choice returned');
    respond(200, [
        'message' => $choice['message'],
        'finish_reason' => $choice['finish_reason'] ?? null,
    ]);
}

function curlRawJson(string $url, string $payload): array {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 120,
        CURLOPT_POSTFIELDS => $payload,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'Authorization: Bearer ' . OPENAI_API_KEY,
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
    static $germanTranslations = ['S00' => 1, 'LUT' => 1, 'HFA' => 1];
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

function handleTts(): void {
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

    $cached = file_exists($audioFile) && file_exists($alignmentFile);
    if (!$cached) {
        $ttsPayload = [
            'model' => TTS_MODEL,
            'voice' => $voice,
            'input' => $text,
            'response_format' => 'mp3',
            'instructions' => composeTtsInstructions($translation, $voiceStyle),
        ];
        $tts = curlBinary('https://api.openai.com/v1/audio/speech', $ttsPayload);
        if (($tts['_status'] ?? 0) !== 200 || empty($tts['audio'])) {
            fail(502, 'tts failed', ['detail' => $tts['_error'] ?? '']);
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
        );
        if (($align['_status'] ?? 0) !== 200) {
            // We still have the audio; write empty alignment so client falls back gracefully.
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
        'audioUrl' => BASE_PATH . AUDIO_BASE_URL . "/{$voice}/{$translation}/{$bookId}/{$chapter}/{$verse}.mp3",
        'alignmentUrl' => BASE_PATH . AUDIO_BASE_URL . "/{$voice}/{$translation}/{$bookId}/{$chapter}/{$verse}.json",
        'cached' => $cached,
    ]);
}

/**
 * Free-form TTS for assistant chat replies (no bible coords). Cached by a
 * sha-256 hash of voice+style+text so identical lines reuse audio.
 */
function handleTtsSpeak(): void {
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
        $tts = curlBinary('https://api.openai.com/v1/audio/speech', $ttsPayload);
        if (($tts['_status'] ?? 0) !== 200 || empty($tts['audio'])) {
            fail(502, 'tts failed', ['detail' => $tts['_error'] ?? '']);
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
 * Fetch a Bible chapter from bolls.life with persistent server-side cache.
 * Stored alongside the audio in storage/bible/{translation}/{bookId}/{chapter}.json
 * so repeat reads don't hit bolls.life again.
 */
function handleBibleChapter(): void {
    $body = readJsonBody();
    $translation = safeSlug(safeString($body['translation'] ?? '', 16));
    $bookId = safeInt($body['bookId'] ?? null);
    $chapter = safeInt($body['chapter'] ?? null);
    if (!$translation || $bookId <= 0 || $chapter <= 0) {
        fail(400, 'missing bible.chapter params');
    }

    $dir = STORAGE_DIR . "/bible/{$translation}/{$bookId}";
    @mkdir($dir, 0775, true);
    $file = "{$dir}/{$chapter}.json";

    $cached = file_exists($file);
    if ($cached) {
        $raw = file_get_contents($file);
        if ($raw !== false && $raw !== '') {
            $verses = json_decode($raw, true);
            if (is_array($verses)) {
                respond(200, ['verses' => $verses, 'cached' => true]);
                return;
            }
        }
    }

    $url = "https://bolls.life/get-text/{$translation}/{$bookId}/{$chapter}/";
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 30,
        CURLOPT_HTTPHEADER => ['Accept: application/json'],
    ]);
    $payload = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($payload === false || $status !== 200) {
        fail(502, 'bolls.life fetch failed', ['status' => $status]);
    }
    $verses = json_decode($payload, true);
    if (!is_array($verses)) {
        fail(502, 'bolls.life returned invalid JSON');
    }
    file_put_contents($file, $payload);
    respond(200, ['verses' => $verses, 'cached' => false]);
}

function handleTranscribe(): void {
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
    );
    if (($resp['_status'] ?? 0) !== 200) {
        fail(502, 'transcribe failed', ['detail' => $resp['_error'] ?? '']);
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
            'model' => TRANSCRIBE_MODEL,
            'response_format' => 'verbose_json',
            'timestamp_granularities[]' => 'word',
        ],
        'file',
        $dest,
        "{$verse}.mp3",
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
