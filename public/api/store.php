<?php
declare(strict_types=1);

// An include, not an endpoint — see APP_ROOT in api.php. Fetched directly this
// file must say nothing: it never runs api.php's ini_set('display_errors', '0').
if (!defined('APP_ROOT')) { http_response_code(404); exit; }

/**
 * Reading and writing the JSON files under storage/, and the generic
 * collection endpoints built on them.
 *
 * `handleListJson` / `handleUpsertItem` / `handleDeleteItem` / the order pair
 * are shape-agnostic on purpose: cards, boards and reading lists are the same
 * endpoint three times over, differing only in a filename and a key.
 * `handleUpsertProgress` is the one writer that *merges* rather than replaces
 * — see the union rule in its docblock.
 */

/** Read a JSON array file, answering [] for missing, empty or corrupt. */
function readJsonArrayFile(string $path): array {
    if (!file_exists($path)) return [];
    $raw = @file_get_contents($path);
    if (!$raw) return [];
    $items = json_decode($raw, true);
    return is_array($items) ? $items : [];
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

/** Read a single JSON object file (the profile), or null. */
function readJsonObjectFile(string $path): ?array {
    if (!file_exists($path)) return null;
    $raw = @file_get_contents($path);
    if (!$raw) return null;
    $obj = json_decode($raw, true);
    return is_array($obj) ? $obj : null;
}
