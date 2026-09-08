<?php
declare(strict_types=1);

// An include, not an endpoint — see APP_ROOT in api.php. Fetched directly this
// file must say nothing: it never runs api.php's ini_set('display_errors', '0').
if (!defined('APP_ROOT')) { http_response_code(404); exit; }

/**
 * The request/response edge: how a reply is written, how untrusted input is
 * narrowed, who the caller is, and which origins may ask.
 *
 * Everything here is about *this* request and knows nothing about spaces,
 * verses or audio. Reading and writing the JSON under storage/ is
 * api/store.php.
 */

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
