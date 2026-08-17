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
#     --dry-run        print the transfer plan and exit
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

BUILD=1 WITH_SECRETS=0 WITH_BIBLES=0 WITH_PACKS=0 WITH_AMBIENT=0 DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --no-build)     BUILD=0 ;;
    --with-secrets) WITH_SECRETS=1 ;;
    --with-bibles)  WITH_BIBLES=1 ;;
    --with-packs)   WITH_PACKS=1 ;;
    --with-ambient) WITH_AMBIENT=1 ;;
    --dry-run)      DRY_RUN=1 ;;
    -h|--help)      sed -n '2,26p' "$0"; exit 0 ;;
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
PLAN=$(mktemp) ; BATCH=$(mktemp)
trap 'rm -f "$PLAN" "$BATCH"' EXIT

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
for f in index.html manifest.webmanifest sw.js registerSW.js favicon-32.png apple-touch-icon.png; do
  add_file "dist/$f" "$f"
done
add_tree dist/icons icons
while IFS= read -r f; do add_file "$f" "$(basename "$f")"; done < <(find dist -maxdepth 1 -name 'workbox-*.js')
add_tree dist/assets assets

# Backend + Apache config
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

echo
echo "▸ target : $SFTP_SERVER  →  $PUBLIC_URL"
echo "▸ files  : $FILE_COUNT  ($(echo "scale=1; $BYTES/1048576" | bc) MB)"
[ "$WITH_PACKS" = 1 ]   && echo "▸ incl.  : downloadable Bible packs"
[ "$WITH_BIBLES" = 1 ]  && echo "▸ incl.  : Bible XML sources"
[ "$WITH_SECRETS" = 1 ] && echo "▸ incl.  : secrets.php  (overwrites the server's OpenAI key!)"
[ "$WITH_AMBIENT" = 1 ] && echo "▸ incl.  : ambient music tracks"
echo "▸ never  : storage/ (live user data), and anything not listed above"
echo

if [ "$DRY_RUN" = 1 ]; then
  echo "── dry run — would transfer ──"
  awk -F'\t' '{printf "   %s → %s\n", $1, $2}' "$PLAN" | head -40
  [ "$FILE_COUNT" -gt 40 ] && echo "   … and $((FILE_COUNT - 40)) more"
  exit 0
fi

# ─── Emit the sftp batch ─────────────────────────────────────────────────────
# `-` prefixes mean "keep going if this fails" — mkdir on an existing directory
# is expected to fail, and batch mode aborts on the first error otherwise.
awk -F'\t' '{ n=split($2, p, "/"); d=""; for (i=1;i<n;i++){ d = (i==1? p[i] : d "/" p[i]); print d } }' "$PLAN" \
  | awk '!seen[$0]++' | sort | sed 's/^/-mkdir /' >> "$BATCH"
awk -F'\t' '{printf "put %s %s\n", $1, $2}' "$PLAN" >> "$BATCH"

echo "▸ uploading…"
SSHPASS="$SFTP_PASSWD" sshpass -e sftp \
  -o StrictHostKeyChecking=accept-new \
  -o BatchMode=no \
  -o ConnectTimeout=20 \
  -b "$BATCH" "$SFTP_SERVER" > /tmp/deploy-sftp.log 2>&1 || {
    echo "✗ upload failed — last 20 lines:" >&2
    tail -20 /tmp/deploy-sftp.log >&2
    exit 1
  }
echo "▸ uploaded $FILE_COUNT files"

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

echo "   ─ CORS preflight from the native app origin:"
curl -s -i -X OPTIONS "$PUBLIC_URL/api.php?action=ambient.list" \
  -H 'Origin: capacitor://localhost' \
  -H 'Access-Control-Request-Method: GET' \
  -H 'Access-Control-Request-Headers: x-user-id,x-user-secret' --max-time 20 \
  | grep -iE '^HTTP/|^access-control-allow-(origin|headers)' | sed 's/^/     /'

echo
echo "▸ done → $PUBLIC_URL"
