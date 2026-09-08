<?php
declare(strict_types=1);

// An include, not an endpoint — see APP_ROOT in api.php. Fetched directly this
// file must say nothing: it never runs api.php's ini_set('display_errors', '0').
if (!defined('APP_ROOT')) { http_response_code(404); exit; }

/**
 * In-app feedback: the bug button.
 *
 * Deliberately outside both gates — not in $ACCOUNT_ACTIONS and not a
 * community action — because the whole point is that it works for the tester
 * whose app is broken and for the one who never opted into sync. It needs no
 * profile either, unlike report.create: that is about somebody else's writing,
 * and this is about the app.
 */

/**
 * Receive in-app feedback: a bug report, a feature request, or a remark.
 *
 * Addressed to the maintainer rather than to another user, which is what makes
 * it the *simplest* write in this file — no triage, no signature, no
 * projection, nothing crossing between two accounts. Four things are still
 * deliberate:
 *
 *  - **No profile and no account directory are required.** It is not in
 *    $ACCOUNT_ACTIONS and does not read profilePath(): the whole point of a
 *    bug button is that it works for the tester whose app is broken, and for
 *    the one who never opted into server sync. Nothing here touches
 *    storage/users/.
 *  - **The context is whitelisted, not stored as sent.** Every field lands in
 *    front of the maintainer's eyes, and a client may put anything in the body.
 *    The user agent is taken from the request instead of the body for the same
 *    reason: the real one is right here.
 *  - **One file per (identity, kind, message).** Re-tapping send after a
 *    request that actually succeeded overwrites rather than piling up. Order is
 *    carried by `reportedAt` inside the file, not by the filename.
 *  - **A per-identity cap**, enforced by counting that user's own directory.
 *    There is no rate limiting anywhere in this file and this is the one write
 *    a stranger can reach with nothing set up, so it gets a ceiling like every
 *    community collection does.
 */
function handleFeedbackCreate(array $ctx): void {
    $body = readJsonBody();

    // Same three values as the client's FeedbackKind union. Anything else is a
    // client bug, not feedback.
    $kind = safeString($body['kind'] ?? '', 16);
    if (!in_array($kind, ['feedback', 'feature', 'bug'], true)) fail(400, 'invalid kind');

    $message = trim(safeString($body['message'] ?? '', MAX_FEEDBACK_MESSAGE));
    if ($message === '') fail(400, 'message required');

    $sent = is_array($body['context'] ?? null) ? $body['context'] : [];
    $context = [
        'route' => optString($sent['route'] ?? null, 200),
        'commit' => optString($sent['commit'] ?? null, 60),
        'buildTime' => optString($sent['buildTime'] ?? null, 40),
        'platform' => optString($sent['platform'] ?? null, 40),
        'locale' => optString($sent['locale'] ?? null, 20),
        'viewport' => optString($sent['viewport'] ?? null, 40),
        'online' => isset($sent['online']) ? (bool)$sent['online'] : null,
        'userAgent' => substr((string)($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 400),
    ];

    // authenticate() has already matched the id against /^[0-9a-f-]{36}$/, so
    // it holds no path separators and cannot escape this directory.
    $dir = FEEDBACK_DIR . '/' . $ctx['userId'];
    if (!is_dir($dir) && !@mkdir($dir, 0775, true)) fail(500, 'could not store feedback');

    $name = hash('sha256', $kind . '|' . $message) . '.json';
    $path = $dir . '/' . $name;
    if (!file_exists($path)) {
        $held = glob($dir . '/*.json') ?: [];
        if (count($held) >= MAX_FEEDBACK_PER_USER) fail(429, 'too much feedback');
    }

    writeJsonFile($path, [
        'reportedAt' => (int)(microtime(true) * 1000),
        'kind' => $kind,
        'message' => $message,
        'userId' => $ctx['userId'],
        'context' => $context,
    ]);

    respond(200, ['received' => true]);
}
