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
 *   readingLists.list (GET)  Per-user reading list array.
 *   readingLists.upsert      { readingList }
 *   readingLists.delete      { id }
 *   readingProgress.list (GET) Per-user progress array, one row per list.
 *   readingProgress.set      { progress } — completed[] merges by union.
 *   recording.upload      multipart: audio + bookId, chapter, verse, translation
 *   account.delete        Erase everything stored for this identity.
 *   ambient.list (GET)    List ambient music tracks under storage/ambient/.
 *
 * Auth: X-User-Id (UUID) + X-User-Secret (hex). The first *write* registers the
 * identity — see authenticate() / requireUserDir(). Reads and the OpenAI proxy
 * work without an account existing at all, so a client that never opts into
 * server sync leaves nothing here.
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
 * code -> {userId, spaceId}. The only way to name somebody else's space.
 *
 * Denied to HTTP below: these files map codes to the accounts that own them,
 * so serving or listing them would hand out every space on the server. That is
 * about not leaking the *directory*, not about the codes being secrets.
 */
const SHARES_DIR = STORAGE_DIR . '/shares';
/** Content-addressed profile pictures. Served statically, unlike everything
 * else a user owns — see the note where the directory is created. */
const AVATARS_DIR = STORAGE_DIR . '/avatars';

/*
 * Caps on community data.
 *
 * These are the first user-authored content this server holds that another
 * user can read, and there is no rate limiting anywhere, so every collection
 * gets a ceiling. They are generous for real use and small enough that a
 * whole-file rewrite stays cheap: MAX_POST_BYTES x MAX_POSTS_PER_SPACE is the
 * worst-case size of one posts/{spaceId}.json.
 */
const MAX_POST_BYTES = 8000;
const MAX_POSTS_PER_SPACE = 200;
const MAX_SPACES_PER_USER = 20;
const MAX_MEMBERS_PER_SPACE = 500;
const MAX_SUBSCRIPTIONS_PER_USER = 200;
const MAX_FEED_POSTS = 50;
const MAX_AVATAR_BYTES = 512 * 1024;

/**
 * URL prefix under which the SPA + this api.php are served.
 * Production: '' — the app sits at the root of its own subdomain. Resolution order:
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
@mkdir(SHARES_DIR, 0775, true);
@mkdir(AVATARS_DIR, 0775, true);

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

// Same treatment for shares/ — these files map codes to the userId that owns
// them, so listing or fetching them over HTTP would enumerate every space on
// the server. PHP keeps reading via the filesystem.
$sharesHtaccessPath = SHARES_DIR . '/.htaccess';
if (!file_exists($sharesHtaccessPath)) {
    @file_put_contents(
        $sharesHtaccessPath,
        "Require all denied\n" .
        "<IfModule !mod_authz_core.c>\n" .
        "  Order deny,allow\n" .
        "  Deny from all\n" .
        "</IfModule>\n",
    );
}

// avatars/ deliberately gets NO such guard: an <img src> needs a real URL, so
// these are static files like storage/ambient. They are content-addressed by
// sha256, so a URL is unguessable, but it is also permanent and public once
// known — which is the trade a profile picture makes. Nothing else a user owns
// is served this way.

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

/** Optional counterpart to safeString: absent or empty becomes null. */
function optString(mixed $v, int $maxLen = 8000): ?string {
    if ($v === null || $v === '') return null;
    return safeString($v, $maxLen);
}

/**
 * A client-generated id, used verbatim as a path segment.
 *
 * Every id the client mints is crypto.randomUUID(), so requiring that shape is
 * free and makes traversal impossible without a safeSlug() rewrite that would
 * then disagree with the id stored inside the file.
 */
function safeUuid(mixed $v, string $what = 'id'): string {
    $s = safeString($v, 64);
    if (!preg_match('/^[0-9a-fA-F-]{36}$/', $s)) fail(400, "invalid {$what}");
    return $s;
}

/** Read a JSON array file, answering [] for missing, empty or corrupt. */
function readJsonArrayFile(string $path): array {
    if (!file_exists($path)) return [];
    $raw = @file_get_contents($path);
    if (!$raw) return [];
    $items = json_decode($raw, true);
    return is_array($items) ? $items : [];
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

/**
 * Run a prepared cURL handle and always close it. Returns a normalized result:
 *   ['error' => string|null, 'status' => int, 'body' => string, 'contentType' => string]
 * `error` is non-null only on transport failure (curl_exec === false), in which
 * case `status` is 0. The three wrappers below build their options then shape
 * this into their own return contracts.
 */
function curlExec(\CurlHandle $ch): array {
    $body = curl_exec($ch);
    if ($body === false) {
        $err = curl_error($ch);
        curl_close($ch);
        return ['error' => $err, 'status' => 0, 'body' => '', 'contentType' => ''];
    }
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $contentType = (string)curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
    curl_close($ch);
    return ['error' => null, 'status' => $status, 'body' => $body, 'contentType' => $contentType];
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
    $r = curlExec($ch);
    if ($r['error'] !== null) return ['_error' => $r['error'], '_status' => 0];
    $decoded = json_decode($r['body'], true);
    if (!is_array($decoded)) return ['_error' => 'invalid response', '_status' => $r['status'], '_raw' => $r['body']];
    $decoded['_status'] = $r['status'];
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
    $r = curlExec($ch);
    if ($r['error'] !== null) return ['_error' => $r['error'], '_status' => 0];
    if ($r['status'] !== 200) {
        $decoded = json_decode($r['body'], true);
        return ['_error' => is_array($decoded) ? json_encode($decoded) : $r['body'], '_status' => $r['status']];
    }
    return ['_status' => $r['status'], 'audio' => $r['body'], 'contentType' => $r['contentType']];
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
    $r = curlExec($ch);
    if ($r['error'] !== null) return ['_error' => $r['error'], '_status' => 0];
    $decoded = json_decode($r['body'], true);
    if (!is_array($decoded)) return ['_error' => 'invalid response', '_status' => $r['status'], '_raw' => $r['body']];
    $decoded['_status'] = $r['status'];
    return $decoded;
}

// ---------- auth ------------------------------------------------------------

/**
 * The per-request context array (`$ctx`) threaded through every handler:
 *   - userId       string  the authenticated identity (uuid)
 *   - userSecret   string  the secret presented with it
 *   - userDir      string  USERS_DIR/{userId} — may not exist yet
 *   - preferShared bool    added by the router: caller opted into the shared
 *                          OpenAI key for this request (X-Prefer-Shared-Key)
 *   - openaiKey    string  added by the router for OpenAI actions only: the
 *                          resolved key (personal unless preferShared/absent)
 * authenticate() populates the first three; the router adds the rest.
 */

/**
 * Validate the identity headers. Creates nothing.
 *
 * An "account" on this server is just a directory under storage/users/, and it
 * is now brought into existence lazily — by requireUserDir(), from the handful
 * of actions that actually store something. A client that only uses the OpenAI
 * proxy (chat, tts, transcribe) or reads shared content (bible.chapter,
 * ambient.list) leaves no trace here at all. That is what lets the app offer
 * server sync as an opt-in and mean it literally.
 *
 * Auth is "the secret matches, if we have seen this identity before"; a first
 * write claims it (see requireUserDir). That is the same trust model as when
 * this function did the claiming itself — just deferred to the point where
 * there is something to protect. Every read handler below guards with
 * file_exists()/is_readable(), so a missing directory answers empty rather
 * than erroring.
 */
function authenticate(): array {
    $userId = $_SERVER['HTTP_X_USER_ID'] ?? '';
    $userSecret = $_SERVER['HTTP_X_USER_SECRET'] ?? '';
    if (!$userId || !$userSecret) fail(401, 'missing identity headers');
    if (!preg_match('/^[0-9a-f-]{36}$/i', $userId)) fail(401, 'invalid userId');
    if (!preg_match('/^[0-9a-f]{32,}$/i', $userSecret)) fail(401, 'invalid secret');

    $userDir = USERS_DIR . '/' . $userId;

    if (is_dir($userDir)) {
        $stored = @file_get_contents($userDir . '/secret.txt');
        if ($stored === false || trim($stored) !== $userSecret) {
            fail(401, 'auth failed');
        }
    }

    return ['userId' => $userId, 'userSecret' => $userSecret, 'userDir' => $userDir];
}

/**
 * Bring the account into existence, if this is the first thing the user has
 * ever stored. Called from the router for $ACCOUNT_ACTIONS only.
 */
function requireUserDir(array $ctx): void {
    if (is_dir($ctx['userDir'])) return;
    if (!@mkdir($ctx['userDir'], 0775, true)) fail(500, 'could not create user directory');
    // Claims the identity: from here on every request must present this secret.
    file_put_contents($ctx['userDir'] . '/secret.txt', $ctx['userSecret']);
}

// ---------- CORS ------------------------------------------------------------

/**
 * The native builds run in a WebView whose origin is capacitor://localhost
 * (iOS) or https://localhost (Android), so every api.php call is cross-origin.
 * The client sends X-User-Id / X-User-Secret on every request — headers that
 * aren't CORS-safelisted — so all of them are preflighted, GETs included.
 *
 * Auth here is header-only (no cookies, no sessions), so we never send
 * Access-Control-Allow-Credentials and the allow-list can stay tight.
 */
const CORS_ALLOWED_ORIGINS = [
    'capacitor://localhost', // iOS WKWebView   (server.iosScheme)
    'https://localhost',     // Android WebView (server.androidScheme)
    'http://localhost',      // Android if androidScheme is switched to http
];

function corsOriginAllowed(string $origin): bool {
    if (in_array($origin, CORS_ALLOWED_ORIGINS, true)) return true;
    // Vite dev server, including from a phone on the LAN (npm run dev -- --host).
    return (bool) preg_match(
        '#^https?://(localhost|127\.0\.0\.1|\[::1\]|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3})(:\d+)?$#',
        $origin,
    );
}

// ---------- routing ---------------------------------------------------------

// Skip the router when included by a CLI test harness (no HTTP request).
if (PHP_SAPI === 'cli' && !defined('BIBLE_API_RUN_ROUTER')) return;

// Emit CORS headers before anything can fail(), so even 401s and 500s carry
// them — otherwise a cross-origin caller sees an opaque "Failed to fetch"
// instead of the real status.
$corsOrigin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($corsOrigin !== '') {
    // Vary even when the origin is rejected, so no proxy caches one origin's
    // ACAO (or its absence) for another.
    header('Vary: Origin');
    if (corsOriginAllowed($corsOrigin)) {
        header('Access-Control-Allow-Origin: ' . $corsOrigin);
        header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
        header('Access-Control-Allow-Headers: Content-Type, X-User-Id, X-User-Secret, X-Prefer-Shared-Key, X-Base-Path');
        header('Access-Control-Max-Age: 86400');
    }
}

// Answer the preflight before the ?action / requireAuth() gauntlet below —
// OPTIONS carries no custom headers, so it would otherwise 401.
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$action = $_GET['action'] ?? '';
if (!is_string($action) || $action === '') fail(400, 'missing action');

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$ctx = authenticate();

// The actions that store per-user data — and so bring the account into
// existence. Everything else works dir-less: the OpenAI proxy needs no storage,
// bible.chapter and ambient.list serve shared content, and the cards/boards/key
// *readers* all guard with file_exists()/is_readable() and answer empty.
$ACCOUNT_ACTIONS = [
    'cards.upsert', 'cards.delete', 'cards.order.set',
    'boards.upsert', 'boards.delete', 'boards.order.set',
    'readingLists.upsert', 'readingLists.delete', 'readingProgress.set',
    'auth.openaiKey.set', 'recording.upload',
    // Community writers. `space.request` is NOT here: it writes into the
    // *owner's* directory, and the caller's own dir already exists because
    // profile.set is a precondition for asking at all.
    'profile.set', 'profile.avatar.upload',
    'spaces.upsert', 'spaces.delete', 'spaces.code.set',
    'posts.upsert', 'posts.delete',
    'members.decide', 'subscriptions.upsert', 'subscriptions.delete',
];
if (in_array($action, $ACCOUNT_ACTIONS, true)) {
    requireUserDir($ctx);
}

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
    case 'readingLists.list':
        handleListJson($ctx['userDir'] . '/readingLists.json', 'readingLists');
        break;
    case 'readingLists.upsert':
        handleUpsertItem($ctx['userDir'] . '/readingLists.json', 'readingList', 'readingLists');
        break;
    case 'readingLists.delete':
        handleDeleteReadingList($ctx['userDir']);
        break;
    case 'readingProgress.list':
        handleListJson($ctx['userDir'] . '/readingProgress.json', 'progress');
        break;
    case 'readingProgress.set':
        handleUpsertProgress($ctx['userDir'] . '/readingProgress.json');
        break;
    case 'recording.upload':
        handleRecordingUpload($ctx);
        break;
    case 'account.delete':
        handleAccountDelete($ctx);
        break;
    case 'ambient.list':
        handleAmbientList();
        break;

    // Community spaces. The readers answer empty for an account that has never
    // published, like every other reader here, so nothing below requires a
    // directory to exist.
    case 'profile.get':
        handleProfileGet($ctx);
        break;
    case 'profile.set':
        handleProfileSet($ctx);
        break;
    case 'profile.delete':
        handleProfileDelete($ctx);
        break;
    case 'profile.avatar.upload':
        handleAvatarUpload($ctx);
        break;
    case 'spaces.list':
        handleListJson(spacesPath($ctx['userDir']), 'spaces');
        break;
    case 'spaces.upsert':
        handleSpaceUpsert($ctx);
        break;
    case 'spaces.delete':
        handleSpaceDelete($ctx);
        break;
    case 'spaces.code.set':
        handleSpaceCodeSet($ctx);
        break;
    case 'posts.list':
        handlePostsList($ctx);
        break;
    case 'posts.upsert':
        handlePostUpsert($ctx);
        break;
    case 'posts.delete':
        handlePostDelete($ctx);
        break;
    case 'members.list':
        handleMembersList($ctx);
        break;
    case 'members.decide':
        handleMemberDecide($ctx);
        break;
    case 'subscriptions.list':
        handleListJson(subscriptionsPath($ctx['userDir']), 'subscriptions');
        break;
    case 'subscriptions.upsert':
        handleSubscriptionUpsert($ctx);
        break;
    case 'subscriptions.delete':
        handleSubscriptionDelete($ctx);
        break;
    case 'space.request':
        handleSpaceRequest($ctx);
        break;
    case 'space.feed':
        handleSpaceFeed($ctx);
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
    checkOpenAiResponse($ctx, $resp, 'openai chat failed');
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

/** Like curlJson but takes a pre-encoded JSON string (used by handleChat,
 * which encodes with specific flags to preserve empty `{}` objects). */
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
    $r = curlExec($ch);
    if ($r['error'] !== null) return ['_error' => $r['error'], '_status' => 0];
    $decoded = json_decode($r['body'], true);
    if (!is_array($decoded)) return ['_error' => 'invalid response', '_status' => $r['status'], '_raw' => $r['body']];
    $decoded['_status'] = $r['status'];
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

/**
 * Path segment identifying a voiceStyle, or '' for the default.
 *
 * Verse audio used to live at {voice}/{translation}/{book}/{chapter}/{verse}.mp3
 * with the style folded only into the *staleness hash*. Two consequences, both
 * bad: the server regenerated over the same file whenever two callers used
 * different styles, and — worse — the client's mediaCache is keyed by URL, so a
 * style change kept serving the previously cached bytes forever.
 *
 * The empty style deliberately keeps the old path. It is the overwhelming
 * majority of the cache (voiceStyle needs a personal key), and inserting a
 * segment for it would orphan every file already generated.
 */
function voiceStyleSegment(string $voiceStyle): string {
    if ($voiceStyle === '') return '';
    return '/style-' . substr(hash('sha256', $voiceStyle), 0, 16);
}

function cachedAlignmentMatches(string $alignmentFile, string $expectedHash): bool {
    $raw = @file_get_contents($alignmentFile);
    if ($raw === false || $raw === '') return false;
    $decoded = json_decode($raw, true);
    if (!is_array($decoded)) return false;
    return isset($decoded['sourceTextHash']) && $decoded['sourceTextHash'] === $expectedHash;
}

/**
 * If an OpenAI response didn't succeed (status !== 200), surface it via
 * failOpenAi (which tags user_key_failed when the caller's own key was
 * rejected). No-op on success. Centralizes the status check that every
 * OpenAI-proxying handler repeated.
 */
function checkOpenAiResponse(array $ctx, array $resp, string $label): void {
    if ((int)($resp['_status'] ?? 0) !== 200) {
        failOpenAi($ctx, $label, $resp);
    }
}

/**
 * Forced word-level alignment of an existing audio file via the transcription
 * model (verbose_json + word timestamps). Returns the raw response array
 * (with `_status`); the caller decides whether a non-200 is fatal. Shared by
 * the two TTS handlers and the user-recording upload.
 */
function forcedAlignment(string $audioFile, string $fileName, ?string $apiKey): array {
    return curlMultipart(
        'https://api.openai.com/v1/audio/transcriptions',
        [
            'model' => ALIGNMENT_MODEL,
            'response_format' => 'verbose_json',
            'timestamp_granularities[]' => 'word',
        ],
        'file',
        $audioFile,
        $fileName,
        $apiKey,
    );
}

/** Write an alignment JSON file from a successful alignment response, merging
 * any extra fields (e.g. sourceTextHash for the cache-staleness check). */
function writeAlignment(string $path, array $align, array $extra = []): void {
    file_put_contents($path, json_encode(array_merge([
        'words' => $align['words'] ?? [],
        'duration' => $align['duration'] ?? null,
        'text' => $align['text'] ?? null,
    ], $extra), JSON_UNESCAPED_UNICODE));
}

/**
 * Generate audio via OpenAI TTS, persist the mp3, then run forced alignment
 * and persist the alignment JSON. On TTS failure the request fails (via
 * failOpenAi); on alignment failure it degrades gracefully by writing an
 * empty-words alignment so the client still plays the audio. `$alignmentExtra`
 * is merged into the alignment JSON in both the success and empty-fallback
 * cases (handleTts uses it to stamp sourceTextHash). Shared by handleTts and
 * handleTtsSpeak.
 */
function synthesizeAndCacheAudio(
    array $ctx,
    string $text,
    string $voice,
    string $instructions,
    string $audioFile,
    string $alignmentFile,
    array $alignmentExtra = [],
): void {
    $payload = [
        'model' => TTS_MODEL,
        'voice' => $voice,
        'input' => $text,
        'response_format' => 'mp3',
    ];
    if ($instructions !== '') {
        $payload['instructions'] = $instructions;
    }
    $tts = curlBinary('https://api.openai.com/v1/audio/speech', $payload, $ctx['openaiKey']);
    if ((int)($tts['_status'] ?? 0) !== 200 || empty($tts['audio'])) {
        failOpenAi($ctx, 'tts failed', $tts);
    }
    if (file_put_contents($audioFile, $tts['audio']) === false) {
        fail(500, 'could not write audio file');
    }
    $align = forcedAlignment($audioFile, basename($audioFile), $ctx['openaiKey']);
    if ((int)($align['_status'] ?? 0) !== 200) {
        // Keep the audio; write an empty alignment so the client falls back gracefully.
        file_put_contents($alignmentFile, json_encode(array_merge(['words' => []], $alignmentExtra)));
    } else {
        writeAlignment($alignmentFile, $align, $alignmentExtra);
    }
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

    // One expression behind both the file path and the URL below, so they can't
    // drift. NB sha256ForCache() keeps taking $voiceStyle even though the style
    // is now in the path: changing its inputs would mark every existing file
    // stale and regenerate the entire cache at OpenAI's prices.
    $rel = "/{$voice}" . voiceStyleSegment($voiceStyle) . "/{$translation}/{$bookId}/{$chapter}";
    $dir = AUDIO_DIR . $rel;
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
        // Forced alignment stamps sourceTextHash so a future text change
        // (e.g. footnote cleanup) marks the cached mp3 stale — see above.
        synthesizeAndCacheAudio(
            $ctx,
            $text,
            $voice,
            composeTtsInstructions($translation, $voiceStyle),
            $audioFile,
            $alignmentFile,
            ['sourceTextHash' => $expectedHash],
        );
    }

    respond(200, [
        'audioUrl' => BASE_PATH . AUDIO_BASE_URL . "{$rel}/{$verse}.mp3",
        'alignmentUrl' => BASE_PATH . AUDIO_BASE_URL . "{$rel}/{$verse}.json",
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
        synthesizeAndCacheAudio(
            $ctx,
            $text,
            $voice,
            composeSpeakInstructions($language, $voiceStyle),
            $audioFile,
            $alignmentFile,
        );
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
    checkOpenAiResponse($ctx, $resp, 'transcribe failed');
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

/**
 * Delete a reading list *and* its progress, which has no meaning without it.
 * The two live in separate files for the same reason they are separate tables
 * on the client: progress is written far more often and merges differently.
 */
function handleDeleteReadingList(string $userDir): void {
    $body = readJsonBody();
    $id = $body['id'] ?? null;
    if (!is_string($id) || $id === '') fail(400, 'id required');

    $listPath = $userDir . '/readingLists.json';
    $lists = file_exists($listPath) ? json_decode(@file_get_contents($listPath) ?: '[]', true) : [];
    if (!is_array($lists)) $lists = [];
    $lists = array_values(array_filter($lists, fn($it) => ($it['id'] ?? null) !== $id));
    writeJsonFile($listPath, $lists);

    $progressPath = $userDir . '/readingProgress.json';
    if (file_exists($progressPath)) {
        $rows = json_decode(@file_get_contents($progressPath) ?: '[]', true);
        if (!is_array($rows)) $rows = [];
        $rows = array_values(array_filter($rows, fn($it) => ($it['listId'] ?? null) !== $id));
        writeJsonFile($progressPath, $rows);
    }

    respond(200, ['readingLists' => $lists]);
}

/**
 * Store one list's progress, merging rather than replacing.
 *
 * `completed` is unioned with whatever is already here and `currentEntryId`
 * follows the newer `updatedAt` — the same rule as the client's
 * mergeReadingProgress, and it has to exist on both sides: a device that ticks
 * an entry without having pulled first would otherwise erase another device's
 * ticks the moment it pushed.
 */
function handleUpsertProgress(string $path): void {
    $body = readJsonBody();
    $incoming = $body['progress'] ?? null;
    if (!is_array($incoming) || empty($incoming['listId']) || !is_string($incoming['listId'])) {
        fail(400, 'progress with listId required');
    }
    $listId = $incoming['listId'];
    $completed = isset($incoming['completed']) && is_array($incoming['completed'])
        ? array_values(array_filter($incoming['completed'], 'is_string'))
        : [];
    $updatedAt = isset($incoming['updatedAt']) && is_numeric($incoming['updatedAt'])
        ? (int)$incoming['updatedAt']
        : 0;
    $currentEntryId = isset($incoming['currentEntryId']) && is_string($incoming['currentEntryId'])
        ? $incoming['currentEntryId']
        : null;

    $rows = file_exists($path) ? json_decode(@file_get_contents($path) ?: '[]', true) : [];
    if (!is_array($rows)) $rows = [];

    $merged = [
        'listId' => $listId,
        'completed' => $completed,
        'updatedAt' => $updatedAt,
    ];
    if ($currentEntryId !== null) $merged['currentEntryId'] = $currentEntryId;

    $found = false;
    foreach ($rows as $i => $existing) {
        if (($existing['listId'] ?? null) !== $listId) continue;
        $found = true;
        $existingCompleted = isset($existing['completed']) && is_array($existing['completed'])
            ? array_values(array_filter($existing['completed'], 'is_string'))
            : [];
        $existingUpdatedAt = isset($existing['updatedAt']) && is_numeric($existing['updatedAt'])
            ? (int)$existing['updatedAt']
            : 0;
        $merged['completed'] = array_values(array_unique(array_merge($existingCompleted, $completed)));
        $merged['updatedAt'] = max($existingUpdatedAt, $updatedAt);
        // Only the newer write gets to say where the reader is.
        if ($existingUpdatedAt > $updatedAt) {
            if (isset($existing['currentEntryId']) && is_string($existing['currentEntryId'])) {
                $merged['currentEntryId'] = $existing['currentEntryId'];
            } else {
                unset($merged['currentEntryId']);
            }
        }
        $rows[$i] = $merged;
        break;
    }
    if (!$found) $rows[] = $merged;

    writeJsonFile($path, $rows);
    respond(200, ['progress' => $merged]);
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

    // Word alignment from the real recording. Non-fatal: the recording is
    // already saved, so an alignment failure (incl. a rejected key) just skips
    // the alignment file rather than failing the upload.
    $align = forcedAlignment($dest, "{$verse}.mp3", $ctx['openaiKey'] ?? null);
    $alignmentPath = "{$dir}/{$verse}.json";
    if ((int)($align['_status'] ?? 0) === 200) {
        writeAlignment($alignmentPath, $align);
    }

    respond(200, [
        'audioUrl' => BASE_PATH . "/storage/audio/recordings/{$userId}/{$translation}/{$bookId}/{$chapter}/{$verse}.mp3",
        'alignmentUrl' => BASE_PATH . "/storage/audio/recordings/{$userId}/{$translation}/{$bookId}/{$chapter}/{$verse}.json",
    ]);
}

/**
 * Recursively delete a directory, refusing anything that isn't inside
 * STORAGE_DIR.
 *
 * The containment check is belt-and-braces — every caller passes a path built
 * from a uuid authenticate() has already regex-validated — but a recursive
 * unlink in a web root earns the paranoia. is_link() is tested before is_dir()
 * because is_dir() follows symlinks, and following one out of storage/ is the
 * one way this could do real damage.
 */
function deleteTree(string $dir): void {
    // Resolve for the containment check, but fall back to the literal path when
    // realpath() can't resolve one — open_basedir, or a storage/ symlinked
    // outside it, makes realpath() return false, and bailing there means the
    // delete silently does nothing. Falling back is safe: every caller builds
    // the path from a uuid authenticate() has already pinned to [0-9a-f-]{36},
    // so it cannot escape regardless. The prefix test is belt-and-braces.
    $root = realpath(STORAGE_DIR) ?: STORAGE_DIR;
    $real = realpath($dir) ?: $dir;
    if ($real === $root) return;
    if (strncmp($real, $root . '/', strlen($root) + 1) !== 0) return;
    if (!is_dir($real)) return;

    foreach (scandir($real) ?: [] as $name) {
        if ($name === '.' || $name === '..') continue;
        $path = $real . '/' . $name;
        if (is_link($path) || is_file($path)) {
            @unlink($path);
        } elseif (is_dir($path)) {
            deleteTree($path);
        }
    }
    @rmdir($real);
}

/**
 * Delete everything this server holds for the caller: cards, boards, their
 * orders, the personal OpenAI key, any uploaded recordings, and finally the
 * secret that claimed the identity.
 *
 * The counterpart to sync being opt-in — switching it back off has to be able
 * to leave nothing behind. Idempotent: deleting an account that was never
 * created is a success, not a 404.
 *
 * What this deliberately does NOT touch is storage/audio/{voice}/… — the verse
 * narration cache is keyed by (voice, translation, reference) and shared by
 * every user. It holds nothing personal, and clearing it would throw away
 * generation other people already paid for. Avatars are left for the same
 * reason: content-addressed and possibly shared with another user.
 *
 * Nor does it touch the client's own copy of the user's writing. Deleting the
 * server account removes what was shared, not what was written — see
 * LocalPost.shared in src/db/dexie.ts.
 */
function handleAccountDelete(array $ctx): void {
    // Share codes live outside the user directory, so the tree delete below
    // would leave them resolving to a userId with no data behind it. Retire
    // them first — that is also what revokes every subscriber.
    foreach (readJsonArrayFile(spacesPath($ctx['userDir'])) as $space) {
        $code = is_array($space) ? ($space['shareCode'] ?? null) : null;
        if (is_string($code) && preg_match('/^[0-9A-HJKMNP-TV-Z]{16}$/', $code)) {
            @unlink(sharePath($code));
        }
    }

    deleteTree($ctx['userDir']);
    deleteTree(AUDIO_DIR . '/recordings/' . $ctx['userId']);

    // Answer from the filesystem, not from the attempt. This is the one endpoint
    // whose whole value is the promise it keeps, so reporting a success that
    // didn't happen is worse than reporting the failure — and `remaining` makes
    // the failure diagnosable instead of opaque. Those names are the caller's
    // own data, and a fixed known set.
    if (is_dir($ctx['userDir'])) {
        $left = @scandir($ctx['userDir']);
        fail(500, 'could not delete account data', [
            'remaining' => $left === false
                ? ['<unreadable>']
                : array_values(array_diff($left, ['.', '..'])),
        ]);
    }
    respond(200, ['deleted' => true]);
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

// ---------- community spaces ------------------------------------------------
//
// The first cross-user surface in this file. Two rules hold it together:
//
//  1. **A share code is the only way to name a space.** No action takes a
//     target userId — the caller supplies a code, and SHARES_DIR resolves it.
//     That keeps uuids (which are valid X-User-Id values) out of the API.
//     A code is an *address*, not a key: it lets a caller ask to read, and
//     `space.feed` still answers only a member the owner accepted. The one
//     exception is a space set to auto-approval, where the owner has said the
//     code is enough.
//  2. **Nothing user-authored is echoed verbatim to another user.** Every
//     record that crosses between accounts goes through a sanitize* function
//     that whitelists fields, so one person cannot inject arbitrary JSON into
//     somebody else's client. For posts that whitelist is also enforced by the
//     signature: the client signs exactly the fields kept here, so dropping or
//     mangling one is detected rather than silently accepted.
//
// What this cannot do is prove the *content* is genuine — that is the client's
// signature check (src/lib/postSignature.ts). PHP holds no private key, so it
// stores signatures and never mints them.

function profilePath(string $userDir): string { return $userDir . '/profile.json'; }
function spacesPath(string $userDir): string { return $userDir . '/spaces.json'; }
function membersPath(string $userDir): string { return $userDir . '/members.json'; }
function subscriptionsPath(string $userDir): string { return $userDir . '/subscriptions.json'; }
function spacePostsPath(string $userDir, string $spaceId): string {
    return $userDir . '/posts/' . $spaceId . '.json';
}

/** Read a single JSON object file (the profile), or null. */
function readJsonObjectFile(string $path): ?array {
    if (!file_exists($path)) return null;
    $raw = @file_get_contents($path);
    if (!$raw) return null;
    $obj = json_decode($raw, true);
    return is_array($obj) ? $obj : null;
}

function sanitizeProfile(array $p): array {
    $key = safeString($p['authorKey'] ?? '', 128);
    if (!preg_match('/^[0-9a-f]{64}$/i', $key)) fail(400, 'invalid authorKey');
    return [
        'displayName' => safeString($p['displayName'] ?? '', 120),
        'bio' => optString($p['bio'] ?? null, 500),
        'avatarUrl' => optString($p['avatarUrl'] ?? null, 500),
        'authorKey' => strtolower($key),
        'updatedAt' => safeInt($p['updatedAt'] ?? 0),
    ];
}

function sanitizeSpace(array $sp): array {
    $kind = ($sp['kind'] ?? '') === 'today' ? 'today' : 'custom';
    $approval = ($sp['approval'] ?? '') === 'auto' ? 'auto' : 'manual';
    $hours = isset($sp['ephemeralHours']) && is_numeric($sp['ephemeralHours'])
        ? max(0, (int)$sp['ephemeralHours'])
        : null;
    return [
        'id' => safeUuid($sp['id'] ?? '', 'space id'),
        'name' => safeString($sp['name'] ?? '', 120),
        'emoji' => optString($sp['emoji'] ?? null, 16),
        'description' => optString($sp['description'] ?? null, 500),
        'kind' => $kind,
        'ephemeralHours' => $hours,
        'approval' => $approval,
        'shareCode' => optString($sp['shareCode'] ?? null, 32),
        'createdAt' => safeInt($sp['createdAt'] ?? 0),
        'updatedAt' => safeInt($sp['updatedAt'] ?? 0),
    ];
}

/**
 * Whitelist a post.
 *
 * Every field here except `createdAt` is covered by the client's signature, so
 * this function is not merely defensive — getting it wrong would make honest
 * posts fail verification on the reader's device.
 */
function sanitizePost(array $po): array {
    $lang = ($po['language'] ?? '') === 'de' ? 'de' : 'en';
    $sig = optString($po['signature'] ?? null, 256);
    $key = optString($po['authorKey'] ?? null, 128);
    if ($sig !== null && !preg_match('/^[0-9a-f]{128}$/i', $sig)) fail(400, 'invalid signature');
    if ($key !== null && !preg_match('/^[0-9a-f]{64}$/i', $key)) fail(400, 'invalid authorKey');
    return [
        'id' => safeUuid($po['id'] ?? '', 'post id'),
        'spaceId' => safeUuid($po['spaceId'] ?? '', 'space id'),
        'title' => safeString($po['title'] ?? '', 200),
        'body' => safeString($po['body'] ?? '', MAX_POST_BYTES),
        'language' => $lang,
        'publishedAt' => safeInt($po['publishedAt'] ?? 0),
        'createdAt' => safeInt($po['createdAt'] ?? 0),
        'updatedAt' => safeInt($po['updatedAt'] ?? 0),
        'signature' => $sig === null ? null : strtolower($sig),
        'authorKey' => $key === null ? null : strtolower($key),
        'sigVersion' => optString($po['sigVersion'] ?? null, 32),
    ];
}

function sanitizeSubscription(array $su): array {
    $status = in_array($su['status'] ?? '', ['pending', 'accepted', 'revoked'], true)
        ? $su['status'] : 'pending';
    return [
        'code' => normalizeShareCode($su['code'] ?? ''),
        'spaceName' => safeString($su['spaceName'] ?? '', 120),
        'spaceEmoji' => optString($su['spaceEmoji'] ?? null, 16),
        'ownerName' => safeString($su['ownerName'] ?? '', 120),
        'ownerAvatarUrl' => optString($su['ownerAvatarUrl'] ?? null, 500),
        'status' => $status,
        'pinnedKey' => safeString($su['pinnedKey'] ?? '', 128),
        'keyPinnedAt' => safeInt($su['keyPinnedAt'] ?? 0),
        'addedAt' => safeInt($su['addedAt'] ?? 0),
        'updatedAt' => safeInt($su['updatedAt'] ?? 0),
    ];
}

/**
 * Crockford base32, 16 characters — see src/lib/spaceCode.ts, which mints them.
 * The alphabet excludes I, L, O and U, so this also rejects anything that could
 * be a path segment surprise.
 *
 * **Widen this together with `normalizeSpaceCode` on the client** if named
 * codes are added: the result becomes a filename under SHARES_DIR, so whatever
 * shape is allowed here has to stay traversal-proof.
 */
function normalizeShareCode(mixed $v): string {
    $code = strtoupper(safeString($v, 32));
    if (!preg_match('/^[0-9A-HJKMNP-TV-Z]{16}$/', $code)) fail(400, 'invalid share code');
    return $code;
}

function sharePath(string $code): string { return SHARES_DIR . '/' . $code . '.json'; }

/** Resolve a share code to its owner and space, or fail 404. */
function resolveShareCode(string $code): array {
    $rec = readJsonObjectFile(sharePath($code));
    $userId = is_array($rec) ? (string)($rec['userId'] ?? '') : '';
    $spaceId = is_array($rec) ? (string)($rec['spaceId'] ?? '') : '';
    // Re-validate on the way out: these were written by an earlier request and
    // are about to become a filesystem path.
    if (!preg_match('/^[0-9a-f-]{36}$/i', $userId) || !preg_match('/^[0-9a-fA-F-]{36}$/', $spaceId)) {
        fail(404, 'unknown share code');
    }
    $userDir = USERS_DIR . '/' . $userId;
    if (!is_dir($userDir)) fail(404, 'unknown share code');
    return ['userId' => $userId, 'spaceId' => $spaceId, 'userDir' => $userDir];
}

function findById(array $items, string $id): ?array {
    foreach ($items as $it) {
        if (is_array($it) && ($it['id'] ?? null) === $id) return $it;
    }
    return null;
}

/**
 * Drop items older than the space's window.
 *
 * Called on every read *and* every write of an ephemeral space, so "Today"
 * cannot accumulate and a subscriber cannot be served yesterday's items even
 * if the author has not opened the app since. The client filters by timestamp
 * as well, which is what stops a stale local cache showing an expired item.
 */
function pruneExpired(array $posts, ?int $hours): array {
    if (!$hours || $hours <= 0) return $posts;
    $cutoff = (time() - $hours * 3600) * 1000;
    return array_values(array_filter(
        $posts,
        fn($p) => is_array($p) && (int)($p['publishedAt'] ?? 0) >= $cutoff,
    ));
}

/**
 * Cheap sanity check that a post is signed by the key it claims.
 *
 * Defence in depth only: it rejects malformed or truncated writes, and proves
 * nothing whatever about identity — the server cannot know which key belongs to
 * whom, which is exactly why the client pins one per space. Guarded on the
 * sodium extension so a host without it still works; the client verifies
 * regardless and is the authority.
 */
function verifyPostSignature(array $post): bool {
    // The *shape* is required either way: a published post with no signature is
    // one no reader could ever accept, so storing it would only waste a round
    // trip and confuse the author about what their subscribers can see.
    if (!$post['signature'] || !$post['authorKey'] || $post['sigVersion'] !== 'ba.post.v1') return false;
    if (!function_exists('sodium_crypto_sign_verify_detached')) return true;
    $message = implode("\n", [
        'ba.post.v1',
        strtolower((string)$post['authorKey']),
        (string)$post['spaceId'],
        (string)$post['id'],
        (string)(int)$post['publishedAt'],
        (string)(int)$post['updatedAt'],
        (string)$post['language'],
        hash('sha256', (string)$post['title']),
        hash('sha256', (string)$post['body']),
    ]);
    try {
        return sodium_crypto_sign_verify_detached(
            hex2bin((string)$post['signature']),
            $message,
            hex2bin((string)$post['authorKey']),
        );
    } catch (\Throwable) {
        return false;
    }
}

/**
 * A space is only shareable once its owner has a published profile with a
 * signing key.
 *
 * Without one there is nothing for a subscriber to pin, so every post from the
 * space would fail verification and be refused — the subscription would look
 * fine and show nothing, forever. Better to refuse here, where the reason can
 * be reported. Reachable in practice: a client that pushed its spaces but not
 * its profile, e.g. after being pointed at a different server.
 */
function requireOwnerPublished(string $userDir): void {
    $profile = readJsonObjectFile(profilePath($userDir));
    $key = is_array($profile) ? (string)($profile['authorKey'] ?? '') : '';
    if (!preg_match('/^[0-9a-f]{64}$/i', $key)) {
        fail(409, 'space_not_ready');
    }
}

/** The subset of a profile another user may see. */
function publicProfileOf(string $userDir): array {
    $p = readJsonObjectFile(profilePath($userDir)) ?? [];
    return [
        'displayName' => (string)($p['displayName'] ?? ''),
        'bio' => isset($p['bio']) ? (string)$p['bio'] : null,
        'avatarUrl' => isset($p['avatarUrl']) ? (string)$p['avatarUrl'] : null,
        'authorKey' => strtolower((string)($p['authorKey'] ?? '')),
    ];
}

/** The subset of a space another user may see. */
function publicSpaceOf(array $space): array {
    return [
        'id' => (string)$space['id'],
        'name' => (string)($space['name'] ?? ''),
        'emoji' => $space['emoji'] ?? null,
        'description' => $space['description'] ?? null,
        // `kind` and `ephemeralHours` are the subscriber's business: they say
        // this is the author's ephemeral "Today" space, which is what lets a
        // reader ask for today's pieces across everyone they follow — and lets
        // the client localize the built-in name instead of showing the stored
        // literal 'Today' to a German reader.
        'kind' => ($space['kind'] ?? '') === 'today' ? 'today' : 'custom',
        'ephemeralHours' => $space['ephemeralHours'] ?? null,
    ];
}

// ---------- community: the owner's own data ---------------------------------

function handleProfileGet(array $ctx): void {
    respond(200, ['profile' => readJsonObjectFile(profilePath($ctx['userDir']))]);
}

function handleProfileSet(array $ctx): void {
    $body = readJsonBody();
    if (!is_array($body['profile'] ?? null)) fail(400, 'profile required');
    $profile = sanitizeProfile($body['profile']);
    writeJsonFile(profilePath($ctx['userDir']), $profile);
    respond(200, ['profile' => $profile]);
}

/**
 * Leaving the community: drop the profile, the spaces, every post and every
 * share code, but leave the account itself (cards, lists, the identity) alone.
 *
 * The client keeps its local copies — see LocalPost.shared in db/dexie.ts —
 * so this removes the shared copy, not the writing.
 */
function handleProfileDelete(array $ctx): void {
    foreach (readJsonArrayFile(spacesPath($ctx['userDir'])) as $space) {
        $code = is_array($space) ? ($space['shareCode'] ?? null) : null;
        if (is_string($code) && preg_match('/^[0-9A-HJKMNP-TV-Z]{16}$/', $code)) {
            @unlink(sharePath($code));
        }
    }
    deleteTree($ctx['userDir'] . '/posts');
    foreach ([profilePath($ctx['userDir']), spacesPath($ctx['userDir']), membersPath($ctx['userDir'])] as $f) {
        if (file_exists($f)) @unlink($f);
    }
    respond(200, ['deleted' => true]);
}

function handleSpaceUpsert(array $ctx): void {
    $body = readJsonBody();
    if (!is_array($body['space'] ?? null)) fail(400, 'space required');
    $space = sanitizeSpace($body['space']);
    $path = spacesPath($ctx['userDir']);
    $spaces = readJsonArrayFile($path);

    $found = false;
    foreach ($spaces as $i => $existing) {
        if (is_array($existing) && ($existing['id'] ?? null) === $space['id']) {
            // shareCode is owned by spaces.code.set, never by a plain upsert —
            // otherwise a stale client could resurrect a revoked code.
            $space['shareCode'] = $existing['shareCode'] ?? null;
            $spaces[$i] = $space;
            $found = true;
            break;
        }
    }
    if (!$found) {
        if (count($spaces) >= MAX_SPACES_PER_USER) fail(409, 'too many spaces');
        $space['shareCode'] = null;
        $spaces[] = $space;
    }

    writeJsonFile($path, $spaces);
    respond(200, ['spaces' => $spaces]);
}

function handleSpaceDelete(array $ctx): void {
    $body = readJsonBody();
    $id = safeUuid($body['id'] ?? '', 'space id');
    $path = spacesPath($ctx['userDir']);
    $spaces = readJsonArrayFile($path);

    $gone = findById($spaces, $id);
    $code = is_array($gone) ? ($gone['shareCode'] ?? null) : null;
    if (is_string($code) && preg_match('/^[0-9A-HJKMNP-TV-Z]{16}$/', $code)) {
        @unlink(sharePath($code));
    }

    $spaces = array_values(array_filter(
        $spaces,
        fn($sp) => is_array($sp) && ($sp['id'] ?? null) !== $id,
    ));
    writeJsonFile($path, $spaces);

    // The posts and the subscriber list have no meaning without the space.
    $postsFile = spacePostsPath($ctx['userDir'], $id);
    if (file_exists($postsFile)) @unlink($postsFile);
    $members = array_values(array_filter(
        readJsonArrayFile(membersPath($ctx['userDir'])),
        fn($m) => is_array($m) && ($m['spaceId'] ?? null) !== $id,
    ));
    writeJsonFile(membersPath($ctx['userDir']), $members);

    respond(200, ['spaces' => $spaces]);
}

/**
 * Point a share code at one of the caller's spaces, replacing any previous one.
 *
 * The code is minted client-side because a generated one commits to the
 * author's public key (src/lib/spaceCode.ts) — the server has no key material
 * and could not produce one. All this does is publish the mapping and retire
 * the old one.
 *
 * Retiring a code drops that space's memberships, so replacing it is how an
 * owner starts over on who may read. Not because the old code was a key, but
 * because a membership is a decision about a particular invitation.
 */
function handleSpaceCodeSet(array $ctx): void {
    $body = readJsonBody();
    $spaceId = safeUuid($body['spaceId'] ?? '', 'space id');
    $code = normalizeShareCode($body['code'] ?? '');

    $path = spacesPath($ctx['userDir']);
    $spaces = readJsonArrayFile($path);
    $target = findById($spaces, $spaceId);
    if ($target === null) fail(404, 'unknown space');

    // A collision would silently hand somebody else's subscribers to this
    // space. 50 bits makes it vanishingly unlikely; the client retries.
    $existing = readJsonObjectFile(sharePath($code));
    if (is_array($existing) && (string)($existing['userId'] ?? '') !== $ctx['userId']) {
        fail(409, 'code already in use');
    }

    $previous = $target['shareCode'] ?? null;
    if (is_string($previous) && $previous !== $code
        && preg_match('/^[0-9A-HJKMNP-TV-Z]{16}$/', $previous)) {
        @unlink(sharePath($previous));
    }

    writeJsonFile(sharePath($code), [
        'userId' => $ctx['userId'],
        'spaceId' => $spaceId,
        'createdAt' => (int)(microtime(true) * 1000),
    ]);

    foreach ($spaces as $i => $sp) {
        if (is_array($sp) && ($sp['id'] ?? null) === $spaceId) {
            $spaces[$i]['shareCode'] = $code;
            break;
        }
    }
    writeJsonFile($path, $spaces);

    // Rotating a code revokes access, so the old subscriber list is stale.
    if (is_string($previous) && $previous !== $code) {
        $members = array_values(array_filter(
            readJsonArrayFile(membersPath($ctx['userDir'])),
            fn($m) => is_array($m) && ($m['spaceId'] ?? null) !== $spaceId,
        ));
        writeJsonFile(membersPath($ctx['userDir']), $members);
    }

    respond(200, ['spaces' => $spaces]);
}

function handlePostsList(array $ctx): void {
    $body = readJsonBody();
    $spaceId = safeUuid($body['spaceId'] ?? '', 'space id');
    $space = findById(readJsonArrayFile(spacesPath($ctx['userDir'])), $spaceId);
    $path = spacePostsPath($ctx['userDir'], $spaceId);
    $posts = readJsonArrayFile($path);

    $pruned = pruneExpired($posts, is_array($space) ? ($space['ephemeralHours'] ?? null) : null);
    if (count($pruned) !== count($posts)) writeJsonFile($path, $pruned);

    respond(200, ['posts' => $pruned]);
}

function handlePostUpsert(array $ctx): void {
    $body = readJsonBody();
    if (!is_array($body['post'] ?? null)) fail(400, 'post required');
    $post = sanitizePost($body['post']);
    if ($post['publishedAt'] <= 0) fail(400, 'cannot publish a draft');
    if (!verifyPostSignature($post)) fail(400, 'post signature does not verify');

    $space = findById(readJsonArrayFile(spacesPath($ctx['userDir'])), $post['spaceId']);
    if ($space === null) fail(404, 'unknown space');

    $path = spacePostsPath($ctx['userDir'], $post['spaceId']);
    $posts = pruneExpired(readJsonArrayFile($path), $space['ephemeralHours'] ?? null);

    $found = false;
    foreach ($posts as $i => $existing) {
        if (is_array($existing) && ($existing['id'] ?? null) === $post['id']) {
            $posts[$i] = $post;
            $found = true;
            break;
        }
    }
    if (!$found) {
        if (count($posts) >= MAX_POSTS_PER_SPACE) fail(409, 'too many posts in this space');
        $posts[] = $post;
    }

    writeJsonFile($path, $posts);
    respond(200, ['posts' => $posts]);
}

function handlePostDelete(array $ctx): void {
    $body = readJsonBody();
    $id = safeUuid($body['id'] ?? '', 'post id');
    $spaceId = safeUuid($body['spaceId'] ?? '', 'space id');
    $path = spacePostsPath($ctx['userDir'], $spaceId);
    $posts = array_values(array_filter(
        readJsonArrayFile($path),
        fn($p) => is_array($p) && ($p['id'] ?? null) !== $id,
    ));
    writeJsonFile($path, $posts);
    respond(200, ['posts' => $posts]);
}

function handleMembersList(array $ctx): void {
    respond(200, ['members' => readJsonArrayFile(membersPath($ctx['userDir']))]);
}

/**
 * Accept or block one subscriber. The only writer of a membership `status`, and
 * only ever the space's owner — a requester can create a row but never decide
 * about it.
 */
function handleMemberDecide(array $ctx): void {
    $body = readJsonBody();
    $userId = safeString($body['userId'] ?? '', 64);
    if (!preg_match('/^[0-9a-f-]{36}$/i', $userId)) fail(400, 'invalid userId');
    $spaceId = safeUuid($body['spaceId'] ?? '', 'space id');
    $status = $body['status'] ?? '';
    if (!in_array($status, ['accepted', 'blocked'], true)) fail(400, 'invalid status');

    $path = membersPath($ctx['userDir']);
    $members = readJsonArrayFile($path);
    $found = false;
    foreach ($members as $i => $m) {
        if (is_array($m) && ($m['userId'] ?? null) === $userId && ($m['spaceId'] ?? null) === $spaceId) {
            $members[$i]['status'] = $status;
            $members[$i]['decidedAt'] = (int)(microtime(true) * 1000);
            $found = true;
            break;
        }
    }
    if (!$found) fail(404, 'unknown member');

    writeJsonFile($path, $members);
    respond(200, ['members' => $members]);
}

function handleSubscriptionUpsert(array $ctx): void {
    $body = readJsonBody();
    if (!is_array($body['subscription'] ?? null)) fail(400, 'subscription required');
    $sub = sanitizeSubscription($body['subscription']);
    $path = subscriptionsPath($ctx['userDir']);
    $subs = readJsonArrayFile($path);

    $found = false;
    foreach ($subs as $i => $existing) {
        if (is_array($existing) && ($existing['code'] ?? null) === $sub['code']) {
            $subs[$i] = $sub;
            $found = true;
            break;
        }
    }
    if (!$found) {
        if (count($subs) >= MAX_SUBSCRIPTIONS_PER_USER) fail(409, 'too many subscriptions');
        $subs[] = $sub;
    }

    writeJsonFile($path, $subs);
    respond(200, ['subscriptions' => $subs]);
}

function handleSubscriptionDelete(array $ctx): void {
    $body = readJsonBody();
    $code = normalizeShareCode($body['code'] ?? '');
    $path = subscriptionsPath($ctx['userDir']);
    $subs = array_values(array_filter(
        readJsonArrayFile($path),
        fn($s) => is_array($s) && ($s['code'] ?? null) !== $code,
    ));
    writeJsonFile($path, $subs);
    respond(200, ['subscriptions' => $subs]);
}

// ---------- community: across accounts --------------------------------------

/**
 * Ask to read a space. The one cross-user *write* in this file.
 *
 * Constrained on every side: the caller is authenticated, the row it appends
 * carries the caller's own authenticated userId and nothing it chose, the code
 * must already resolve, the owner's directory is never created, and a
 * requester can never set its own status — `auto` approval is the space's
 * setting, read from the owner's own file.
 *
 * Requiring the caller's profile to exist is the server-side half of "a
 * profile is the one community opt-in": without it there would be no name to
 * show the owner when they decide.
 */
function handleSpaceRequest(array $ctx): void {
    $body = readJsonBody();
    $code = normalizeShareCode($body['code'] ?? '');

    $me = readJsonObjectFile(profilePath($ctx['userDir']));
    if ($me === null) fail(403, 'profile_required');

    $target = resolveShareCode($code);
    $space = findById(readJsonArrayFile(spacesPath($target['userDir'])), $target['spaceId']);
    if ($space === null) fail(404, 'unknown share code');
    requireOwnerPublished($target['userDir']);

    $path = membersPath($target['userDir']);
    $members = readJsonArrayFile($path);

    $now = (int)(microtime(true) * 1000);
    $auto = ($space['approval'] ?? 'manual') === 'auto';
    $status = $auto ? 'accepted' : 'pending';

    $found = false;
    foreach ($members as $i => $m) {
        if (!is_array($m)) continue;
        if (($m['userId'] ?? null) !== $ctx['userId'] || ($m['spaceId'] ?? null) !== $target['spaceId']) continue;
        // Re-asking refreshes the name snapshot but never the decision: a
        // blocked subscriber cannot clear their own block by asking again.
        $members[$i]['displayName'] = (string)($me['displayName'] ?? '');
        $members[$i]['avatarUrl'] = isset($me['avatarUrl']) ? (string)$me['avatarUrl'] : null;
        $status = (string)($m['status'] ?? $status);
        $found = true;
        break;
    }
    if (!$found) {
        if (count($members) >= MAX_MEMBERS_PER_SPACE) fail(409, 'this space has too many subscribers');
        $members[] = [
            'userId' => $ctx['userId'],
            'spaceId' => $target['spaceId'],
            'status' => $status,
            'displayName' => (string)($me['displayName'] ?? ''),
            'avatarUrl' => isset($me['avatarUrl']) ? (string)$me['avatarUrl'] : null,
            'requestedAt' => $now,
            'decidedAt' => $auto ? $now : null,
        ];
    }
    writeJsonFile($path, $members);

    respond(200, [
        'status' => $status,
        'space' => publicSpaceOf($space),
        'owner' => publicProfileOf($target['userDir']),
    ]);
}

/**
 * Read a space's posts. The one cross-user *read*.
 *
 * Answers only for an accepted member, and answers with projections rather
 * than the stored records. Each post keeps its signature intact so the
 * subscriber's client can verify it against the key it pinned — this endpoint
 * is not trusted, and is not asking to be.
 */
function handleSpaceFeed(array $ctx): void {
    $body = readJsonBody();
    $code = normalizeShareCode($body['code'] ?? '');
    $target = resolveShareCode($code);

    $space = findById(readJsonArrayFile(spacesPath($target['userDir'])), $target['spaceId']);
    if ($space === null) fail(404, 'unknown share code');
    requireOwnerPublished($target['userDir']);

    $status = 'pending';
    foreach (readJsonArrayFile(membersPath($target['userDir'])) as $m) {
        if (!is_array($m)) continue;
        if (($m['userId'] ?? null) === $ctx['userId'] && ($m['spaceId'] ?? null) === $target['spaceId']) {
            $status = (string)($m['status'] ?? 'pending');
            break;
        }
    }
    if ($status !== 'accepted') {
        // Deliberately not a 403: "waiting for approval" is a normal state the
        // client shows, and a blocked reader learns no more than a pending one.
        respond(200, [
            'status' => $status,
            'space' => publicSpaceOf($space),
            'owner' => publicProfileOf($target['userDir']),
            'posts' => [],
        ]);
    }

    $path = spacePostsPath($target['userDir'], $target['spaceId']);
    $posts = readJsonArrayFile($path);
    $pruned = pruneExpired($posts, $space['ephemeralHours'] ?? null);
    if (count($pruned) !== count($posts)) writeJsonFile($path, $pruned);

    usort($pruned, fn($a, $b) => (int)($b['publishedAt'] ?? 0) <=> (int)($a['publishedAt'] ?? 0));

    respond(200, [
        'status' => 'accepted',
        'space' => publicSpaceOf($space),
        'owner' => publicProfileOf($target['userDir']),
        'posts' => array_slice($pruned, 0, MAX_FEED_POSTS),
    ]);
}

/**
 * Store a profile picture, content-addressed.
 *
 * Modelled on handleRecordingUpload, with two differences that matter:
 *
 *  - the size cap is enforced *here*, not left to php.ini. Nothing in this
 *    repo sets upload_max_filesize, so on an unknown host there may be no
 *    limit at all;
 *  - the type is decided by getimagesize() reading the actual bytes, never by
 *    the client's filename or Content-Type, and the stored name is a sha256 of
 *    the content. So a caller cannot choose where the file lands or what
 *    extension it gets.
 *
 * Content addressing also means re-uploading the same picture is free and two
 * users with the same avatar share one file.
 */
function handleAvatarUpload(array $ctx): void {
    $file = $_FILES['avatar'] ?? null;
    if (!is_array($file) || ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        fail(400, 'no avatar uploaded');
    }
    if ((int)($file['size'] ?? 0) > MAX_AVATAR_BYTES) fail(413, 'avatar too large');

    $tmp = (string)($file['tmp_name'] ?? '');
    if (!is_uploaded_file($tmp)) fail(400, 'no avatar uploaded');
    if (filesize($tmp) > MAX_AVATAR_BYTES) fail(413, 'avatar too large');

    $info = @getimagesize($tmp);
    $ext = match ($info === false ? 0 : ($info[2] ?? 0)) {
        IMAGETYPE_JPEG => 'jpg',
        IMAGETYPE_PNG => 'png',
        IMAGETYPE_WEBP => 'webp',
        default => null,
    };
    if ($ext === null) fail(400, 'unsupported image type');

    $hash = hash_file('sha256', $tmp);
    if ($hash === false) fail(500, 'could not read upload');
    $name = "{$hash}.{$ext}";
    $dest = AVATARS_DIR . '/' . $name;

    if (!file_exists($dest) && !move_uploaded_file($tmp, $dest)) {
        fail(500, 'failed to save avatar');
    }
    @chmod($dest, 0644);

    respond(200, ['avatarUrl' => BASE_PATH . '/storage/avatars/' . $name]);
}
