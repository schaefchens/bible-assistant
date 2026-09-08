<?php
declare(strict_types=1);

// An include, not an endpoint — see APP_ROOT in api.php. Fetched directly this
// file must say nothing: it never runs api.php's ini_set('display_errors', '0').
if (!defined('APP_ROOT')) { http_response_code(404); exit; }

/**
 * Talking to OpenAI: which key pays for it, the four curl shapes, and how a
 * failure is reported back.
 *
 * No endpoint lives here. The three that call OpenAI are api/chat.php,
 * api/audio.php and api/moderation.php.
 */

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
