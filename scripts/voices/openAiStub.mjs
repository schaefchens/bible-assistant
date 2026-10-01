/**
 * A stand-in for api.openai.com, run in-process by verifyVoicesBackend.mjs.
 *
 * It exists for one question the ElevenLabs stub cannot answer: when a reader
 * narrates with a voice somebody shared on a shelf, whose OpenAI key is sent?
 * api.php reaches it through OPENAI_API_BASE in the staged secrets.php, and it
 * listens on 127.0.0.1 only — so with it in place no request in the harness can
 * reach the real service, whatever a check does.
 *
 * Every request is recorded with its Authorization header. Behaviour is chosen
 * by the key:
 *
 *   sk-oa-ok-…     speech, alignment and /v1/models all work
 *   sk-oa-slow-…   the same, speech after SLOW_MS
 *   sk-oa-bad-…    401 invalid_api_key, the message quoting part of the key —
 *                  which api.php must never pass on for somebody else's key
 *   sk-oa-broke-…  429 insufficient_quota on speech
 *   anything else  401
 */
import { createServer } from 'node:http';
import { SLOW_MS, fakeMp3, framesFor } from './elevenLabsStub.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function kindOf(auth) {
  const m = /^Bearer sk-oa-([a-z]+)-/.exec(auth ?? '');
  return m && ['ok', 'slow', 'bad', 'broke'].includes(m[1]) ? m[1] : 'unknown';
}

const invalidKey = (auth) => ({
  error: {
    message: `Incorrect API key provided: ${String(auth).slice(7, 19)}****. You can find your API key at https://platform.openai.com/account/api-keys.`,
    type: 'invalid_request_error',
    param: null,
    code: 'invalid_api_key',
  },
});

export async function startOpenAiStub() {
  /** Every request, in arrival order. */
  const requests = [];
  /** Speech requests in flight right now, and the most there ever were. */
  let inFlight = 0;
  let peak = 0;

  const send = (res, status, body, type = 'application/json') => {
    res.writeHead(status, { 'Content-Type': type });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };

  const route = async (req, res, path, body, auth) => {
    const kind = kindOf(auth);
    if (kind === 'unknown' || kind === 'bad') return send(res, 401, invalidKey(auth));

    if (req.method === 'GET' && path === '/v1/models') {
      return send(res, 200, { object: 'list', data: [{ id: 'gpt-4o-mini-tts', object: 'model' }] });
    }

    if (req.method === 'POST' && path === '/v1/audio/speech') {
      if (kind === 'broke') {
        return send(res, 429, {
          error: { message: 'You exceeded your current quota, please check your plan and billing details.', type: 'insufficient_quota', param: null, code: 'insufficient_quota' },
        });
      }
      inFlight++;
      peak = Math.max(peak, inFlight);
      try {
        if (kind === 'slow') await sleep(SLOW_MS);
        const input = typeof body?.input === 'string' ? body.input : '';
        return send(res, 200, fakeMp3(framesFor(Array.from(input).length)), 'audio/mpeg');
      } finally {
        inFlight--;
      }
    }

    if (req.method === 'POST' && path === '/v1/audio/transcriptions') {
      // Multipart; the words matter to nobody here, only that alignment ran.
      return send(res, 200, {
        task: 'transcribe',
        language: 'english',
        duration: 1.5,
        text: 'stub',
        words: [{ word: 'stub', start: 0.1, end: 0.6 }],
      });
    }

    return send(res, 404, { error: { message: 'Not found', type: 'invalid_request_error' } });
  };

  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const url = new URL(req.url, 'http://stub');
      const raw = Buffer.concat(chunks);
      const isJson = String(req.headers['content-type'] ?? '').startsWith('application/json');
      let body = null;
      if (isJson) {
        try {
          body = JSON.parse(raw.toString('utf8'));
        } catch {
          body = null;
        }
      }
      const auth = req.headers.authorization;
      requests.push({ method: req.method, path: url.pathname, auth, body, bytes: raw.length });
      try {
        await route(req, res, url.pathname, body, auth);
      } catch (e) {
        if (!res.headersSent) send(res, 500, { error: { message: `stub error: ${e.message}` } });
        else res.destroy();
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  return {
    port,
    requests,
    since: (mark) => requests.slice(mark),
    /** The most speech requests that were ever in flight at once. */
    peak: () => peak,
    resetPeak: () => {
      peak = inFlight;
    },
    close: () => new Promise((resolve) => {
      server.closeAllConnections?.();
      server.close(() => resolve());
    }),
  };
}
