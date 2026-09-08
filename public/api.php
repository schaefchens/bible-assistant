<?php
declare(strict_types=1);

/**
 * Bible Assistant — the PHP backend.
 *
 * This file is the front door: it loads the fourteen files in api/, then routes
 * `?action=NAME` to a handler. **The switch below is the endpoint list** — it
 * is complete by construction, so nothing here restates it. (There used to be
 * a hand-written list in this docblock; by the time the file reached 2,800
 * lines it was missing the nineteen community actions, tts.speak,
 * bible.chapter, the OpenAI-key trio and moderation.check.)
 *
 * Deploy this file **and api/** to the webspace alongside the built SPA;
 * `scripts/deploy.sh` names both, and one without the other 500s on every
 * request. It assumes:
 *   - the OpenAI key is set as `OPENAI_API_KEY` in a sibling `secrets.php`
 *     (preferred) or in the environment;
 *   - a writable `./storage/` next to this file (created on first request —
 *     see api/bootstrap.php, which also decides what Apache may serve).
 *
 * Auth: X-User-Id (UUID) + X-User-Secret (hex). The first *write* registers the
 * identity — see `authenticate()` / `requireUserDir()` in api/http.php. Reads
 * and the OpenAI proxy work without an account existing at all, so a client
 * that never opts into server sync leaves nothing here.
 *
 * Two rules the router enforces before any handler runs, and the reason it is
 * worth reading top to bottom: `$ACCOUNT_ACTIONS` is the whole set of actions
 * that bring a user directory into existence, and `$OPENAI_ACTIONS` the whole
 * set that resolve a key. Adding an action to either has consequences the
 * handler cannot see.
 */

ini_set('display_errors', '0');
error_reporting(E_ALL);

/**
 * The directory this file sits in — the web root, holding storage/, bibles/ and
 * secrets.php.
 *
 * Named rather than spelled `__DIR__` at the point of use, because the handlers
 * live one level down in api/ and `__DIR__` there means api/. That is not a
 * hypothetical: splitting this file moved three paths (secrets.php, STORAGE_DIR
 * and the Zefania XML) into api/ silently, and the backend answered every
 * moderation check "unchecked, fails open" because it could no longer find the
 * key. Anything resolving a path against the deployment root uses this.
 */
const APP_ROOT = __DIR__;

// ---------- the backend, in fourteen files ----------------------------------
//
// Loaded in dependency order, all of them, before anything is dispatched —
// PHP hoists each file's top-level functions, so the router below can call
// into any of them. Each file's own docblock says what it owns.
//
// bootstrap  what exists on disk, and what Apache may serve
// http       respond/fail, input narrowing, identity, CORS
// store      the JSON files under storage/, and the generic collection endpoints
// openai     which key pays, the curl shapes, how a failure is reported
// chat       the assistant proxy
// audio      tts, tts.speak, forced alignment, transcribe
// bible      Zefania XML -> verses
// account    the caller's own key, account.delete, recording, ambient
// community  what a space is on disk: paths, sanitizers, codes, signatures
// spaces     the owner's own community endpoints
// sharing    the three endpoints that cross accounts
// moderation the content standards, and the judge
// reports    report.create
// feedback   feedback.create

require_once __DIR__ . '/api/bootstrap.php';
require_once __DIR__ . '/api/http.php';
require_once __DIR__ . '/api/store.php';
require_once __DIR__ . '/api/openai.php';
require_once __DIR__ . '/api/chat.php';
require_once __DIR__ . '/api/audio.php';
require_once __DIR__ . '/api/bible.php';
require_once __DIR__ . '/api/account.php';
require_once __DIR__ . '/api/community.php';
require_once __DIR__ . '/api/spaces.php';
require_once __DIR__ . '/api/sharing.php';
require_once __DIR__ . '/api/moderation.php';
require_once __DIR__ . '/api/reports.php';
require_once __DIR__ . '/api/feedback.php';

// ---------- routing ---------------------------------------------------------

// Skip the router when included by a CLI test harness (no HTTP request).
if (PHP_SAPI === 'cli' && !defined('BIBLE_API_RUN_ROUTER')) return;

// Emit CORS headers before anything can fail(), so even 401s and 500s carry
// them — otherwise a cross-origin caller sees an opaque "Failed to fetch"
// instead of the real status.
$corsOrigin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($corsOrigin !== '') {
    // Vary even when the origin is rejected, so no proxy caches one origin's
    // ACAO (or its absence) for another.
    header('Vary: Origin');
    if (corsOriginAllowed($corsOrigin)) {
        header('Access-Control-Allow-Origin: ' . $corsOrigin);
        header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
        header('Access-Control-Allow-Headers: Content-Type, X-User-Id, X-User-Secret, X-Prefer-Shared-Key, X-Base-Path');
        header('Access-Control-Max-Age: 86400');
    }
}

// Answer the preflight before the ?action / requireAuth() gauntlet below —
// OPTIONS carries no custom headers, so it would otherwise 401.
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$action = $_GET['action'] ?? '';
if (!is_string($action) || $action === '') fail(400, 'missing action');

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$ctx = authenticate();

// The actions that store per-user data — and so bring the account into
// existence. Everything else works dir-less: the OpenAI proxy needs no storage,
// bible.chapter and ambient.list serve shared content, and the cards/boards/key
// *readers* all guard with file_exists()/is_readable() and answer empty.
$ACCOUNT_ACTIONS = [
    'cards.upsert', 'cards.delete', 'cards.order.set',
    'boards.upsert', 'boards.delete', 'boards.order.set',
    'readingLists.upsert', 'readingLists.delete', 'readingProgress.set',
    'auth.openaiKey.set', 'recording.upload',
    // Community writers. `space.request` is NOT here: it writes into the
    // *owner's* directory, and the caller's own dir already exists because
    // profile.set is a precondition for asking at all.
    'profile.set', 'profile.avatar.upload',
    'spaces.upsert', 'spaces.delete', 'spaces.code.set',
    'posts.upsert', 'posts.delete',
    'members.decide', 'subscriptions.upsert', 'subscriptions.delete',
];
if (in_array($action, $ACCOUNT_ACTIONS, true)) {
    requireUserDir($ctx);
}

// Resolve the effective OpenAI key once per request — prefer the caller's
// own key over the shared OPENAI_API_KEY so usage bills to their account.
// Honoured by every handler that touches OpenAI; the new auth.openaiKey.set
// handler ignores this and uses the freshly-submitted key for validation.
$OPENAI_ACTIONS = ['chat', 'tts', 'tts.speak', 'transcribe', 'recording.upload'];
$ctx['preferShared'] = (($_SERVER['HTTP_X_PREFER_SHARED_KEY'] ?? '') === '1');
if (in_array($action, $OPENAI_ACTIONS, true)) {
    $ctx['openaiKey'] = effectiveOpenAiKey($ctx, $ctx['preferShared']);
    if ($ctx['openaiKey'] === '') {
        fail(500, 'no OpenAI API key configured');
    }
}

switch ($action) {
    case 'chat':
        handleChat($ctx);
        break;
    case 'tts':
        handleTts($ctx);
        break;
    case 'tts.speak':
        handleTtsSpeak($ctx);
        break;
    case 'bible.chapter':
        handleBibleChapter();
        break;
    case 'transcribe':
        handleTranscribe($ctx);
        break;
    case 'auth.openaiKey.status':
        handleOpenAiKeyStatus($ctx);
        break;
    case 'auth.openaiKey.set':
        handleOpenAiKeySet($ctx);
        break;
    case 'auth.openaiKey.clear':
        handleOpenAiKeyClear($ctx);
        break;
    case 'cards.list':
        handleListJson($ctx['userDir'] . '/cards.json', 'cards');
        break;
    case 'cards.upsert':
        handleUpsertItem($ctx['userDir'] . '/cards.json', 'card', 'cards');
        break;
    case 'cards.delete':
        handleDeleteItem($ctx['userDir'] . '/cards.json', 'cards');
        break;
    case 'cards.order.get':
        handleOrderGet($ctx['userDir'] . '/cardOrder.json');
        break;
    case 'cards.order.set':
        handleOrderSet($ctx['userDir'] . '/cardOrder.json');
        break;
    case 'boards.list':
        handleListJson($ctx['userDir'] . '/boards.json', 'boards');
        break;
    case 'boards.upsert':
        handleUpsertItem($ctx['userDir'] . '/boards.json', 'board', 'boards');
        break;
    case 'boards.delete':
        handleDeleteItem($ctx['userDir'] . '/boards.json', 'boards');
        break;
    case 'boards.order.get':
        handleOrderGet($ctx['userDir'] . '/boardOrder.json');
        break;
    case 'boards.order.set':
        handleOrderSet($ctx['userDir'] . '/boardOrder.json');
        break;
    case 'readingLists.list':
        handleListJson($ctx['userDir'] . '/readingLists.json', 'readingLists');
        break;
    case 'readingLists.upsert':
        handleUpsertItem($ctx['userDir'] . '/readingLists.json', 'readingList', 'readingLists');
        break;
    case 'readingLists.delete':
        handleDeleteReadingList($ctx['userDir']);
        break;
    case 'readingProgress.list':
        handleListJson($ctx['userDir'] . '/readingProgress.json', 'progress');
        break;
    case 'readingProgress.set':
        handleUpsertProgress($ctx['userDir'] . '/readingProgress.json');
        break;
    case 'recording.upload':
        handleRecordingUpload($ctx);
        break;
    case 'account.delete':
        handleAccountDelete($ctx);
        break;
    case 'ambient.list':
        handleAmbientList();
        break;

    // Community spaces. The readers answer empty for an account that has never
    // published, like every other reader here, so nothing below requires a
    // directory to exist.
    case 'profile.get':
        handleProfileGet($ctx);
        break;
    case 'profile.set':
        handleProfileSet($ctx);
        break;
    case 'profile.delete':
        handleProfileDelete($ctx);
        break;
    case 'profile.avatar.upload':
        handleAvatarUpload($ctx);
        break;
    case 'spaces.list':
        handleListJson(spacesPath($ctx['userDir']), 'spaces');
        break;
    case 'spaces.upsert':
        handleSpaceUpsert($ctx);
        break;
    case 'spaces.delete':
        handleSpaceDelete($ctx);
        break;
    case 'spaces.code.set':
        handleSpaceCodeSet($ctx);
        break;
    case 'posts.list':
        handlePostsList($ctx);
        break;
    case 'posts.upsert':
        handlePostUpsert($ctx);
        break;
    case 'posts.delete':
        handlePostDelete($ctx);
        break;
    case 'members.list':
        handleMembersList($ctx);
        break;
    case 'members.decide':
        handleMemberDecide($ctx);
        break;
    case 'subscriptions.list':
        handleListJson(subscriptionsPath($ctx['userDir']), 'subscriptions');
        break;
    case 'subscriptions.upsert':
        handleSubscriptionUpsert($ctx);
        break;
    case 'subscriptions.delete':
        handleSubscriptionDelete($ctx);
        break;
    case 'space.peek':
        handleSpacePeek($ctx);
        break;
    case 'space.request':
        handleSpaceRequest($ctx);
        break;
    case 'space.feed':
        handleSpaceFeed($ctx);
        break;
    case 'report.create':
        handleReportCreate($ctx);
        break;
    case 'moderation.check':
        handleModerationCheck($ctx);
        break;

    // In-app feedback. Not a community action and not an account action: it
    // writes into its own directory, so a user who has never opted into sync
    // (and so has no directory here at all) can still report a bug.
    case 'feedback.create':
        handleFeedbackCreate($ctx);
        break;
    default:
        fail(404, 'unknown action');
}

