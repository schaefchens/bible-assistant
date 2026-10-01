<?php
declare(strict_types=1);

// An include, not an endpoint — see APP_ROOT in api.php. Fetched directly this
// file must say nothing: it never runs api.php's ini_set('display_errors', '0').
if (!defined('APP_ROOT')) { http_response_code(404); exit; }

/**
 * Narrating with somebody else's voice: whose key pays, on whose terms, and
 * how much of it may be spent.
 *
 * An owner shares one of their voices on a shelf — a shared item of kind
 * `voice`, whose payload carries the voice and the owner's terms (see
 * sharedVoiceOf() in api/voices.php). A reader the owner accepted reads with
 * it through `tts.shared` / `tts.speak.shared`: the same handlers, the same
 * cache, the same "a hit is free" — and on a miss the **owner's** stored key
 * pays. Everything that protects the owner's money is enforced here, at the
 * moment of spending; the client only reflects it:
 *
 *   withSponsorPayer()   the access checks, in order, every "no" alike
 *   sharedScopeAllows()  what the voice may read for others
 *   sponsorAdmit()       the allowances — charged under a lock before any
 *                        upstream call, given back only when no audio came
 *                        back — and the owner's generation slots
 *
 * The second write into another person's directory, after space.request:
 * users/{owner}/sponsored/{itemId}/ holds the counters, and goes with the
 * item, the space, the community profile and the account
 * (forgetSponsorship() and its callers in api/spaces.php; account.delete takes
 * the whole directory).
 *
 * Every refusal is `{error: 'shared_voice_*', payer: 'owner', itemId}` and
 * never a provider code, so the client can never mistake the owner's key
 * failing for the reader's own; an owner-side upstream failure carries no
 * upstream detail at all — it could name the key or a billing state, which
 * are nobody's business but the owner's.
 */

/** A charge is never smaller than this many characters: a style instruction
 * and the alignment pass cost something even on a two-word heading. */
const SPONSOR_MIN_CHARGE = 50;
/** At most this many of one owner's sponsored generations at once, so that
 * readers cannot trip the owner's provider concurrency limit for everybody —
 * the owner included. */
const SPONSOR_SLOTS = 2;
/** How long a sponsored miss waits for one of the owner's slots before
 * answering `shared_voice_busy`. A define so the harness can shorten it. */
if (!defined('SPONSOR_SLOT_WAIT_SECONDS')) define('SPONSOR_SLOT_WAIT_SECONDS', 60);
/** postUnits.ts' MAX_UNIT_BYTES: a paragraph longer than this is read in
 * pieces, so only then may a piece of it be asked for on its own. */
const POST_UNIT_MAX_BYTES = 3500;

function sponsoredRoot(string $ownerDir): string { return $ownerDir . '/sponsored'; }
/** `$itemId` must be a uuid: it becomes a directory name. */
function sponsoredDir(string $ownerDir, string $itemId): string { return sponsoredRoot($ownerDir) . '/' . $itemId; }

/** Drop a shared voice's counters. Removing the item is what revokes it, and
 * a re-share is a new item with a fresh allowance. */
function forgetSponsorship(string $ownerDir, string $itemId): void {
    deleteTree(sponsoredDir($ownerDir, $itemId));
}

/** Refuse a sponsored narration. `$itemId` is echoed only once it is known to
 * be a uuid. A 503 says when to come back. */
function failSponsored(string $code, int $status, ?string $itemId): void {
    if ($status === 503) header('Retry-After: 2');
    fail($status, $code, ['payer' => 'owner', 'itemId' => $itemId]);
}

/**
 * `$ctx` with the payer for a sponsored narration miss — the voice's owner —
 * attached as `payer`, and what the spending is charged to as `sponsor`; or
 * the request is refused. Asked on a miss only, after the cache said no.
 *
 * `$ref` is the request's `shared: {code, itemId}`; `$request` is what is to
 * be read: provider, config (normalized), kind ('verse'|'speak'), text, verse
 * (for a verse), language ('en'|'de'|'_'), failExtra.
 *
 * Read-only, and in this order. The first four refuse identically —
 * `shared_voice_unavailable` — so nothing is learned about a shelf the caller
 * may not read:
 *
 *   1. the caller has a community profile. That is the proof authenticate()
 *      checked a secret at all — it checks none for an identity with no
 *      directory — so nobody can claim the id of an accepted member who has
 *      since left;
 *   2. the code names a space that is there, whose owner is published. (The
 *      owner asking pays as they always would.)
 *   3. the caller's membership is accepted: not pending, not blocked;
 *   4. the item is shown in *that* space, and is a voice — a code for one
 *      shelf never spends a voice shared on another.
 *
 * Then, for an accepted member, who may be told why:
 *
 *   5. the voice asked for is the voice shared, else `shared_voice_mismatch`
 *      (the owner has updated it; the reader's copy is stale);
 *   6. its scope allows this text, else `shared_voice_out_of_scope`;
 *   7. a shelf that lets anyone with the code in has a monthly pool, else
 *      `shared_voice_budget`. Checked now, not when the voice was shared, so
 *      switching the shelf to automatic approval later opens no hole: every
 *      new identity would otherwise bring a fresh daily allowance;
 *   8. the owner has a key for this provider, else `shared_voice_unavailable`.
 *      Their own stored key — never the operator's, never the reader's:
 *      openAiPayer() is not asked (it honours the *reader's* session fallback
 *      to the shared key), and an empty key never reaches the OpenAI curl
 *      wrappers, which would fall back to the shared key on one.
 */
function withSponsorPayer(array $ctx, mixed $ref, array $request): array {
    $itemId = is_array($ref) && is_string($ref['itemId'] ?? null) && preg_match('/^[0-9a-fA-F-]{36}$/', $ref['itemId'])
        ? $ref['itemId']
        : null;
    $code = is_array($ref) && is_string($ref['code'] ?? null) ? strtoupper($ref['code']) : '';
    $refuse = static function (string $error = 'shared_voice_unavailable', int $status = 403) use ($itemId): void {
        failSponsored($error, $status, $itemId);
    };

    // 1.
    if ($itemId === null || readJsonObjectFile(profilePath($ctx['userDir'])) === null) $refuse();

    // 2.
    $target = lookupShareCode($code);
    if ($target === null) $refuse();
    $space = findById(readJsonArrayFile(spacesPath($target['userDir'])), $target['spaceId']);
    if ($space === null || !ownerIsPublished($target['userDir'])) $refuse();
    if ($target['userId'] === $ctx['userId']) {
        $ctx = withTtsPayer($ctx, $request['provider'], $request['failExtra'] ?? []);
        $ctx['sponsor'] = null;
        return $ctx;
    }

    // 3.
    if (membershipStatusOf($target['userDir'], $target['spaceId'], $ctx['userId']) !== 'accepted') $refuse();

    // 4.
    $item = findById(liveSpaceItems($target['userDir'], $space), $itemId);
    $payload = $item !== null && ($item['kind'] ?? '') === 'voice'
        ? storedItemPayload($target['userDir'], $itemId)
        : null;
    $shared = $payload === null ? null : sharedVoiceOf($payload);
    if (!is_array($shared)) $refuse();

    // 5.
    if (!sameVoiceConfig($shared['config'], $request['config'])) $refuse('shared_voice_mismatch', 409);

    // 6.
    if (!sharedScopeAllows($shared['sharing']['scope'], $request, $target, $space)) {
        $refuse('shared_voice_out_of_scope');
    }

    // 7.
    if (($space['approval'] ?? 'manual') === 'auto' && !isset($shared['sharing']['monthly'])) {
        $refuse('shared_voice_budget');
    }

    // 8.
    $key = storedKey($target['userDir'], $request['provider']);
    if ($key === '' || ($request['provider'] === 'elevenlabs' && !preg_match(EL_KEY_RE, $key))) $refuse();

    $ctx['payer'] = ['provider' => $request['provider'], 'key' => $key, 'who' => 'owner'];
    $ctx['sponsor'] = [
        'ownerId' => $target['userId'],
        'ownerDir' => $target['userDir'],
        'itemId' => $itemId,
        'readerId' => $ctx['userId'],
        'sharing' => $shared['sharing'],
    ];
    return $ctx;
}

/**
 * Admit a sponsored miss to the owner's key: charge the allowance, then take
 * one of the owner's slots — or refuse. Called with the entry lock held and
 * the cache checked a second time, so a request that finds the audio waiting
 * is never charged. The job gives the charge back if no audio comes back.
 */
function sponsorAdmit(NarrationJob $job, array $sponsor, string $text): void {
    $chars = max(mb_strlen($text, 'UTF-8'), SPONSOR_MIN_CHARGE);
    $reservation = reserveSponsoredChars($sponsor, $chars);
    if ($reservation === null) fail(500, 'could not record the shared voice allowance');
    if ($reservation === false) failSponsored('shared_voice_budget', 403, $sponsor['itemId']);
    $job->reservation = $reservation;

    $slot = takeSponsorSlot($sponsor['ownerId'], (float)SPONSOR_SLOT_WAIT_SECONDS);
    if ($slot === null) fail(500, 'could not lock the narration cache');
    if ($slot === false) failSponsored('shared_voice_busy', 503, $sponsor['itemId']);
    $job->slot = $slot;
}

// ---------- the allowances ----------------------------------------------------

/**
 * Charge `$chars` against every allowance the voice has, all or nothing.
 *
 * One small file per allowance, under users/{owner}/sponsored/{itemId}/:
 * pool.json `{period: 'YYYY-MM', used}` for the monthly pool, and
 * daily-{readerId}.json `{period: 'YYYY-MM-DD', used}` for one reader's day,
 * both in UTC; a counter from an earlier period counts as zero. Every file is
 * held under flock for the whole read-check-write, always pool first, so two
 * requests can neither charge past a limit together nor wait on each other.
 * An allowance the owner did not set is not counted at all.
 *
 * @return array|false|null the reservation (what refundSponsoredChars() takes),
 *                          false when it would pass a limit, null when a
 *                          counter cannot be written
 */
function reserveSponsoredChars(array $sponsor, int $chars): array|false|null {
    $counters = sponsoredCounters($sponsor);
    $reservation = [
        'counters' => array_map(fn(array $c): array => ['path' => $c['path'], 'period' => $c['period']], $counters),
        'chars' => $chars,
    ];
    if ($counters === []) return $reservation;

    $dir = sponsoredDir($sponsor['ownerDir'], $sponsor['itemId']);
    if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) return null;

    $held = [];
    $release = static function () use (&$held): void {
        foreach ($held as [$fp]) {
            flock($fp, LOCK_UN);
            fclose($fp);
        }
        $held = [];
    };
    foreach ($counters as $c) {
        $fp = @fopen($c['path'], 'c+');
        if ($fp === false) {
            $release();
            return null;
        }
        if (!flock($fp, LOCK_EX)) {
            fclose($fp);
            $release();
            return null;
        }
        $held[] = [$fp, $c, counterUsed($fp, $c['period'])];
    }
    foreach ($held as [, $c, $used]) {
        if ($used + $chars > $c['limit']) {
            $release();
            return false;
        }
    }
    foreach ($held as [$fp, $c, $used]) writeCounter($fp, $c['period'], $used + $chars);
    $release();
    return $reservation;
}

/** The counters a voice's terms call for, in locking order. */
function sponsoredCounters(array $sponsor): array {
    $dir = sponsoredDir($sponsor['ownerDir'], $sponsor['itemId']);
    $counters = [];
    if (isset($sponsor['sharing']['monthly'])) {
        $counters[] = ['path' => "{$dir}/pool.json", 'period' => gmdate('Y-m'), 'limit' => (int)$sponsor['sharing']['monthly']];
    }
    if (isset($sponsor['sharing']['dailyPerReader'])) {
        $counters[] = [
            // The reader's id is the authenticated one, already a uuid.
            'path' => "{$dir}/daily-{$sponsor['readerId']}.json",
            'period' => gmdate('Y-m-d'),
            'limit' => (int)$sponsor['sharing']['dailyPerReader'],
        ];
    }
    return $counters;
}

/** What a locked counter has used in `$period`: 0 for an earlier period, an
 * empty file or anything unreadable. */
function counterUsed($fp, string $period): int {
    rewind($fp);
    $raw = stream_get_contents($fp);
    $d = is_string($raw) && $raw !== '' ? json_decode($raw, true) : null;
    if (!is_array($d) || ($d['period'] ?? null) !== $period || !is_int($d['used'] ?? null)) return 0;
    return max(0, $d['used']);
}

function writeCounter($fp, string $period, int $used): void {
    ftruncate($fp, 0);
    rewind($fp);
    fwrite($fp, (string)json_encode(['period' => $period, 'used' => $used]));
    fflush($fp);
}

/**
 * Give a reservation back — NarrationJob does, and only when no audio came
 * back for it. A period that has turned since is left alone: its counter
 * starts from zero anyway.
 */
function refundSponsoredChars(array $reservation): void {
    foreach ($reservation['counters'] as $c) {
        if (!is_file($c['path'])) continue;
        $fp = @fopen($c['path'], 'c+');
        if ($fp === false) continue;
        if (flock($fp, LOCK_EX)) {
            $used = counterUsed($fp, $c['period']);
            if ($used > 0) writeCounter($fp, $c['period'], max(0, $used - (int)$reservation['chars']));
            flock($fp, LOCK_UN);
        }
        fclose($fp);
    }
}

/**
 * One of the owner's SPONSOR_SLOTS generation slots, as [handle, path]; false
 * when none came free within `$waitSeconds`, null when no lock file opens.
 * Lock files like an entry's (narrationTryLock), so they go when let go and
 * WORK_DIR stays empty between generations.
 */
function takeSponsorSlot(string $ownerId, float $waitSeconds): array|false|null {
    $deadline = microtime(true) + $waitSeconds;
    while (true) {
        for ($i = 0; $i < SPONSOR_SLOTS; $i++) {
            $path = WORK_DIR . "/sponsor-{$ownerId}-{$i}.lock";
            $fp = narrationTryLock($path);
            if ($fp === null) return null;
            if ($fp !== false) return [$fp, $path];
        }
        if (microtime(true) >= $deadline) return false;
        usleep(100000);
    }
}

// ---------- the scope ---------------------------------------------------------

/**
 * May a voice shared with `$scope` read this text for somebody else?
 *
 *   scripture  a verse, exactly as this server's Bible has it, and the
 *              announcements the app itself makes around scripture
 *   pieces     that, and the owner's own writing on this shelf: a piece's
 *              heading, a whole paragraph, or — only inside a paragraph too
 *              long for one reading unit — a run of whole sentences
 *   anything   no text check: the owner has said so
 *
 * The point is *what* the owner's voice is made to say, not only what it
 * costs: without it, a reader could have it read any words at all.
 */
function sharedScopeAllows(string $scope, array $request, array $target, array $space): bool {
    if ($scope === 'anything') return true;
    if ($request['kind'] === 'verse') return isScriptureVerse($request['verse'], $request['text']);
    if (isAnnouncement($request['text'], (string)$request['language'])) return true;
    return $scope === 'pieces' && isShelfWriting($request['text'], $target, $space);
}

/** Is `$text` this verse, word for word, as this server reads it — the
 * `textTts` the client speaks (src/services/bible/bibleApi.ts verseSpeakable)? */
function isScriptureVerse(array $verse, string $text): bool {
    // The OpenAI path hands the translation over as sent; the map is keyed in
    // capitals, and only a known one may name a file.
    $translation = strtoupper((string)$verse['translation']);
    if (!isset(BIBLE_XML_MAP[$translation])) return false;
    if ($verse['bookId'] < 1 || $verse['bookId'] > 66 || $verse['chapter'] < 1 || $verse['chapter'] > 150) return false;
    $chapter = bibleChapterVerses($translation, (int)$verse['bookId'], (int)$verse['chapter']);
    foreach ($chapter['verses'] ?? [] as $row) {
        if (is_array($row) && (int)($row['verse'] ?? 0) === (int)$verse['verse']) {
            return $text === (string)($row['textTts'] ?? '');
        }
    }
    return false;
}

/**
 * Is this one of the announcements the app makes around scripture — "Psalm,
 * chapter 117", "Galater, Kapitel 5, Verse 22 bis 26", "Verse 2", a bare
 * verse number — in the request's language (either, when it names none)?
 *
 * Matched against the app's own templates and book names, which
 * api/announcements.php carries (generated from src/i18n/*.json and the book
 * catalog by `npm run voices:announcements`). Whole-text and anchored, with
 * only the numbers free, so no prose that merely ends in ", chapter 1" passes.
 */
function isAnnouncement(string $text, string $language): bool {
    if (preg_match('/^[1-9][0-9]{0,2}$/', $text) === 1) return true;
    $languages = $language === 'en' || $language === 'de' ? [$language] : ['en', 'de'];
    foreach ($languages as $lang) {
        foreach (announcementPatterns($lang) as $pattern) {
            if (preg_match($pattern, $text) === 1) return true;
        }
    }
    return false;
}

/** The announcement templates of one language as anchored patterns: the
 * template's own words quoted, its holes filled with a book name or numbers. */
function announcementPatterns(string $lang): array {
    static $memo = [];
    if (isset($memo[$lang])) return $memo[$lang];
    $number = '[1-9][0-9]{0,2}';
    $books = implode('|', array_map(fn(string $n): string => preg_quote($n, '/'), ANNOUNCE_BOOK_NAMES[$lang]));
    $separators = implode('|', array_map(fn(string $s): string => preg_quote($s, '/'), ANNOUNCE_LIST_SEPARATORS[$lang]));
    $holes = [
        '{{book}}' => "(?:{$books})",
        '{{n}}' => $number,
        '{{v}}' => $number,
        '{{from}}' => $number,
        '{{to}}' => $number,
        // Intl.ListFormat's "1, 3 and 7": two numbers or more, never one.
        '{{verses}}' => "{$number}(?:(?:{$separators}){$number}){1,176}",
    ];
    $patterns = [];
    foreach (['chapter', 'chapterVerse', 'chapterRange', 'chapterList', 'verse'] as $key) {
        $re = '';
        // A hole this file does not know stays literal text, and so matches
        // nothing a template would produce: unknown means refused.
        foreach (preg_split('/(\{\{[A-Za-z]+\}\})/', ANNOUNCE_TEMPLATES[$lang][$key], -1, PREG_SPLIT_DELIM_CAPTURE) ?: [] as $part) {
            $re .= $holes[$part] ?? preg_quote($part, '/');
        }
        $patterns[] = '/^' . $re . '$/u';
    }
    return $memo[$lang] = $patterns;
}

/**
 * Is `$text` the owner's own writing on this shelf: a piece's spoken heading,
 * one of its paragraphs, or a run of whole sentences of an over-long one?
 */
function isShelfWriting(string $text, array $target, array $space): bool {
    $posts = pruneExpired(
        readJsonArrayFile(spacePostsPath($target['userDir'], $target['spaceId'])),
        $space['ephemeralHours'] ?? null,
    );
    $author = (string)publicProfileOf($target['userDir'])['displayName'];
    foreach ($posts as $post) {
        if (!is_array($post)) continue;
        $language = ($post['language'] ?? '') === 'de' ? 'de' : 'en';
        if ($text === pieceHeadingOf((string)($post['title'] ?? ''), $author, $language)) return true;
        foreach (pieceParagraphsOf((string)($post['body'] ?? '')) as $paragraph) {
            if ($text === $paragraph) return true;
            if (strlen($paragraph) > POST_UNIT_MAX_BYTES && isSentenceRunOf($text, $paragraph)) return true;
        }
    }
    return false;
}

/** A piece's spoken heading — postHeadingText() in src/lib/playbackPlan.ts:
 * "{title}. By {author}.", or the bare title when there is no author. */
function pieceHeadingOf(string $title, string $author, string $language): string {
    if ($author === '') return $title;
    return strtr(ANNOUNCE_TEMPLATES[$language]['postBy'], ['{{title}}' => $title, '{{author}}' => $author]);
}

/**
 * A piece's paragraphs — postParagraphs() in src/services/community/
 * postUnits.ts, before it cuts an over-long one: split at blank lines, every
 * run of JavaScript whitespace one space, trimmed, the empty ones dropped.
 * JavaScript's whitespace, not PCRE's (jsWhitespaceClass()): the two disagree
 * on two characters, and either would make a paragraph unrecognisable.
 */
function pieceParagraphsOf(string $body): array {
    $paragraphs = [];
    foreach (preg_split('/\n{2,}/', $body) ?: [] as $p) {
        $p = preg_replace('/[' . jsWhitespaceClass() . ']+/u', ' ', $p);
        if (!is_string($p)) continue;
        $p = trim($p, ' ');
        if ($p !== '') $paragraphs[] = $p;
    }
    return $paragraphs;
}

/**
 * Is `$text` a piece postUnits.ts may cut an over-long paragraph into? A run
 * of whole sentences — it cuts where a sentence end meets a space, as its
 * SENTENCE_BREAK says — or, inside one sentence that is itself over the cap,
 * a run of whole words. Where the cut may fall, not where it does: the client
 * may pack sentences differently and still be recognised.
 */
function isSentenceRunOf(string $text, string $paragraph): bool {
    if ($text === '' || strlen($text) > POST_UNIT_MAX_BYTES) return false;
    $sentences = preg_split('/(?<=[.!?]|[.!?][)\]"\'”’»]) /u', $paragraph, -1, PREG_SPLIT_OFFSET_CAPTURE);
    if (!is_array($sentences)) return false;
    $starts = [];
    $ends = [];
    $long = [];
    foreach ($sentences as [$sentence, $at]) {
        $starts[$at] = true;
        $ends[$at + strlen($sentence)] = true;
        if (strlen($sentence) > POST_UNIT_MAX_BYTES) $long[] = [$at, $at + strlen($sentence)];
    }
    $length = strlen($text);
    for ($at = strpos($paragraph, $text); $at !== false; $at = strpos($paragraph, $text, $at + 1)) {
        $end = $at + $length;
        if (isset($starts[$at]) && isset($ends[$end])) return true;
        foreach ($long as [$from, $to]) {
            if ($at < $from || $end > $to) continue;
            $wordStart = $at === $from || $paragraph[$at - 1] === ' ';
            $wordEnd = $end === $to || $paragraph[$end] === ' ';
            if ($wordStart && $wordEnd) return true;
        }
    }
    return false;
}
