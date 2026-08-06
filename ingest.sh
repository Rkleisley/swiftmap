#!/usr/bin/env bash
set -euo pipefail

# ─── USAGE ─────────────────────────────────────────────────
#   bash ingest.sh <path-to-bundle>
#   Example: bash ingest.sh qtip-release-20250101T120000.bundle
#
# WHAT THIS DOES
#   Takes a release bundle produced by release.sh, fast-forwards the
#   local mirror branch 'public-main' to match it, and pushes that
#   branch to origin.
#
# WHAT THIS DELIBERATELY DOES NOT DO
#   It never touches, checks out, or merges into 'main'. Merging
#   public-main -> main is a manual developer task (see handoff at end).
# ───────────────────────────────────────────────────────────

TARGET_BRANCH="public-main"   # Local mirror branch this script manages
REMOTE="origin"               # Remote to push the mirror branch to
PROTECTED_BRANCH="main"       # Branch this script must NEVER modify

# ─── small helpers ─────────────────────────────────────────
die()  { echo "❌ $*" >&2; exit 1; }
info() { echo "ℹ️  $*"; }
ok()   { echo "✅ $*"; }

# ─── 0. ENVIRONMENT SANITY ─────────────────────────────────
git rev-parse --is-inside-work-tree >/dev/null 2>&1 \
  || die "Not inside a git repository. cd into your repo and try again."

git remote get-url "$REMOTE" >/dev/null 2>&1 \
  || die "Remote '$REMOTE' is not configured in this repository."

# ─── 1. ARGUMENT CHECK ─────────────────────────────────────
if [[ $# -ne 1 ]]; then
  echo "Usage: bash ingest.sh <path-to-bundle>" >&2
  echo "   Example: bash ingest.sh qtip-release-20250101T120000.bundle" >&2
  exit 1
fi

BUNDLE="$1"
[[ -f "$BUNDLE" ]] || die "Bundle file not found: $BUNDLE"

# ─── 2. VALIDATE BUNDLE ────────────────────────────────────
echo "🔍 Validating bundle..."
git bundle verify "$BUNDLE" >/dev/null \
  || die "Bundle verification failed. Is this the right file, and is your repo deep enough to apply it?"

# ─── 3. DISCOVER THE REF INSIDE THE BUNDLE ─────────────────
# Don't assume the ref name — read it from the bundle so this script
# stays correct even if release.sh changes what it packs. We expect
# exactly one head.
mapfile -t BUNDLE_HEADS < <(git bundle list-heads "$BUNDLE" | awk '{print $2}')
if [[ ${#BUNDLE_HEADS[@]} -eq 0 ]]; then
  die "Bundle contains no refs — nothing to ingest."
elif [[ ${#BUNDLE_HEADS[@]} -gt 1 ]]; then
  echo "❌ Bundle contains multiple refs; expected exactly one:" >&2
  printf '     %s\n' "${BUNDLE_HEADS[@]}" >&2
  exit 1
fi
BUNDLE_REF="${BUNDLE_HEADS[0]}"
info "Bundle ref: $BUNDLE_REF"

# ─── 4. REQUIRE A CLEAN WORKING TREE ───────────────────────
# Checked before any branch switch so nothing is carried or lost.
if ! git diff --quiet || ! git diff --cached --quiet; then
  die "You have uncommitted changes. Commit or stash them first."
fi

# ─── 5. ENSURE WE ARE ON public-main (zero assumptions) ────
# The dev may run this from any branch; put them on public-main
# explicitly rather than assuming they're already there.
STARTING_BRANCH=$(git rev-parse --abbrev-ref HEAD)

if ! git show-ref --verify --quiet "refs/heads/$TARGET_BRANCH"; then
  # First-ever ingest: create the mirror branch directly from the bundle.
  info "'$TARGET_BRANCH' doesn't exist yet — creating it from the bundle..."
  git fetch "$BUNDLE" "$BUNDLE_REF:refs/heads/$TARGET_BRANCH"
  git switch "$TARGET_BRANCH"
  NEW_HEAD=$(git rev-parse --short "$TARGET_BRANCH")
  ok "Created '$TARGET_BRANCH' at $NEW_HEAD."
else
  if [[ "$STARTING_BRANCH" != "$TARGET_BRANCH" ]]; then
    info "Switching from '$STARTING_BRANCH' to '$TARGET_BRANCH'."
  fi
  git switch "$TARGET_BRANCH"

  # ─── 6. FETCH AND FAST-FORWARD ───────────────────────────
  echo "📦 Fetching from bundle into '$TARGET_BRANCH'..."
  BEFORE=$(git rev-parse "$TARGET_BRANCH")
  git fetch "$BUNDLE" "$BUNDLE_REF"

  if ! git merge --ff-only FETCH_HEAD; then
    echo "❌ Fast-forward failed: '$TARGET_BRANCH' has diverged from the bundle." >&2
    echo "   Someone likely committed to '$TARGET_BRANCH' directly. This branch" >&2
    echo "   must only ever mirror the bundle. Resolve manually before retrying." >&2
    exit 1
  fi

  AFTER=$(git rev-parse "$TARGET_BRANCH")
  if [[ "$BEFORE" == "$AFTER" ]]; then
    info "No new commits in bundle — '$TARGET_BRANCH' was already current locally."
    info "(Will still reconcile '$REMOTE' below in case a prior push didn't land.)"
  else
    ok "'$TARGET_BRANCH' advanced: ${BEFORE:0:8} → ${AFTER:0:8}"
  fi
fi

# ─── 7. PUSH (idempotent: reconciles origin even if nothing new) ──
echo "🚀 Pushing '$TARGET_BRANCH' to '$REMOTE'..."
git push "$REMOTE" "$TARGET_BRANCH"

# ─── 8. SAFETY ASSERTION: we never touched the protected branch ──
ENDING_BRANCH=$(git rev-parse --abbrev-ref HEAD)
[[ "$ENDING_BRANCH" == "$TARGET_BRANCH" ]] \
  || die "Internal error: expected to end on '$TARGET_BRANCH' but on '$ENDING_BRANCH'."

# ─── 9. HANDOFF (manual — do NOT automate) ─────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
ok "Ingest complete. You are on '$TARGET_BRANCH'."
echo ""
echo "Next step (MANUAL — do NOT automate):"
echo "  git switch $PROTECTED_BRANCH"
echo "  git merge $TARGET_BRANCH"
echo ""
echo "Review any merge conflicts, then push '$PROTECTED_BRANCH' when ready."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"