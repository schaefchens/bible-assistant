<?php
declare(strict_types=1);

// An include, not an endpoint — see APP_ROOT in api.php. Fetched directly this
// file must say nothing: it never runs api.php's ini_set('display_errors', '0').
if (!defined('APP_ROOT')) { http_response_code(404); exit; }

/**
 * The assistant proxy: one endpoint, forwarding a tool-calling chat request.
 */

function handleChat(array $ctx): void {
    // Decode as stdClass (NOT assoc) so empty objects like `properties: {}` survive
    // a JSON round-trip — assoc arrays can't distinguish [] from {} and OpenAI rejects
    // any tool whose `parameters.properties` arrives as `[]` instead of `{}`.
    $raw = file_get_contents('php://input');
    if (!$raw) fail(400, 'empty body');
    $obj = json_decode($raw, false);
    if (!is_object($obj) || !isset($obj->messages) || !isset($obj->tools)) {
        fail(400, 'messages and tools required');
    }
    if (!isset($obj->model) || !is_string($obj->model)) $obj->model = CHAT_MODEL_DEFAULT;
    $obj->tool_choice = 'auto';
    if (!isset($obj->temperature)) $obj->temperature = 0.2;

    $payload = json_encode($obj, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $resp = curlRawJson('https://api.openai.com/v1/chat/completions', $payload, $ctx['openaiKey']);
    checkOpenAiResponse($ctx, $resp, 'openai chat failed');
    $choice = $resp['choices'][0] ?? null;
    if (!$choice) fail(502, 'no choice returned');
    respond(200, [
        'message' => $choice['message'],
        'finish_reason' => $choice['finish_reason'] ?? null,
    ]);
}
