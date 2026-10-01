# Backend — `public/api.php` + `public/api/*.php`

> Part of the architecture notes indexed in [`CLAUDE.md`](../../CLAUDE.md). Moved there verbatim; "above" and "below" may refer to sections that now live in a sibling file.

One PHP front door; routes on `?action=`. Per-user data dirs keyed by an identity derived from the user's passphrase. `chat`, `transcribe` and `recording.upload` resolve an OpenAI key before their handler runs — the user's personal key, **stored on the server** by `auth.openaiKey.set` (the client never holds it), or the shared key, which `X-Prefer-Shared-Key` forces for a session. `tts` and `tts.speak` decide who pays inside the handler, on a cache miss only — see "Who pays" below.

**Accounts are lazy.** `authenticate()` validates the identity headers and creates
nothing; `requireUserDir()` creates `storage/users/{id}` and is called from the router
only for `$ACCOUNT_ACTIONS` (the cards/boards/reading-list/voice writers, the two key
setters `auth.openaiKey.set` and `auth.elevenlabsKey.set`, `recording.upload`, and the
community writers). Everything else works with no directory at all — the readers guard
with `file_exists`/`is_readable` and answer empty. This is what makes the client's sync
opt-in truthful: a user who only reads scripture and asks the assistant questions leaves
nothing on the server. Don't move an action into `$ACCOUNT_ACTIONS` without meaning it,
and don't reintroduce an eager `mkdir` in `authenticate()`.

**A file per concern, loaded by `api.php` before anything is dispatched** — no count
here, because the last one went stale the same way the endpoint list did. It was one
2,786-line file, which meant a change to moderation had to be read alongside the
Zefania parser and the curl helpers. `api.php` is now the header, the requires and
the router — and **the router's `switch` is the endpoint list**, complete by
construction, which is why the docblock no longer carries a hand-written copy (by
2,786 lines that copy was missing the nineteen community actions, `tts.speak`,
`bible.chapter`, the OpenAI-key trio and `moderation.check`).

| file | owns |
| --- | --- |
| `api/bootstrap.php` | what exists on disk, and what Apache may serve. Side effects only |
| `api/http.php` | `respond`/`fail`, input narrowing (`safe*`), identity, CORS |
| `api/store.php` | the JSON files under `storage/`, and the generic collection endpoints |
| `api/openai.php` | which OpenAI key pays (`openAiPayer`), the four curl shapes, how a failure is reported |
| `api/chat.php` | the assistant proxy |
| `api/audio.php` | `tts`, `tts.speak`, who pays for narration (`ttsPayer`), the shared key's limits, forced alignment, `transcribe`; the pure MP3 framing and the ElevenLabs character-timings → words converter |
| `api/bible.php` | Zefania XML → verses (`bibleChapterVerses`, also the ElevenLabs verse context) |
| `api/account.php` | the stored provider keys (the only code that touches `users/{id}/*_key.txt`), `account.delete`, `recording.upload`, `ambient.list` |
| `api/voices.php` | what a narration voice is: the audible-config rules, its canonical hash, `sanitizeVoiceProfile`, the voices collection and the selection |
| `api/elevenlabs.php` | the ElevenLabs transport (the only `xi-api-key`), its failure mapping, the key trio, narration, and the four proxies |
| `api/community.php` | what a space is on disk: paths, sanitizers, share codes, signatures, the moderation text pulled out of a payload |
| `api/spaces.php` | the owner's own community endpoints |
| `api/sharing.php` | the four endpoints that cross accounts |
| `api/moderation.php` | the content standards (`MODERATION_POLICY`) and the judge |
| `api/reports.php` | `report.create` |
| `api/feedback.php` | `feedback.create` |

Three things about that split are load-bearing:

- **Never write `__DIR__` in `api/`.** It means `api/`, not the web root, and three
  paths resolve against the root: `secrets.php`, `STORAGE_DIR` and the Zefania XML.
  Splitting the file repointed all three silently — the visible symptom was every
  moderation check answering "unchecked, fails open" because the key could no
  longer be found. `APP_ROOT`, defined in `api.php`, is the anchor.
- **`api.php` and `api/` deploy together**, or the backend 500s on every request.
  `scripts/deploy.sh`'s allow-list names both, and so do `tests/e2e/run.mjs`'s
  staleness check and `verifyBackend.mjs`'s temp docroot. A fourth harness that
  stages the backend has to name both too.
- **The native build needs no rule for this.** `publicDir` is off there and
  `assertNoServerFiles` already refuses any `.php` at any depth, so `api/` stays
  out of the `.ipa`/`.apk` for free — and would fail the build if it leaked in.
- **Every file in `api/` opens with `if (!defined('APP_ROOT'))` and a 404.** They
  are includes, not endpoints, and the router is the only way in. Without the
  guard, `GET /api/bootstrap.php` died on the undefined constant and printed the
  server's filesystem path — that file never reaches `api.php`'s
  `ini_set('display_errors', '0')`. `public/api/.htaccess` denies the directory too,
  but the guard is what holds on a host without `mod_authz_core` and under PHP's
  CLI server, which ignores `.htaccess` and is what both `community:verify:api`
  and the E2E suite run on. Both are asserted there ("a handler fetched directly
  says nothing at all").
- **Never write `<Directory>` in a `.htaccess`.** It is valid only in server
  config, and Apache answers **every request on the whole site** with 500 if it
  appears — `/` included, not just the path it names. The deny therefore lives
  in `public/api/.htaccess`, per-directory, where `Require all denied` is legal.
  This is the one class of bug no harness here can catch: `php -S` ignores
  `.htaccess` entirely, so the tests, `community:verify:api` and all 51 E2E
  specs stayed green on a config that would have taken production down. Checked
  against a real Apache 2.4 before deploying; `apachectl -t` alone does **not**
  catch it either, since it reports "Syntax OK" and only fails at request time.
- **`scripts/deploy.sh` uploads `api/` before `api.php`.** The order is
  load-bearing: until `api.php` is replaced the old self-contained one is still
  serving, and the new handlers sit unused beside it. The other way round leaves
  every request 500ing for the rest of the transfer — and permanently, if the
  transfer then fails.

Actions: `chat`, `tts`, `tts.speak`, `bible.chapter`, `transcribe`, `auth.openaiKey.{status,set,clear}`, `auth.elevenlabsKey.{status,set,clear}`, `elevenlabs.{subscription,voices,design,design.save}`, `voices.{list,upsert,delete}`, `voices.selection.{get,set}`, `cards.{list,upsert,delete,order.get,order.set}`, `boards.{list,upsert,delete,order.get,order.set}`, `readingLists.{list,upsert,delete}`, `readingProgress.{list,set}`, `recording.upload`, `account.delete`, `ambient.list`, and the community actions:
`profile.{get,set,delete}`, `profile.avatar.upload`, `spaces.{list,upsert,delete}`,
`spaces.code.set`, `posts.{list,upsert,delete}`, `items.{list,upsert,delete}`,
`members.{list,decide}`,
`subscriptions.{list,upsert,delete}`, `moderation.check`, and the three that cross
accounts — `space.request`, `space.feed`, `space.item` and `report.create` (see
[`community.md`](community.md)).
Plus `feedback.create` (see [`feedback.md`](feedback.md)).

`feedback.create` is the odd one out: it is neither a community action nor an account
action, and it requires no profile — see [`feedback.md`](feedback.md).

`readingProgress.set` is the one writer that **merges** rather than replaces — see
[`reading-lists.md`](reading-lists.md). `readingLists.delete` also drops that list's progress row, which has no meaning without
it. The client tolerates both reading-list actions being absent (an older api.php answers
"unknown action"), so shipping the client before the backend costs a user their lists syncing,
not their cards.

Bible text is parsed from Zefania XML in `public/bibles/*.xml` (S00, S51, LUT, HFA, ELB = German; ESV, KJV, NKJV = English). Client base URL + error handling: `src/services/api/client.ts` (`apiPostJson` / `apiGetJson` / `apiPostForm`, `ApiError`, `onUserKeyFailure`).

## Who pays — narration and the provider keys

Narration is the one place the payer depends on the request body — OpenAI or
ElevenLabs, and later perhaps a voice's owner rather than its listener — so it is
resolved **inside the handler, on a cache miss only**: `ttsPayer($ctx, $provider)` /
`withTtsPayer()` in `api/audio.php`. A hit is served with no key at all, which is also
why `tts` and `tts.speak` are not in `$OPENAI_ACTIONS` any more. The answer is
`['provider', 'key', 'who' => 'requester'|'operator']`, and everything downstream reads
`who` rather than re-deriving it from the filesystem (`failOpenAi` used to, and reported
an *empty* key file as the user's key failing).

- **The shared key reads Echo, and only Echo.** When the operator pays, a miss may
  generate voice `echo` with no style; anything else is 403 `openai_key_required`
  (`requireOperatorAllows`). The client has always offered only that on the shared key;
  this makes the server agree, now that custom voices are in front of everyone.
- **Keys are stored, never sent per request.** `account.php`'s helpers —
  `storedKey`/`storeKey`/`clearStoredKey`/`maskKey` — are the only code that reads or
  writes `users/{id}/*_key.txt`, written 0600 from creation (tempnam + rename; the old
  write-then-chmod left a window). A key with a control character is refused before it
  can reach a header line, and an outage while validating is 502 `openai_unavailable`,
  not "rejected".
- **ElevenLabs is always the requester's own key.** There is no shared one, and
  `ELEVENLABS_API_BASE` is a `define` only — never `getenv`, because `deploy.sh` exports
  `sftp.env` into the build environment. Only `elevenLabsRequest()` builds an
  `xi-api-key` header, on `curlExec()` and never on the OpenAI curl wrappers, which fall
  back to the shared *OpenAI* key. ElevenLabs errors carry `provider: 'elevenlabs'`,
  the `payer`, and on narration the `voiceId` and `model`; none is ever `user_key_failed`
  (the client reads that as "offer the shared OpenAI key"). The codes are listed in
  [`voices.md`](voices.md).

**ElevenLabs narration is content-addressed and immutable**:
`/storage/audio/el/{cfgHash}/{lang|_}/{k[0:2]}/{k}.mp3|.json`, `cfgHash` the first 20
hex of a sha256 over `audibleConfigCanonical()` (fixed two-decimal settings, the model,
the voice, `EL_CONFIG_VERSION`, the output format) and `k` a sha256 of
`el-content-v1`, the language and the text. So a verse and the same words through
`tts.speak` share a file, nothing is regenerated in place under an `immutable` URL, and
nobody can overwrite another request's audio. A miss takes a per-entry lock in
`storage/work/` (a `PRIVATE_DIRS` member), re-checks, synthesizes to a temp file and
renames into place with the JSON last — its presence is what a hit tests. Bump
`EL_CONFIG_VERSION` only when the same config and text would now sound different.

`npm run voices:verify:api` (`scripts/voices/`) proves all of it against an in-process
ElevenLabs stub, with the shared OpenAI key blanked and a canary key planted to prove
no upstream request ever carried it.
