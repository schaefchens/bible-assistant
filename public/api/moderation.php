<?php
declare(strict_types=1);

// An include, not an endpoint — see APP_ROOT in api.php. Fetched directly this
// file must say nothing: it never runs api.php's ini_set('display_errors', '0').
if (!defined('APP_ROOT')) { http_response_code(404); exit; }

/**
 * Automated moderation: the server's copy of the content standards, and the
 * judge that applies them.
 *
 * MODERATION_POLICY is a **mirror of `community.terms.*`** in src/i18n/*.json
 * — change the rules in one and they change in the other, and bump
 * COMMUNITY_TERMS_VERSION in src/lib/communityTerms.ts so every user is asked
 * to accept them again.
 */

//
// Two jobs, one judge: refuse a piece that breaks the content standards before
// it is ever published, and decide whether a report is worth a human's time.
//
// It runs **here and not in the client** for the obvious reason — a check the
// client performs is a check a modified client skips — and the client asks the
// same question first (`moderation.check`) only so it can show the author why,
// at the moment they pressed publish, instead of after a sync round trip.
//
// It always uses the **shared** key, never the caller's own: billing an author
// for the judging of their own post is odd, and a user who removed their key
// would otherwise switch moderation off.
//
// **It fails open.** With no key, no network, or an unparseable answer the
// piece is published and the verdict is recorded as unchecked rather than
// cached as approved. The alternative — refusing every publish while OpenAI is
// unreachable — turns an outage into a total outage, and the reporting path
// plus a human moderator are what actually stand behind this.

/**
 * Moderation runs on a stronger model than the chat does, deliberately.
 *
 * The chat's job is to resolve a reference and it is corrected instantly by
 * the user; the moderator's job is to judge somebody's writing against a
 * policy and refuse it, where a wrong call is either published abuse or a
 * silenced author. gpt-4o-mini is measurably worse at the second kind of
 * judgment, and a publish happens once per piece — this is the cheapest place
 * in the app to buy accuracy.
 */
const MODERATION_MODEL = 'gpt-4o';

/**
 * The standards the judge applies. **Mirror of `community.terms.*` in
 * `src/i18n/*.json`** — if the rules change here they change there, and
 * `COMMUNITY_TERMS_VERSION` in `src/lib/communityTerms.ts` has to be bumped so
 * every user is asked to accept them again.
 *
 * The carve-out in the middle is not padding. Scripture contains war, sex and
 * politics; a moderator told only "no violence, no sexual content, nothing
 * political" refuses Judges, the Song of Songs and half the prophets. Quoting
 * and discussing the Bible has to be explicitly, loudly allowed or this
 * feature rejects exactly the writing it exists for.
 */
const MODERATION_POLICY = <<<'TXT'
This app hosts Christian, Bible-centred writing. A piece is ALLOWED when it is:
- Scripture, or a quotation of it, in any translation.
- Reflection, devotion, prayer, teaching, testimony, lament, or a question
  about faith or the Bible.
- Practical notes about reading, memorising or studying Scripture.

ALWAYS ALLOWED, even when the subject matter is hard: quoting or discussing any
biblical passage, including war, judgment, death, grief, sexuality within
marriage, suffering, doubt and sin. The Bible is not off-limits to itself.
Lament, sadness and confession of sin are allowed. Naming a sin in order to
teach or repent of it is allowed.

A piece is REFUSED when it is:
- Worldly, political or commercial: party politics, campaigning, advertising,
  fundraising, promotion of a business or a product, cryptocurrency, links to
  unrelated services.
- Sexual content or nudity outside of what Scripture itself says, or written to
  arouse.
- Dating, matchmaking or romantic solicitation, including "looking for a wife
  or husband" posts and personal contact details offered for that purpose.
- Hate, harassment or abuse of any person or group, including slurs and
  threats, whether or not a verse is attached.
- Spam: nonsense, repeated text, keyword stuffing, or content with no
  discernible meaning.
- Off-theme: anything with no connection to the Bible or Christian faith
  (sport, gossip, technology, general life-hacking, unrelated fiction).

Judge the writing, not its quality. Bad prose, poor theology, a minority
doctrinal position, or disagreement with mainstream interpretation are NOT
grounds for refusal. Refuse only a clear breach of the list above.

What you are given is not always an essay. A shelf may also hold a reading plan
or a memorisation board, and for those the text is the human-written parts
pulled out of a structured document: a plan's name, its day titles and its
per-passage notes; a board's name and its cards' titles and notes. Expect
fragments, passage references and bare book names, in any order and with no
connecting prose. That shape is NORMAL and is never on its own grounds for
refusal — in particular a list of book or chapter names is a reading plan, not
spam and not off-theme. Judge only the human-written words that are there.
TXT;

/**
 * Ask the judge one question and get a decision back.
 *
 * Returns `['ok' => bool, 'reason' => string, 'checked' => bool]`. `checked`
 * is false when no judgment could be obtained at all — the caller decides what
 * that means, and for both callers here it means "carry on".
 *
 * `MODERATION_STUB` in secrets.php short-circuits the call with a fixed
 * verdict. That is the seam `scripts/community/verifyBackend.mjs` drives: the
 * refusal path is the half that matters and it cannot be tested against a live
 * model, so it is tested against this.
 */
function moderationJudge(string $system, string $user): array {
    if (defined('MODERATION_STUB')) {
        $stub = json_decode((string)constant('MODERATION_STUB'), true);
        if (is_array($stub)) {
            return [
                'ok' => ($stub['verdict'] ?? 'allow') !== 'refuse',
                'reason' => (string)($stub['reason'] ?? ''),
                'checked' => true,
            ];
        }
    }
    if (OPENAI_API_KEY === '') return ['ok' => true, 'reason' => '', 'checked' => false];

    $resp = curlJson('https://api.openai.com/v1/chat/completions', [
        'model' => MODERATION_MODEL,
        // Zero, not the chat's 0.2: the same text must get the same verdict
        // twice, or an author who edits a typo and republishes can be refused
        // for a piece that was allowed a minute ago.
        'temperature' => 0,
        'response_format' => ['type' => 'json_object'],
        'messages' => [
            ['role' => 'system', 'content' => $system],
            ['role' => 'user', 'content' => $user],
        ],
    ], [], OPENAI_API_KEY);

    $content = $resp['choices'][0]['message']['content'] ?? null;
    if (!is_string($content)) return ['ok' => true, 'reason' => '', 'checked' => false];
    $out = json_decode($content, true);
    if (!is_array($out) || !isset($out['verdict'])) {
        return ['ok' => true, 'reason' => '', 'checked' => false];
    }
    return [
        'ok' => $out['verdict'] !== 'refuse',
        'reason' => safeString($out['reason'] ?? '', 400),
        'checked' => true,
    ];
}

/**
 * Judge one piece, with the verdict cached by content.
 *
 * Content-addressed like generated speech, and for the same reason: the same
 * text is judged more than once — the client asks before publishing, the
 * publish itself asks again, and an author who withdraws and re-shares asks a
 * third time. Only *obtained* verdicts are cached; an unchecked one is retried.
 */
function moderatePiece(string $title, string $body, string $language): array {
    // A stubbed verdict bypasses the cache in both directions, so flipping the
    // stub actually changes the answer — it is a test seam and a kill switch,
    // and a cached stub would make it behave like neither.
    if (defined('MODERATION_STUB')) return moderationJudge('', '');
    $hash = hash('sha256', MODERATION_MODEL . "\n" . $language . "\n" . $title . "\n" . $body);
    $cachePath = MODERATION_DIR . '/' . $hash . '.json';
    $cached = readJsonObjectFile($cachePath);
    if (is_array($cached) && isset($cached['ok'])) {
        return ['ok' => (bool)$cached['ok'], 'reason' => (string)($cached['reason'] ?? ''), 'checked' => true];
    }

    $verdict = moderationJudge(
        MODERATION_POLICY . "\n\n" .
        "You are moderating one piece of writing submitted to this app. Reply " .
        "with JSON: {\"verdict\":\"allow\"|\"refuse\",\"reason\":\"...\"}. " .
        "The reason is shown to the author, so write one short sentence, " .
        "addressed to them, in the language of their piece, naming which rule " .
        "it breaks. Leave the reason empty when you allow it.",
        "Title: {$title}\n\nBody:\n{$body}",
    );
    if ($verdict['checked']) {
        writeJsonFile($cachePath, [
            'ok' => $verdict['ok'],
            'reason' => $verdict['reason'],
            'model' => MODERATION_MODEL,
            'judgedAt' => (int)(microtime(true) * 1000),
            // The judged text, so a disputed refusal can be looked at.
            'title' => mb_substr($title, 0, 300),
            'excerpt' => mb_substr($body, 0, MAX_REPORT_EXCERPT),
        ]);
    }
    return $verdict;
}

/**
 * Is this report worth a human's time?
 *
 * Deliberately biased toward yes: a report wrongly filed as unfounded is a
 * complaint nobody ever reads, which is the failure this whole path exists to
 * prevent. It only sorts — see REPORTS_UNFOUNDED_DIR, nothing is discarded.
 */
function triageReport(string $reason, ?string $note, ?array $post, string $spaceName): array {
    $subject = $post === null
        ? "A whole shelf is being reported. Shelf name: {$spaceName}"
        : "Reported piece — title: " . (string)($post['title'] ?? '') . "\n\nBody:\n"
          . mb_substr((string)($post['body'] ?? ''), 0, MAX_REPORT_EXCERPT);

    return moderationJudge(
        MODERATION_POLICY . "\n\n" .
        "You are triaging a report from one user about another user's writing. " .
        "Decide whether a human moderator should look at it. Reply with JSON: " .
        "{\"verdict\":\"allow\"|\"refuse\",\"reason\":\"...\"}, where " .
        "\"allow\" means the report is plausible and should reach a human, and " .
        "\"refuse\" means it plainly is not — the reported writing breaks no " .
        "rule and the report looks mistaken or vexatious. Lean towards " .
        "\"allow\": a wrongly dismissed report is never read by anyone. The " .
        "reason is for the moderator, not the reporter.",
        "Reported for: {$reason}\nReporter's note: " . ($note ?? '(none)') . "\n\n{$subject}",
    );
}

/**
 * Judge a piece the author is about to publish.
 *
 * Exists purely so the refusal can be shown *at* the publish tap: publishing
 * travels on the sync queue, and a 422 arriving from a background flush would
 * surface as a post that silently never shared. The write path checks again
 * regardless, and the verdict cache means asking twice costs one judgment.
 *
 * Requires a profile — this spends the shared OpenAI key, so it is not a free
 * text-classification endpoint for anyone holding an identity.
 */
function handleModerationCheck(array $ctx): void {
    $body = readJsonBody();
    if (readJsonObjectFile(profilePath($ctx['userDir'])) === null) fail(403, 'profile_required');
    $title = safeString($body['title'] ?? '', 300);
    $text = safeString($body['body'] ?? '', MAX_POST_BYTES);
    $language = safeString($body['language'] ?? 'en', 8);
    if (trim($text) === '') fail(400, 'body required');

    $verdict = moderatePiece($title, $text, $language);
    respond(200, [
        'ok' => $verdict['ok'],
        'reason' => $verdict['reason'],
        // False means no judgment could be obtained (no key, no network). The
        // client publishes anyway — see the fail-open note above.
        'checked' => $verdict['checked'],
    ]);
}
