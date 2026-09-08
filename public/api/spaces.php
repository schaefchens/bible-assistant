<?php
declare(strict_types=1);

// An include, not an endpoint — see APP_ROOT in api.php. Fetched directly this
// file must say nothing: it never runs api.php's ini_set('display_errors', '0').
if (!defined('APP_ROOT')) { http_response_code(404); exit; }

/**
 * The owner's own community data: their profile, spaces, posts, the
 * membership decisions on their spaces, their subscriptions, and their avatar.
 *
 * Every endpoint here reads and writes only the caller's own directory. The
 * three that reach into somebody else's are api/sharing.php.
 */

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

    // The un-bypassable half of the moderation check. The client asks
    // `moderation.check` first so it can tell the author why at the moment
    // they pressed publish; this is what makes skipping that ask pointless.
    // Cached by content, so the two questions cost one judgment.
    $verdict = moderatePiece($post['title'], $post['body'], $post['language']);
    if (!$verdict['ok']) fail(422, 'content_refused', ['reason' => $verdict['reason']]);

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
