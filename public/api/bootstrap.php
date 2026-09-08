<?php
declare(strict_types=1);

// An include, not an endpoint — see APP_ROOT in api.php. Fetched directly this
// file must say nothing: it never runs api.php's ini_set('display_errors', '0').
if (!defined('APP_ROOT')) { http_response_code(404); exit; }

/**
 * What exists on disk, and what Apache is allowed to serve.
 *
 * Loaded first and for its side effects: it reads secrets.php, resolves
 * BASE_PATH, declares the storage constants, creates the directories and
 * writes the .htaccess files that deny HTTP access to everything holding
 * user-authored text. Nothing here answers a request.
 *
 * A constant lives here when this file's own directory setup needs it, and
 * with its domain otherwise — MODERATION_DIR is here because a directory is
 * created for it; MODERATION_POLICY is in api/moderation.php beside the judge
 * that applies it.
 */

$secretsPath = APP_ROOT . '/secrets.php';
if (file_exists($secretsPath)) {
    require_once $secretsPath;
}

if (!defined('OPENAI_API_KEY')) {
    define('OPENAI_API_KEY', getenv('OPENAI_API_KEY') ?: '');
}

const STORAGE_DIR = APP_ROOT . '/storage';
const USERS_DIR = STORAGE_DIR . '/users';
const AUDIO_DIR = STORAGE_DIR . '/audio';
/**
 * code -> {userId, spaceId}. The only way to name somebody else's space.
 *
 * Denied to HTTP below: these files map codes to the accounts that own them,
 * so serving or listing them would hand out every space on the server. That is
 * about not leaking the *directory*, not about the codes being secrets.
 */
const SHARES_DIR = STORAGE_DIR . '/shares';
/** Content-addressed profile pictures. Served statically, unlike everything
 * else a user owns — see the note where the directory is created. */
const AVATARS_DIR = STORAGE_DIR . '/avatars';
// Moderation reports. Addressed to nobody: neither the reporter nor the
// reported author can read this directory back, which is what stops an author
// deleting the evidence against them.
const REPORTS_DIR = STORAGE_DIR . '/reports';
/**
 * Reports the triage judged unfounded. Kept, not dropped: an automated
 * dismissal that deletes the complaint is unauditable, and the judge is
 * wrong sometimes.
 */
const REPORTS_UNFOUNDED_DIR = REPORTS_DIR . '/unfounded';
/** Cached moderation verdicts, content-addressed like generated speech. */
const MODERATION_DIR = STORAGE_DIR . '/moderation';
/** A report carries a snapshot of the offending text, capped so a report can't
 * be used to store arbitrary data on the server. */
const MAX_REPORT_NOTE = 1000;
const MAX_REPORT_EXCERPT = 2000;

/**
 * In-app feedback: bug reports, feature requests, and plain remarks.
 *
 * Addressed to the maintainer, not to another user, so unlike REPORTS_DIR it
 * needs no triage and no snapshot of anybody else's writing — but it is still
 * user-authored text plus a device fingerprint (route, build, user agent), so
 * it gets the same HTTP deny as everything else here.
 *
 * One sub-directory per identity, which is what makes MAX_FEEDBACK_PER_USER
 * enforceable with a single scandir. There is no rate limiting anywhere in
 * this file, and a feedback box is the one write in the app that a stranger
 * can reach with no profile, no account directory and no sync opt-in.
 */
const FEEDBACK_DIR = STORAGE_DIR . '/feedback';
const MAX_FEEDBACK_MESSAGE = 4000;
const MAX_FEEDBACK_PER_USER = 50;

/*
 * Caps on community data.
 *
 * These are the first user-authored content this server holds that another
 * user can read, and there is no rate limiting anywhere, so every collection
 * gets a ceiling. They are generous for real use and small enough that a
 * whole-file rewrite stays cheap: MAX_POST_BYTES x MAX_POSTS_PER_SPACE is the
 * worst-case size of one posts/{spaceId}.json.
 */
const MAX_POST_BYTES = 8000;
const MAX_POSTS_PER_SPACE = 200;
const MAX_SPACES_PER_USER = 20;
const MAX_MEMBERS_PER_SPACE = 500;
const MAX_SUBSCRIPTIONS_PER_USER = 200;
const MAX_FEED_POSTS = 50;
const MAX_AVATAR_BYTES = 512 * 1024;

/**
 * URL prefix under which the SPA + this api.php are served.
 * Production: '' — the app sits at the root of its own subdomain. Resolution order:
 *   1) define('BASE_PATH', ...) in secrets.php
 *   2) BIBLE_ASSISTANT_BASE_PATH env var
 *   3) X-Base-Path request header (Vite dev proxy sets this)
 *   4) Auto-detect from REQUEST_URI
 */
if (!defined('BASE_PATH')) {
    $resolved = '';
    $envBase = getenv('BIBLE_ASSISTANT_BASE_PATH');
    $headerBase = $_SERVER['HTTP_X_BASE_PATH'] ?? '';
    $req = $_SERVER['REQUEST_URI'] ?? '';
    if ($envBase !== false && $envBase !== '') {
        $resolved = $envBase;
    } elseif ($headerBase !== '') {
        $resolved = $headerBase;
    } elseif (preg_match('#^(/[^/?]+)/(api\.php|storage)#', $req, $m)) {
        $resolved = $m[1];
    }
    define('BASE_PATH', rtrim($resolved, '/'));
}
const AUDIO_BASE_URL = '/storage/audio'; // joined with BASE_PATH below

/**
 * Translation code -> Zefania XML filename under public/bibles/ (a.k.a.
 * dist/bibles/ on the deployed server). Any code not in this map is
 * rejected by handleBibleChapter() with a 400.
 */
const BIBLE_XML_MAP = [
    'S00'  => 's00.xml',
    'ESV'  => 'esv.xml',
    'KJV'  => 'kjv.xml',
    'NKJV' => 'nkjv.xml',
    'LUT'  => 'lut.xml',
    'HFA'  => 'hfa.xml',
    'S51'  => 's51.xml',
    'ELB'  => 'elb.xml',
];

/** Cache schema marker. Bump when the verse JSON shape changes so stale
 * entries on disk get invalidated on next read. */
const BIBLE_CACHE_FORMAT = 'xml-v2';

const CHAT_MODEL_DEFAULT = 'gpt-4o-mini';

const TTS_MODEL = 'gpt-4o-mini-tts';
/** Plain STT for voice input — fastest/best for the chat composer. */
const STT_MODEL = 'gpt-4o-transcribe';
/** Forced word-alignment requires verbose_json + word timestamps; only whisper-1 supports both. */
const ALIGNMENT_MODEL = 'whisper-1';

/**
 * The storage tree, created on first request.
 *
 * A directory is listed in exactly one of the two groups below, and which one
 * decides whether Apache will serve it. `denyHttp()` is what makes that a
 * decision rather than an oversight: it was written out five times, twelve
 * lines each, and the sixth sensitive directory would have been one
 * copy-paste away from being world-readable.
 *
 * `community:verify:api` asserts the deny is present for every directory
 * holding user-authored text, which is the check that keeps this honest.
 */

/** Deny all HTTP access to a directory. PHP keeps reading via the filesystem. */
function denyHttp(string $dir): void {
    $path = $dir . '/.htaccess';
    if (file_exists($path)) return;
    @file_put_contents(
        $path,
        "Require all denied\n" .
        "<IfModule !mod_authz_core.c>\n" .
        "  Order deny,allow\n" .
        "  Deny from all\n" .
        "</IfModule>\n",
    );
}

/**
 * Directories whose contents are user-authored text, an identity, or a device
 * fingerprint. None of it is ever served over HTTP.
 *
 *   users/       secret.txt and openai_key.txt, plus every card and list. A
 *                userId travels on every request, so without this anyone
 *                knowing one could GET the secret it authenticates with.
 *   shares/      code -> the account owning it: serving these would enumerate
 *                every space on the server.
 *   reports/     who reported whom. Only the maintainer, over SFTP, reads it —
 *                which is what stops an author deleting the evidence.
 *   moderation/  cached verdicts, and a verdict quotes the text it judged.
 *   feedback/    what testers wrote, with the route and user agent they wrote
 *                it from.
 */
const PRIVATE_DIRS = [USERS_DIR, SHARES_DIR, REPORTS_DIR, MODERATION_DIR, FEEDBACK_DIR];

/**
 * Directories served statically, deliberately.
 *
 *   audio/    the generated-speech cache, content-addressed and shared by
 *             every user — the first person to hear a paragraph pays for it.
 *   ambient/  the music tracks. Content, not user data.
 *   avatars/  an <img src> needs a real URL. Content-addressed by sha256, so
 *             unguessable, but permanent and public once known — which is the
 *             trade a profile picture makes. Nothing else a user owns is
 *             served this way.
 */
const PUBLIC_DIRS = [AUDIO_DIR, STORAGE_DIR . '/ambient', AVATARS_DIR];

foreach ([STORAGE_DIR, REPORTS_UNFOUNDED_DIR, ...PRIVATE_DIRS, ...PUBLIC_DIRS] as $dir) {
    @mkdir($dir, 0775, true);
}

// No directory listings anywhere under storage/, including the public ones.
$storageHtaccess = STORAGE_DIR . '/.htaccess';
if (!file_exists($storageHtaccess)) {
    @file_put_contents($storageHtaccess, "Options -Indexes\n");
}

foreach (PRIVATE_DIRS as $dir) {
    denyHttp($dir);
}
// REPORTS_UNFOUNDED_DIR sits inside REPORTS_DIR, so it is already covered, and
// avatars/ is deliberately absent from that list — see PUBLIC_DIRS above.
