<?php
declare(strict_types=1);

// An include, not an endpoint — see APP_ROOT in api.php. Fetched directly this
// file must say nothing: it never runs api.php's ini_set('display_errors', '0').
if (!defined('APP_ROOT')) { http_response_code(404); exit; }

/**
 * ElevenLabs: the transport, the caller's key, narration, and the proxies.
 *
 * Three rules hold this file together:
 *
 *  1. **The caller's own key pays, always.** There is no shared ElevenLabs key
 *     (see ELEVENLABS_API_BASE in api/bootstrap.php), so everything here
 *     resolves elevenLabsPayer() and answers 403 `elevenlabs_key_missing`
 *     without one — except a narration cache hit, which costs nothing and so
 *     needs no key at all.
 *  2. **Only elevenLabsRequest() builds an `xi-api-key` header**, on
 *     curlExec() — never on the OpenAI wrappers in api/openai.php, which fall
 *     back to the shared *OpenAI* key and would hand it to a third party.
 *  3. **Every failure says whose it is**: {error: 'elevenlabs_*', provider:
 *     'elevenlabs', payer} — never `user_key_failed`, which makes the client
 *     offer the shared OpenAI key, and that cannot help here. Narration
 *     failures also name the `voiceId` and `model`, so the client can set
 *     aside just that voice for the session.
 *
 * The audible-config rules and the cache identity are api/voices.php's; the
 * MP3 framing and the character-timings → words conversion are pure audio,
 * in api/audio.php.
 */

/** The text a narration request may carry, in bytes. */
const EL_TEXT_MAX_BYTES = 4000;
/** v4's dialogue endpoint caps one request at 2,000 characters; chunks stay
 * well inside that, cut at sentence ends. */
const EL_V4_CHUNK_CHARS = 1800;
const EL_V4_MAX_CHUNKS = 4;
/** How much neighbouring text rides along as `previous_text`/`future_text`. */
const EL_CONTEXT_CHARS = 100;
/**
 * On a verse miss, send the neighbouring verses as context, so the voice reads
 * a verse as part of a passage rather than as a sentence on its own. Not part
 * of the cache key, so it can be switched off without orphaning any audio —
 * the first generation's context simply stays what it was.
 */
const EL_VERSE_CONTEXT = true;
const EL_CONTENT_KEY_VERSION = 'el-content-v1';
const EL_ALIGNMENT_FORMAT = 'el-chars-v1';
const EL_DESIGN_MODEL = 'eleven_ttv_v3';
/** One designed preview, decoded. */
const EL_PREVIEW_MAX_BYTES = 2 * 1024 * 1024;
/** One with-timestamps response: ~4,000 characters of speech, base64, plus timings. */
const EL_NARRATION_MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
/** One retry for "busy, try again", after this long. */
const EL_RETRY_DELAY_US = 1500000;
/** An ElevenLabs key: what their dashboard mints, and nothing that could break a header. */
const EL_KEY_RE = '/^[A-Za-z0-9_-]{16,256}$/';
/** How long a narration miss waits for another request generating the same
 * entry before answering 503 `tts_busy`. A define, not a const, so the
 * voices:verify:api harness can shorten it from secrets.php. */
if (!defined('EL_LOCK_WAIT_SECONDS')) define('EL_LOCK_WAIT_SECONDS', 90);

/** What a designed voice says while it is being auditioned: Psalm 23:1-4, in
 * the voice's language (Luther 1912 / KJV), 100-1,000 characters as the
 * design endpoint requires. "Lord"/"Herr" rather than the capitals, which a
 * voice model may spell out. */
const EL_DESIGN_SAMPLE = [
    'en' => 'The Lord is my shepherd; I shall not want. He maketh me to lie down in green pastures: '
        . 'he leadeth me beside the still waters. He restoreth my soul: he leadeth me in the paths of '
        . "righteousness for his name's sake. Yea, though I walk through the valley of the shadow of "
        . 'death, I will fear no evil: for thou art with me; thy rod and thy staff they comfort me.',
    'de' => 'Der Herr ist mein Hirte; mir wird nichts mangeln. Er weidet mich auf einer grünen Aue und '
        . 'führet mich zum frischen Wasser. Er erquicket meine Seele; er führet mich auf rechter Straße '
        . 'um seines Namens willen. Und ob ich schon wanderte im finstern Tal, fürchte ich kein '
        . 'Unglück; denn du bist bei mir, dein Stecken und Stab trösten mich.',
];

// ---------- transport ---------------------------------------------------------

/** The configured origin, if it is one this server may talk to: https, or the
 * loopback stub of scripts/voices/verifyVoicesBackend.mjs. */
function elevenLabsBase(): ?string {
    $base = rtrim((string)ELEVENLABS_API_BASE, '/');
    if (preg_match('#^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$#', $base)) return $base;
    if (preg_match('#^http://127\.0\.0\.1:[0-9]{1,5}$#', $base)) return $base;
    return null;
}

/**
 * One request to ElevenLabs — and the only place an `xi-api-key` header is
 * ever built. No redirects are followed, the response is capped at
 * `$maxBytes` (aborted mid-transfer, not read and then measured), and the key
 * is scrubbed from any error text.
 *
 * @return array{status:int, body:string, error:?string, tooLarge:bool}
 */
function elevenLabsRequest(
    string $method,
    string $path,
    array $query,
    ?array $json,
    string $key,
    int $timeout,
    int $maxBytes,
): array {
    // Callers pass literal paths plus a voice id that already passed its
    // pattern; anything else is a bug here, not untrusted input.
    if (!preg_match('#^/v[12](/[A-Za-z0-9_-]+)+$#', $path)) fail(500, 'invalid ElevenLabs path');
    if ($method !== 'GET' && $method !== 'POST') fail(500, 'invalid ElevenLabs method');
    $base = elevenLabsBase();
    if ($base === null) {
        return ['status' => 0, 'body' => '', 'error' => 'ELEVENLABS_API_BASE is not an https origin', 'tooLarge' => false];
    }
    // A stored key was shape-checked when it was saved; checked again because
    // it is about to become a header.
    if (!preg_match(EL_KEY_RE, $key)) {
        return ['status' => 0, 'body' => '', 'error' => 'malformed ElevenLabs key', 'tooLarge' => false];
    }

    $url = $base . $path . ($query === [] ? '' : '?' . http_build_query($query, '', '&', PHP_QUERY_RFC3986));
    $headers = ['xi-api-key: ' . $key, 'Accept: application/json'];
    $tooLarge = false;
    $ch = curl_init($url);
    $options = [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_PROTOCOLS => str_starts_with($base, 'https://') ? CURLPROTO_HTTPS : CURLPROTO_HTTP,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_TIMEOUT => $timeout,
        // Refuses up front when the length is announced; the progress
        // callback catches a chunked response that never announces one.
        CURLOPT_MAXFILESIZE => $maxBytes,
        CURLOPT_NOPROGRESS => false,
        CURLOPT_PROGRESSFUNCTION => static function ($_handle, $downloadTotal, $downloaded) use ($maxBytes, &$tooLarge): int {
            if ($downloadTotal > $maxBytes || $downloaded > $maxBytes) {
                $tooLarge = true;
                return 1;
            }
            return 0;
        },
    ];
    if ($method === 'POST') {
        $payload = json_encode($json ?? new stdClass(), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($payload === false) fail(500, 'could not encode the ElevenLabs request');
        $options[CURLOPT_POST] = true;
        $options[CURLOPT_POSTFIELDS] = $payload;
        $headers[] = 'Content-Type: application/json';
    }
    $options[CURLOPT_HTTPHEADER] = $headers;
    curl_setopt_array($ch, $options);

    $r = curlExec($ch);
    if ($tooLarge || curl_errno($ch) === CURLE_FILESIZE_EXCEEDED || strlen($r['body']) > $maxBytes) {
        return ['status' => $r['status'], 'body' => '', 'error' => 'response too large', 'tooLarge' => true];
    }
    if ($r['error'] !== null) {
        return ['status' => 0, 'body' => '', 'error' => elevenLabsDetail($r['error'], $key), 'tooLarge' => false];
    }
    return ['status' => $r['status'], 'body' => $r['body'], 'error' => null, 'tooLarge' => false];
}

/**
 * elevenLabsRequest(), retried once after 1.5 s when ElevenLabs says it is
 * busy — a concurrency limit, `system_busy`, or a 503. The smaller tiers allow
 * only a couple of concurrent requests, and a refused one is a silent hole in
 * a chapter; one patient retry absorbs most of them.
 */
function elevenLabsCall(
    string $method,
    string $path,
    array $query,
    ?array $json,
    string $key,
    int $timeout,
    int $maxBytes,
): array {
    $resp = elevenLabsRequest($method, $path, $query, $json, $key, $timeout, $maxBytes);
    if (elevenLabsRetryable($resp)) {
        usleep(EL_RETRY_DELAY_US);
        $resp = elevenLabsRequest($method, $path, $query, $json, $key, $timeout, $maxBytes);
    }
    return $resp;
}

function elevenLabsRetryable(array $resp): bool {
    if ($resp['error'] !== null) return false;
    if ($resp['status'] === 503) return true;
    if ($resp['status'] < 400) return false;
    $codes = elevenLabsErrorParts($resp['body'])['codes'];
    return array_intersect($codes, ['concurrent_limit_exceeded', 'too_many_concurrent_requests', 'system_busy']) !== [];
}

// ---------- failures ----------------------------------------------------------

/** PHP 8.1's array_is_list(), for the 8.0 baseline. */
function isListArray(array $a): bool {
    $i = 0;
    foreach ($a as $k => $_) {
        if ($k !== $i++) return false;
    }
    return true;
}

/**
 * What an ElevenLabs error body says, in any of the shapes it comes in:
 *
 *   {detail: {status: 'quota_exceeded', message}}                    the original
 *   {detail: {type, code: 'quota_exceeded', message, request_id}}    the current
 *   {detail: [{loc, msg, type}, …]}  or  {detail: '…'}               validation
 *
 * `codes` is every machine-readable code found (lower-cased), `message` the
 * human one. Neither is trusted for anything but choosing a failure code.
 *
 * @return array{codes: string[], message: string}
 */
function elevenLabsErrorParts(string $body): array {
    $decoded = json_decode($body, true);
    $detail = is_array($decoded) ? ($decoded['detail'] ?? ($decoded['error'] ?? null)) : null;
    $codes = [];
    $message = '';
    if (is_array($detail) && isListArray($detail)) {
        $messages = [];
        foreach ($detail as $entry) {
            if (!is_array($entry)) continue;
            if (is_string($entry['type'] ?? null)) $codes[] = strtolower($entry['type']);
            $loc = is_array($entry['loc'] ?? null)
                ? implode('.', array_map('strval', array_filter($entry['loc'], 'is_scalar')))
                : '';
            $msg = is_string($entry['msg'] ?? null) ? $entry['msg'] : '';
            $messages[] = trim(($loc !== '' ? "{$loc}: " : '') . $msg);
        }
        $codes[] = 'validation_error';
        $message = implode('; ', array_filter($messages));
    } elseif (is_array($detail)) {
        foreach (['code', 'status', 'type'] as $field) {
            if (is_string($detail[$field] ?? null)) $codes[] = strtolower($detail[$field]);
        }
        $message = is_string($detail['message'] ?? null) ? $detail['message'] : '';
    } elseif (is_string($detail)) {
        $message = $detail;
    } elseif (!is_array($decoded)) {
        $message = $body; // not JSON at all — e.g. a proxy's HTML error page
    }
    return ['codes' => $codes, 'message' => $message];
}

/** Upstream text made safe to hand back: the key scrubbed out, markup and
 * runs of whitespace flattened, valid UTF-8, at most 300 characters. */
function elevenLabsDetail(string $text, string $key = ''): string {
    if ($key !== '') $text = str_replace($key, '[key]', $text);
    // Belt and braces: anything else shaped like an ElevenLabs key.
    $text = preg_replace('/\bsk_[A-Za-z0-9]{16,}/', '[key]', $text) ?? '';
    $text = mb_convert_encoding($text, 'UTF-8', 'UTF-8');
    $text = trim(preg_replace('/\s+/u', ' ', strip_tags($text)) ?? '');
    return mb_substr($text, 0, 300, 'UTF-8');
}

/** The permission a "missing the permission text_to_speech" message names. */
function elevenLabsPermissionOf(string $message): ?string {
    return preg_match('/permissions?\W+([a-z]+(?:_[a-z]+)+)/i', $message, $m) ? strtolower($m[1]) : null;
}

/**
 * The client-facing failure for a response that was not a success:
 * [code, httpStatus, extra]. Codes are read before statuses because
 * ElevenLabs reports a quota or a missing permission as a 401 — the status
 * alone would call either one a bad key.
 */
function elevenLabsFailureOf(array $resp, string $key): array {
    if ($resp['tooLarge']) return ['elevenlabs_bad_response', 502, ['detail' => 'response too large']];
    if ($resp['error'] !== null) {
        return ['elevenlabs_unavailable', 502, ['detail' => elevenLabsDetail((string)$resp['error'], $key)]];
    }
    $status = $resp['status'];
    $parts = elevenLabsErrorParts($resp['body']);
    $codes = $parts['codes'];
    $has = fn(array $set): bool => array_intersect($codes, $set) !== [];

    if ($has(['missing_permissions', 'missing_permission']) || stripos($parts['message'], 'missing the permission') !== false) {
        return ['elevenlabs_key_permissions', 502, ['permission' => elevenLabsPermissionOf($parts['message'])]];
    }
    if ($has(['quota_exceeded', 'insufficient_credits', 'insufficient_quota', 'payment_required'])) {
        return ['elevenlabs_quota_exceeded', 502, []];
    }
    if ($has(['voice_not_found', 'voice_does_not_exist', 'voice_not_available', 'generated_voice_not_found'])) {
        return ['elevenlabs_voice_unavailable', 502, []];
    }
    if ($has(['free_users_not_allowed', 'detected_unusual_activity', 'subscription_required', 'voice_limit_reached', 'model_not_allowed', 'not_allowed'])) {
        return ['elevenlabs_not_allowed', 502, ['detail' => elevenLabsDetail($parts['message'], $key)]];
    }
    if ($has(['concurrent_limit_exceeded', 'too_many_concurrent_requests', 'system_busy', 'rate_limit_exceeded', 'too_many_requests'])) {
        return ['elevenlabs_rate_limited', 429, []];
    }
    if ($has(['invalid_api_key', 'missing_api_key', 'api_key_invalid', 'invalid_authorization', 'unauthorized'])) {
        return ['elevenlabs_key_failed', 502, []];
    }
    if ($status === 401) return ['elevenlabs_key_failed', 502, []];
    if ($status === 402) return ['elevenlabs_quota_exceeded', 502, []];
    if ($status === 403) return ['elevenlabs_not_allowed', 502, ['detail' => elevenLabsDetail($parts['message'], $key)]];
    if ($status === 404) return ['elevenlabs_voice_unavailable', 502, []];
    if ($status === 429 || $status === 503) return ['elevenlabs_rate_limited', 429, []];
    if ($status >= 500) return ['elevenlabs_unavailable', 502, ['status' => $status]];
    if ($status >= 400) {
        $detail = elevenLabsDetail($parts['message'] !== '' ? $parts['message'] : "HTTP {$status}", $key);
        return ['elevenlabs_rejected', 400, ['detail' => $detail]];
    }
    // A 2xx that is not what was asked for, or a 3xx we will not follow.
    return ['elevenlabs_bad_response', 502, ['status' => $status]];
}

/**
 * Answer with an ElevenLabs failure. A 429 or 503 says when to come back.
 * `$payer` is who would have paid ('requester' — the caller — for everything
 * today; a shared voice would one day be paid for by its 'owner').
 */
function failElevenLabs(string $code, int $status, string $payer, array $extra = []): void {
    if ($status === 429 || $status === 503) header('Retry-After: 2');
    fail($status, $code, array_merge(['provider' => 'elevenlabs', 'payer' => $payer], $extra));
}

/** Upstream text as a bounded, valid UTF-8 string — or null. */
function elText(mixed $v, int $maxChars): ?string {
    if (!is_string($v)) return null;
    $v = trim(mb_convert_encoding($v, 'UTF-8', 'UTF-8'));
    return $v === '' ? null : mb_substr($v, 0, $maxChars, 'UTF-8');
}

/** An upstream URL the client may load: https only, no whitespace, bounded. */
function elHttpsUrl(mixed $v): ?string {
    if (!is_string($v) || strlen($v) > 2048 || !preg_match('#^https://[^\s"\'<>\\\\]+$#', $v)) return null;
    $host = parse_url($v, PHP_URL_HOST);
    return is_string($host) && $host !== '' ? $v : null;
}

/** A required piece of caller text, trimmed: 1..$maxChars characters. */
function elRequiredText(mixed $v, int $maxChars, string $what): string {
    if (!is_string($v)) fail(400, "{$what} required");
    $v = trim($v);
    if ($v === '' || mb_strlen($v, 'UTF-8') > $maxChars) fail(400, "invalid {$what}");
    return $v;
}

// ---------- the key -----------------------------------------------------------

/**
 * Who pays ElevenLabs for this caller: their own stored key, or nobody.
 *
 *   ['provider' => 'elevenlabs', 'key' => string, 'who' => 'requester'] | null
 */
function elevenLabsPayer(array $ctx): ?array {
    $key = isset($ctx['userDir']) ? storedKey($ctx['userDir'], 'elevenlabs') : '';
    if ($key === '' || !preg_match(EL_KEY_RE, $key)) return null;
    return ['provider' => 'elevenlabs', 'key' => $key, 'who' => 'requester'];
}

/** The payer, or 403 `elevenlabs_key_missing` — for the proxies, which have
 * no cache to fall back on. */
function requireElevenLabsPayer(array $ctx): array {
    $payer = elevenLabsPayer($ctx);
    if ($payer === null) failElevenLabs('elevenlabs_key_missing', 403, 'requester');
    return $payer;
}

/** The credits view of /v1/user/subscription, whitelisted. `resetsAt` is in
 * milliseconds, like every other timestamp the client handles. */
function elevenLabsSubscriptionOf(mixed $d): ?array {
    if (!is_array($d)) return null;
    $count = $d['character_count'] ?? null;
    $limit = $d['character_limit'] ?? null;
    $reset = $d['next_character_count_reset_unix'] ?? null;
    return [
        'tier' => elText($d['tier'] ?? null, 64),
        'characterCount' => is_int($count) || is_float($count) ? (int)$count : null,
        'characterLimit' => is_int($limit) || is_float($limit) ? (int)$limit : null,
        'resetsAt' => (is_int($reset) || is_float($reset)) && $reset > 0 ? (int)$reset * 1000 : null,
        'status' => elText($d['status'] ?? null, 64),
    ];
}

/** A local file check only — it never asks ElevenLabs, and creates nothing. */
function handleElevenLabsKeyStatus(array $ctx): void {
    $key = storedKey($ctx['userDir'], 'elevenlabs');
    if ($key === '') respond(200, ['hasKey' => false]);
    $out = ['hasKey' => true, 'masked' => maskKey($key)];
    if ((storedKeyMeta($ctx['userDir'], 'elevenlabs')['restricted'] ?? false) === true) $out['restricted'] = true;
    respond(200, $out);
}

/**
 * Validate and store the caller's ElevenLabs key.
 *
 * The shape is checked first, with no network call: an OpenAI key pasted
 * into the wrong field is named as such. Then /v1/user/subscription proves
 * the key and reports the credits. A key created without the "user read"
 * permission is refused there yet perfectly good for narration, so a
 * permission error is not a verdict: the voice library is probed, and a key
 * that is merely restricted on both is stored with `restricted: true`. Only a
 * key ElevenLabs does not recognise is rejected; anything else that keeps the
 * question open (an outage, a busy upstream) stores nothing and says so.
 */
function handleElevenLabsKeySet(array $ctx): void {
    $body = readJsonBody();
    $key = is_string($body['key'] ?? null) ? trim($body['key']) : '';
    if (str_starts_with($key, 'sk-')) fail(400, 'that looks like an OpenAI key');
    if (!preg_match(EL_KEY_RE, $key)) fail(400, 'invalid key format');

    $restricted = false;
    $subscription = null;
    $resp = elevenLabsCall('GET', '/v1/user/subscription', [], null, $key, 20, 256 * 1024);
    if ($resp['error'] === null && $resp['status'] === 200) {
        $subscription = elevenLabsSubscriptionOf(json_decode($resp['body'], true));
    } else {
        [$code] = elevenLabsFailureOf($resp, $key);
        if ($code === 'elevenlabs_key_permissions') {
            $probe = elevenLabsCall('GET', '/v2/voices', ['page_size' => 1], null, $key, 20, 1024 * 1024);
            $probeCode = ($probe['error'] === null && $probe['status'] === 200)
                ? null
                : elevenLabsFailureOf($probe, $key)[0];
            if ($probeCode !== null && $probeCode !== 'elevenlabs_key_permissions') {
                $resp = $probe;
                $code = $probeCode;
            } else {
                $restricted = true;
            }
        }
        if (!$restricted) {
            if ($code === 'elevenlabs_key_failed') {
                $parts = elevenLabsErrorParts($resp['body']);
                fail(400, 'key rejected by ElevenLabs', [
                    'status' => $resp['status'],
                    'code' => $parts['codes'][0] ?? null,
                    'detail' => elevenLabsDetail($parts['message'], $key),
                ]);
            }
            failElevenLabs('elevenlabs_unavailable', 502, 'requester', ['status' => $resp['status']]);
        }
    }

    if (!storeKey($ctx['userDir'], 'elevenlabs', $key, $restricted ? ['restricted' => true] : [])) {
        fail(500, 'could not store key');
    }
    $out = ['hasKey' => true, 'masked' => maskKey($key), 'restricted' => $restricted];
    if ($subscription !== null) $out['subscription'] = $subscription;
    respond(200, $out);
}

/** Idempotent, and creates no account: clearing a key never set is a success. */
function handleElevenLabsKeyClear(array $ctx): void {
    clearStoredKey($ctx['userDir'], 'elevenlabs');
    respond(200, ['hasKey' => false]);
}

// ---------- the proxies -------------------------------------------------------

/** Turn a non-success into the matching failure, or decode a success. */
function elevenLabsJson(array $resp, string $key): array {
    if ($resp['error'] !== null || $resp['status'] !== 200) {
        [$code, $status, $extra] = elevenLabsFailureOf($resp, $key);
        failElevenLabs($code, $status, 'requester', $extra);
    }
    $decoded = json_decode($resp['body'], true);
    if (!is_array($decoded)) failElevenLabs('elevenlabs_bad_response', 502, 'requester');
    return $decoded;
}

function handleElevenLabsSubscription(array $ctx): void {
    $payer = requireElevenLabsPayer($ctx);
    $resp = elevenLabsCall('GET', '/v1/user/subscription', [], null, $payer['key'], 20, 256 * 1024);
    $subscription = elevenLabsSubscriptionOf(elevenLabsJson($resp, $payer['key']));
    respond(200, ['subscription' => $subscription]);
}

/** One voice from the library, whitelisted; null for one the app could not
 * narrate with (a voice id outside the pattern narration accepts). */
function elevenLabsVoiceOf(mixed $v): ?array {
    if (!is_array($v)) return null;
    $id = $v['voice_id'] ?? null;
    if (!is_string($id) || !preg_match(ELEVENLABS_VOICE_ID_RE, $id)) return null;
    $labels = is_array($v['labels'] ?? null) ? $v['labels'] : [];
    $languages = [];
    foreach (is_array($v['verified_languages'] ?? null) ? $v['verified_languages'] : [] as $l) {
        if (!is_array($l)) continue;
        $languages[] = [
            'language' => elText($l['language'] ?? null, 16),
            'accent' => elText($l['accent'] ?? null, 64),
            'locale' => elText($l['locale'] ?? null, 16),
            'modelId' => elText($l['model_id'] ?? null, 64),
            'previewUrl' => elHttpsUrl($l['preview_url'] ?? null),
        ];
        if (count($languages) >= 20) break;
    }
    return [
        'voiceId' => $id,
        'name' => elText($v['name'] ?? null, 100) ?? '',
        'category' => elText($v['category'] ?? null, 32),
        'labels' => [
            'accent' => elText($labels['accent'] ?? null, 64),
            'age' => elText($labels['age'] ?? null, 64),
            'gender' => elText($labels['gender'] ?? null, 64),
            'descriptive' => elText($labels['descriptive'] ?? null, 64),
            'useCase' => elText($labels['use_case'] ?? null, 64),
        ],
        'description' => elText($v['description'] ?? null, 500),
        'previewUrl' => elHttpsUrl($v['preview_url'] ?? null),
        'languages' => $languages,
        'isOwner' => ($v['is_owner'] ?? false) === true,
    ];
}

/** The caller's voice library (premade voices included), searchable, paged. */
function handleElevenLabsVoices(array $ctx): void {
    $payer = requireElevenLabsPayer($ctx);
    $body = readJsonBody();

    $search = $body['search'] ?? null;
    if ($search !== null && (!is_string($search) || mb_strlen($search, 'UTF-8') > 100)) fail(400, 'invalid search');
    $pageSize = $body['pageSize'] ?? 30;
    if (!is_int($pageSize) || $pageSize < 1 || $pageSize > 100) fail(400, 'invalid pageSize');
    $token = $body['nextPageToken'] ?? null;
    if ($token !== null && (!is_string($token) || strlen($token) > 512 || preg_match('/[\x00-\x1F\x7F]/', $token))) {
        fail(400, 'invalid nextPageToken');
    }

    $query = ['page_size' => $pageSize, 'include_total_count' => 'false'];
    if (is_string($search) && trim($search) !== '') $query['search'] = trim($search);
    if (is_string($token) && $token !== '') $query['next_page_token'] = $token;
    $resp = elevenLabsCall('GET', '/v2/voices', $query, null, $payer['key'], 30, 4 * 1024 * 1024);
    $d = elevenLabsJson($resp, $payer['key']);
    if (!is_array($d['voices'] ?? null)) failElevenLabs('elevenlabs_bad_response', 502, 'requester');

    $voices = [];
    foreach ($d['voices'] as $v) {
        $voice = elevenLabsVoiceOf($v);
        if ($voice !== null) $voices[] = $voice;
    }
    respond(200, [
        'voices' => $voices,
        'hasMore' => ($d['has_more'] ?? false) === true,
        'nextPageToken' => elText($d['next_page_token'] ?? null, 512),
    ]);
}

/**
 * Describe a voice, hear three takes on it. The sample text is the server's
 * — a fixed Psalm 23 in the voice's language — so this is not a free
 * text-to-speech endpoint, and every preview is directly comparable.
 */
function handleElevenLabsDesign(array $ctx): void {
    $payer = requireElevenLabsPayer($ctx);
    $body = readJsonBody();
    $description = elRequiredText($body['description'] ?? null, 1000, 'description');
    $language = $body['language'] ?? 'en';
    if ($language !== 'en' && $language !== 'de') fail(400, 'invalid language');
    $text = EL_DESIGN_SAMPLE[$language];

    $resp = elevenLabsCall('POST', '/v1/text-to-voice/design', ['output_format' => EL_OUTPUT_FORMAT], [
        'voice_description' => $description,
        'model_id' => EL_DESIGN_MODEL,
        'text' => $text,
        'auto_generate_text' => false,
    ], $payer['key'], 120, 16 * 1024 * 1024);
    $d = elevenLabsJson($resp, $payer['key']);

    $previews = [];
    foreach (is_array($d['previews'] ?? null) ? $d['previews'] : [] as $p) {
        if (!is_array($p) || !is_string($p['audio_base_64'] ?? null)) continue;
        $id = $p['generated_voice_id'] ?? null;
        if (!is_string($id) || !preg_match('/^[A-Za-z0-9_-]{1,100}$/', $id)) continue;
        // Strict base64, at most 2 MB once decoded, and really MPEG audio —
        // a preview the client cannot play is no preview.
        if (strlen($p['audio_base_64']) > intdiv(EL_PREVIEW_MAX_BYTES * 4, 3) + 4) continue;
        $audio = base64_decode($p['audio_base_64'], true);
        if ($audio === false || $audio === '' || strlen($audio) > EL_PREVIEW_MAX_BYTES || mp3Scan($audio) === null) continue;
        $duration = $p['duration_secs'] ?? null;
        $previews[] = [
            'generatedVoiceId' => $id,
            'audioBase64' => base64_encode($audio),
            'mediaType' => 'audio/mpeg',
            'durationSecs' => is_int($duration) || is_float($duration) ? (float)$duration : null,
            'language' => elText($p['language'] ?? null, 16) ?? $language,
        ];
        if (count($previews) >= 3) break;
    }
    if ($previews === []) failElevenLabs('elevenlabs_bad_response', 502, 'requester', ['detail' => 'no playable previews']);
    respond(200, ['previews' => $previews, 'text' => $text]);
}

/** Keep one designed preview as a voice in the caller's ElevenLabs library. */
function handleElevenLabsDesignSave(array $ctx): void {
    $payer = requireElevenLabsPayer($ctx);
    $body = readJsonBody();
    $generatedId = $body['generatedVoiceId'] ?? null;
    if (!is_string($generatedId) || !preg_match('/^[A-Za-z0-9_-]{1,100}$/', $generatedId)) {
        fail(400, 'invalid generatedVoiceId');
    }
    $name = elRequiredText($body['name'] ?? null, 100, 'name');
    $description = elRequiredText($body['description'] ?? null, 1000, 'description');

    $resp = elevenLabsCall('POST', '/v1/text-to-voice', [], [
        'voice_name' => $name,
        'voice_description' => $description,
        'generated_voice_id' => $generatedId,
    ], $payer['key'], 60, 1024 * 1024);
    $voice = elevenLabsVoiceOf(elevenLabsJson($resp, $payer['key']));
    if ($voice === null) failElevenLabs('elevenlabs_bad_response', 502, 'requester', ['detail' => 'no voice id in the response']);
    respond(200, ['voice' => [
        'voiceId' => $voice['voiceId'],
        'name' => $voice['name'],
        'category' => $voice['category'],
        'previewUrl' => $voice['previewUrl'],
    ]]);
}

// ---------- narration ---------------------------------------------------------

/**
 * `tts` / `tts.speak` with `provider: 'elevenlabs'`.
 *
 * The cache path is the audible config plus the text, never the payer or the
 * reference:
 *
 *   /storage/audio/el/{cfgHash}/{lang|_}/{k[0:2]}/{k}.mp3 | .json
 *   k = sha256("el-content-v1\0" . lang . "\0" . text)
 *
 * so a verse and the same words spoken through tts.speak share one file, and
 * the files never change once written (safe to cache as immutable).
 *
 * Order, all of it load-bearing:
 *   1. a hit is served with no key, no lock and no mkdir;
 *   2. a miss needs a payer, else 403 `elevenlabs_key_missing`;
 *   3. ignore_user_abort — a listener who skips ahead still leaves the audio
 *      cached for the next one;
 *   4. the per-entry lock in WORK_DIR, then the cache again — two listeners
 *      asking at once cost one generation;
 *   5. synthesize in memory, write a temp file, mkdir, rename, chmod 0644, the
 *      JSON last: its presence is what step 1 tests, so a reader never sees
 *      half an entry. A failure leaves nothing behind (see the shutdown hook).
 */
function handleElevenLabsNarration(array $ctx, array $body, string $kind): void {
    $config = elevenLabsConfig($body['elevenlabs'] ?? null);
    $voiceTag = ['voiceId' => $config['voiceId'], 'model' => $config['model']];

    $text = $body['text'] ?? null;
    if (!is_string($text) || trim($text) === '') {
        fail(400, $kind === 'verse' ? 'missing tts params' : 'missing tts.speak params');
    }
    if (strlen($text) > EL_TEXT_MAX_BYTES) fail(400, 'text too long');
    if (!mb_check_encoding($text, 'UTF-8')) fail(400, 'text is not UTF-8');

    $verse = null;
    if ($kind === 'verse') {
        $translation = is_string($body['translation'] ?? null) ? strtoupper($body['translation']) : '';
        if ((BIBLE_XML_MAP[$translation] ?? null) === null) fail(400, 'unknown translation');
        $verse = [
            'translation' => $translation,
            'bookId' => safeInt($body['bookId'] ?? null),
            'chapter' => safeInt($body['chapter'] ?? null),
            'verse' => safeInt($body['verse'] ?? null),
        ];
        if ($verse['bookId'] <= 0 || $verse['chapter'] <= 0 || $verse['verse'] <= 0) fail(400, 'missing tts params');
        $lang = TRANSLATION_LANGUAGE[$translation] ?? '_';
    } else {
        $language = $body['language'] ?? null;
        if ($language === null || $language === '') $lang = '_';
        elseif ($language === 'en' || $language === 'de') $lang = $language;
        else fail(400, 'invalid language');
    }

    $configHash = audibleConfigHash($config);
    $entry = hash('sha256', EL_CONTENT_KEY_VERSION . "\0" . $lang . "\0" . $text);
    $rel = "/el/{$configHash}/{$lang}/" . substr($entry, 0, 2);
    $dir = AUDIO_DIR . $rel;
    $audioFile = "{$dir}/{$entry}.mp3";
    $alignmentFile = "{$dir}/{$entry}.json";
    $answer = static function (bool $cached) use ($rel, $entry): void {
        respond(200, [
            'audioUrl' => BASE_PATH . AUDIO_BASE_URL . "{$rel}/{$entry}.mp3",
            'alignmentUrl' => BASE_PATH . AUDIO_BASE_URL . "{$rel}/{$entry}.json",
            'cached' => $cached,
        ]);
    };

    // 1. A hit costs nobody anything.
    if (is_file($alignmentFile) && is_file($audioFile)) $answer(true);

    // How the text will be cut is decided by the text alone, so an unsayable
    // one is refused before anybody's key is involved.
    $spoken = elevenLabsSpokenText($text, $config['model']);
    $chunks = $config['model'] === 'eleven_v4'
        ? elevenLabsChunks(mb_str_split($spoken), EL_V4_CHUNK_CHARS)
        : [[0, count(mb_str_split($spoken))]];
    if (count($chunks) > EL_V4_MAX_CHUNKS) fail(400, 'text too long');

    // 2. A miss: somebody has to pay.
    $ctx = withTtsPayer($ctx, 'elevenlabs', $voiceTag);
    $payer = $ctx['payer'];

    // 3. Finish what is started, even for a listener who has gone.
    ignore_user_abort(true);
    if (function_exists('set_time_limit')) @set_time_limit(300);

    // 4. One generation per entry. The shutdown hook also runs after fail()'s
    // exit, which is what makes "a failure leaves nothing behind" true on
    // every path rather than on the ones that remembered to clean up.
    $lockPath = WORK_DIR . "/el-{$configHash}-{$entry}.lock";
    $temps = [];
    $lock = null;
    register_shutdown_function(static function () use (&$temps, &$lock, $lockPath): void {
        foreach ($temps as $f) {
            if (is_file($f)) @unlink($f);
        }
        if ($lock !== null) elevenLabsUnlock($lock, $lockPath);
    });
    $lock = elevenLabsLock($lockPath, (float)EL_LOCK_WAIT_SECONDS);
    if ($lock === null) fail(500, 'could not lock the narration cache');
    if ($lock === false) {
        $lock = null;
        failElevenLabs('tts_busy', 503, $payer['who'], $voiceTag);
    }
    if (is_file($alignmentFile) && is_file($audioFile)) {
        // Somebody else generated it while we waited.
        elevenLabsUnlock($lock, $lockPath);
        $lock = null;
        $answer(true);
    }

    // 5. Synthesize, then publish.
    $context = ['previous' => null, 'next' => null];
    if ($verse !== null && EL_VERSE_CONTEXT) $context = elevenLabsVerseContext($verse);
    $result = $config['model'] === 'eleven_v4'
        ? elevenLabsDialogue($config, $spoken, $chunks, $lang, $context, $payer['key'])
        : elevenLabsSpeech($config, $spoken, $context, $payer['key']);
    if (isset($result['failure'])) {
        [$code, $status, $extra] = $result['failure'];
        failElevenLabs($code, $status, $payer['who'], array_merge($voiceTag, $extra));
    }

    $converted = elevenLabsWords($text, $result['segments'], $result['duration'], $spoken);
    $alignment = json_encode([
        'words' => $converted['words'],
        'duration' => round($result['duration'], 3),
        'text' => $text,
        'sourceTextHash' => sha256ForCache($text, ''),
        'provider' => 'elevenlabs',
        'configHash' => $configHash,
        'format' => EL_ALIGNMENT_FORMAT,
        'quality' => $converted['quality'],
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($alignment === false) fail(500, 'could not encode the alignment');

    $tmpAudio = elevenLabsTempFile($result['audio'], $temps);
    $tmpAlignment = elevenLabsTempFile($alignment, $temps);
    if ($tmpAudio === null || $tmpAlignment === null) fail(500, 'could not write audio file');
    if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) fail(500, 'could not write audio file');
    if (!@rename($tmpAudio, $audioFile)) fail(500, 'could not write audio file');
    @chmod($audioFile, 0644);
    if (!@rename($tmpAlignment, $alignmentFile)) fail(500, 'could not write audio file');
    @chmod($alignmentFile, 0644);
    $temps = [];

    elevenLabsUnlock($lock, $lockPath);
    $lock = null;
    $answer(false);
}

/**
 * Take the per-entry generation lock: a handle on success, false when another
 * request held it for longer than `$waitSeconds`, null when no lock file can
 * be opened at all.
 *
 * The holder deletes the file as it lets go (see elevenLabsUnlock), so a
 * waiter can win a lock on a file that is no longer there; it notices — the
 * inode at the path is not the one it holds — and starts over on the fresh
 * file. That keeps WORK_DIR empty between generations without ever letting
 * two requests generate one entry.
 */
function elevenLabsLock(string $path, float $waitSeconds) {
    $deadline = microtime(true) + $waitSeconds;
    while (true) {
        $fp = @fopen($path, 'c');
        if ($fp === false) return null;
        if (flock($fp, LOCK_EX | LOCK_NB)) {
            clearstatcache(true, $path);
            $onDisk = @stat($path);
            $held = fstat($fp);
            if ($onDisk !== false && $held !== false && $onDisk['ino'] === $held['ino'] && $onDisk['dev'] === $held['dev']) {
                return $fp;
            }
            flock($fp, LOCK_UN);
            fclose($fp);
        } else {
            fclose($fp);
            if (microtime(true) >= $deadline) return false;
            usleep(100000);
        }
    }
}

/** Delete the lock file *before* unlocking it — see elevenLabsLock. */
function elevenLabsUnlock($fp, string $path): void {
    @unlink($path);
    flock($fp, LOCK_UN);
    fclose($fp);
}

/** Bytes into a fresh 0600 temp file in WORK_DIR, registered for cleanup. */
function elevenLabsTempFile(string $bytes, array &$temps): ?string {
    $tmp = @tempnam(WORK_DIR, 'el-');
    if ($tmp === false) return null;
    $temps[] = $tmp;
    if (realpath(dirname($tmp)) !== realpath(WORK_DIR)) return null;
    return @file_put_contents($tmp, $bytes) === strlen($bytes) ? $tmp : null;
}

/**
 * The text as it is sent. v4 reads square brackets as audio tags ("[sighs]"),
 * so they become round ones — a length-preserving swap, which is what lets
 * the timings map straight back onto the text as displayed. Multilingual v2
 * gets the text unchanged.
 */
function elevenLabsSpokenText(string $text, string $model): string {
    return $model === 'eleven_v4' ? strtr($text, ['[' => '(', ']' => ')']) : $text;
}

/**
 * Where a v4 text is cut into requests: [from, to) code-point ranges of at
 * most `$max`, ending at a sentence end where one fits, else after a clause
 * mark, else at a space, and only as a last resort inside a word. Ranges are
 * trimmed, so what lies between two of them is whitespace — a word never
 * straddles a cut.
 */
function elevenLabsChunks(array $cps, int $max): array {
    $n = count($cps);
    $ranges = [];
    $pos = 0;
    while (true) {
        while ($pos < $n && isJsSpace($cps[$pos])) $pos++;
        if ($pos >= $n) break;
        if ($n - $pos <= $max) {
            $end = $n;
        } else {
            $sentence = null;
            $clause = null;
            $space = null;
            for ($i = $pos + $max; $i > $pos; $i--) {
                if ($i < $n && !isJsSpace($cps[$i])) continue; // must be followed by a space
                $space ??= $i;
                $mark = elevenLabsMarkBefore($cps, $i, $pos);
                if ($mark === 'sentence') {
                    $sentence = $i;
                    break;
                }
                if ($mark === 'clause') $clause ??= $i;
            }
            $end = $sentence ?? $clause ?? $space ?? ($pos + $max);
        }
        $to = $end;
        while ($to > $pos && isJsSpace($cps[$to - 1])) $to--;
        $ranges[] = [$pos, $to];
        $pos = $end;
    }
    return $ranges;
}

/** What kind of pause ends the text just before `$i`, looking through
 * closing quotes and brackets: 'sentence', 'clause' or null. */
function elevenLabsMarkBefore(array $cps, int $i, int $floor): ?string {
    $j = $i - 1;
    while ($j > $floor && in_array($cps[$j], ['"', "'", '”', '“', '’', '«', '»', ')', ']'], true)) $j--;
    $c = $cps[$j] ?? '';
    if (in_array($c, ['.', '!', '?', '…'], true)) return 'sentence';
    if (in_array($c, [';', ':', ','], true)) return 'clause';
    return null;
}

/** The first ≤100 characters of a text, ending on a word. */
function elevenLabsContextHead(?string $text): ?string {
    $cps = mb_str_split(trim((string)$text));
    if (count($cps) > EL_CONTEXT_CHARS) {
        $cut = EL_CONTEXT_CHARS;
        if (!isJsSpace($cps[$cut])) {
            for ($i = $cut - 1; $i > 0 && !isJsSpace($cps[$i]); $i--);
            if ($i > 0) $cut = $i;
        }
        $cps = array_slice($cps, 0, $cut);
    }
    $out = trim(implode('', $cps));
    return $out === '' ? null : $out;
}

/** The last ≤100 characters of a text, starting on a word. */
function elevenLabsContextTail(?string $text): ?string {
    $cps = mb_str_split(trim((string)$text));
    $n = count($cps);
    if ($n > EL_CONTEXT_CHARS) {
        $from = $n - EL_CONTEXT_CHARS;
        if (!isJsSpace($cps[$from - 1])) {
            for ($i = $from; $i < $n - 1 && !isJsSpace($cps[$i]); $i++);
            if ($i < $n - 1) $from = $i + 1;
        }
        $cps = array_slice($cps, $from);
    }
    $out = trim(implode('', $cps));
    return $out === '' ? null : $out;
}

/** The neighbouring verses' text, for continuity. Best effort: a chapter
 * that cannot be read just means no context. */
function elevenLabsVerseContext(array $verse): array {
    $chapter = bibleChapterVerses($verse['translation'], $verse['bookId'], $verse['chapter']);
    $previous = null;
    $next = null;
    foreach ($chapter['verses'] ?? [] as $row) {
        if (!is_array($row)) continue;
        $n = (int)($row['verse'] ?? 0);
        $t = (string)($row['textTts'] ?? ($row['text'] ?? ''));
        if ($n === $verse['verse'] - 1) $previous = elevenLabsContextTail($t);
        if ($n === $verse['verse'] + 1) $next = elevenLabsContextHead($t);
    }
    return ['previous' => $previous, 'next' => $next];
}

/**
 * Audio plus character timings out of one with-timestamps response:
 * ['audio', 'duration', 'sampleRate', 'samplesPerFrame', 'alignment'] or
 * ['failure' => [code, status, extra]]. The audio is MPEG frames only (see
 * mp3Scan) and the duration is theirs — the real one, not the timings'.
 */
function elevenLabsTimedAudio(array $resp, string $key): array {
    if ($resp['error'] !== null || $resp['status'] !== 200) return ['failure' => elevenLabsFailureOf($resp, $key)];
    $d = json_decode($resp['body'], true);
    if (!is_array($d) || !is_string($d['audio_base64'] ?? null)) {
        return ['failure' => ['elevenlabs_bad_response', 502, ['detail' => 'no audio in the response']]];
    }
    $bytes = base64_decode($d['audio_base64'], true);
    $mp3 = ($bytes === false || $bytes === '') ? null : mp3Scan($bytes);
    if ($mp3 === null) return ['failure' => ['elevenlabs_bad_response', 502, ['detail' => 'the audio is not MP3']]];
    // The timings of the text as sent, else of ElevenLabs' normalized reading
    // of it (numbers spelled out, …) — still better than none. Kept in
    // ElevenLabs' own shape: elevenLabsWords() reads that.
    $alignment = null;
    foreach (['alignment', 'normalized_alignment'] as $field) {
        if (characterTimingsOf($d[$field] ?? null) !== null) {
            $alignment = $d[$field];
            break;
        }
    }
    return [
        'audio' => $mp3['audio'],
        'duration' => $mp3['duration'],
        'sampleRate' => $mp3['sampleRate'],
        'samplesPerFrame' => $mp3['samplesPerFrame'],
        'alignment' => $alignment,
    ];
}

/**
 * eleven_v4: POST /v1/text-to-dialogue/with-timestamps, one request per chunk,
 * each carrying its neighbours (the previous verse / the next chunk) as
 * context. The chunks' audio frames are joined and each chunk's timings are
 * offset by the real duration of the audio before it.
 */
function elevenLabsDialogue(array $config, string $spoken, array $chunks, string $lang, array $context, string $key): array {
    $cps = mb_str_split($spoken);
    $texts = array_map(fn(array $r): string => implode('', array_slice($cps, $r[0], $r[1] - $r[0])), $chunks);
    $last = count($chunks) - 1;
    $audio = '';
    $offset = 0.0;
    $segments = [];
    $format = null;
    foreach ($chunks as $i => [$from, $to]) {
        $request = [
            'inputs' => [['text' => $texts[$i], 'voice_id' => $config['voiceId']]],
            'model_id' => 'eleven_v4',
            'settings' => ['stability' => $config['stability'], 'similarity' => $config['similarity']],
        ];
        if ($lang !== '_') $request['language_code'] = $lang;
        $previous = $i > 0
            ? elevenLabsContextTail($texts[$i - 1])
            : elevenLabsContextTail(elevenLabsSpokenText((string)$context['previous'], 'eleven_v4'));
        $future = $i < $last
            ? elevenLabsContextHead($texts[$i + 1])
            : elevenLabsContextHead(elevenLabsSpokenText((string)$context['next'], 'eleven_v4'));
        if ($previous !== null) $request['previous_text'] = $previous;
        if ($future !== null) $request['future_text'] = $future;

        $resp = elevenLabsCall('POST', '/v1/text-to-dialogue/with-timestamps', ['output_format' => EL_OUTPUT_FORMAT],
            $request, $key, 120, EL_NARRATION_MAX_RESPONSE_BYTES);
        $part = elevenLabsTimedAudio($resp, $key);
        if (isset($part['failure'])) return $part;
        $thisFormat = $part['sampleRate'] . '/' . $part['samplesPerFrame'];
        if ($format !== null && $format !== $thisFormat) {
            return ['failure' => ['elevenlabs_bad_response', 502, ['detail' => 'the chunks differ in format']]];
        }
        $format = $thisFormat;
        $audio .= $part['audio'];
        $segments[] = [
            'from' => $from,
            'to' => $to,
            'alignment' => $part['alignment'],
            'offset' => $offset,
            'duration' => $part['duration'],
        ];
        $offset += $part['duration'];
    }
    return ['audio' => $audio, 'duration' => $offset, 'segments' => $segments];
}

/**
 * eleven_multilingual_v2: POST /v1/text-to-speech/{voiceId}/with-timestamps,
 * one request for the whole text (its limit is far above ours). Never sent a
 * `language_code` — this model detects the language itself and the parameter
 * is not one it takes. Continuity rides as `previous_text` / `next_text`.
 */
function elevenLabsSpeech(array $config, string $spoken, array $context, string $key): array {
    $request = [
        'text' => $spoken,
        'model_id' => 'eleven_multilingual_v2',
        'voice_settings' => [
            'stability' => $config['stability'],
            'similarity_boost' => $config['similarity'],
            'style' => $config['style'],
            'speed' => $config['speed'],
            'use_speaker_boost' => true,
        ],
    ];
    $previous = elevenLabsContextTail($context['previous']);
    $next = elevenLabsContextHead($context['next']);
    if ($previous !== null) $request['previous_text'] = $previous;
    if ($next !== null) $request['next_text'] = $next;

    $resp = elevenLabsCall('POST', '/v1/text-to-speech/' . $config['voiceId'] . '/with-timestamps',
        ['output_format' => EL_OUTPUT_FORMAT], $request, $key, 180, EL_NARRATION_MAX_RESPONSE_BYTES);
    $part = elevenLabsTimedAudio($resp, $key);
    if (isset($part['failure'])) return $part;
    return [
        'audio' => $part['audio'],
        'duration' => $part['duration'],
        'segments' => [[
            'from' => 0,
            'to' => count(mb_str_split($spoken)),
            'alignment' => $part['alignment'],
            'offset' => 0.0,
            'duration' => $part['duration'],
        ]],
    ];
}
