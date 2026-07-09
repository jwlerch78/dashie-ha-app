#!/usr/bin/env bash
# Atomic release for a Dashie Console add-on CHANNEL.
#
# The repo hosts two add-ons (one per channel), each a self-contained HA add-on folder:
#   dev   → dashie-console-dev/   vendors dashie-console  main   (bleeding edge, test box)
#   prod  → dashie-console/       vendors dashie-console  prod   (frozen, field boxes)
#
# It vendors the channel's console branch into that folder, bumps its config.yaml +
# package.json together (so version + console can't drift — the 0.1.34/0.1.35 stale-
# console bug), commits ONLY that folder, and optionally pushes.
#
# NOTE: console changes (including the generated ai-prompt bundle) must be committed +
# pushed on the channel's branch FIRST — sync vendors the COMMITTED tree of that branch.
#
# Usage:
#   ./scripts/release.sh <version> --channel <dev|prod> [--push]
#     e.g. ./scripts/release.sh 0.1.179 --channel dev --push
#
# Run from anywhere — paths resolve off the script location.

set -euo pipefail

NEW_VERSION=""
CHANNEL=""
DO_PUSH=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --channel) CHANNEL="${2:-}"; shift 2 ;;
    --push)    DO_PUSH=1; shift ;;
    -*)        echo "Unknown flag: $1" >&2; exit 1 ;;
    *)         if [[ -z "$NEW_VERSION" ]]; then NEW_VERSION="$1"; shift; else echo "Unexpected arg: $1" >&2; exit 1; fi ;;
  esac
done

if [[ -z "$NEW_VERSION" || -z "$CHANNEL" ]]; then
  echo "Usage: $0 <version> --channel <dev|prod> [--push]" >&2
  exit 1
fi

case "$CHANNEL" in
  dev)  CONSOLE_BRANCH="main"; ADDON_DIR="dashie-console-dev" ;;
  prod) CONSOLE_BRANCH="prod"; ADDON_DIR="dashie-console" ;;
  *)    echo "Error: --channel must be 'dev' or 'prod' (got '$CHANNEL')" >&2; exit 1 ;;
esac

ADDON_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ADDON_ROOT"
DIR="$ADDON_ROOT/$ADDON_DIR"

if [[ ! -f "$DIR/config.yaml" ]]; then
  echo "Error: $DIR/config.yaml not found — is the '$CHANNEL' add-on folder present?" >&2
  exit 1
fi

# Refuse a dirty tree so the release commit contains only what this script staged.
if ! git diff-index --quiet HEAD --; then
  echo "Error: working tree has uncommitted changes. Commit or stash first." >&2
  git status --short
  exit 1
fi

echo "==> [$CHANNEL] Vendoring dashie-console '$CONSOLE_BRANCH' → $ADDON_DIR/frontend/dashie-console"
CONSOLE_SHA="$("$ADDON_ROOT/scripts/sync-console.sh" "$CONSOLE_BRANCH" "$DIR/frontend/dashie-console")"

echo "==> [$CHANNEL] Bumping version → $NEW_VERSION"
sed -i.bak -E "s/^version: \"[^\"]+\"/version: \"$NEW_VERSION\"/" "$DIR/config.yaml"; rm -f "$DIR/config.yaml.bak"
sed -i.bak -E "s/(\"version\": *\")[^\"]+(\")/\1$NEW_VERSION\2/" "$DIR/package.json"; rm -f "$DIR/package.json.bak"
grep -q "\"$NEW_VERSION\"" "$DIR/config.yaml"  || { echo "config.yaml bump failed"; exit 1; }
grep -q "\"$NEW_VERSION\"" "$DIR/package.json" || { echo "package.json bump failed"; exit 1; }

echo "==> [$CHANNEL] Staging"
# -A captures files the console removed (sync does rm -rf + re-extract).
git add -A "$ADDON_DIR/config.yaml" "$ADDON_DIR/package.json" "$ADDON_DIR/frontend/dashie-console"

if git diff --cached --quiet; then
  echo "==> Nothing to commit ($ADDON_DIR already at $NEW_VERSION with console @ $CONSOLE_SHA)"
  exit 0
fi

echo "==> [$CHANNEL] Committing"
git commit -m "Release $CHANNEL $NEW_VERSION (console $CONSOLE_BRANCH @ $CONSOLE_SHA)" \
  -- "$ADDON_DIR/config.yaml" "$ADDON_DIR/package.json" "$ADDON_DIR/frontend/dashie-console"

if [[ $DO_PUSH -eq 1 ]]; then
  echo "==> Pushing origin main"
  git push origin main
fi

echo ""
echo "Done. Released $CHANNEL $NEW_VERSION (console $CONSOLE_BRANCH @ $CONSOLE_SHA)."
