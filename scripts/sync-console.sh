#!/usr/bin/env bash
# Sync the dashie-console frontend into this add-on repo.
#
# The dashie-console repo is private, so we can't use git submodules (HAOS has no
# credentials when it clones our add-on). Instead we vendor a copy of the console
# files into frontend/dashie-console/ and commit them.
#
# Run this script from the repo root whenever the console is updated.
#
#   ./scripts/sync-console.sh [CONSOLE_PATH]
#
# CONSOLE_PATH defaults to ../dashie-console. Override if the console repo lives
# elsewhere. The script pulls the latest main branch, rsyncs the files, and leaves
# the staged changes for you to commit manually.

set -euo pipefail

CONSOLE_PATH="${1:-$(cd "$(dirname "$0")/../.." && pwd)/dashie-console}"
ADDON_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${ADDON_ROOT}/frontend/dashie-console"

if [[ ! -d "$CONSOLE_PATH/.git" ]]; then
    echo "Error: $CONSOLE_PATH is not a git repository." >&2
    echo "Pass the path to your local dashie-console clone as the first argument." >&2
    exit 1
fi

echo "==> Pulling latest dashie-console from $CONSOLE_PATH"
git -C "$CONSOLE_PATH" fetch origin
git -C "$CONSOLE_PATH" checkout main
git -C "$CONSOLE_PATH" pull --ff-only origin main
CONSOLE_SHA="$(git -C "$CONSOLE_PATH" rev-parse --short HEAD)"

echo "==> Syncing files into $TARGET"
mkdir -p "$TARGET"
rsync -a --delete \
    --exclude='.git' \
    --exclude='node_modules' \
    --exclude='*.log' \
    "$CONSOLE_PATH/" "$TARGET/"

cd "$ADDON_ROOT"
if git diff --quiet -- frontend/dashie-console; then
    echo "==> No changes (console is already up-to-date at $CONSOLE_SHA)"
else
    echo "==> Console synced to $CONSOLE_SHA"
    echo "==> Staged changes ready for commit:"
    git status --short -- frontend/dashie-console | head -20
    echo ""
    echo "Suggested commit message:"
    echo "  Sync dashie-console to $CONSOLE_SHA"
fi
