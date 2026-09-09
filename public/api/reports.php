<?php
declare(strict_types=1);

// An include, not an endpoint — see APP_ROOT in api.php. Fetched directly this
// file must say nothing: it never runs api.php's ini_set('display_errors', '0').
if (!defined('APP_ROOT')) { http_response_code(404); exit; }

/**
 * Reporting somebody else's writing.
 *
 * The third action that crosses accounts and the only one addressed to
 * neither party: storage/reports/ is HTTP-denied, so the author can neither
 * see that they were reported nor delete what was said. The reported text is
 * snapshotted, because deleting the piece is the obvious first move after
 * being reported.
 */

/**
 * Report a piece, or a whole space, to the app's moderators.
 *
 * The third action that crosses accounts, and the only one addressed to
 * neither party: it writes into REPORTS_DIR, which is HTTP-denied, so the
 * author can neither see that they were reported nor delete what was said.
 *
 * Three things about it are deliberate:
 *
 *  - **The reported text is snapshotted here.** Deleting the piece is the
 *    obvious first move after being reported, and a report that says only
 *    "post 4f2c… was sexual content" is unactionable once the post is gone.
 *  - **One file per (reporter, target).** The name is a hash of the pair, so
 *    re-reporting the same piece overwrites rather than piling up — reports
 *    are bounded by how much a user can actually see, not by how fast a client
 *    can loop.
 *  - **A profile is required**, like `space.request`: you cannot see somebody
 *    else's writing without one, so a report from an account with no profile is
 *    not a report about anything. It is not in $ACCOUNT_ACTIONS for the same
 *    reason that action isn't — the caller's directory already exists.
 */
function handleReportCreate(array $ctx): void {
    $body = readJsonBody();
    $code = normalizeShareCode($body['code'] ?? '');
    $postId = optString($body['postId'] ?? null, 64);
    $reason = safeString($body['reason'] ?? '', 32);
    $note = optString($body['note'] ?? null, MAX_REPORT_NOTE);

    // Same list as the client's ReportReason union and the accepted content
    // standards. Anything else is a client bug, not a report.
    $reasons = ['offtopic', 'political', 'sexual', 'dating', 'hate', 'spam', 'other'];
    if (!in_array($reason, $reasons, true)) fail(400, 'invalid reason');

    $me = readJsonObjectFile(profilePath($ctx['userDir']));
    if ($me === null) fail(403, 'profile_required');

    $target = resolveShareCode($code);
    $space = findById(readJsonArrayFile(spacesPath($target['userDir'])), $target['spaceId']);
    if ($space === null) fail(404, 'unknown share code');

    // A report names one thing in the room, and a room holds three kinds. They
    // are snapshotted into the same fields on purpose: the human queue should
    // read uniformly, and "what was reported" is a title plus some of its text
    // whichever kind it was. `targetKind` says which, for anyone acting on it.
    $post = null;
    $targetKind = 'space';
    if ($postId !== null && $postId !== '') {
        $posts = readJsonArrayFile(spacePostsPath($target['userDir'], $target['spaceId']));
        $post = findById($posts, $postId);
        if ($post !== null) {
            $targetKind = 'post';
        } else {
            $items = readJsonArrayFile(spaceItemsPath($target['userDir'], $target['spaceId']));
            $item = findById($items, $postId);
            if ($item === null) fail(404, 'unknown post');
            $targetKind = (string)($item['kind'] ?? 'plan');
            // The payload is the reported text — deleting the item is the
            // obvious first move after being reported, so it is copied here.
            $stored = readJsonObjectFile(itemPayloadPath($target['userDir'], $postId));
            $payload = is_array($stored) ? (string)($stored['payload'] ?? '') : '';
            $post = [
                'id' => $item['id'] ?? '',
                'title' => $item['title'] ?? '',
                'body' => $payload === '' ? '' : moderationTextOf($payload),
                'publishedAt' => $item['publishedAt'] ?? 0,
                'authorKey' => $item['authorKey'] ?? '',
            ];
        }
    }

    $ownerProfile = readJsonObjectFile(profilePath($target['userDir']));
    $now = (int)(microtime(true) * 1000);
    $report = [
        'reportedAt' => $now,
        'reason' => $reason,
        'note' => $note,
        'reporterUserId' => $ctx['userId'],
        'reporterName' => safeString($me['displayName'] ?? '', 120),
        'ownerUserId' => $target['userId'],
        'ownerName' => safeString($ownerProfile['displayName'] ?? '', 120),
        'shareCode' => $code,
        'spaceId' => $target['spaceId'],
        'spaceName' => safeString($space['name'] ?? '', 200),
        'targetKind' => $targetKind,
        'postId' => $post === null ? null : safeString($post['id'] ?? '', 64),
        'postTitle' => $post === null ? null : safeString($post['title'] ?? '', 300),
        'postPublishedAt' => $post === null ? null : (int)($post['publishedAt'] ?? 0),
        'postAuthorKey' => $post === null ? null : safeString($post['authorKey'] ?? '', 128),
        'postExcerpt' => $post === null
            ? null
            : mb_substr((string)($post['body'] ?? ''), 0, MAX_REPORT_EXCERPT),
    ];

    // Triaged, not filtered: a plausible report goes to the human queue, one
    // that plainly is not goes to the sub-directory, and the reporter is told
    // the same thing either way. Telling someone their report was dismissed by
    // a model teaches them to stop reporting and teaches an abuser what passes.
    $triage = triageReport($reason, $note, $post, (string)($space['name'] ?? ''));
    $report['triage'] = $triage['checked'] ? ($triage['ok'] ? 'valid' : 'unfounded') : 'unchecked';
    $report['triageReason'] = $triage['reason'];
    $report['triageModel'] = $triage['checked'] ? MODERATION_MODEL : null;

    $name = hash('sha256', $ctx['userId'] . '|' . ($postId ?: 'space:' . $target['spaceId']));
    $dir = $report['triage'] === 'unfounded' ? REPORTS_UNFOUNDED_DIR : REPORTS_DIR;
    writeJsonFile($dir . '/' . $name . '.json', $report);
    // One report per reporter and target, wherever it was previously filed: a
    // re-report after an edit must not leave a stale copy in the other queue.
    $other = $report['triage'] === 'unfounded' ? REPORTS_DIR : REPORTS_UNFOUNDED_DIR;
    if (file_exists($other . '/' . $name . '.json')) @unlink($other . '/' . $name . '.json');

    respond(200, ['reported' => true]);
}
