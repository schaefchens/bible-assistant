# Bible Assistant

A mobile-first PWA that retrieves Bible verses by voice or text and reads them aloud with word-level highlighting. Cards (verse collections) can be grouped into Boards for memorization.

## Stack

- **Frontend**: React 19 + Vite 8 + TypeScript, Tailwind v3, Zustand, Dexie (IndexedDB), i18next, vite-plugin-pwa.
- **Backend**: single PHP file (`public/api.php`) on Hetzner shared webspace.
- **AI**: OpenAI `gpt-4o-mini` (tool calling), `gpt-4o-mini-tts` (TTS), `gpt-4o-transcribe` (Whisper, word-level timestamps), all proxied through PHP — the key never leaves the server.
- **Bible source**: [bolls.life](https://bolls.life) — `ESV` (English Standard Version) and `S00` (Schlachter 2000 German).

The SPA is served under the `/assistant/` path in both dev and production. Change the `base` value in `vite.config.ts` to move it.

## Local dev

```
npm install
# In one terminal: SPA dev server (port 5173)
npm run dev
# In another terminal: PHP backend (port 8000)
cp public/secrets.php.example public/secrets.php   # add OPENAI_API_KEY
php -S 0.0.0.0:8000 -t public
```

Open **http://localhost:5173/assistant/**. Vite strips the `/assistant` prefix when forwarding `/assistant/api.php` and `/assistant/storage/*` to the PHP server, and adds an `X-Base-Path: /assistant` header so PHP knows what prefix to put back into returned audio URLs.

For PWA / Web Speech features on iOS you need HTTPS (use mkcert or a tunnel).

## Deploy (Hetzner webspace, e.g. `/assistant/`)

```
npm run build
```

Upload to the server's `assistant/` directory:

- `dist/*` (the built SPA, includes manifest, service worker, icons)
- `public/api.php`
- A server-side `secrets.php` next to `api.php` containing `define('OPENAI_API_KEY', 'sk-...')`. **Never commit this file.**
- Ensure `assistant/storage/` is writable by PHP.

PHP auto-detects the base path from `REQUEST_URI` (matches the leading segment before `/api.php` or `/storage/`). To override, set the `BIBLE_ASSISTANT_BASE_PATH` env var, or `define('BASE_PATH', '/whatever')` in `secrets.php`.

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
