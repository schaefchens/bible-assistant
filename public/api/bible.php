<?php
declare(strict_types=1);

// An include, not an endpoint — see APP_ROOT in api.php. Fetched directly this
// file must say nothing: it never runs api.php's ini_set('display_errors', '0').
if (!defined('APP_ROOT')) { http_response_code(404); exit; }

/**
 * Scripture text, parsed out of the Zefania XML in public/bibles/.
 *
 * `normalizeSpace` and `stripForTts` are byte-for-byte mirrored in
 * scripts/bible/phpCompat.mjs, which is what lets `npm run bible:verify`
 * assert the JS pack builder and this parser agree on every fixture. Changing
 * either without the other is what that script exists to catch.
 */

/**
 * Fetch a Bible chapter from the local Zefania XML, cached per chapter to
 * storage/bible/{translation}/{bookId}/{chapter}.json so repeat reads are
 * disk-only. Translations must be registered in BIBLE_XML_MAP; unknown codes
 * return 400.
 */
function handleBibleChapter(): void {
    $body = readJsonBody();
    $translation = safeSlug(safeString($body['translation'] ?? '', 16));
    $bookId = safeInt($body['bookId'] ?? null);
    $chapter = safeInt($body['chapter'] ?? null);
    if (!$translation || $bookId <= 0 || $chapter <= 0) {
        fail(400, 'missing bible.chapter params');
    }

    $xmlSlug = BIBLE_XML_MAP[strtoupper($translation)] ?? null;
    if ($xmlSlug === null) {
        fail(400, 'unknown translation', ['translation' => $translation]);
    }

    $dir = STORAGE_DIR . "/bible/{$translation}/{$bookId}";
    @mkdir($dir, 0775, true);
    $file = "{$dir}/{$chapter}.json";

    if (file_exists($file)) {
        $raw = file_get_contents($file);
        if ($raw !== false && $raw !== '') {
            $cached = json_decode($raw, true);
            // Cache uses { format, verses } so future schema bumps via
            // BIBLE_CACHE_FORMAT invalidate stale entries automatically.
            if (is_array($cached) && ($cached['format'] ?? null) === BIBLE_CACHE_FORMAT) {
                respond(200, ['verses' => $cached['verses'] ?? [], 'cached' => true]);
                return;
            }
        }
    }

    $xmlPath = APP_ROOT . '/bibles/' . $xmlSlug;
    if (!is_readable($xmlPath)) {
        fail(500, 'bible xml missing on server', ['translation' => $translation]);
    }
    $verses = parseZefaniaChapter($xmlPath, $bookId, $chapter);
    if ($verses === null) {
        fail(404, 'chapter not found', ['translation' => $translation, 'bookId' => $bookId, 'chapter' => $chapter]);
    }
    file_put_contents($file, json_encode([
        'format' => BIBLE_CACHE_FORMAT,
        'verses' => $verses,
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    respond(200, ['verses' => $verses, 'cached' => false]);
}

/**
 * Parse a single chapter out of a Zefania XML file. Returns an array of
 * verse rows, or null if the requested book/chapter wasn't found.
 *
 * Handles both Zefania flavours we ship:
 *   - simple:   <bible>/<testament>/<book number=>/<chapter number=>/<verse number=>
 *   - zef2005:  <XMLBIBLE>/<BIBLEBOOK bnumber=>/<CHAPTER cnumber=>/<VERS vnumber=>
 *
 * Uses XMLReader to skip past non-matching books cheaply (the Strong's bibles
 * are 12 MB each), then DOM-expands the matched book for mixed-content walks.
 */
function parseZefaniaChapter(string $xmlPath, int $bookId, int $chapter): ?array {
    $reader = new XMLReader();
    if (!$reader->open($xmlPath)) return null;
    $doc = new DOMDocument();

    while ($reader->read()) {
        if ($reader->nodeType !== XMLReader::ELEMENT) continue;
        $name = $reader->localName;
        if ($name !== 'book' && $name !== 'BIBLEBOOK') continue;
        $bnum = (int)($reader->getAttribute('number') ?: $reader->getAttribute('bnumber') ?: 0);
        if ($bnum !== $bookId) {
            $reader->next();
            continue;
        }
        $bookNode = $reader->expand($doc);
        $reader->close();
        if (!$bookNode instanceof DOMElement) return null;
        foreach ($bookNode->childNodes as $chapNode) {
            if (!$chapNode instanceof DOMElement) continue;
            $cname = $chapNode->nodeName;
            if ($cname !== 'chapter' && $cname !== 'CHAPTER') continue;
            $cnum = (int)($chapNode->getAttribute('number') ?: $chapNode->getAttribute('cnumber') ?: 0);
            if ($cnum === $chapter) {
                return parseZefaniaVerses($chapNode, $bookId, $chapter);
            }
        }
        return null;
    }
    $reader->close();
    return null;
}

function parseZefaniaVerses(DOMElement $chap, int $bookId, int $chapter): array {
    $verses = [];
    foreach ($chap->childNodes as $vnode) {
        if (!$vnode instanceof DOMElement) continue;
        $vname = $vnode->nodeName;
        if ($vname !== 'verse' && $vname !== 'VERS') continue;
        $vnum = (int)($vnode->getAttribute('number') ?: $vnode->getAttribute('vnumber') ?: 0);
        if ($vnum <= 0) continue;

        [$segments, $hasStrongs] = extractZefaniaSegments($vnode);
        $text = normalizeSpace(implode('', array_column($segments, 't')));
        $textTts = stripForTts($text);

        $verse = [
            'pk' => $bookId * 1_000_000 + $chapter * 1_000 + $vnum,
            'verse' => $vnum,
            'text' => $text,
            'textTts' => $textTts,
        ];
        if ($hasStrongs) {
            $verse['segments'] = array_map(
                fn($s) => $s['s'] !== null ? ['t' => $s['t'], 's' => $s['s']] : ['t' => $s['t']],
                $segments,
            );
        }
        $verses[] = $verse;
    }
    return $verses;
}

/**
 * Walk a <verse>/<VERS> element collecting [text, strong-number] segments.
 * Returns [segments, hasStrongs]. <NOTE> and <DIV> subtrees are dropped
 * entirely — they're study notes, not verse text.
 */
function extractZefaniaSegments(DOMElement $verse): array {
    $segments = [];
    $hasStrongs = false;
    foreach ($verse->childNodes as $node) {
        if ($node instanceof DOMText || $node instanceof DOMCdataSection) {
            $segments[] = ['t' => $node->nodeValue, 's' => null];
            continue;
        }
        if (!$node instanceof DOMElement) continue;
        $nm = $node->nodeName;
        if ($nm === 'gr') {
            $strong = $node->getAttribute('str');
            $segments[] = ['t' => $node->textContent, 's' => $strong !== '' ? $strong : null];
            if ($strong !== '') $hasStrongs = true;
            continue;
        }
        if ($nm === 'NOTE' || $nm === 'DIV') continue;
        // Anything else (rare): fold its plain text in so we don't lose content.
        $segments[] = ['t' => $node->textContent, 's' => null];
    }
    return [$segments, $hasStrongs];
}

function normalizeSpace(string $s): string {
    $s = preg_replace('/\s+/u', ' ', $s) ?? $s;
    // Some Zefania bibles (notably ELB1905) keep trailing spaces inside
    // <gr> tags, which surface as "Erde ." after concatenation. Trim space
    // before sentence punctuation so display and TTS both read cleanly.
    $s = preg_replace('/ +([.,;:!?»"])/u', '$1', $s) ?? $s;
    return trim($s);
}

/**
 * Produce a TTS-safe variant by removing bracketed editor inserts that read
 * aloud as noise — numeric footnote refs like "[37]", manuscript caveats like
 * "[SOME OF THE EARLIEST MANUSCRIPTS...]", and the bracketed alternate-reading
 * inserts found in ESV/NLT. Multi-verse "[[ ... ]]" spans (e.g. Mark 16:9-20)
 * leave orphan brackets when split per verse, so strip leftover bracket chars
 * too — the text in between is real verse content.
 */
function stripForTts(string $s): string {
    $s = preg_replace('/\[+[^\[\]]*\]+/u', '', $s) ?? $s;
    $s = preg_replace('/[\[\]]/u', '', $s) ?? $s;
    return normalizeSpace($s);
}
