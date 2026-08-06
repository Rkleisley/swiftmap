#!/usr/bin/env bash
set -euo pipefail

# ─── CONFIGURATION ─────────────────────────────────────────
SOURCE_BRANCH="main"
CERT_WAIT_SECONDS="${ARRAKIS_CERT_WAIT_SECONDS:-600}"
CERT_MIN_VALIDITY_SECONDS=300

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)

# Internal values (dataset, URLs, classification) live in release.env,
# which is gitignored. Copy release.env.example to get started.
RELEASE_ENV_FILE="${ARRAKIS_RELEASE_ENV:-$SCRIPT_DIR/release.env}"
if [[ ! -f "$RELEASE_ENV_FILE" ]]; then
  echo "❌ Missing config file: $RELEASE_ENV_FILE" >&2
  echo "Copy release.env.example to release.env and fill in the values." >&2
  exit 1
fi
# shellcheck source=/dev/null
source "$RELEASE_ENV_FILE"

for required_var in CLASSIFICATION DATASET SCANNING_URL CERT_PORTAL_URL; do
  if [[ -z "${!required_var:-}" ]]; then
    echo "❌ $required_var is not set in $RELEASE_ENV_FILE" >&2
    exit 1
  fi
done
unset required_var
DOWNLOADS_DIR=""
CERT_ZIP="${ARRAKIS_CERT_ZIP:-}"
TEMP_CERT_DIR=""
TMP_BUNDLE=""
UPLOAD_RESPONSE=""

cleanup() {
  if [[ -n "$TMP_BUNDLE" && -f "$TMP_BUNDLE" ]]; then
    rm -f -- "$TMP_BUNDLE"
  fi
  if [[ -n "$UPLOAD_RESPONSE" && -f "$UPLOAD_RESPONSE" ]]; then
    rm -f -- "$UPLOAD_RESPONSE"
  fi
  if [[ -n "$TEMP_CERT_DIR" && -d "$TEMP_CERT_DIR" ]]; then
    rm -rf -- "$TEMP_CERT_DIR"
  fi
}
trap cleanup EXIT

require_commands() {
  local command_name
  for command_name in curl find git openssl sed sort stat unzip; do
    if ! command -v "$command_name" >/dev/null 2>&1; then
      echo "❌ Required command is not installed: $command_name" >&2
      exit 1
    fi
  done
}

resolve_downloads_dir() {
  local resolved_dir

  if [[ -n "${ARRAKIS_DOWNLOADS_DIR:-}" ]]; then
    printf '%s\n' "$ARRAKIS_DOWNLOADS_DIR"
    return
  fi

  if command -v xdg-user-dir >/dev/null 2>&1; then
    resolved_dir=$(xdg-user-dir DOWNLOAD 2>/dev/null || true)
    if [[ -n "$resolved_dir" ]]; then
      printf '%s\n' "$resolved_dir"
      return
    fi
  fi

  if [[ -n "${USERPROFILE:-}" ]]; then
    if command -v cygpath >/dev/null 2>&1; then
      cygpath -u "${USERPROFILE}\\Downloads"
    else
      printf '%s/Downloads\n' "$USERPROFILE"
    fi
    return
  fi

  printf '%s/Downloads\n' "$HOME"
}

file_mtime() {
  stat -c '%Y' "$1" 2>/dev/null \
    || stat -f '%m' "$1" 2>/dev/null \
    || printf '0\n'
}

newest_cert_zip() {
  find "$DOWNLOADS_DIR" -maxdepth 1 -type f \
    -name 'gdn-arrakis-mtls-*.zip' \
    -printf '%T@ %p\n' 2>/dev/null \
    | sort -nr \
    | sed -n '1s/^[^ ]* //p'
}

cert_zip_is_valid() {
  local cert_zip="$1"
  local client_cert_entry

  [[ -f "$cert_zip" ]] || return 1
  client_cert_entry=$(unzip -Z1 "$cert_zip" 2>/dev/null | sed -n '/client\.crt$/ {p;q;}')
  [[ -n "$client_cert_entry" ]] || return 1

  unzip -p "$cert_zip" "$client_cert_entry" 2>/dev/null \
    | openssl x509 -checkend "$CERT_MIN_VALIDITY_SECONDS" -noout >/dev/null 2>&1
}

select_certificate_zip() {
  local previous_zip previous_mtime deadline candidate candidate_mtime

  if [[ -n "$CERT_ZIP" ]]; then
    if ! cert_zip_is_valid "$CERT_ZIP"; then
      echo "❌ The specified Arrakis certificate ZIP is missing, invalid, or expired: $CERT_ZIP" >&2
      exit 1
    fi
    echo "Using specified Arrakis certificate bundle: ${CERT_ZIP##*/}"
    return
  fi

  previous_zip=$(newest_cert_zip)
  previous_mtime="0"
  if [[ -n "$previous_zip" ]]; then
    previous_mtime=$(file_mtime "$previous_zip")
  fi

  if [[ -n "$previous_zip" ]] && cert_zip_is_valid "$previous_zip"; then
    CERT_ZIP="$previous_zip"
    echo "Reusing valid Arrakis certificate bundle: ${CERT_ZIP##*/}"
    return
  fi

  echo
  echo "A fresh Arrakis certificate is required for this release."
  echo "Open this link, sign in, and download the certificate ZIP:"
  echo "  $CERT_PORTAL_URL"
  echo
  echo "Watching for a new gdn-arrakis-mtls-*.zip in:"
  echo "  $DOWNLOADS_DIR"
  echo "Waiting up to $CERT_WAIT_SECONDS seconds (press Ctrl+C to cancel)."

  deadline=$((SECONDS + CERT_WAIT_SECONDS))
  while (( SECONDS <= deadline )); do
    candidate=$(newest_cert_zip)
    if [[ -n "$candidate" ]]; then
      candidate_mtime=$(file_mtime "$candidate")
      if [[ "$candidate" != "$previous_zip" || "$candidate_mtime" -gt "$previous_mtime" ]]; then
        if cert_zip_is_valid "$candidate"; then
          CERT_ZIP="$candidate"
          echo "Detected valid Arrakis certificate bundle: ${CERT_ZIP##*/}"
          return
        fi
      fi
    fi
    sleep 2
  done

  echo "❌ Timed out waiting for a newly downloaded, valid Arrakis certificate." >&2
  echo "If it downloaded elsewhere, move it to $DOWNLOADS_DIR or set ARRAKIS_DOWNLOADS_DIR." >&2
  exit 1
}

extract_certificate_bundle() {
  local client_cert cert_dir required_file

  TEMP_CERT_DIR=$(mktemp -d "${TMPDIR:-/tmp}/athena-arrakis-certs.XXXXXX")
  unzip -qq "$CERT_ZIP" -d "$TEMP_CERT_DIR"

  client_cert=$(find "$TEMP_CERT_DIR" -type f -name client.crt -print -quit)
  if [[ -z "$client_cert" ]]; then
    echo "❌ Certificate bundle does not contain client.crt" >&2
    exit 1
  fi

  cert_dir=$(dirname -- "$client_cert")
  for required_file in client.crt client.key ca.crt; do
    if [[ ! -f "$cert_dir/$required_file" ]]; then
      echo "❌ Certificate bundle is missing $required_file" >&2
      exit 1
    fi
  done

  ARRAKIS_CERT="$cert_dir/client.crt"
  ARRAKIS_KEY="$cert_dir/client.key"
  ARRAKIS_CA="$cert_dir/ca.crt"
}

# ─── PREFLIGHT CHECKS ──────────────────────────────────────
cd "$SCRIPT_DIR"
require_commands

case "$CERT_WAIT_SECONDS" in
  ''|*[!0-9]*)
    echo "❌ ARRAKIS_CERT_WAIT_SECONDS must be a non-negative integer." >&2
    exit 1
    ;;
esac

DOWNLOADS_DIR=$(resolve_downloads_dir)
if [[ ! -d "$DOWNLOADS_DIR" ]]; then
  echo "❌ Downloads directory does not exist: $DOWNLOADS_DIR" >&2
  echo "Set ARRAKIS_DOWNLOADS_DIR if your browser downloads elsewhere." >&2
  exit 1
fi

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "$CURRENT_BRANCH" != "$SOURCE_BRANCH" ]]; then
  echo "❌ Must be on '$SOURCE_BRANCH' to release. You're on '$CURRENT_BRANCH'."
  exit 1
fi

# if ! git diff --quiet || ! git diff --cached --quiet; then
#   echo "❌ Uncommitted changes detected. Commit or stash before releasing."
#   exit 1
# fi

echo "🔍 Checking local $SOURCE_BRANCH is up to date with origin..."
git fetch origin "$SOURCE_BRANCH" --quiet
LOCAL=$(git rev-parse HEAD)
REMOTE_HEAD=$(git rev-parse "origin/$SOURCE_BRANCH")
BASE=$(git merge-base HEAD "origin/$SOURCE_BRANCH")

if [[ "$LOCAL" != "$REMOTE_HEAD" ]]; then
  if [[ "$LOCAL" == "$BASE" ]]; then
    echo "❌ Your local $SOURCE_BRANCH is behind origin/$SOURCE_BRANCH. Run 'git pull' first."
  elif [[ "$REMOTE_HEAD" == "$BASE" ]]; then
    echo "❌ Your local $SOURCE_BRANCH is ahead of origin/$SOURCE_BRANCH. Run 'git push' first."
  else
    echo "❌ Your local $SOURCE_BRANCH has diverged from origin/$SOURCE_BRANCH. Reconcile before releasing."
  fi
  exit 1
fi
echo "✅ Local $SOURCE_BRANCH is up to date."

# ─── CERTIFICATE ───────────────────────────────────────────
select_certificate_zip
extract_certificate_bundle

# ─── CREATE RELEASE BUNDLE ─────────────────────────────────
GIT_HEAD=$(git rev-parse HEAD)
FIRST_COMMIT=$(git rev-list --max-parents=0 HEAD)
COMMIT_COUNT=$(git rev-list --count HEAD)
RELEASE_VERSION=$(git describe --tags --abbrev=0 2>/dev/null || echo "v0.0.0")
CREATED_DATE=$(date -Iseconds)
BUNDLE_NAME="swiftmap-release-$(date +%Y%m%dT%H%M%S).bundle"
TMP_BUNDLE=$(mktemp "${TMPDIR:-/tmp}/qtip-release.XXXXXX.bundle")

echo "Creating full-history bundle for branch '$SOURCE_BRANCH'..."
git bundle create "$TMP_BUNDLE" "$SOURCE_BRANCH"

# ─── UPLOAD ────────────────────────────────────────────────
echo "Uploading bundle as $BUNDLE_NAME..."

# --fail-with-body needs curl >= 7.76.0; emulate it so older curls (e.g. WSL
# Ubuntu 20.04) still fail on HTTP errors without hiding the response body.
UPLOAD_RESPONSE=$(mktemp "${TMPDIR:-/tmp}/qtip-upload-response.XXXXXX")
HTTP_STATUS=$(curl --silent --show-error --request POST "$SCANNING_URL" \
  --cert "$ARRAKIS_CERT" \
  --key "$ARRAKIS_KEY" \
  --cacert "$ARRAKIS_CA" \
  -F "arrakis-dataset=$DATASET" \
  -F "arrakis-classification=$CLASSIFICATION" \
  -F "arrakis-created-date=$CREATED_DATE" \
  -F "metatag_release-version=$RELEASE_VERSION" \
  -F "metatag_git-head=$GIT_HEAD" \
  -F "metatag_git-base=$FIRST_COMMIT" \
  -F "metatag_commit-count=$COMMIT_COUNT" \
  -F "metatag_author=$(git config user.name)" \
  -F "metatag_created-by=local-push-script" \
  -F "file=@$TMP_BUNDLE;filename=$BUNDLE_NAME" \
  --output "$UPLOAD_RESPONSE" \
  --write-out '%{http_code}')

cat "$UPLOAD_RESPONSE"
if [[ "$HTTP_STATUS" -lt 200 || "$HTTP_STATUS" -ge 300 ]]; then
  echo
  echo "❌ Upload failed with HTTP status $HTTP_STATUS." >&2
  exit 1
fi

echo
echo "✅ Done. Bundle uploaded as $BUNDLE_NAME"