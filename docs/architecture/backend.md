# Backend — `public/api.php` + `public/api/*.php`

> Part of the architecture notes indexed in [`CLAUDE.md`](../../CLAUDE.md). Moved there verbatim; "above" and "below" may refer to sections that now live in a sibling file.

One PHP front door; routes on `?action=`. Per-user data dirs keyed by an identity derived from the user's passphrase. OpenAI actions (`chat`, `tts`, `tts.speak`, `transcribe`, `recording.upload`) require a key — a personal key (sent by the client) or the shared key, selected via the `X-Prefer-Shared-Key` header.

**Accounts are lazy.** `authenticate()` validates the identity headers and creates
nothing; `requireUserDir()` creates `storage/users/{id}` and is called from the router
only for `$ACCOUNT_ACTIONS` (the cards/boards writers, `auth.openaiKey.set`,
`recording.upload`). Everything else works with no directory at all — the readers guard
with `file_exists`/`is_readable` and answer empty. This is what makes the client's sync
opt-in truthful: a user who only reads scripture and asks the assistant questions leaves
nothing on the server. Don't move an action into `$ACCOUNT_ACTIONS` without meaning it,
and don't reintroduce an eager `mkdir` in `authenticate()`.

**Fourteen files, loaded by `api.php` before anything is dispatched.** It was one
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
| `api/openai.php` | which key pays, the four curl shapes, how a failure is reported |
| `api/chat.php` | the assistant proxy |
| `api/audio.php` | `tts`, `tts.speak`, forced alignment, `transcribe` |
| `api/bible.php` | Zefania XML → verses |
| `api/account.php` | the caller's own key, `account.delete`, `recording.upload`, `ambient.list` |
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

Actions: `chat`, `tts`, `tts.speak`, `bible.chapter`, `transcribe`, `auth.openaiKey.{status,set,clear}`, `cards.{list,upsert,delete,order.get,order.set}`, `boards.{list,upsert,delete,order.get,order.set}`, `readingLists.{list,upsert,delete}`, `readingProgress.{list,set}`, `recording.upload`, `account.delete`, `ambient.list`, and the community actions:
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
