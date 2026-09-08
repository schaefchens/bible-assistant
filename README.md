# Bible Assistant

Speak or type a reference; hear it read aloud, with word-level highlighting that
follows the voice. Built mobile-first and offline-first — reading, the reader
screen, cards, boards, reading lists and already-fetched audio all work with no
connection.

Beyond looking verses up:

- **a reader** (`/read`) for reading rather than asking, in your own paper and ink;
- **cards and boards** — verse notes, grouped for memorisation, on a corkboard if
  you like;
- **reading lists** — a plan or a collection, built by hand or by asking for one
  ("a year through the Bible"), that plays as a playlist;
- **rooms** — invite-only spaces for your own writing, narrated and highlighted by
  the same machinery as scripture;
- **hands-free mode**, a lock-screen transport, and offline downloads per chapter.

`CLAUDE.md` is the architecture map. Start there for anything structural — it is
kept current and says *why*, which this file does not.

## Stack

- **Frontend** — React 19 + Vite 8 + TypeScript 6, Tailwind v3, Zustand, Dexie
  (IndexedDB), i18next, vite-plugin-pwa.
- **Backend** — PHP on Hetzner shared webspace: `public/api.php` is a router over
  **fourteen files in `public/api/`**. They deploy together or every request 500s.
- **Native** — iOS and Android via Capacitor 8, from the same source with a
  different build (`npm run build:native` → `dist-native/`).
- **AI** — OpenAI `gpt-4o-mini` (tool calling), `gpt-4o-mini-tts` (speech),
  `gpt-4o-transcribe` (word-level timestamps), `gpt-4o` (content moderation), all
  proxied through PHP so the key never reaches the client.
- **Bible source** — Zefania XML in `public/bibles/`, compiled into offline packs
  by `npm run bible:build`.

Three build targets come out of one codebase and several things differ per target
— the router (`BrowserRouter` vs `HashRouter`), the API origin, whether there is a
service worker, and where Bible text comes from. See "Native builds" in
`CLAUDE.md` before touching any of it.

The SPA is served from the root of its own subdomain
(<https://bibleassistant.apps.schaefchens.de/>). To mount it under a path prefix,
set `WEB_BASE=/subpath/` — `vite.config.ts` derives the build `base` *and* the dev
proxy from it, so the two cannot drift.

### Which translations you get

A clone contains the four public-domain texts: **KJV**, **Luther 1912**,
**Elberfelder 1905**, **Schlachter 1951**.

ESV, NKJV, Hoffnung für Alle and Schlachter 2000 are still in copyright and are
**not** in this repository — not in the tree and not in its history. Permission is
being sought from each rights holder; anything unlicensed will be removed.
`bible:build` skips a translation whose XML is absent, so the app builds, verifies
and runs from a clone — the picker simply offers four. See
[`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md).

## Local dev

```
npm install
# One terminal: the SPA (port 5173)
npm run dev
# Another: the PHP backend (port 8000)
cp public/secrets.php.example public/secrets.php   # add OPENAI_API_KEY
php -S 0.0.0.0:8000 -t public
npm run bible:build                                # offline packs, once
```

Open **<http://localhost:5173/>**. Vite forwards `/api.php`, `/api/*` and
`/storage/*` to PHP. (Under a `WEB_BASE` prefix it strips the prefix on the way
and sends `X-Base-Path`, so PHP puts it back into the audio URLs it returns.)

PWA install and iOS speech features need HTTPS — mkcert or a tunnel.

## Tests

**Four layers, four jobs**, and the entry criteria matter — see "Testing" in
`CLAUDE.md` for the definition of done and why a test is earned by a risk rather
than by a feature.

| layer | what | mocks |
| --- | --- | --- |
| `tests/unit` | pure functions | none — that is the entry criterion |
| `tests/component` | a React render: hook reactivity, render-time state | rarely |
| `tests/int` | stores + Dexie + queue, tool dispatch, the segment loader | at the outer edges |
| `tests/e2e` | a user clicking through the real app | **none** |

```
npm test          # unit + component + int. Seconds — run it like you run tsc.
npm run e2e       # end-to-end, against the BUILT app. Minutes.
npm run e2e:live  # opt-in: the only spec that makes OpenAI generate speech.
npm run verify    # the whole gate: tsc, lint, three verify scripts, npm test
```

`npm run verify` exits 0. Keep it that way — it was red for a long time on
standing lint errors, which meant nobody could tell a new failure from the old
ones.

`npm run e2e` serves `dist/` with `php -S`, so it needs a current build:

```
npm run build && npm run e2e
```

It refuses a stale `dist/` rather than rebuilding behind your back, and it mocks
nothing and changes no source: real PHP, real Bible text, real narration, a real
`gpt-4o-mini` call. Narration is free because speech is content-addressed and the
cache in `dist/storage/audio` is warm — **every spec asserts its narration was a
cache hit**, which is what stops the suite quietly billing OpenAI on every run.

Three property-check scripts sit alongside, and run under `verify`:

```
npm run bible:verify        # the JS pack parser vs the PHP parser, on golden fixtures
npm run community:verify    # post signing, share codes, the post chunker
npm run community:verify:api  # the cross-account HTTP surface, on a throwaway php -S
```

## Deploy (Hetzner webspace)

```
npm run build
./scripts/deploy.sh [--dry-run]
```

SFTP with an explicit allow-list, and it **must never upload `storage/` (live user
data) or `secrets.php`**. It names `api.php` *and* the whole of `api/`, and
uploads `api/` first — until `api.php` is replaced the old one is still serving,
whereas the other order 500s every request for the rest of the transfer.
`--dry-run` prints the plan; afterwards it verifies the deploy over HTTPS,
including that `api/` answers 403.

Large, rarely-changing content is opt-in:

| flag | uploads |
| --- | --- |
| `--with-bibles` | `public/bibles/*.xml` — including the four not in git |
| `--with-packs` | `build/bible-packs/` — the downloadable offline packs |
| `--with-ambient` | `storage/ambient/*.mp3` — the music tracks |
| `--with-secrets` | `secrets.php`. Read the warning in the script first |

At the web root PHP needs no base path. Under a prefix it auto-detects one from
`REQUEST_URI`; override with `BIBLE_ASSISTANT_BASE_PATH` or
`define('BASE_PATH', '/whatever')` in `secrets.php`.

## Identity, and what reaches the server

Each device mints a `userId` (UUID) and `userSecret` on first launch, derived from
a BIP39-style mnemonic and sent as `X-User-Id` / `X-User-Secret`. It is **a device
key first and a recovery phrase second**: it is minted silently, and you are only
shown it when you turn sync on. An app that reads scripture offline should not
open on "create an account".

**Server sync is opt-in and off on a fresh install.** `settings.syncEnabled` is
enforced at exactly three chokepoints, and **accounts are lazy** —
`authenticate()` creates nothing, and only the actions in `$ACCOUNT_ACTIONS` call
`requireUserDir()`. So someone who reads scripture and asks the assistant
questions leaves **no directory on the server at all**. Don't move an action into
`$ACCOUNT_ACTIONS` without meaning it.

To share a library between devices, enable sync, then **Settings → Identity →
Copy** and paste it into **Identity → Import** on the second device.

## Server storage layout

```
public/storage/
  audio/                                   # world-readable once the URL is known
    <voice>/<translation>/<bookId>/<chapter>/<verse>.mp3
    <voice>/<translation>/<bookId>/<chapter>/<verse>.json    # word alignment
    speak/<voice>/<sha256 of the text>.mp3                   # replies, posts
    recordings/<userId>/…
  ambient/                                 # the music tracks
  avatars/<sha256>.<ext>                   # an <img src> needs a real URL
  users/<userId>/{cards,boards,…}.json     # HTTP-denied
  shares/<code>.json                       # HTTP-denied
  reports/                                 # HTTP-denied
  moderation/                              # HTTP-denied
  feedback/<userId>/                       # HTTP-denied
```

Verse and `speak/` audio are **content-addressed and shared across every user**,
so the first person to hear a passage pays for it and everyone after gets a cache
hit. The five private directories are denied in one place —
`api/bootstrap.php`'s `denyHttp()` — not five `.htaccess` files.

## Keyboard

- `↑` / `↓` — previous / next passage
- `Space` / `Enter` — play / pause the selected passage
- `←` / `→` — seek back / forward by words (the same action as the dock's `⏪ ⏩`)

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
