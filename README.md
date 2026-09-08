# Bible Assistant

A mobile-first PWA that retrieves Bible verses by voice or text and reads them aloud with word-level highlighting. Cards (verse collections) can be grouped into Boards for memorization.

## Stack

- **Frontend**: React 19 + Vite 8 + TypeScript, Tailwind v3, Zustand, Dexie (IndexedDB), i18next, vite-plugin-pwa.
- **Backend**: single PHP file (`public/api.php`) on Hetzner shared webspace.
- **AI**: OpenAI `gpt-4o-mini` (tool calling), `gpt-4o-mini-tts` (TTS), `gpt-4o-transcribe` (Whisper, word-level timestamps), all proxied through PHP — the key never leaves the server.
- **Bible source**: Zefania XML in `public/bibles/` — S00, S51, LUT, HFA, ELB (German), ESV, KJV, NKJV (English). Parsed by `api.php` and cached; also compiled into downloadable offline packs (`npm run bible:build`).

The SPA is served from the root of its own subdomain (https://bibleassistant.apps.schaefchens.de/) in both dev and production. To mount it under a path prefix instead, set `WEB_BASE=/subpath/` — `vite.config.ts` derives the build `base` *and* the dev proxy from it, so the two can't drift.

## Local dev

```
npm install
# In one terminal: SPA dev server (port 5173)
npm run dev
# In another terminal: PHP backend (port 8000)
cp public/secrets.php.example public/secrets.php   # add OPENAI_API_KEY
php -S 0.0.0.0:8000 -t public
```

Open **http://localhost:5173/**. Vite forwards `/api.php` and `/storage/*` to the PHP server. (Under a `WEB_BASE` prefix it also strips that prefix on the way to PHP and sends an `X-Base-Path` header, so PHP puts the prefix back into the audio URLs it returns.)

For PWA / Web Speech features on iOS you need HTTPS (use mkcert or a tunnel).

## Tests

Three layers, three jobs. See the "Testing" section of `CLAUDE.md` for the definition of done
and why the E2E tier mocks nothing.

```
npm test          # unit + integration. Seconds — run it like you run tsc.
npm run e2e       # end-to-end, against the BUILT app. Minutes.
npm run verify    # the whole gate: tsc, lint, bible/community verify, npm test
```

`npm run e2e` serves `dist/` with `php -S`, so it needs a current build:

```
npm run build && npm run e2e
```

It refuses to run against a stale `dist/` rather than rebuilding behind your back. It drives
the real app with nothing mocked — real PHP, real Bible text, real narration, and a real
`gpt-4o-mini` call for the assistant journey. Narration is free because generated speech is
content-addressed and the cache in `dist/storage/audio` is warm; every spec asserts as much.

`npm run e2e:live` is opt-in and is the only thing that makes OpenAI *generate* speech — run it
before a release, or after touching the audio pipeline.

## Deploy (Hetzner webspace)

```
npm run build
```

`./scripts/deploy.sh [--dry-run]` does this over SFTP with an explicit allow-list (it must
never upload `storage/` or `secrets.php`). To do it by hand, upload to the web root:

- `dist/*` (the built SPA, includes manifest, service worker, icons)
- `public/api.php`
- A server-side `secrets.php` next to `api.php` containing `define('OPENAI_API_KEY', 'sk-...')`. **Never commit this file.**
- Ensure `storage/` next to `api.php` is writable by PHP.

At the web root PHP needs no base path. Under a path prefix it auto-detects one from `REQUEST_URI` (the leading segment before `/api.php` or `/storage/`); override with the `BIBLE_ASSISTANT_BASE_PATH` env var or `define('BASE_PATH', '/whatever')` in `secrets.php`.

## Identity

Each device generates a `userId` (UUID) and `userSecret` (32 random bytes hex) on first launch. Both are sent as `X-User-Id` / `X-User-Secret` headers on every API call. PHP creates the user folder on first sighting and rejects mismatches afterward.

To use the same library on another device, open **Settings → Identity → Copy**, then on the second device paste the value into **Identity → Import**.

## Audio cache layout

```
public/storage/
  audio/
    <voice>/<translation>/<bookId>/<chapter>/<verse>.mp3
    <voice>/<translation>/<bookId>/<chapter>/<verse>.json   # word alignment
    recordings/<userId>/<translation>/<bookId>/<chapter>/<verse>.mp3
  users/<userId>/
    cards.json
    boards.json
    secret.txt
```

The TTS audio cache is shared globally — same translation + voice + verse always produces identical audio.

## Keyboard

- `↑` / `↓` — previous / next message
- `Space` / `Enter` — play / pause the selected message's verses

## Licence

The source code is under the **[PolyForm Noncommercial
1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0)** licence —
see [`LICENSE.md`](LICENSE.md). Any noncommercial purpose is permitted, and
the licence names charitable, educational and religious use explicitly, so a
church or a study group may run and modify it freely. Commercial use is not
granted; ask.

The licence covers **the code only**. The Bible translations and the ambient
music belong to other people, on their own terms — see
[`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md).

**A clone gets four of the eight translations.** KJV, Luther 1912, Elberfelder
1905 and Schlachter 1951 are public domain and committed. ESV, NKJV, Hoffnung
für Alle and Schlachter 2000 are still in copyright, are **not** in this
repository — not in the tree and not in its history — and ship only via
`deploy.sh --with-bibles`. Permission is being
sought from each rights holder; anything unlicensed will be removed.

`bible:build` skips a translation whose XML is absent, so the app builds and
runs from a clone with four texts — `npm run dev` works, the picker simply
offers four.
