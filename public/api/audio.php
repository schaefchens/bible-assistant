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
 * In: `transcribe` proxies Whisper for voice input.
 */

/**
 * Compose `instructions` for the OpenAI TTS request. A language hint based
 * on the Bible translation prevents the model from drifting into English
 * pronunciation on short German verses (or vice versa). Any user-provided
 * voiceStyle is appended after the language hint.
 */
function composeTtsInstructions(string $translation, string $voiceStyle): string {
    static $germanTranslations = ['S00' => 1, 'LUT' => 1, 'HFA' => 1, 'S51' => 1, 'ELB' => 1];
    $upper = strtoupper($translation);
    $hint = isset($germanTranslations[$upper])
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
        'https://api.openai.com/v1/audio/transcriptions',
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
    file_put_contents($path, json_encode(array_merge([
        'words' => $align['words'] ?? [],
        'duration' => $align['duration'] ?? null,
        'text' => $align['text'] ?? null,
    ], $extra), JSON_UNESCAPED_UNICODE));
}

/**
 * Generate audio via OpenAI TTS, persist the mp3, then run forced alignment
 * and persist the alignment JSON. On TTS failure the request fails (via
 * failOpenAi); on alignment failure it degrades gracefully by writing an
 * empty-words alignment so the client still plays the audio. `$alignmentExtra`
 * is merged into the alignment JSON in both the success and empty-fallback
 * cases (handleTts uses it to stamp sourceTextHash). Shared by handleTts and
 * handleTtsSpeak.
 */
function synthesizeAndCacheAudio(
    array $ctx,
    string $text,
    string $voice,
    string $instructions,
    string $audioFile,
    string $alignmentFile,
    array $alignmentExtra = [],
): void {
    $payload = [
        'model' => TTS_MODEL,
        'voice' => $voice,
        'input' => $text,
        'response_format' => 'mp3',
    ];
    if ($instructions !== '') {
        $payload['instructions'] = $instructions;
    }
    $tts = curlBinary('https://api.openai.com/v1/audio/speech', $payload, $ctx['openaiKey']);
    if ((int)($tts['_status'] ?? 0) !== 200 || empty($tts['audio'])) {
        failOpenAi($ctx, 'tts failed', $tts);
    }
    if (file_put_contents($audioFile, $tts['audio']) === false) {
        fail(500, 'could not write audio file');
    }
    $align = forcedAlignment($audioFile, basename($audioFile), $ctx['openaiKey']);
    if ((int)($align['_status'] ?? 0) !== 200) {
        // Keep the audio; write an empty alignment so the client falls back gracefully.
        file_put_contents($alignmentFile, json_encode(array_merge(['words' => []], $alignmentExtra)));
    } else {
        writeAlignment($alignmentFile, $align, $alignmentExtra);
    }
}

function handleTts(array $ctx): void {
    $body = readJsonBody();
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
    @mkdir($dir, 0775, true);
    $audioFile = "{$dir}/{$verse}.mp3";
    $alignmentFile = "{$dir}/{$verse}.json";

    // Treat audio as stale when its sourceTextHash doesn't match the current
    // text. Pre-migration audio (bolls.life pipeline) sometimes baked inline
    // footnote refs like "16" / "17" into the mp3 because textTts hadn't been
    // stripped yet — without this check those keep playing forever.
    $expectedHash = sha256ForCache($text, $voiceStyle);
    $cached = file_exists($audioFile)
        && file_exists($alignmentFile)
        && cachedAlignmentMatches($alignmentFile, $expectedHash);
    if (!$cached) {
        // Forced alignment stamps sourceTextHash so a future text change
        // (e.g. footnote cleanup) marks the cached mp3 stale — see above.
        synthesizeAndCacheAudio(
            $ctx,
            $text,
            $voice,
            composeTtsInstructions($translation, $voiceStyle),
            $audioFile,
            $alignmentFile,
            ['sourceTextHash' => $expectedHash],
        );
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
 */
function handleTtsSpeak(array $ctx): void {
    $body = readJsonBody();
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
    @mkdir($dir, 0775, true);
    $audioFile = "{$dir}/{$key}.mp3";
    $alignmentFile = "{$dir}/{$key}.json";

    $cached = file_exists($audioFile) && file_exists($alignmentFile);
    if (!$cached) {
        synthesizeAndCacheAudio(
            $ctx,
            $text,
            $voice,
            composeSpeakInstructions($language, $voiceStyle),
            $audioFile,
            $alignmentFile,
        );
    }

    respond(200, [
        'audioUrl' => BASE_PATH . AUDIO_BASE_URL . "/speak/{$voice}/{$key}.mp3",
        'alignmentUrl' => BASE_PATH . AUDIO_BASE_URL . "/speak/{$voice}/{$key}.json",
        'cached' => $cached,
    ]);
}

function handleTranscribe(array $ctx): void {
    if (empty($_FILES['audio'])) fail(400, 'no audio uploaded');
    $tmp = $_FILES['audio']['tmp_name'];
    $name = $_FILES['audio']['name'] ?? 'audio.webm';
    $language = is_string($_POST['language'] ?? null) ? $_POST['language'] : 'en';

    $resp = curlMultipart(
        'https://api.openai.com/v1/audio/transcriptions',
        [
            'model' => STT_MODEL,
            'response_format' => 'json',
            'language' => $language === 'de' ? 'de' : 'en',
        ],
        'file',
        $tmp,
        $name,
        $ctx['openaiKey'],
    );
    checkOpenAiResponse($ctx, $resp, 'transcribe failed');
    respond(200, ['text' => $resp['text'] ?? '']);
}
