#!/usr/bin/env bash
# Atomic release for the Dashie Hub add-on.
#
# Bumping config.yaml's version without first running sync-console.sh has bitten
# us once already (0.1.34/0.1.35 both shipped with stale console JS). This script
# does everything in one go so the two can't drift:
#
#   1. Sync ../dashie-console → frontend/dashie-console/
#   2. Bump config.yaml + package.json to the new version
#   3. Stage everything, commit, optionally push
#
# Usage:
#   ./scripts/release.sh 0.1.36           # bump + commit
#   ./scripts/release.sh 0.1.36 --push    # bump + commit + push origin main
#
# Run from the add-on repo root (or anywhere — script resolves paths).

set -euo pipefail

if [[ $# -lt 1 ]]; then
    echo "Usage: $0 <new-version> [--push]" >&2
    echo "  e.g. $0 0.1.36" >&2
    exit 1
fi

NEW_VERSION="$1"
DO_PUSH=0
if [[ "${2:-}" == "--push" ]]; then DO_PUSH=1; fi

ADDON_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ADDON_ROOT"

# Refuse to run on a dirty tree — the commit at the end should contain only what
# this script staged, not random in-progress edits.
if ! git diff-index --quiet HEAD --; then
    echo "Error: working tree has uncommitted changes. Commit or stash first." >&2
    git status --short
    exit 1
fi

echo "==> Syncing console"
"$ADDON_ROOT/scripts/sync-console.sh"

echo "==> Bumping version → $NEW_VERSION"
# config.yaml: line like `version: "0.1.34"`
sed -i.bak -E "s/^version: \"[^\"]+\"/version: \"$NEW_VERSION\"/" config.yaml
rm -f config.yaml.bak
# package.json: line like `  "version": "0.1.34",`
sed -i.bak -E "s/(\"version\": *\")[^\"]+(\")/\1$NEW_VERSION\2/" package.json
rm -f package.json.bak

# Confirm the bump landed.
grep -q "\"$NEW_VERSION\"" config.yaml || { echo "config.yaml bump failed"; exit 1; }
grep -q "\"$NEW_VERSION\"" package.json || { echo "package.json bump failed"; exit 1; }

echo "==> Staging changes"
git add config.yaml package.json frontend/dashie-console

if git diff --cached --quiet; then
    echo "==> Nothing to commit (already at $NEW_VERSION with synced console)"
    exit 0
fi

echo "==> Committing"
git commit -m "Release $NEW_VERSION" -- config.yaml package.json frontend/dashie-console

if [[ $DO_PUSH -eq 1 ]]; then
    echo "==> Pushing origin main"
    git push origin main
fi

echo ""
echo "Done. Released $NEW_VERSION."
