<?php
declare(strict_types=1);

// An include, not an endpoint — see APP_ROOT in api.php. Fetched directly this
// file must say nothing: it never runs api.php's ini_set('display_errors', '0').
if (!defined('APP_ROOT')) { http_response_code(404); exit; }

/**
 * The three endpoints that cross accounts, and the only ones that do.
 *
 *   space.peek     read-only: what is at this code? Writes nothing, and needs
 *                  no profile — its whole job is to show an invitation before
 *                  anything is committed.
 *   space.request  the one cross-user *write*: appends a membership row,
 *                  carrying the caller's authenticated id, into the owner's
 *                  file. A requester can never set its own status, and
 *                  re-asking cannot clear a block.
 *   space.feed     the one cross-user *read*: answers an accepted member only,
 *                  with projections rather than stored records.
 */

/**
 * Look at a space without asking for anything — name, owner, and whether the
 * caller already has a membership.
 *
 * Exists because `space.request` *creates* the membership: without a read-only
 * peek, a "do you want to subscribe to X?" confirmation would be showing X only
 * after having already asked on the user's behalf. So this is what an invite
 * link's modal reads, and it is the one community action that writes nothing at
 * all — deliberately not in $ACCOUNT_ACTIONS, and it does not require the
 * caller to have a profile, since the whole point is to be shown the invitation
 * before committing to anything.
 */
function handleSpacePeek(array $ctx): void {
    $body = readJsonBody();
    $code = normalizeShareCode($body['code'] ?? '');
    $target = resolveShareCode($code);

    $space = findById(readJsonArrayFile(spacesPath($target['userDir'])), $target['spaceId']);
    if ($space === null) fail(404, 'unknown share code');
    requireOwnerPublished($target['userDir']);

    $status = null;
    foreach (readJsonArrayFile(membersPath($target['userDir'])) as $m) {
        if (!is_array($m)) continue;
        if (($m['userId'] ?? null) === $ctx['userId'] && ($m['spaceId'] ?? null) === $target['spaceId']) {
            $status = (string)($m['status'] ?? 'pending');
            break;
        }
    }

    respond(200, [
        'status' => $status,
        'space' => publicSpaceOf($space),
        'owner' => publicProfileOf($target['userDir']),
    ]);
}

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
    // Nobody subscribes to themselves. Allowed, it wrote a membership request
    // from the owner into the owner's own file — an invitation from yourself,
    // waiting in your own inbox — and the client then listed the space twice,
    // once as theirs and once as one they follow. The client refuses first so it
    // can explain; this is the half a modified client cannot skip.
    if ($target['userId'] === $ctx['userId']) fail(409, 'own_space');

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
 * Read a space's posts and the headers of its shared items. A cross-user *read*.
 *
 * Answers only for an accepted member, and answers with projections rather
 * than the stored records. Each post keeps its signature intact so the
 * subscriber's client can verify it against the key it pinned — this endpoint
 * is not trusted, and is not asking to be.
 *
 * **Item payloads are not here, on purpose.** This is polled on every
 * foreground, and every 15s while a subscription is pending, so shipping a
 * year-long plan's ~100KB with it would cost megabytes an hour. A header
 * commits to `payloadHash` and so verifies on its own; `space.item` fetches one
 * payload, once per version.
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
            'items' => [],
        ]);
    }

    $path = spacePostsPath($target['userDir'], $target['spaceId']);
    $posts = readJsonArrayFile($path);
    $pruned = pruneExpired($posts, $space['ephemeralHours'] ?? null);
    if (count($pruned) !== count($posts)) writeJsonFile($path, $pruned);

    usort($pruned, fn($a, $b) => (int)($b['publishedAt'] ?? 0) <=> (int)($a['publishedAt'] ?? 0));

    $itemsPath = spaceItemsPath($target['userDir'], $target['spaceId']);
    $items = readJsonArrayFile($itemsPath);
    $prunedItems = pruneExpired($items, $space['ephemeralHours'] ?? null);
    if (count($prunedItems) !== count($items)) writeJsonFile($itemsPath, $prunedItems);

    usort($prunedItems, fn($a, $b) => (int)($b['publishedAt'] ?? 0) <=> (int)($a['publishedAt'] ?? 0));

    respond(200, [
        'status' => 'accepted',
        'space' => publicSpaceOf($space),
        'owner' => publicProfileOf($target['userDir']),
        'posts' => array_slice($pruned, 0, MAX_FEED_POSTS),
        'items' => array_slice($prunedItems, 0, MAX_FEED_ITEMS),
    ]);
}

/**
 * Read one shared item's payload. The second cross-user read.
 *
 * Separate from the feed because of size, not because of access: the same
 * accepted-member gate applies, and the same "not a 403" reasoning would too,
 * except that there is nothing partial to answer with — a caller who may not
 * read the room may not read its plan either.
 *
 * **The item must be listed in the space the code resolves to.** That binding
 * is the whole security content of this endpoint: without it, a code for a room
 * the caller *is* accepted in would fetch any payload in the owner's account,
 * including one from a room they were never let into. Payload files are keyed
 * by item id alone, so the header file is what says which room an id belongs to.
 */
function handleSpaceItem(array $ctx): void {
    $body = readJsonBody();
    $code = normalizeShareCode($body['code'] ?? '');
    $itemId = safeUuid($body['itemId'] ?? '', 'item id');
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
    if ($status !== 'accepted') fail(403, 'not a member of this space');

    $items = pruneExpired(
        readJsonArrayFile(spaceItemsPath($target['userDir'], $target['spaceId'])),
        $space['ephemeralHours'] ?? null,
    );
    $item = findById($items, $itemId);
    if ($item === null) fail(404, 'unknown item');

    $stored = readJsonObjectFile(itemPayloadPath($target['userDir'], $itemId));
    $payload = is_array($stored) ? ($stored['payload'] ?? null) : null;
    if (!is_string($payload)) fail(404, 'unknown item');

    respond(200, ['item' => $item, 'payload' => $payload]);
}
