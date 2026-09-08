<?php
declare(strict_types=1);

// An include, not an endpoint — see APP_ROOT in api.php. Fetched directly this
// file must say nothing: it never runs api.php's ini_set('display_errors', '0').
if (!defined('APP_ROOT')) { http_response_code(404); exit; }

/**
 * The account itself: the caller's own OpenAI key, erasing everything stored
 * for an identity, a training recording, and the ambient music listing.
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
