<?php
declare(strict_types=1);

// An include, not an endpoint — see APP_ROOT in api.php. Fetched directly this
// file must say nothing: it never runs api.php's ini_set('display_errors', '0').
if (!defined('APP_ROOT')) { http_response_code(404); exit; }

/**
 * The account itself: the caller's own provider keys, erasing everything
 * stored for an identity, a training recording, and the ambient music listing.
 *
 * The stored-key helpers below (`storedKey`, `storeKey`, `clearStoredKey`,
 * `storedKeyMeta`) are the **only** code that touches users/{id}/*_key.txt.
 * Everything else asks a payer resolver — openAiPayer() in api/openai.php,
 * elevenLabsPayer() in api/elevenlabs.php — which asks these.
 */

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
    $align = forcedAlignment($dest, "{$verse}.mp3", $ctx['payer']['key'] ?? null);
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
 * Delete everything this server holds for the caller: cards, boards, their
 * orders, voices and the voice selection, the stored provider keys, any
 * uploaded recordings, and finally the secret that claimed the identity.
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

// ---------- stored provider keys --------------------------------------------

/**
 * The file each provider's key lives in, under users/{id}/. A provider that is
 * not listed here has no stored key — that is the whole registry.
 */
const PROVIDER_KEY_FILES = [
    'openai' => 'openai_key.txt',
    'elevenlabs' => 'elevenlabs_key.txt',
];

function storedKeyPath(string $userDir, string $provider): string {
    $name = PROVIDER_KEY_FILES[$provider] ?? null;
    if ($name === null) fail(500, 'unknown key provider');
    return $userDir . '/' . $name;
}

/** Facts about a stored key that are not the key (ElevenLabs: `restricted`).
 * Beside the key, never inside it, so the key file stays exactly one key. */
function storedKeyMetaPath(string $userDir, string $provider): string {
    return preg_replace('/\.txt$/', '.meta.json', storedKeyPath($userDir, $provider)) ?? '';
}

/** The caller's own key for a provider, or '' when they have none. Never the
 * shared key — that decision is the payer resolver's. Creates nothing. */
function storedKey(string $userDir, string $provider): string {
    $f = storedKeyPath($userDir, $provider);
    if (!is_readable($f)) return '';
    return trim((string)@file_get_contents($f));
}

/** What storeKey() recorded beside the key; [] when nothing (or no key). */
function storedKeyMeta(string $userDir, string $provider): array {
    return readJsonObjectFile(storedKeyMetaPath($userDir, $provider)) ?? [];
}

/**
 * Store a key so that it is never readable by anyone else, not even for an
 * instant: tempnam() creates the file 0600 *before* the key is written into
 * it, and rename() puts it in place atomically. (The old write-then-chmod left
 * a window in which a fresh key sat in a 0644 file.)
 *
 * The caller's directory must exist — every key writer is in
 * $ACCOUNT_ACTIONS. `$meta` replaces whatever was recorded for the previous
 * key; it is best-effort, because the key is what matters.
 */
function storeKey(string $userDir, string $provider, string $key, array $meta = []): bool {
    $f = storedKeyPath($userDir, $provider);
    $tmp = @tempnam($userDir, '.key-');
    if ($tmp === false) return false;
    // tempnam() falls back to the system temp dir when $userDir is unusable —
    // and a rename from there could cross filesystems, i.e. copy with the
    // destination's default mode. Refuse rather than risk it.
    if (realpath(dirname($tmp)) !== realpath($userDir)) {
        @unlink($tmp);
        return false;
    }
    if (@file_put_contents($tmp, $key) !== strlen($key) || !@chmod($tmp, 0600) || !@rename($tmp, $f)) {
        @unlink($tmp);
        return false;
    }
    $metaPath = storedKeyMetaPath($userDir, $provider);
    if ($meta === []) {
        if (file_exists($metaPath)) @unlink($metaPath);
    } else {
        @file_put_contents($metaPath, json_encode($meta, JSON_UNESCAPED_SLASHES));
    }
    return true;
}

/** Remove a stored key and what was recorded about it. Idempotent, and
 * creates nothing — clearing a key that was never set is a success. */
function clearStoredKey(string $userDir, string $provider): void {
    foreach ([storedKeyPath($userDir, $provider), storedKeyMetaPath($userDir, $provider)] as $f) {
        if (file_exists($f)) @unlink($f);
    }
}

/** Show last-4 chars of a key so the UI can confirm which one is saved
 * without exposing it. Anything shorter than 8 chars is masked entirely. */
function maskKey(string $key): string {
    $len = strlen($key);
    if ($len <= 8) return str_repeat('•', $len);
    return substr($key, 0, 3) . '…' . substr($key, -4);
}

// ---------- the caller's own OpenAI key -------------------------------------

function handleOpenAiKeyStatus(array $ctx): void {
    $key = storedKey($ctx['userDir'], 'openai');
    respond(200, $key === '' ? ['hasKey' => false] : ['hasKey' => true, 'masked' => maskKey($key)]);
}

function handleOpenAiKeySet(array $ctx): void {
    $body = readJsonBody();
    $key = trim(safeString($body['key'] ?? '', 512));
    if ($key === '') fail(400, 'missing key');
    // The key becomes an HTTP header below and on every later OpenAI call; a
    // CR or LF inside it is header injection, not a key. Refused before any
    // network call.
    if (preg_match('/[\x00-\x1F\x7F]/', $key)) fail(400, 'invalid key format');

    // Validate by hitting /v1/models with the submitted key. Cheap, no
    // request body, and surfaces a clear error if the key is rejected.
    $ch = curl_init('https://api.openai.com/v1/models');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 30,
        CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $key],
    ]);
    $r = curlExec($ch);
    $status = $r['status'];
    // An outage proves nothing about the key, so it must not read as a
    // verdict on it: 502, and nothing is stored.
    if ($r['error'] !== null || $status >= 500) {
        fail(502, 'openai_unavailable', [
            'status' => $status,
            'detail' => 'OpenAI could not be reached to check this key, so it was not saved. Please try again.',
        ]);
    }
    if ($status !== 200) {
        $detail = '';
        $decoded = json_decode($r['body'], true);
        if (is_array($decoded) && isset($decoded['error']['message'])) {
            $detail = (string)$decoded['error']['message'];
        }
        fail(400, 'key rejected by OpenAI', ['status' => $status, 'detail' => $detail]);
    }

    if (!storeKey($ctx['userDir'], 'openai', $key)) fail(500, 'could not store key');
    respond(200, ['hasKey' => true, 'masked' => maskKey($key)]);
}

function handleOpenAiKeyClear(array $ctx): void {
    clearStoredKey($ctx['userDir'], 'openai');
    respond(200, ['hasKey' => false]);
}
