#!/usr/bin/env bash
#
# Deploy the PWA + PHP backend to the Hetzner webspace over SFTP.
#
#   ./scripts/deploy.sh [options]
#
#     --no-build       skip `npm run build` and upload whatever is in dist/
#     --with-secrets   also upload secrets.php (see the warning below)
#     --with-bibles    also upload public/bibles/*.xml   (~59 MB, rarely changes)
#     --with-packs     also upload build/bible-packs/    (~88 MB, downloadable Bibles)
#     --with-ambient   also upload storage/ambient/*.mp3 (~77 MB, the music tracks)
#     --prune          then delete what this deploy replaced (see "Pruning" below)
#     --dry-run        print the transfer plan and exit — with --prune, the
#                      deletions too, which lists the server (read-only)
#
# Credentials come from ./sftp.env (gitignored):
#     SFTP_SERVER=user@host
#     SFTP_PASSWD=...
#
# ─── Why this uses an explicit allow-list ────────────────────────────────────
# Vite copies public/ verbatim into dist/, so dist/ also contains the *server*
# side of the project: secrets.php (a live OPENAI_API_KEY), 59 MB of Bible XML,
# and storage/ — which on a deployed server holds every user's cards, boards,
# secret.txt and the audio cache.
#
# Uploading dist/ wholesale would therefore overwrite live user data with a
# local snapshot. Nothing is uploaded unless it is named below.
#
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"

BUILD=1 WITH_SECRETS=0 WITH_BIBLES=0 WITH_PACKS=0 WITH_AMBIENT=0 PRUNE=0 DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --no-build)     BUILD=0 ;;
    --with-secrets) WITH_SECRETS=1 ;;
    --with-bibles)  WITH_BIBLES=1 ;;
    --with-packs)   WITH_PACKS=1 ;;
    --with-ambient) WITH_AMBIENT=1 ;;
    --prune)        PRUNE=1 ;;
    --dry-run)      DRY_RUN=1 ;;
    -h|--help)      awk 'NR > 1 { if (!/^#/) exit; print }' "$0"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

[ -f sftp.env ] || { echo "✗ sftp.env not found in $ROOT" >&2; exit 1; }
set -a; . ./sftp.env; set +a
: "${SFTP_SERVER:?SFTP_SERVER missing from sftp.env}"
: "${SFTP_PASSWD:?SFTP_PASSWD missing from sftp.env}"

command -v sshpass >/dev/null || { echo "✗ sshpass not installed (brew install sshpass)" >&2; exit 1; }

PUBLIC_URL="https://bibleassistant.apps.schaefchens.de"

if [ "$BUILD" = 1 ]; then
  echo "▸ building web bundle…"
  npm run build
fi
[ -f dist/index.html ] || { echo "✗ dist/index.html missing — run without --no-build" >&2; exit 1; }

# ─── Build the transfer plan ─────────────────────────────────────────────────
# PLAN lines are "local<TAB>remote". Directories are derived from them.
TMPD=$(mktemp -d)
trap 'rm -rf "$TMPD"' EXIT
PLAN="$TMPD/plan" BATCH="$TMPD/batch"

add_file() { [ -f "$1" ] && printf '%s\t%s\n' "$1" "$2" >> "$PLAN" || true; }
add_tree() {
  # add_tree <localdir> <remotedir> — every file beneath it, structure preserved
  local src="$1" dst="$2"
  [ -d "$src" ] || return 0
  while IFS= read -r f; do
    printf '%s\t%s\n' "$f" "$dst/${f#$src/}" >> "$PLAN"
  done < <(find "$src" -type f ! -name '.DS_Store')
}

# The SPA itself
for f in index.html privacy.html manifest.webmanifest sw.js registerSW.js favicon-32.png apple-touch-icon.png; do
  add_file "dist/$f" "$f"
done
add_tree dist/icons icons
while IFS= read -r f; do add_file "$f" "$(basename "$f")"; done < <(find dist -maxdepth 1 -name 'workbox-*.js')
add_tree dist/assets assets

# Backend + Apache config
# Order matters. api.php is a thin router that requires api/*.php, so the
# handlers go up FIRST: until api.php is replaced the old self-contained one is
# still serving, and the new handlers sit unused beside it. Uploading api.php
# first would leave every request 500ing for the rest of the transfer — and for
# good, if the upload then failed.
add_tree dist/api api
add_file dist/api.php api.php
add_file dist/.htaccess .htaccess

# Bundled Bible packs (LUT/KJV + manifest + the pack .htaccess)
add_tree dist/bible-packs bible-packs

[ "$WITH_PACKS" = 1 ]   && add_tree build/bible-packs bible-packs
[ "$WITH_BIBLES" = 1 ]  && add_tree public/bibles bibles
[ "$WITH_SECRETS" = 1 ] && add_file public/secrets.php secrets.php

# Ambient music. This is the ONE part of storage/ that is content rather than
# user data, and ?action=ambient.list just scans this directory — so with it
# empty the music dropdown is silently blank. Scoped to ambient/ alone: never
# storage/users/ (cards, boards, secret.txt) and never storage/audio/ (the
# server-side TTS cache, which the server rebuilds on demand).
[ "$WITH_AMBIENT" = 1 ] && add_tree public/storage/ambient storage/ambient

FILE_COUNT=$(wc -l < "$PLAN" | tr -d ' ')
BYTES=$(awk -F'\t' '{print $1}' "$PLAN" | xargs -I{} stat -f%z {} 2>/dev/null | awk '{s+=$1} END {print s+0}')

# ─── Talking to the server ───────────────────────────────────────────────────
sftp_batch() {
  # sftp_batch <batch> <log> — run an sftp batch file; its output goes to <log>.
  SSHPASS="$SFTP_PASSWD" sshpass -e sftp \
    -o StrictHostKeyChecking=accept-new \
    -o BatchMode=no \
    -o ConnectTimeout=20 \
    -b "$1" "$SFTP_SERVER" > "$2" 2>&1 < /dev/null
}
remote_ls() {
  # remote_ls <dir>... — "<path><TAB><d|f>" for every entry of each <dir>, in
  # one read-only session. A directory that does not exist lists nothing.
  local d
  for d in "$@"; do printf -- '-ls -la %s\n' "$d"; done > "$TMPD/ls.batch"
  sftp_batch "$TMPD/ls.batch" "$TMPD/ls.log" || {
    echo "✗ could not list the server — last 5 lines:" >&2
    tail -5 "$TMPD/ls.log" >&2
    exit 1
  }
  awk '
    /^sftp> / { dir = $0; sub(/^sftp> -?ls -la /, "", dir); next }
    NF >= 9 && $1 ~ /^[-d]/ {
      name = $9; for (i = 10; i <= NF; i++) name = name " " $i
      if (name == "." || name == "..") next
      print (dir == "." ? name : dir "/" name) "\t" (substr($1, 1, 1) == "d" ? "d" : "f")
    }' "$TMPD/ls.log"
}
remote_tree() {
  # remote_tree <dir> — <dir> and everything beneath it, files first, then the
  # directories deepest first: the order an rm/rmdir batch needs.
  printf '%s\td\n' "$1" > "$TMPD/tree"
  printf '%s\n' "$1" > "$TMPD/level"
  while [ -s "$TMPD/level" ]; do
    # shellcheck disable=SC2046  # one path per line, none with a space
    remote_ls $(cat "$TMPD/level") > "$TMPD/found"
    cat "$TMPD/found" >> "$TMPD/tree"
    awk -F'\t' '$2 == "d" { print $1 }' "$TMPD/found" > "$TMPD/level"
  done
  awk -F'\t' '$2 == "f"' "$TMPD/tree"
  awk -F'\t' '$2 == "d" { print gsub("/", "/") "\t" $0 }' "$TMPD/tree" | sort -rn | cut -f2-
}

# ─── Pruning ─────────────────────────────────────────────────────────────────
# Uploading never deletes, so whatever a deploy replaces stays behind: old
# bundles in assets/, retired icons, a translation's previous packs — the last
# still publicly downloadable. --prune deletes, once the upload is done:
#
#   assets/, icons/, workbox-*.js  files this deploy did not upload, sparing
#       what the deployed sw.js (the build being replaced) precaches: an open
#       tab of that build may still fetch them. If that sw.js cannot be read,
#       none of the three is pruned.
#   api/                           handlers the new api.php no longer has.
#   bible-packs/<T>/<version>/     whole version directories of a translation
#       this deploy uploads another version of. Never a file inside a current
#       version: without --with-packs only the bundled packs go up, not the
#       .gz and Strong's files beside them.
#
# Never bibles/ (a clone lacks the in-copyright XMLs, so the server's are the
# only copies), never storage/, never any other file in the root — secrets.php
# is one — and never a dotfile.
PRUNE_COUNT=0
if [ "$PRUNE" = 1 ]; then
  cut -f2 "$PLAN" | sort -u > "$TMPD/planned"

  curl -fsS --max-time 20 "$PUBLIC_URL/sw.js" > "$TMPD/sw.js" 2>/dev/null || : > "$TMPD/sw.js"
  { grep -oE 'url:"[^"]+"' "$TMPD/sw.js" | sed -E 's/^url:"(.*)"$/\1/'
    grep -oE 'workbox-[0-9a-f]+' "$TMPD/sw.js" | sed 's/$/.js/'
  } > "$TMPD/spared" || true
  SPARE_KNOWN=0
  grep -q '^assets/' "$TMPD/spared" && SPARE_KNOWN=1

  remote_ls . assets icons api bible-packs > "$TMPD/remote"
  : > "$TMPD/kept"
  awk -F'\t' -v known="$SPARE_KNOWN" -v kept="$TMPD/kept" '
    FILENAME == ARGV[1] { planned[$1] = 1; next }
    FILENAME == ARGV[2] { spared[$1] = 1; next }
    $2 != "f" || ($1 in planned) || $1 ~ /(^|\/)\./ { next }
    $1 ~ /^api\/[^\/]+$/ { print; next }
    known && ($1 ~ /^(assets|icons)\/[^\/]+$/ || $1 ~ /^workbox-[0-9a-f]+\.js$/) {
      if ($1 in spared) print $1 > kept; else print
    }' "$TMPD/planned" "$TMPD/spared" "$TMPD/remote" > "$TMPD/prune"

  awk -F'\t' '$2 == "d" && $1 ~ /^bible-packs\/[^\/]+$/ { print $1 }' "$TMPD/remote" > "$TMPD/codes"
  : > "$TMPD/stale"
  if [ -s "$TMPD/codes" ]; then
    # shellcheck disable=SC2046  # one path per line, none with a space
    remote_ls $(cat "$TMPD/codes") > "$TMPD/versions"
    awk -F'\t' '
      FILENAME == ARGV[1] {
        if (split($1, p, "/") >= 4 && p[1] == "bible-packs") { current[p[2]] = 1; uploaded[p[2] "/" p[3]] = 1 }
        next
      }
      $2 == "d" && split($1, p, "/") == 3 && (p[2] in current) && !((p[2] "/" p[3]) in uploaded) { print $1 }
    ' "$TMPD/planned" "$TMPD/versions" > "$TMPD/stale"
  fi
  while IFS= read -r dir; do remote_tree "$dir" >> "$TMPD/prune"; done < "$TMPD/stale"

  # Whatever the server listed, nothing outside these is ever deleted, and
  # nothing this deploy uploads.
  awk -F'\t' '
    BEGIN { n = "[A-Za-z0-9_-][A-Za-z0-9_.-]*" }
    FILENAME == ARGV[1] { planned[$1] = 1; next }
    ($1 in planned) || !($1 ~ ("^(assets|icons|api)/" n "$") || $1 ~ /^workbox-[0-9a-f]+\.js$/ \
        || $1 ~ ("^bible-packs/" n "/" n "(/" n ")*$")) {
      print "✗ refusing to prune " $1 > "/dev/stderr"; bad = 1
    }
    END { exit bad }' "$TMPD/planned" "$TMPD/prune" || exit 1
  PRUNE_COUNT=$(wc -l < "$TMPD/prune" | tr -d ' ')
fi

echo
echo "▸ target : $SFTP_SERVER  →  $PUBLIC_URL"
echo "▸ files  : $FILE_COUNT  ($(echo "scale=1; $BYTES/1048576" | bc) MB)"
[ "$WITH_PACKS" = 1 ]   && echo "▸ incl.  : downloadable Bible packs"
[ "$WITH_BIBLES" = 1 ]  && echo "▸ incl.  : Bible XML sources"
[ "$WITH_SECRETS" = 1 ] && echo "▸ incl.  : secrets.php  (overwrites the server's OpenAI key!)"
[ "$WITH_AMBIENT" = 1 ] && echo "▸ incl.  : ambient music tracks"
echo "▸ never  : storage/ (live user data), and anything not listed above"
if [ "$PRUNE" = 1 ]; then
  echo "▸ prune  : $PRUNE_COUNT paths, once the upload is done"
  awk -F'\t' '{
      split($1, p, "/")
      g = (p[1] == "bible-packs") ? p[1] "/" p[2] "/" p[3] "/" : ((2 in p) ? p[1] "/" : "workbox-*.js")
      c[g]++
    }
    END { for (g in c) printf "           %5d  %s\n", c[g], g }' "$TMPD/prune" | sort -k2
  if [ "$SPARE_KNOWN" = 1 ]; then
    echo "           spared: $(wc -l < "$TMPD/kept" | tr -d ' ') the build being replaced still precaches"
  else
    echo "           assets/, icons/ and workbox-*.js left alone: the deployed sw.js could not be read"
  fi
fi
echo

if [ "$DRY_RUN" = 1 ]; then
  # NR, not `| head`: under pipefail, awk's SIGPIPE on a long plan ended the
  # script right here.
  echo "── dry run — would transfer ──"
  awk -F'\t' 'NR <= 40 {printf "   %s → %s\n", $1, $2}' "$PLAN"
  [ "$FILE_COUNT" -gt 40 ] && echo "   … and $((FILE_COUNT - 40)) more"
  if [ "$PRUNE_COUNT" -gt 0 ]; then
    echo "── and then delete ──"
    awk -F'\t' 'NR <= 40 { print "   " $1 ($2 == "d" ? "/" : "") }' "$TMPD/prune"
    [ "$PRUNE_COUNT" -gt 40 ] && echo "   … and $((PRUNE_COUNT - 40)) more"
  fi
  exit 0
fi

# ─── Emit the sftp batch ─────────────────────────────────────────────────────
# `-` prefixes mean "keep going if this fails" — mkdir on an existing directory
# is expected to fail, and batch mode aborts on the first error otherwise.
awk -F'\t' '{ n=split($2, p, "/"); d=""; for (i=1;i<n;i++){ d = (i==1? p[i] : d "/" p[i]); print d } }' "$PLAN" \
  | awk '!seen[$0]++' | sort | sed 's/^/-mkdir /' >> "$BATCH"
awk -F'\t' '{printf "put %s %s\n", $1, $2}' "$PLAN" >> "$BATCH"

echo "▸ uploading…"
sftp_batch "$BATCH" /tmp/deploy-sftp.log || {
    echo "✗ upload failed — last 20 lines:" >&2
    tail -20 /tmp/deploy-sftp.log >&2
    exit 1
  }
echo "▸ uploaded $FILE_COUNT files"

# ─── Prune ───────────────────────────────────────────────────────────────────
# Only now: until api.php and the packs are replaced, the old ones are serving.
# What is still listed afterwards is what failed.
if [ "$PRUNE_COUNT" -gt 0 ]; then
  echo "▸ pruning…"
  awk -F'\t' '{ print ($2 == "d" ? "-rmdir " : "-rm ") $1 }' "$TMPD/prune" > "$TMPD/prune.batch"
  sftp_batch "$TMPD/prune.batch" /tmp/deploy-prune.log || {
    echo "✗ prune failed — last 20 lines:" >&2
    tail -20 /tmp/deploy-prune.log >&2
    exit 1
  }
  cut -f1 "$TMPD/prune" | sed -E -e 's#/[^/]*$##' -e t -e 's#.*#.#' | sort -u > "$TMPD/parents"
  # shellcheck disable=SC2046  # one path per line, none with a space
  remote_ls $(cat "$TMPD/parents") > "$TMPD/after"
  LEFT=$(awk -F'\t' 'FILENAME == ARGV[1] { gone[$1] = 1; next } ($1 in gone)' "$TMPD/prune" "$TMPD/after" | wc -l | tr -d ' ')
  if [ "$LEFT" = 0 ]; then echo "▸ pruned $PRUNE_COUNT paths"
  else echo "✗ pruned $((PRUNE_COUNT - LEFT)) of $PRUNE_COUNT paths — see /tmp/deploy-prune.log" >&2; fi
fi

# ─── Verify ──────────────────────────────────────────────────────────────────
echo
echo "▸ verifying…"
check() {
  local path="$1" expect="$2" label="$3"
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$PUBLIC_URL$path" || echo 000)
  if [ "$code" = "$expect" ]; then printf '   ✓ %-34s %s\n' "$label" "$code"
  else printf '   ✗ %-34s got %s, expected %s\n' "$label" "$code" "$expect"; fi
}

# Status code alone is NOT enough for asset paths. The SPA-fallback rewrite in
# .htaccess turns every missing file into a 200 serving index.html, so a
# forgotten asset looks perfectly healthy. This asserts the content-type too —
# which is how a batch of missing icons slipped through as five green 200s.
check_asset() {
  local path="$1" expect_ct="$2" label="$3"
  local ct
  ct=$(curl -sI --max-time 20 "$PUBLIC_URL$path" | tr -d '\r' | awk -F': ' 'tolower($1)=="content-type"{print $2}')
  case "$ct" in
    "$expect_ct"*) printf '   ✓ %-34s %s\n' "$label" "$ct" ;;
    text/html*)    printf '   ✗ %-34s SPA fallback — file is MISSING on the server\n' "$label" ;;
    *)             printf '   ✗ %-34s unexpected content-type: %s\n' "$label" "${ct:-none}" ;;
  esac
}
check "/"                                200 "SPA index"
check "/manifest.webmanifest"            200 "PWA manifest"
check "/bible-packs/manifest.json"       200 "Bible pack manifest"
check_asset "/icons/icon-512.png"        "image/png"   "PWA icon 512"
check_asset "/icons/icon-192.png"        "image/png"   "PWA icon 192"
check_asset "/apple-touch-icon.png"      "image/png"   "apple-touch-icon"
check_asset "/favicon-32.png"            "image/png"   "favicon"
# No identity headers -> api.php should reject with 401, which proves PHP is
# executing rather than serving the source, and that routing works.
check "/api.php?action=ambient.list"     401 "api.php (401 = PHP alive)"
# The handlers in api/ are includes, not endpoints, and api/.htaccess denies
# them. Worth checking on every deploy for a reason out of proportion to its
# size: the natural way to write that deny is <Directory "api">, which is
# invalid in a .htaccess and makes Apache answer **every request on the whole
# site** with 500. `apachectl -t` reports "Syntax OK" for it, and PHP's CLI
# server — what the test suite and community:verify:api run on — ignores
# .htaccess entirely. So nothing upstream of this line can catch it.
check "/api/store.php"                   403 "api/ denied (403 = not servable)"
check "/api/bootstrap.php"               403 "api/bootstrap.php denied"

echo "   ─ CORS preflight from the native app origin:"
curl -s -i -X OPTIONS "$PUBLIC_URL/api.php?action=ambient.list" \
  -H 'Origin: capacitor://localhost' \
  -H 'Access-Control-Request-Method: GET' \
  -H 'Access-Control-Request-Headers: x-user-id,x-user-secret' --max-time 20 \
  | grep -iE '^HTTP/|^access-control-allow-(origin|headers)' | sed 's/^/     /'

echo
echo "▸ done → $PUBLIC_URL"
