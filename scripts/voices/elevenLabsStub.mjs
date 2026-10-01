/**
 * A stand-in for api.elevenlabs.io, run in-process by verifyVoicesBackend.mjs.
 *
 * It never reaches the real service: api.php is pointed here through
 * ELEVENLABS_API_BASE in the staged secrets.php, and this listens on
 * 127.0.0.1 only. Every request is recorded — method, path, query, headers,
 * body — because half of what the harness asserts is about what api.php
 * *sent*: which endpoint, which fields, no `Authorization`, never the OpenAI
 * key.
 *
 * Behaviour is chosen by the key (`xi-api-key`), so one stub serves every
 * account in the run:
 *
 *   sk_ok_…          everything works
 *   sk_restricted_…  no user_read and no voices_read (both refused with
 *                    `missing_permissions`); speech still works
 *   sk_bad_…         every call 401 `invalid_api_key` (the current error shape)
 *   sk_broke_…       speech refused 402 `quota_exceeded` (current shape)
 *   sk_brokelegacy_… speech refused 401 `quota_exceeded` (the original shape)
 *   sk_slow_…        speech answers after SLOW_MS
 *   sk_busy_…        speech always 429 `concurrent_limit_exceeded`
 *   sk_down_…        the account endpoints answer 500
 *   anything else    401 `invalid_api_key`
 *
 * and, for an `sk_ok_` key, by the voice id (see FAULTS), which is how one
 * account exercises every way a narration can fail.
 *
 * The audio is fake but well-formed: MPEG-1 Layer III, 128 kbps, 44.1 kHz,
 * mono (header FF FB 90 C4), 417/418-byte frames, wrapped in an ID3v2 tag, an
 * Info header frame and an ID3v1 tag the way an encoder might wrap it — which
 * is exactly what api.php must strip before it joins chunks. Every character
 * takes CHAR_SECONDS, so the harness can say to the millisecond when each
 * word must start.
 */
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';

export const SAMPLES_PER_FRAME = 1152;
export const SAMPLE_RATE = 44100;
export const FRAME_SECONDS = SAMPLES_PER_FRAME / SAMPLE_RATE;
/** When the first character starts, and how long each one takes. */
export const LEAD_SECONDS = 0.1;
export const CHAR_SECONDS = 0.05;
export const SLOW_MS = 700;

/** One audio frame. Padded frames are 418 bytes, unpadded 417. */
function mp3Frame(padded) {
  const f = Buffer.alloc(padded ? 418 : 417);
  f[0] = 0xff;
  f[1] = 0xfb;
  f[2] = padded ? 0x92 : 0x90;
  f[3] = 0xc4;
  return f;
}

/** A Xing-style "Info" header frame: a frame, but not audio. Mono MPEG-1, no
 * CRC, so the tag sits after 4 header + 17 side-info bytes. */
function infoFrame() {
  const f = mp3Frame(false);
  f.write('Info', 21, 'latin1');
  return f;
}

function id3v2() {
  const body = Buffer.alloc(20);
  return Buffer.concat([Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, body.length]), body]);
}

function id3v1() {
  const t = Buffer.alloc(128);
  t.write('TAG', 0, 'latin1');
  return t;
}

/** The padding rhythm of every frame index — shared with the harness, which
 * rebuilds the bytes api.php should have kept. */
export const paddedAt = (i) => i % 3 !== 2;

/** `frames` audio frames, wrapped (or not) the way an encoder might. */
export function fakeMp3(frames, { wrapped = true } = {}) {
  const parts = [];
  if (wrapped) parts.push(id3v2(), infoFrame());
  for (let i = 0; i < frames; i++) parts.push(mp3Frame(paddedAt(i)));
  if (wrapped) parts.push(id3v1());
  return Buffer.concat(parts);
}

/** How many frames the stub answers a text of `chars` code points with:
 * enough for every character, plus a little silence either side. */
export const framesFor = (chars) => Math.ceil((2 * LEAD_SECONDS + chars * CHAR_SECONDS) / FRAME_SECONDS);

/** The time the stub gives code point `i` of a response. */
export const charStart = (i) => +(LEAD_SECONDS + i * CHAR_SECONDS).toFixed(3);
export const charEnd = (i) => +(LEAD_SECONDS + (i + 1) * CHAR_SECONDS).toFixed(3);

function timings(text) {
  const chars = Array.from(text); // code points, as ElevenLabs' Python counts them
  return {
    characters: chars,
    character_start_times_seconds: chars.map((_, i) => charStart(i)),
    character_end_times_seconds: chars.map((_, i) => charEnd(i)),
  };
}

function timedAudio(text, { alignment = true, normalizedOnly = false } = {}) {
  const t = timings(text);
  const out = { audio_base64: fakeMp3(framesFor(Array.from(text).length)).toString('base64') };
  if (alignment && !normalizedOnly) out.alignment = t;
  if (alignment) out.normalized_alignment = t;
  return out;
}

/** The original error shape, and the current one. */
const legacy = (status, message) => ({ detail: { status, message } });
const current = (type, code, message) => ({
  detail: { type, code, message, request_id: 'req_stub', param: null },
});

const INVALID_KEY = { status: 401, body: current('authentication_error', 'invalid_api_key', 'Invalid API key') };

/**
 * Narration faults, by voice id (all of them valid ids, so they reach the
 * stub). `body` may be a function of the key, to prove api.php scrubs a key
 * that upstream echoes back.
 */
export const FAULTS = {
  FaultVoiceNotFound01: {
    status: 404,
    body: legacy('voice_not_found', 'A voice with the voice_id FaultVoiceNotFound01 was not found.'),
  },
  FaultNotAllowed00001: {
    status: 403,
    body: current('authorization_error', 'free_users_not_allowed', 'Free users cannot use library voices via the API.'),
  },
  FaultPermission00001: {
    status: 401,
    body: legacy('missing_permissions', 'The API key you used is missing the permission text_to_speech to execute this operation.'),
  },
  FaultRejected0000001: {
    status: 422,
    body: (key) => ({
      detail: [{ loc: ['body', 'inputs', 0, 'text'], msg: `Value error, refused for ${key}`, type: 'value_error' }],
    }),
  },
  FaultRejectedLong001: {
    status: 400,
    body: (key) => ({ detail: `Bad request for ${key}: ${'x'.repeat(1000)}` }),
  },
  FaultServerError0001: { status: 500, body: { detail: 'Internal Server Error' } },
  FaultUnavailable0001: { status: 503, body: { detail: 'Service Unavailable' } },
  FaultGarbage00000001: { status: 200, raw: '<html><body>not json</body></html>' },
  FaultBadAudio0000001: {
    status: 200,
    body: () => ({ audio_base64: randomBytes(5000).toString('base64'), alignment: timings('x') }),
  },
  FaultHugeResponse001: { status: 200, raw: 'x'.repeat(17 * 1024 * 1024) },
  FaultHugeChunked0001: { status: 200, chunked: 17 * 1024 * 1024 },
  FaultRedirect0000001: { status: 302, headers: { Location: 'http://127.0.0.1:9/elsewhere' }, raw: '' },
};
/** Voice ids that succeed, but differently. */
export const BUSY_ONCE_VOICE = 'FaultBusyOnce0000001';
export const NO_ALIGNMENT_VOICE = 'FaultNoAlignment0001';
export const NORMALIZED_ONLY_VOICE = 'FaultNormalizedOnly1';

/** The library: three good voices and one api.php must drop (a bad id). */
function libraryVoices() {
  return [
    {
      voice_id: 'JBFqnCBsd6RMkjVDRZzb',
      name: 'George',
      category: 'premade',
      labels: { accent: 'british', age: 'middle_aged', gender: 'male', descriptive: 'warm', use_case: 'narrative_story', internal_note: 'leak-me' },
      description: 'Warm resonance that instantly captivates listeners.',
      preview_url: 'https://storage.example/george.mp3',
      verified_languages: [
        { language: 'en', model_id: 'eleven_v4', accent: 'british', locale: 'en-GB', preview_url: 'https://storage.example/george-en.mp3', secret: 'leak-me' },
        { language: 'de', model_id: 'eleven_multilingual_v2', accent: 'standard', locale: 'de-DE', preview_url: 'javascript:alert(1)' },
      ],
      is_owner: false,
      sharing: { status: 'enabled', secret_internal: 'leak-me' },
      samples: [{ sample_id: 'leak-me' }],
      fine_tuning: { state: 'leak-me' },
    },
    {
      voice_id: 'XB0fDUnXU5powFXDhCwa',
      name: 'Charlotte',
      category: 'premade',
      labels: { accent: 'swedish', age: 'young', gender: 'female' },
      description: null,
      preview_url: 'http://insecure.example/charlotte.mp3',
      verified_languages: [],
      is_owner: false,
    },
    {
      voice_id: 'bad id!',
      name: 'Broken',
      category: 'cloned',
      labels: {},
      preview_url: 'https://storage.example/broken.mp3',
    },
    {
      voice_id: 'MyOwnVoice0000000001',
      name: 'Opa Heinrich',
      category: 'generated',
      labels: { descriptive: 'elderly' },
      description: 'A warm, elderly German narrator.',
      preview_url: 'https://storage.example/heinrich.mp3',
      verified_languages: [{ language: 'de', model_id: 'eleven_v4', accent: 'standard', locale: 'de-DE', preview_url: 'https://storage.example/heinrich-de.mp3' }],
      is_owner: true,
    },
  ];
}

function kindOf(key) {
  const m = /^sk_([a-z]+)_/.exec(key ?? '');
  return m && ['ok', 'restricted', 'bad', 'broke', 'brokelegacy', 'slow', 'busy', 'down'].includes(m[1]) ? m[1] : 'unknown';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function startElevenLabsStub() {
  /** Every request, in arrival order. */
  const requests = [];
  /** How often each voice id has been asked for, for the "busy once" voice. */
  const seen = new Map();

  const send = (res, status, body, headers = {}) => {
    const raw = typeof body === 'string' ? body : JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
    res.end(raw);
  };

  /** The account-level checks every endpoint shares. Returns true when it answered. */
  const refuseByKey = (res, kind, { speech }) => {
    if (kind === 'bad' || kind === 'unknown') return send(res, INVALID_KEY.status, INVALID_KEY.body), true;
    if (!speech && kind === 'down') return send(res, 500, { detail: 'upstream exploded' }), true;
    if (speech && kind === 'broke') {
      return send(res, 402, current('payment_required', 'quota_exceeded', 'This request exceeds your quota of 10000.')), true;
    }
    if (speech && kind === 'brokelegacy') {
      return send(res, 401, legacy('quota_exceeded', 'This request exceeds your quota of 10000. You have 3 credits remaining.')), true;
    }
    if (speech && kind === 'busy') {
      return send(res, 429, legacy('concurrent_limit_exceeded', 'Too many concurrent requests for your subscription.')), true;
    }
    return false;
  };

  const speech = async (res, key, kind, voiceId, text) => {
    if (refuseByKey(res, kind, { speech: true })) return;
    if (kind === 'slow') await sleep(SLOW_MS);
    const count = (seen.get(voiceId) ?? 0) + 1;
    seen.set(voiceId, count);
    const fault = FAULTS[voiceId];
    if (fault) {
      if (fault.chunked) {
        // No Content-Length: only api.php's progress callback can stop this.
        res.writeHead(fault.status, { 'Content-Type': 'application/json' });
        res.on('error', () => {}); // api.php hangs up mid-stream, as it should
        let closed = false;
        res.once('close', () => {
          closed = true;
        });
        const piece = Buffer.alloc(1024 * 1024, 0x78);
        for (let sent = 0; sent < fault.chunked && !closed; sent += piece.length) {
          if (res.write(piece)) continue;
          await new Promise((resolve) => {
            const done = () => {
              res.off('drain', done);
              res.off('close', done);
              resolve();
            };
            res.on('drain', done);
            res.on('close', done);
          });
        }
        return res.end();
      }
      const body = typeof fault.body === 'function' ? fault.body(key) : fault.body;
      return send(res, fault.status, fault.raw ?? body, fault.headers);
    }
    if (voiceId === BUSY_ONCE_VOICE && count === 1) {
      return send(res, 429, legacy('system_busy', 'The system is busy, try again shortly.'));
    }
    if (typeof text !== 'string' || text === '') return send(res, 422, { detail: [{ loc: ['body', 'text'], msg: 'Field required', type: 'missing' }] });
    if (Array.from(text).length > 2000) {
      return send(res, 400, legacy('max_character_limit_exceeded', 'Text is longer than 2000 characters.'));
    }
    return send(res, 200, timedAudio(text, {
      alignment: voiceId !== NO_ALIGNMENT_VOICE,
      normalizedOnly: voiceId === NORMALIZED_ONLY_VOICE,
    }));
  };

  const route = async (req, res, url, body, key) => {
    const kind = kindOf(key);
    const path = url.pathname;

    if (req.method === 'GET' && path === '/v1/user/subscription') {
      if (refuseByKey(res, kind, { speech: false })) return;
      if (kind === 'restricted') {
        return send(res, 401, legacy('missing_permissions', 'The API key you used is missing the permission user_read to execute this operation.'));
      }
      const broke = kind === 'broke' || kind === 'brokelegacy';
      return send(res, 200, {
        tier: 'creator',
        character_count: broke ? 100000 : 1234,
        character_limit: 100000,
        next_character_count_reset_unix: 1767225600,
        status: 'active',
        voice_slots_used: 3,
        can_extend_character_limit: true,
        invoicing: { next_invoice: { amount_due_cents: 2200 } },
        currency: 'usd',
      });
    }

    if (req.method === 'GET' && path === '/v2/voices') {
      if (refuseByKey(res, kind, { speech: false })) return;
      if (kind === 'restricted') {
        return send(res, 401, current('authorization_error', 'missing_permissions', 'The API key you used is missing the permission voices_read to execute this operation.'));
      }
      const search = (url.searchParams.get('search') ?? '').toLowerCase();
      const all = libraryVoices().filter((v) => !search || v.name.toLowerCase().includes(search));
      const size = Number(url.searchParams.get('page_size') ?? 10);
      const start = url.searchParams.get('next_page_token') === 'page-2' ? size : 0;
      const page = all.slice(start, start + size);
      const more = start + size < all.length;
      return send(res, 200, { voices: page, has_more: more, next_page_token: more ? 'page-2' : null, total_count: all.length });
    }

    if (req.method === 'POST' && path === '/v1/text-to-dialogue/with-timestamps') {
      const input = Array.isArray(body?.inputs) ? body.inputs[0] : null;
      return speech(res, key, kind, input?.voice_id, input?.text);
    }

    const tts = /^\/v1\/text-to-speech\/([^/]+)\/with-timestamps$/.exec(path);
    if (req.method === 'POST' && tts) return speech(res, key, kind, tts[1], body?.text);

    if (req.method === 'POST' && path === '/v1/text-to-voice/design') {
      if (refuseByKey(res, kind, { speech: true })) return;
      const preview = (i) => ({
        audio_base_64: fakeMp3(40 + i).toString('base64'),
        generated_voice_id: `gen${i}${randomBytes(6).toString('hex')}`,
        media_type: 'audio/mpeg',
        duration_secs: +((40 + i) * FRAME_SECONDS).toFixed(3),
        language: 'en',
        leaked: 'leak-me',
      });
      const previews = [preview(0), preview(1), preview(2)];
      // A description asking for it gets one unplayable take among the three.
      if (String(body?.voice_description ?? '').includes('broken preview')) {
        previews[1] = { ...previews[1], audio_base_64: 'not base64 at all!' };
      }
      return send(res, 200, { previews, text: body?.text, internal: 'leak-me' });
    }

    if (req.method === 'POST' && path === '/v1/text-to-voice') {
      if (refuseByKey(res, kind, { speech: true })) return;
      return send(res, 200, {
        voice_id: 'Designed00000000000001',
        name: body?.voice_name,
        category: 'generated',
        preview_url: 'https://storage.example/designed.mp3',
        labels: {},
        sharing: { secret_internal: 'leak-me' },
      });
    }

    return send(res, 404, { detail: 'Not Found' });
  };

  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const url = new URL(req.url, 'http://stub');
      const raw = Buffer.concat(chunks).toString('utf8');
      let body;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        body = raw;
      }
      const key = req.headers['xi-api-key'];
      requests.push({
        method: req.method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        headers: { ...req.headers },
        raw,
        body,
        key,
      });
      try {
        await route(req, res, url, body, key);
      } catch (e) {
        if (!res.headersSent) send(res, 500, { detail: `stub error: ${e.message}` });
        else res.destroy();
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  return {
    port,
    requests,
    /** Requests made since `mark` (an index from `requests.length`). */
    since: (mark) => requests.slice(mark),
    close: () => new Promise((resolve) => {
      server.closeAllConnections?.();
      server.close(() => resolve());
    }),
  };
}
