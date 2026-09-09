<?php
declare(strict_types=1);

// An include, not an endpoint — see APP_ROOT in api.php. Fetched directly this
// file must say nothing: it never runs api.php's ini_set('display_errors', '0').
if (!defined('APP_ROOT')) { http_response_code(404); exit; }

/**
 * What a space is on disk: where each file lives, what may cross to another
 * user, how a share code resolves, and whether a post's signature holds.
 *
 * The shared vocabulary of api/spaces.php (the owner's own endpoints) and
 * api/sharing.php (the three that cross accounts). Two rules live here and
 * are the reason it is one file:
 *
 *   - a share code is the only way to name a space, so `resolveShareCode` is
 *     the only lookup from a caller-supplied name to an account;
 *   - nothing user-authored is echoed verbatim to another user, so every
 *     record crossing accounts goes through a `sanitize*` whitelist — which
 *     for a post is additionally enforced by the signature, since the client
 *     signs exactly the fields kept.
 */

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
/** A room's shared items — plans and boards. Headers only; see itemPayloadPath. */
function spaceItemsPath(string $userDir, string $spaceId): string {
    return $userDir . '/items/' . $spaceId . '.json';
}
/**
 * One shared item's payload, in a file of its own.
 *
 * Kept out of the header file because space.feed is polled on every foreground
 * — and every 15s while a subscription is pending — so a room's worth of plans
 * riding along would be megabytes an hour. Callers must pass an id that has
 * been through `safeUuid`: this is the one place in the community code where a
 * caller-supplied string becomes a filename.
 */
function itemPayloadPath(string $userDir, string $itemId): string {
    return $userDir . '/payloads/' . $itemId . '.json';
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

/**
 * Whitelist one shared item **header**.
 *
 * Same standing as sanitizePost: every field here is covered by the client's
 * signature, so getting it wrong makes an honest plan fail verification on the
 * reader's device rather than merely letting something odd through.
 *
 * The payload is deliberately not part of this. It is an opaque JSON string as
 * far as PHP is concerned — validated for size and well-formedness, never
 * reshaped — which is what keeps the plan and board schemas from existing a
 * second time here, in a language that would have to be kept in agreement with
 * TypeScript by hand.
 */
function sanitizeSharedItem(array $it): array {
    $kind = ($it['kind'] ?? '') === 'board' ? 'board' : 'plan';
    $lang = ($it['language'] ?? '') === 'de' ? 'de' : 'en';
    $sig = optString($it['signature'] ?? null, 256);
    $key = optString($it['authorKey'] ?? null, 128);
    $hash = strtolower(safeString($it['payloadHash'] ?? '', 128));
    if ($sig !== null && !preg_match('/^[0-9a-f]{128}$/i', $sig)) fail(400, 'invalid signature');
    if ($key !== null && !preg_match('/^[0-9a-f]{64}$/i', $key)) fail(400, 'invalid authorKey');
    if (!preg_match('/^[0-9a-f]{64}$/', $hash)) fail(400, 'invalid payloadHash');
    return [
        'id' => safeUuid($it['id'] ?? '', 'item id'),
        'spaceId' => safeUuid($it['spaceId'] ?? '', 'space id'),
        'kind' => $kind,
        'title' => safeString($it['title'] ?? '', 200),
        'language' => $lang,
        'payloadHash' => $hash,
        'payloadBytes' => safeInt($it['payloadBytes'] ?? 0),
        'publishedAt' => safeInt($it['publishedAt'] ?? 0),
        'createdAt' => safeInt($it['createdAt'] ?? 0),
        'updatedAt' => safeInt($it['updatedAt'] ?? 0),
        'signature' => $sig === null ? null : strtolower($sig),
        'authorKey' => $key === null ? null : strtolower($key),
        'sigVersion' => optString($it['sigVersion'] ?? null, 32),
    ];
}

/** The shared-item twin of verifyPostSignature; everything said there applies. */
function verifyItemSignature(array $item): bool {
    if (!$item['signature'] || !$item['authorKey'] || $item['sigVersion'] !== 'ba.item.v1') return false;
    if (!function_exists('sodium_crypto_sign_verify_detached')) return true;
    $message = implode("\n", [
        'ba.item.v1',
        strtolower((string)$item['authorKey']),
        (string)$item['spaceId'],
        (string)$item['id'],
        (string)$item['kind'],
        (string)(int)$item['publishedAt'],
        (string)(int)$item['updatedAt'],
        (string)$item['language'],
        hash('sha256', (string)$item['title']),
        strtolower((string)$item['payloadHash']),
    ]);
    try {
        return sodium_crypto_sign_verify_detached(
            hex2bin((string)$item['signature']),
            $message,
            hex2bin((string)$item['authorKey']),
        );
    } catch (\Throwable) {
        return false;
    }
}

/**
 * Every human-written string inside a payload, for the moderator to judge.
 *
 * A plan's day titles and entry labels, and a board's card titles and notes,
 * are free text going to other people, so they have to go through the same
 * judge a piece does. That check has to run **here** — a check the client
 * performs is a check a modified client skips — which means the server needs
 * the text without knowing the schema.
 *
 * So: walk the decoded JSON and collect every string. Domain-ignorant by
 * design, so a payload shape this build has never seen is still judged.
 * Single characters and uuids are dropped as noise; nothing else is
 * interpreted. The result is capped, because MODERATION_POLICY plus a whole
 * year-plan would be a large prompt for no extra signal.
 */
function moderationTextOf(string $payload): string {
    $decoded = json_decode($payload, true);
    $out = [];
    $walk = function (mixed $node) use (&$walk, &$out): void {
        if (is_string($node)) {
            if (mb_strlen($node) > 1 && !preg_match('/^[0-9a-fA-F-]{36}$/', $node)) $out[] = $node;
            return;
        }
        if (is_array($node)) foreach ($node as $child) $walk($child);
    };
    $walk($decoded);
    return mb_substr(implode("\n", $out), 0, 12000);
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
