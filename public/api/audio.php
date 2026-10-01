<?php
declare(strict_types=1);

// An include, not an endpoint — see APP_ROOT in api.php. Fetched directly this
// file must say nothing: it never runs api.php's ini_set('display_errors', '0').
if (!defined('APP_ROOT')) { http_response_code(404); exit; }

/**
 * Speech, in both directions.
 *
 * Out: `tts` (a verse, keyed by reference) and `tts.speak` (any text, keyed by
 * its own sha256) generate audio plus a forced word alignment and cache both
 * under storage/audio/, in a directory shared by every user — so the first
 * person to hear a paragraph pays for it and everyone after gets a cache hit.
 *
 * Two providers answer both actions. A body without `provider` (or with
 * 'openai') is OpenAI, handled here; a body with `provider: 'elevenlabs'` goes
 * to handleElevenLabsNarration() in api/elevenlabs.php. Either way the payer
 * is resolved **on a cache miss only**, inside the handler (ttsPayer /
 * withTtsPayer below) — a hit costs nobody anything, so it needs no key at
 * all.
 *
 * `tts.shared` and `tts.speak.shared` are the same two handlers for a voice
 * somebody shared on a shelf: the same cache, the same free hit, and on a miss
 * the voice's *owner* pays, on the terms they set — see api/sponsorship.php.
 *
 * Both providers generate a miss the same way (NarrationJob, below): one
 * generation per entry under a lock, into temp files renamed into place, and
 * nothing left behind by a failure.
 *
 * In: `transcribe` proxies Whisper for voice input.
 */

/**
 * Who would pay to generate narration in `$provider` for this caller, or null
 * when nobody can. The cache is keyed by audible config and text, never by
 * payer, so this is asked only after a miss.
 *
 *   openai      openAiPayer(): the caller's own key, else the shared one
 *   elevenlabs  elevenLabsPayer(): the caller's own key — there is no shared one
 */
function ttsPayer(array $ctx, string $provider): ?array {
    if ($provider === 'elevenlabs') return elevenLabsPayer($ctx);
    $payer = openAiPayer($ctx);
    return $payer['key'] === '' ? null : $payer;
}

/**
 * `$ctx` with the payer for a narration cache miss attached as `payer`, or the
 * request fails the way that provider fails when nobody can pay: OpenAI with
 * the same 500 the router used to answer before any handler ran, ElevenLabs
 * with 403 `elevenlabs_key_missing` (plus `$failExtra`, which names the voice).
 */
function withTtsPayer(array $ctx, string $provider, array $failExtra = []): array {
    $payer = ttsPayer($ctx, $provider);
    if ($payer === null) {
        if ($provider === 'elevenlabs') failElevenLabs('elevenlabs_key_missing', 403, 'requester', $failExtra);
        fail(500, 'no OpenAI API key configured');
    }
    $ctx['payer'] = $payer;
    return $ctx;
}

/**
 * What the shared OpenAI key will generate: Echo with no style, nothing else.
 *
 * The client has always offered only that on the shared key (it is the voice
 * the warm cache, the downloads and the e2e fixtures are all in); this makes
 * the server agree, now that the UI puts custom voices in front of everyone.
 * Checked on a miss only — every voice's cached audio stays free to play.
 */
function requireOperatorAllows(array $ctx, string $voice, string $voiceStyle): void {
    if (($ctx['payer']['who'] ?? '') !== 'operator') return;
    if ($voice === 'echo' && $voiceStyle === '') return;
    fail(403, 'openai_key_required');
}

/**
 * Which provider a narration body is for. Absent means OpenAI — every body a
 * client sent before voices existed — and anything unrecognised is refused
 * rather than read as OpenAI, which would bill the wrong voice.
 */
function ttsProviderOf(array $body): string {
    $provider = $body['provider'] ?? 'openai';
    if ($provider === 'openai' || $provider === 'elevenlabs') return $provider;
    fail(400, 'unknown provider');
    return '';
}

/**
 * Compose `instructions` for the OpenAI TTS request. A language hint based
 * on the Bible translation prevents the model from drifting into English
 * pronunciation on short German verses (or vice versa). Any user-provided
 * voiceStyle is appended after the language hint.
 */
function composeTtsInstructions(string $translation, string $voiceStyle): string {
    $hint = (TRANSLATION_LANGUAGE[strtoupper($translation)] ?? 'en') === 'de'
        ? 'Read this Bible passage in clear, reverent German.'
        : 'Read this Bible passage in clear, reverent English.';
    return $voiceStyle !== '' ? "$hint $voiceStyle" : $hint;
}

/** Counterpart for the free-form tts.speak endpoint (no translation, just
 * an optional `language` code from the client). Returns '' if neither a
 * language nor a voiceStyle were supplied. */
function composeSpeakInstructions(string $language, string $voiceStyle): string {
    $lang = strtolower($language);
    $hint = '';
    if ($lang === 'de') $hint = 'Speak this in clear German.';
    elseif ($lang === 'en') $hint = 'Speak this in clear English.';
    if ($hint === '') return $voiceStyle;
    return $voiceStyle !== '' ? "$hint $voiceStyle" : $hint;
}

/** Hash of the inputs that determine TTS audio output. Stored alongside
 * the alignment so a cached mp3 can be detected as stale when the source
 * text (or voiceStyle) changes — e.g. after the bolls-to-XML migration
 * cleaned up inline footnote refs like "[16]" that had been baked into
 * the audio. Voice/translation/bookId/chapter/verse are already part of
 * the cache path so they don't need to be in the hash. */
function sha256ForCache(string $text, string $voiceStyle): string {
    return hash('sha256', $voiceStyle . "\x00" . $text);
}

/**
 * Path segment identifying a voiceStyle, or '' for the default.
 *
 * Verse audio used to live at {voice}/{translation}/{book}/{chapter}/{verse}.mp3
 * with the style folded only into the *staleness hash*. Two consequences, both
 * bad: the server regenerated over the same file whenever two callers used
 * different styles, and — worse — the client's mediaCache is keyed by URL, so a
 * style change kept serving the previously cached bytes forever.
 *
 * The empty style deliberately keeps the old path. It is the overwhelming
 * majority of the cache (voiceStyle needs a personal key), and inserting a
 * segment for it would orphan every file already generated.
 */
function voiceStyleSegment(string $voiceStyle): string {
    if ($voiceStyle === '') return '';
    return '/style-' . substr(hash('sha256', $voiceStyle), 0, 16);
}

function cachedAlignmentMatches(string $alignmentFile, string $expectedHash): bool {
    $raw = @file_get_contents($alignmentFile);
    if ($raw === false || $raw === '') return false;
    $decoded = json_decode($raw, true);
    if (!is_array($decoded)) return false;
    return isset($decoded['sourceTextHash']) && $decoded['sourceTextHash'] === $expectedHash;
}

/**
 * Forced word-level alignment of an existing audio file via the transcription
 * model (verbose_json + word timestamps). Returns the raw response array
 * (with `_status`); the caller decides whether a non-200 is fatal. Shared by
 * the two TTS handlers and the user-recording upload.
 */
function forcedAlignment(string $audioFile, string $fileName, ?string $apiKey): array {
    return curlMultipart(
        openAiUrl('/v1/audio/transcriptions'),
        [
            'model' => ALIGNMENT_MODEL,
            'response_format' => 'verbose_json',
            'timestamp_granularities[]' => 'word',
        ],
        'file',
        $audioFile,
        $fileName,
        $apiKey,
    );
}

/** Write an alignment JSON file from a successful alignment response, merging
 * any extra fields (e.g. sourceTextHash for the cache-staleness check). */
function writeAlignment(string $path, array $align, array $extra = []): void {
    file_put_contents($path, alignmentJson($align, $extra));
}

/** The alignment file's contents: a successful alignment response's words,
 * duration and text, plus `$extra`. */
function alignmentJson(array $align, array $extra = []): string {
    return (string)json_encode(array_merge([
        'words' => $align['words'] ?? [],
        'duration' => $align['duration'] ?? null,
        'text' => $align['text'] ?? null,
    ], $extra), JSON_UNESCAPED_UNICODE);
}

/**
 * One OpenAI narration miss, from "who pays" to the published files. Answers
 * true when it generated the entry, false when another request had just done
 * so while this one waited.
 *
 * The order handleElevenLabsNarration() keeps, for the same reasons — and a
 * shared voice, which lets a shelf full of readers miss the same chapter at
 * once on somebody else's key, makes them anything but theoretical:
 *
 *   1. who pays: the caller's own key or the shared one — or, for a shared
 *      voice (`$shared` is its `{ref, request}`), its owner, via
 *      withSponsorPayer(). The shared key's limits apply whoever it would be;
 *   2. finish what is started, even for a listener who has gone;
 *   3. one generation per entry: the per-entry lock, then the cache again, so
 *      two listeners asking at once cost one generation — and are charged
 *      once, because a sponsored miss reserves the owner's allowance (and one
 *      of their slots) only now, after the second look;
 *   4. speech and alignment into temp files, renamed into place with the
 *      alignment last — its presence is what a hit tests — so nobody ever sees
 *      half an entry, and a failure leaves nothing behind.
 *
 * `$entry`: text, voice, style, instructions, dir, audioFile, alignmentFile,
 * alignmentExtra, and isHit — the cache check, asked again under the lock.
 */
function narrateOpenAiMiss(array $ctx, array $entry, ?array $shared): bool {
    // 1. Who pays — decided here, on the miss, and only here.
    if ($shared !== null) {
        $ctx = withSponsorPayer($ctx, $shared['ref'], $shared['request']);
    } else {
        $ctx = withTtsPayer($ctx, 'openai');
        $ctx['sponsor'] = null;
    }
    requireOperatorAllows($ctx, $entry['voice'], $entry['style']);

    // 2.
    ignore_user_abort(true);
    if (function_exists('set_time_limit')) @set_time_limit(300);

    // 3.
    $job = new NarrationJob(WORK_DIR . '/oa-' . substr(hash('sha256', $entry['audioFile']), 0, 40) . '.lock');
    $lock = narrationLock($job->lockPath, (float)EL_LOCK_WAIT_SECONDS);
    if ($lock === null) fail(500, 'could not lock the narration cache');
    if ($lock === false) failNarrationBusy($ctx);
    $job->lock = $lock;
    if (($entry['isHit'])()) {
        $job->end();
        return false;
    }
    if ($ctx['sponsor'] !== null) sponsorAdmit($job, $ctx['sponsor'], $entry['text']);

    // 4.
    $payload = [
        'model' => TTS_MODEL,
        'voice' => $entry['voice'],
        'input' => $entry['text'],
        'response_format' => 'mp3',
    ];
    if ($entry['instructions'] !== '') $payload['instructions'] = $entry['instructions'];
    $tts = curlBinary(openAiUrl('/v1/audio/speech'), $payload, $ctx['payer']['key']);
    if ((int)($tts['_status'] ?? 0) !== 200 || empty($tts['audio'])) failOpenAiNarration($ctx, $tts);
    $job->spent = true;

    $tmpAudio = narrationTempFile($tts['audio'], $job->temps);
    if ($tmpAudio === null) fail(500, 'could not write audio file');
    $align = forcedAlignment($tmpAudio, basename($entry['audioFile']), $ctx['payer']['key']);
    // An alignment failure keeps the audio: an empty alignment, and the client
    // simply highlights nothing.
    $alignment = (int)($align['_status'] ?? 0) === 200
        ? alignmentJson($align, $entry['alignmentExtra'])
        : (string)json_encode(array_merge(['words' => []], $entry['alignmentExtra']));
    $tmpAlignment = narrationTempFile($alignment, $job->temps);
    if ($tmpAlignment === null) fail(500, 'could not write audio file');

    publishNarration($entry['dir'], $tmpAudio, $entry['audioFile'], $tmpAlignment, $entry['alignmentFile']);
    $job->commit();
    return true;
}

/**
 * A narration request that could not be generated *now* — another request has
 * held the entry for longer than EL_LOCK_WAIT_SECONDS. Retry-After either way;
 * whose voice it was decides the code (a shared voice never answers with a
 * provider code, see failSponsored()).
 */
function failNarrationBusy(array $ctx, array $extra = []): void {
    if (($ctx['sponsor'] ?? null) !== null) failSponsored('shared_voice_busy', 503, $ctx['sponsor']['itemId']);
    if (($ctx['payer']['provider'] ?? 'openai') === 'elevenlabs') {
        failElevenLabs('tts_busy', 503, $ctx['payer']['who'], $extra);
    }
    header('Retry-After: 2');
    fail(503, 'tts_busy');
}

/**
 * OpenAI refused to speak. On the caller's own key or the shared one this is
 * what it always was (failOpenAi, `user_key_failed` included). On an owner's
 * key it says only whether it will keep happening — a refused or exhausted key
 * is `shared_voice_unavailable`, anything else `shared_voice_busy` — and never
 * OpenAI's own message, which can quote part of the key or its billing state.
 */
function failOpenAiNarration(array $ctx, array $resp): void {
    if (($ctx['payer']['who'] ?? '') !== 'owner') failOpenAi($ctx, 'tts failed', $resp);
    $status = (int)($resp['_status'] ?? 0);
    $error = json_decode((string)($resp['_error'] ?? ''), true);
    $code = is_array($error) ? ($error['error']['code'] ?? ($error['error']['type'] ?? null)) : null;
    $theKeys = in_array($status, [401, 403, 404], true) || ($status === 429 && $code === 'insufficient_quota');
    failSponsored($theKeys ? 'shared_voice_unavailable' : 'shared_voice_busy', $theKeys ? 403 : 503, $ctx['sponsor']['itemId']);
}

/**
 * Narrate one verse, keyed by its reference. `$shared` is true for
 * `tts.shared`: the same request, for a voice somebody shared on a shelf, plus
 * `shared: {code, itemId}` naming it.
 */
function handleTts(array $ctx, bool $shared = false): void {
    $body = readJsonBody();
    if (ttsProviderOf($body) === 'elevenlabs') {
        handleElevenLabsNarration($ctx, $body, 'verse', $shared);
        return;
    }

    $text = safeString($body['text'] ?? '');
    $voice = safeSlug(safeString($body['voice'] ?? 'alloy', 32));
    $voiceStyle = isset($body['voiceStyle']) ? safeString($body['voiceStyle'], 1000) : '';
    $translation = safeSlug(safeString($body['translation'] ?? '', 16));
    $bookId = safeInt($body['bookId'] ?? null);
    $chapter = safeInt($body['chapter'] ?? null);
    $verse = safeInt($body['verse'] ?? null);

    if (!$text || !$translation || $bookId <= 0 || $chapter <= 0 || $verse <= 0) {
        fail(400, 'missing tts params');
    }

    // One expression behind both the file path and the URL below, so they can't
    // drift. NB sha256ForCache() keeps taking $voiceStyle even though the style
    // is now in the path: changing its inputs would mark every existing file
    // stale and regenerate the entire cache at OpenAI's prices.
    $rel = "/{$voice}" . voiceStyleSegment($voiceStyle) . "/{$translation}/{$bookId}/{$chapter}";
    $dir = AUDIO_DIR . $rel;
    $audioFile = "{$dir}/{$verse}.mp3";
    $alignmentFile = "{$dir}/{$verse}.json";

    // Treat audio as stale when its sourceTextHash doesn't match the current
    // text. Pre-migration audio (bolls.life pipeline) sometimes baked inline
    // footnote refs like "16" / "17" into the mp3 because textTts hadn't been
    // stripped yet — without this check those keep playing forever.
    $expectedHash = sha256ForCache($text, $voiceStyle);
    $isHit = static fn(): bool => file_exists($audioFile)
        && file_exists($alignmentFile)
        && cachedAlignmentMatches($alignmentFile, $expectedHash);
    $cached = $isHit();
    if (!$cached) {
        $cached = !narrateOpenAiMiss($ctx, [
            'text' => $text,
            'voice' => $voice,
            'style' => $voiceStyle,
            'instructions' => composeTtsInstructions($translation, $voiceStyle),
            'dir' => $dir,
            'audioFile' => $audioFile,
            'alignmentFile' => $alignmentFile,
            // Stamped so a future text change (e.g. footnote cleanup) marks the
            // cached mp3 stale — see above.
            'alignmentExtra' => ['sourceTextHash' => $expectedHash],
            'isHit' => $isHit,
        ], $shared ? [
            'ref' => $body['shared'] ?? null,
            'request' => [
                'provider' => 'openai',
                'config' => ['provider' => 'openai', 'voice' => $voice, 'style' => $voiceStyle],
                'kind' => 'verse',
                'text' => $text,
                'verse' => ['translation' => $translation, 'bookId' => $bookId, 'chapter' => $chapter, 'verse' => $verse],
                'language' => TRANSLATION_LANGUAGE[strtoupper($translation)] ?? '_',
            ],
        ] : null);
    }

    respond(200, [
        'audioUrl' => BASE_PATH . AUDIO_BASE_URL . "{$rel}/{$verse}.mp3",
        'alignmentUrl' => BASE_PATH . AUDIO_BASE_URL . "{$rel}/{$verse}.json",
        'cached' => $cached,
    ]);
}

/**
 * Free-form TTS for assistant chat replies (no bible coords). Cached by a
 * sha-256 hash of voice+style+text so identical lines reuse audio.
 * `$shared`: as for handleTts — `tts.speak.shared`.
 */
function handleTtsSpeak(array $ctx, bool $shared = false): void {
    $body = readJsonBody();
    if (ttsProviderOf($body) === 'elevenlabs') {
        handleElevenLabsNarration($ctx, $body, 'speak', $shared);
        return;
    }

    $text = safeString($body['text'] ?? '', 4000);
    $voice = safeSlug(safeString($body['voice'] ?? 'alloy', 32));
    $voiceStyle = isset($body['voiceStyle']) ? safeString($body['voiceStyle'], 1000) : '';
    // Optional language hint — short announcements (e.g. "Vers 16") benefit
    // from an explicit nudge so the model doesn't default to English.
    $language = safeSlug(safeString($body['language'] ?? '', 4));

    if (!$text) fail(400, 'missing tts.speak params');

    // Cache key includes language so a hint change naturally invalidates.
    $key = hash('sha256', $voice . ':' . $voiceStyle . ':' . $language . ':' . $text);
    $dir = AUDIO_DIR . "/speak/{$voice}";
    $audioFile = "{$dir}/{$key}.mp3";
    $alignmentFile = "{$dir}/{$key}.json";

    $isHit = static fn(): bool => file_exists($audioFile) && file_exists($alignmentFile);
    $cached = $isHit();
    if (!$cached) {
        $cached = !narrateOpenAiMiss($ctx, [
            'text' => $text,
            'voice' => $voice,
            'style' => $voiceStyle,
            'instructions' => composeSpeakInstructions($language, $voiceStyle),
            'dir' => $dir,
            'audioFile' => $audioFile,
            'alignmentFile' => $alignmentFile,
            'alignmentExtra' => [],
            'isHit' => $isHit,
        ], $shared ? [
            'ref' => $body['shared'] ?? null,
            'request' => [
                'provider' => 'openai',
                'config' => ['provider' => 'openai', 'voice' => $voice, 'style' => $voiceStyle],
                'kind' => 'speak',
                'text' => $text,
                'verse' => null,
                'language' => $language,
            ],
        ] : null);
    }

    respond(200, [
        'audioUrl' => BASE_PATH . AUDIO_BASE_URL . "/speak/{$voice}/{$key}.mp3",
        'alignmentUrl' => BASE_PATH . AUDIO_BASE_URL . "/speak/{$voice}/{$key}.json",
        'cached' => $cached,
    ]);
}

// ---------- generating one entry --------------------------------------------
//
// What a cache miss holds while it generates, for either provider: the entry's
// lock, the temp files, and — for a shared voice — one of the owner's slots
// and the characters reserved against their allowance. fail() exits, so
// clean-up that waited for a return would be skipped on exactly the paths that
// need it; NarrationJob does it from a shutdown hook instead, on every way out.

final class NarrationJob {
    /** @var resource|null the per-entry generation lock */
    public $lock = null;
    /** @var array{0: resource, 1: string}|null an owner's slot (api/sponsorship.php) */
    public ?array $slot = null;
    /** @var string[] temp files not yet renamed into place */
    public array $temps = [];
    /** Characters reserved against a shared voice's allowance. */
    public ?array $reservation = null;
    /** True once an upstream call has returned audio: the reservation was
     * spent then, whatever happens after, and is not given back. */
    public bool $spent = false;

    public function __construct(public string $lockPath) {
        register_shutdown_function([$this, 'end']);
    }

    /** Let go of everything, giving back a reservation nothing was spent on.
     * Idempotent: the shutdown hook calls it again after every request. */
    public function end(): void {
        foreach ($this->temps as $f) {
            if (is_file($f)) @unlink($f);
        }
        $this->temps = [];
        if ($this->reservation !== null && !$this->spent) refundSponsoredChars($this->reservation);
        $this->reservation = null;
        if ($this->slot !== null) narrationUnlock($this->slot[0], $this->slot[1]);
        $this->slot = null;
        if ($this->lock !== null) narrationUnlock($this->lock, $this->lockPath);
        $this->lock = null;
    }

    /** The entry is published: its temp files are gone into place, and what was
     * reserved for it was spent. */
    public function commit(): void {
        $this->temps = [];
        $this->reservation = null;
        $this->end();
    }
}

/**
 * Take a generation lock: a handle on success, false when another request held
 * it for longer than `$waitSeconds`, null when no lock file can be opened at
 * all.
 *
 * The holder deletes the file as it lets go (see narrationUnlock), so a waiter
 * can win a lock on a file that is no longer there; it notices — the inode at
 * the path is not the one it holds — and starts over on the fresh file. That
 * keeps WORK_DIR empty between generations without ever letting two requests
 * generate one entry.
 */
function narrationLock(string $path, float $waitSeconds) {
    $deadline = microtime(true) + $waitSeconds;
    while (true) {
        $fp = narrationTryLock($path);
        if ($fp !== false) return $fp;
        if (microtime(true) >= $deadline) return false;
        usleep(100000);
    }
}

/** One attempt at narrationLock: a handle, false when it is held, null when no
 * lock file can be opened. Never waits. */
function narrationTryLock(string $path) {
    while (true) {
        $fp = @fopen($path, 'c');
        if ($fp === false) return null;
        if (!flock($fp, LOCK_EX | LOCK_NB)) {
            fclose($fp);
            return false;
        }
        clearstatcache(true, $path);
        $onDisk = @stat($path);
        $held = fstat($fp);
        if ($onDisk !== false && $held !== false && $onDisk['ino'] === $held['ino'] && $onDisk['dev'] === $held['dev']) {
            return $fp;
        }
        // Won a file its holder had just deleted: try the one now there.
        flock($fp, LOCK_UN);
        fclose($fp);
    }
}

/** Delete the lock file *before* unlocking it — see narrationLock. */
function narrationUnlock($fp, string $path): void {
    @unlink($path);
    flock($fp, LOCK_UN);
    fclose($fp);
}

/** Bytes into a fresh 0600 temp file in WORK_DIR, registered for cleanup. */
function narrationTempFile(string $bytes, array &$temps): ?string {
    $tmp = @tempnam(WORK_DIR, 'tts-');
    if ($tmp === false) return null;
    $temps[] = $tmp;
    if (realpath(dirname($tmp)) !== realpath(WORK_DIR)) return null;
    return @file_put_contents($tmp, $bytes) === strlen($bytes) ? $tmp : null;
}

/**
 * Rename a generated entry into place: the audio first, the alignment last —
 * its presence is what a hit tests, so nobody is ever served half an entry —
 * each made world-readable, because AUDIO_DIR is served statically. A rename
 * replaces a stale entry atomically.
 */
function publishNarration(string $dir, string $tmpAudio, string $audioFile, string $tmpAlignment, string $alignmentFile): void {
    if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) fail(500, 'could not write audio file');
    if (!@rename($tmpAudio, $audioFile)) fail(500, 'could not write audio file');
    @chmod($audioFile, 0644);
    if (!@rename($tmpAlignment, $alignmentFile)) fail(500, 'could not write audio file');
    @chmod($alignmentFile, 0644);
}

function handleTranscribe(array $ctx): void {
    if (empty($_FILES['audio'])) fail(400, 'no audio uploaded');
    $tmp = $_FILES['audio']['tmp_name'];
    $name = $_FILES['audio']['name'] ?? 'audio.webm';
    $language = is_string($_POST['language'] ?? null) ? $_POST['language'] : 'en';

    $resp = curlMultipart(
        openAiUrl('/v1/audio/transcriptions'),
        [
            'model' => STT_MODEL,
            'response_format' => 'json',
            'language' => $language === 'de' ? 'de' : 'en',
        ],
        'file',
        $tmp,
        $name,
        $ctx['payer']['key'],
    );
    checkOpenAiResponse($ctx, $resp, 'transcribe failed');
    respond(200, ['text' => $resp['text'] ?? '']);
}

// ---------- MPEG audio frames ----------------------------------------------
//
// ElevenLabs answers v4 narration in chunks, and each chunk's MP3 may arrive
// wrapped in an ID3 tag, open with a Xing/Info header frame and end in an
// ID3v1/APE tag. Joining chunks means joining their *audio frames* only, and
// a chunk's duration is its frame count — the number every later chunk's
// timings are offset by. Pure functions; no I/O.

/**
 * The MPEG audio frame header at `$pos`, or null when there is none there.
 *
 * @return ?array{length:int, sampleRate:int, samplesPerFrame:int, version:int, layer:int, tagOffset:int}
 */
function mp3FrameHeader(string $b, int $pos, int $end): ?array {
    if ($pos < 0 || $pos + 4 > $end) return null;
    if (ord($b[$pos]) !== 0xFF) return null;
    $b1 = ord($b[$pos + 1]);
    $b2 = ord($b[$pos + 2]);
    $b3 = ord($b[$pos + 3]);
    if (($b1 & 0xE0) !== 0xE0) return null;
    $version = ($b1 >> 3) & 0x03;      // 3 MPEG-1, 2 MPEG-2, 0 MPEG-2.5, 1 reserved
    $layer = ($b1 >> 1) & 0x03;        // 1 Layer III, 2 Layer II, 3 Layer I, 0 reserved
    $bitrateIndex = ($b2 >> 4) & 0x0F;
    $rateIndex = ($b2 >> 2) & 0x03;
    if ($version === 1 || $layer === 0 || $bitrateIndex === 0 || $bitrateIndex === 15 || $rateIndex === 3) return null;

    static $rates = [3 => [44100, 48000, 32000], 2 => [22050, 24000, 16000], 0 => [11025, 12000, 8000]];
    static $kbps = [
        'v1l1' => [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
        'v1l2' => [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
        'v1l3' => [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
        'v2l1' => [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
        'v2l23' => [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
    ];
    $mpeg1 = $version === 3;
    $sampleRate = $rates[$version][$rateIndex];
    $padding = ($b2 >> 1) & 0x01;
    if ($layer === 3) {
        $bitrate = $kbps[$mpeg1 ? 'v1l1' : 'v2l1'][$bitrateIndex] * 1000;
        $length = (intdiv(12 * $bitrate, $sampleRate) + $padding) * 4;
        $samples = 384;
    } elseif ($layer === 2) {
        $bitrate = $kbps[$mpeg1 ? 'v1l2' : 'v2l23'][$bitrateIndex] * 1000;
        $length = intdiv(144 * $bitrate, $sampleRate) + $padding;
        $samples = 1152;
    } else {
        $bitrate = $kbps[$mpeg1 ? 'v1l3' : 'v2l23'][$bitrateIndex] * 1000;
        $length = intdiv(($mpeg1 ? 144 : 72) * $bitrate, $sampleRate) + $padding;
        $samples = $mpeg1 ? 1152 : 576;
    }
    $mono = (($b3 >> 6) & 0x03) === 3;
    return [
        'length' => $length,
        'sampleRate' => $sampleRate,
        'samplesPerFrame' => $samples,
        'version' => $version,
        'layer' => $layer,
        // Where a Xing/Info tag would sit: after the header, the optional CRC
        // and the side information.
        'tagOffset' => 4 + (($b1 & 0x01) === 0 ? 2 : 0) + ($mpeg1 ? ($mono ? 17 : 32) : ($mono ? 9 : 17)),
    ];
}

/**
 * The audio frames of an MP3 and nothing else: no leading ID3v2 tag, no
 * Xing/Info/VBRI header frame, no trailing ID3v1/APE tag. Two results
 * concatenated are a valid MP3 exactly as long as both together.
 *
 * Null when the bytes are not one MPEG audio stream: no frame pair is found
 * near the start, or the stream breaks off (format change, lost sync) with
 * more than a few kilobytes still to go.
 *
 * @return ?array{audio:string, frames:int, sampleRate:int, samplesPerFrame:int, duration:float}
 */
function mp3Scan(string $bytes): ?array {
    $end = strlen($bytes);
    $pos = 0;
    while ($end - $pos >= 10 && substr($bytes, $pos, 3) === 'ID3') {
        $size = ((ord($bytes[$pos + 6]) & 0x7F) << 21) | ((ord($bytes[$pos + 7]) & 0x7F) << 14)
            | ((ord($bytes[$pos + 8]) & 0x7F) << 7) | (ord($bytes[$pos + 9]) & 0x7F);
        $pos += 10 + $size + ((ord($bytes[$pos + 5]) & 0x10) !== 0 ? 10 : 0);
    }
    if ($end - $pos >= 128 && substr($bytes, $end - 128, 3) === 'TAG') $end -= 128;
    if ($end - $pos >= 32 && substr($bytes, $end - 32, 8) === 'APETAGEX') {
        $tagSize = unpack('V', substr($bytes, $end - 20, 4))[1];
        $flags = unpack('V', substr($bytes, $end - 12, 4))[1];
        $total = $tagSize + (($flags & 0x80000000) !== 0 ? 32 : 0);
        if ($total >= 32 && $total <= $end - $pos) $end -= $total;
    }

    // The first frame: a header whose frame is followed by another like it
    // (or ends the data exactly) — one header alone is too easy to fake.
    $first = null;
    $limit = min($end, $pos + 65536);
    for ($p = $pos; $p !== false && $p + 4 <= $limit; $p = strpos($bytes, "\xFF", $p + 1)) {
        $h = mp3FrameHeader($bytes, $p, $end);
        if ($h === null) continue;
        $after = $p + $h['length'];
        if ($after === $end) {
            $first = $p;
            break;
        }
        $h2 = mp3FrameHeader($bytes, $after, $end);
        if ($h2 !== null && $h2['sampleRate'] === $h['sampleRate'] && $h2['layer'] === $h['layer'] && $h2['version'] === $h['version']) {
            $first = $p;
            break;
        }
    }
    if ($first === null) return null;

    $format = mp3FrameHeader($bytes, $first, $end);
    $frames = [];
    $p = $first;
    while ($p < $end) {
        $h = mp3FrameHeader($bytes, $p, $end);
        if ($h === null || $h['sampleRate'] !== $format['sampleRate'] || $h['layer'] !== $format['layer'] || $h['version'] !== $format['version']) break;
        if ($p + $h['length'] > $end) break; // a truncated last frame is dropped
        $frame = substr($bytes, $p, $h['length']);
        $p += $h['length'];
        if ($frames === [] && $p - $h['length'] === $first) {
            $tag = substr($frame, $h['tagOffset'], 4);
            if ($tag === 'Xing' || $tag === 'Info' || substr($frame, 36, 4) === 'VBRI') continue;
        }
        $frames[] = $frame;
    }
    if ($frames === [] || $end - $p > 4096) return null;
    return [
        'audio' => implode('', $frames),
        'frames' => count($frames),
        'sampleRate' => $format['sampleRate'],
        'samplesPerFrame' => $format['samplesPerFrame'],
        'duration' => count($frames) * $format['samplesPerFrame'] / $format['sampleRate'],
    ];
}

// ---------- character timings -> word alignment ------------------------------
//
// ElevenLabs answers with a time for every character it spoke. The reader
// highlights *words*, numbered exactly the way src/lib/wordTokens.ts cuts the
// text, so this turns character times into one entry per such word:
// words[i].word === wordTokens(text)[i]. scripts/voices/verifyVoicesBackend.mjs
// checks that against wordTokens() itself. Pure functions; no I/O.

/**
 * JavaScript's `\s` — what wordTokens() splits on — and deliberately not
 * PCRE's: the two disagree on U+0085 (PCRE space, JS not) and U+FEFF (JS
 * space, PCRE not), and one disagreement shifts every word index after it.
 */
const JS_WHITESPACE = [
    0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0xA0, 0x1680,
    0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200A,
    0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF,
];

/** JS_WHITESPACE as the inside of a PCRE character class (for a /u pattern):
 * what `\s` means to the client, wherever the server has to agree with it. */
function jsWhitespaceClass(): string {
    return implode('', array_map(fn(int $c): string => sprintf('\\x{%04X}', $c), JS_WHITESPACE));
}

/** Is this one code point JavaScript whitespace? */
function isJsSpace(string $cp): bool {
    static $set = null;
    if ($set === null) {
        $set = [];
        foreach (JS_WHITESPACE as $c) $set[mb_chr($c, 'UTF-8')] = true;
    }
    return isset($set[$cp]);
}

function isLetterOrDigit(string $cp): bool {
    return preg_match('/^[\p{L}\p{N}]/u', $cp) === 1;
}

/**
 * The words of a text, as [from, to) code-point ranges: wordTokens() without
 * the empty strings split() produces at a leading or trailing space (the
 * leading one is accounted for by elevenLabsWords' placeholder).
 */
function jsWordRanges(array $cps): array {
    $ranges = [];
    $start = null;
    foreach ($cps as $i => $c) {
        if (isJsSpace($c)) {
            if ($start !== null) $ranges[] = [$start, $i];
            $start = null;
        } elseif ($start === null) {
            $start = $i;
        }
    }
    if ($start !== null) $ranges[] = [$start, count($cps)];
    return $ranges;
}

/**
 * One with-timestamps `alignment` (or `normalized_alignment`) as a list of
 * [character, start, end] — or null unless it is three equal, non-empty
 * arrays of strings and non-negative numbers.
 */
function characterTimingsOf(mixed $alignment): ?array {
    if (!is_array($alignment)) return null;
    $chars = $alignment['characters'] ?? null;
    $starts = $alignment['character_start_times_seconds'] ?? null;
    $ends = $alignment['character_end_times_seconds'] ?? null;
    if (!is_array($chars) || !is_array($starts) || !is_array($ends)) return null;
    $chars = array_values($chars);
    $starts = array_values($starts);
    $ends = array_values($ends);
    $n = count($chars);
    if ($n === 0 || count($starts) !== $n || count($ends) !== $n) return null;
    $out = [];
    for ($i = 0; $i < $n; $i++) {
        $c = $chars[$i];
        $s = $starts[$i];
        $e = $ends[$i];
        if (!is_string($c) || (!is_int($s) && !is_float($s)) || (!is_int($e) && !is_float($e))) return null;
        if (!is_finite((float)$s) || !is_finite((float)$e) || $s < 0) return null;
        $out[] = [$c, (float)$s, max((float)$s, (float)$e)];
    }
    return $out;
}

/**
 * A character, folded for "is this the same character, spoken": case,
 * typographic quotes, dashes and the ellipsis, NFKD with the combining marks
 * dropped (so a decomposed ü meets a precomposed one). Whitespace folds to one
 * space; a lone combining mark folds to '' and matches nothing.
 */
function looseCharKey(string $c): string {
    static $memo = [];
    if (isset($memo[$c])) return $memo[$c];
    static $typographic = [
        '„' => '"', '“' => '"', '”' => '"', '‟' => '"', '«' => '"', '»' => '"', '″' => '"',
        '‚' => "'", '‘' => "'", '’' => "'", '‛' => "'", '‹' => "'", '›' => "'", '′' => "'", '`' => "'", '´' => "'",
        '‐' => '-', '‑' => '-', '‒' => '-', '–' => '-', '—' => '-', '―' => '-', '−' => '-',
        '…' => '.',
    ];
    if (isJsSpace($c)) {
        $key = ' ';
    } else {
        $key = $typographic[$c] ?? $c;
        if (class_exists('Normalizer')) {
            $decomposed = Normalizer::normalize($key, Normalizer::FORM_KD);
            if (is_string($decomposed)) $key = $decomposed;
        }
        $key = mb_strtolower(preg_replace('/\p{Mn}+/u', '', $key) ?? $key, 'UTF-8');
    }
    if (count($memo) < 4096) $memo[$c] = $key;
    return $key;
}

function sameSpokenChar(string $a, string $b): bool {
    if ($a === $b) return true;
    $key = looseCharKey($a);
    return $key !== '' && $key === looseCharKey($b);
}

/**
 * Character timings onto the code points of the text that was sent: exact
 * when the characters are the text's own, else a two-pointer walk that
 * matches loosely (sameSpokenChar) and looks up to eight characters ahead on
 * either side to step over what only one of them has. `reliable` says whether
 * at least half of the text's letters and digits found their match; `span`
 * is when this response's speech starts and ends.
 *
 * @return array{times: list<?array{0:float,1:float}>, exact: bool, reliable: bool, span: array{0:float,1:float}}
 */
function mapCharacterTimings(array $said, array $timings): array {
    $spoken = [];
    foreach ($timings as [$c, $s, $e]) {
        foreach (mb_str_split($c) as $cp) $spoken[] = [$cp, $s, $e];
    }
    $span = [min(array_column($timings, 1)), max(array_column($timings, 2))];
    $n = count($said);
    $m = count($spoken);
    $times = array_fill(0, $n, null);
    if ($n === $m && array_column($spoken, 0) === array_values($said)) {
        foreach ($spoken as $i => [, $s, $e]) $times[$i] = [$s, $e];
        return ['times' => $times, 'exact' => true, 'reliable' => true, 'span' => $span];
    }

    $matched = 0;
    $i = 0;
    $j = 0;
    while ($i < $n && $j < $m) {
        if (sameSpokenChar($said[$i], $spoken[$j][0])) {
            $times[$i] = [$spoken[$j][1], $spoken[$j][2]];
            if (isLetterOrDigit($said[$i])) $matched++;
            $i++;
            $j++;
            continue;
        }
        $step = null;
        for ($d = 1; $d <= 8 && $step === null; $d++) {
            if ($i + $d < $n && sameSpokenChar($said[$i + $d], $spoken[$j][0])) $step = [$d, 0];
            elseif ($j + $d < $m && sameSpokenChar($said[$i], $spoken[$j + $d][0])) $step = [0, $d];
        }
        if ($step === null) {
            // A substitution: a different character in the same place still
            // marks when that place was spoken.
            if (!isJsSpace($said[$i]) && !isJsSpace($spoken[$j][0])) $times[$i] = [$spoken[$j][1], $spoken[$j][2]];
            $i++;
            $j++;
        } else {
            $i += $step[0];
            $j += $step[1];
        }
    }
    $letters = count(array_filter($said, 'isLetterOrDigit'));
    return ['times' => $times, 'exact' => false, 'reliable' => $matched * 2 >= $letters, 'span' => $span];
}

/** Times for words spread over [from, to] by their length. */
function proportionalWordTimes(array $ranges, float $from, float $to): array {
    $weights = array_map(fn(array $r): int => max(1, $r[1] - $r[0]), array_values($ranges));
    $total = max(1, array_sum($weights));
    $out = [];
    $done = 0;
    foreach ($weights as $w) {
        $start = $from + ($to - $from) * $done / $total;
        $done += $w;
        $out[] = [$start, $from + ($to - $from) * $done / $total];
    }
    return $out;
}

/** Fill each run of untimed words between its timed neighbours. */
function interpolateWordTimes(array $ranges, array $timed, float $duration): array {
    $count = count($ranges);
    $k = 0;
    while ($k < $count) {
        if ($timed[$k] !== null) {
            $k++;
            continue;
        }
        $run = $k;
        while ($k < $count && $timed[$k] === null) $k++;
        $lo = $run > 0 ? $timed[$run - 1][1] : 0.0;
        $hi = $k < $count ? $timed[$k][0] : $duration;
        foreach (proportionalWordTimes(array_slice($ranges, $run, $k - $run), $lo, max($lo, $hi)) as $i => $t) {
            $timed[$run + $i] = $t;
        }
    }
    return $timed;
}

/**
 * ElevenLabs character timings → the word alignment the reader plays.
 *
 * `$segments` says which code points of the text each response spoke and
 * when its audio started: [['from', 'to', 'alignment' (ElevenLabs' own
 * shape), 'offset' (s), 'duration' (s, optional)], …]. `$spoken` is the text
 * as sent when it differs (v4's bracket swap), and has the same length.
 *
 *   - a word starts at its first letter or digit (else its earliest timed
 *     character) and ends where the next word starts — gaps are filled, so a
 *     pause keeps the last word lit — the last one at its last sound;
 *   - times never go backwards, never pass the audio's real duration, and are
 *     rounded to milliseconds;
 *   - a text that starts with whitespace gets a `{word: ' ', start: 0, end: 0}`
 *     first, because wordTokens() counts the empty token split() yields there
 *     and parseAlignment drops an empty word — without it every index shifts.
 *
 * `quality`: `exact` (the characters were the text's own), `repaired` (a
 * loose match, or a few words interpolated), `proportional` (a response
 * could not be matched, so its words were spread over its audio, or more than
 * a fifth of the words were guessed), `none` (no timings at all — words: [],
 * and the audio still plays).
 *
 * @return array{words: list<array{word:string, start:float|int, end:float|int}>, quality: string}
 */
function elevenLabsWords(string $text, array $segments, float $duration, ?string $spoken = null): array {
    $cps = mb_str_split($text);
    $said = $spoken === null ? $cps : mb_str_split($spoken);
    if (count($said) !== count($cps)) $said = $cps;
    $n = count($cps);
    $ranges = jsWordRanges($cps);
    if ($ranges === [] || !($duration > 0)) return ['words' => [], 'quality' => 'none'];

    // 1. A time for every code point a response's characters matched — or,
    // for a response that matched nothing, the stretch of audio it occupies.
    $times = array_fill(0, $n, null);
    $owner = array_fill(0, $n, null);
    $spans = [];
    $exact = true;
    $unmapped = false;
    $anyTimings = false;
    foreach (array_values($segments) as $si => $segment) {
        $from = max(0, (int)($segment['from'] ?? 0));
        $to = min($n, (int)($segment['to'] ?? 0));
        if ($to <= $from) continue;
        $offset = (float)($segment['offset'] ?? 0.0);
        $timings = characterTimingsOf($segment['alignment'] ?? null);
        if ($timings !== null) $anyTimings = true;
        $map = $timings === null ? null : mapCharacterTimings(array_slice($said, $from, $to - $from), $timings);
        if ($map !== null && $map['reliable']) {
            if (!$map['exact']) $exact = false;
            foreach ($map['times'] as $i => $t) {
                if ($t !== null) $times[$from + $i] = [$t[0] + $offset, $t[1] + $offset];
            }
            continue;
        }
        $exact = false;
        $unmapped = true;
        $span = $map !== null
            ? $map['span']
            : (isset($segment['duration']) ? [0.0, (float)$segment['duration']] : null);
        if ($span === null) continue;
        $spans[$si] = [$span[0] + $offset, $span[1] + $offset];
        for ($i = $from; $i < $to; $i++) $owner[$i] = $si;
    }
    // Not one character timed anywhere: say so rather than guess the lot.
    // (One untimed chunk among timed ones is spread over its own audio below.)
    if (!$anyTimings) return ['words' => [], 'quality' => 'none'];

    // 2. A time for every word that has timed characters.
    $timed = [];
    $byOwner = [];
    foreach ($ranges as $k => [$a, $b]) {
        $first = null;
        $earliest = null;
        $latest = null;
        for ($i = $a; $i < $b; $i++) {
            $t = $times[$i];
            if ($t === null) continue;
            if ($first === null && isLetterOrDigit($cps[$i])) $first = $t[0];
            $earliest = $earliest === null ? $t[0] : min($earliest, $t[0]);
            $latest = $latest === null ? $t[1] : max($latest, $t[1]);
        }
        $timed[$k] = $earliest === null ? null : [$first ?? $earliest, $latest];
        if ($earliest === null && $owner[$a] !== null) $byOwner[$owner[$a]][] = $k;
    }

    // 3. The rest: spread over their response's audio, or between neighbours.
    foreach ($byOwner as $si => $ks) {
        $fill = proportionalWordTimes(array_map(fn(int $k): array => $ranges[$k], $ks), $spans[$si][0], $spans[$si][1]);
        foreach ($ks as $i => $k) $timed[$k] = $fill[$i];
    }
    $guessed = count(array_filter($timed, fn($t): bool => $t === null));
    $timed = interpolateWordTimes($ranges, $timed, $duration);
    if ($unmapped || $guessed * 5 > count($ranges)) $quality = 'proportional';
    elseif ($exact && $guessed === 0) $quality = 'exact';
    else $quality = 'repaired';

    // 4. Monotonic, gap-free, inside the audio.
    $starts = [];
    $previous = 0.0;
    foreach ($timed as $k => [$s]) {
        $previous = max($previous, min($s, $duration));
        $starts[$k] = $previous;
    }
    $words = isJsSpace($cps[0]) ? [['word' => ' ', 'start' => 0, 'end' => 0]] : [];
    $last = count($ranges) - 1;
    foreach ($ranges as $k => [$a, $b]) {
        $start = $starts[$k];
        $end = $k < $last ? $starts[$k + 1] : min(max($timed[$k][1], $start), $duration);
        $words[] = [
            'word' => implode('', array_slice($cps, $a, $b - $a)),
            'start' => round($start, 3),
            'end' => round(max($end, $start), 3),
        ];
    }
    return ['words' => $words, 'quality' => $quality];
}
