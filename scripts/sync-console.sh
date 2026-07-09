#!/usr/bin/env bash
# Vendor the dashie-console frontend into an add-on channel's frontend/ copy.
#
# Exports the COMMITTED tree of a dashie-console branch via `git archive` — NOT a
# working-tree checkout+rsync. Why:
#   • no branch-switch on the console repo (won't disrupt a concurrent editor there)
#   • no uncommitted-file contamination (a stray edit in the console repo can never
#     leak into a release — only committed files are archived)
#   • .git + gitignored node_modules are naturally excluded (not in the tree)
#
# The console repo is private, so HAOS can't use a git submodule — we vendor a copy
# into the add-on and commit it. Called by release.sh with the channel's branch + dir.
#
# Usage:
#   ./scripts/sync-console.sh <branch> <target-dir> [console-path]
#     <branch>      dashie-console branch to vendor (e.g. main | prod)
#     <target-dir>  absolute destination (e.g. .../dashie-console-dev/frontend/dashie-console)
#     console-path  optional; defaults to ../../dashie-console

set -euo pipefail

BRANCH="${1:?usage: sync-console.sh <branch> <target-dir> [console-path]}"
TARGET="${2:?usage: sync-console.sh <branch> <target-dir> [console-path]}"
CONSOLE_PATH="${3:-$(cd "$(dirname "$0")/../.." && pwd)/dashie-console}"

if [[ ! -d "$CONSOLE_PATH/.git" ]]; then
    echo "Error: $CONSOLE_PATH is not a git repository." >&2
    echo "Pass the path to your local dashie-console clone as the third argument." >&2
    exit 1
fi

echo "==> Fetching dashie-console origin/$BRANCH" >&2
git -C "$CONSOLE_PATH" fetch origin "$BRANCH" --quiet
CONSOLE_SHA="$(git -C "$CONSOLE_PATH" rev-parse --short "origin/$BRANCH")"

echo "==> Vendoring origin/$BRANCH ($CONSOLE_SHA) → $TARGET" >&2
rm -rf "$TARGET"
mkdir -p "$TARGET"
git -C "$CONSOLE_PATH" archive "origin/$BRANCH" | tar -x -C "$TARGET"

echo "==> Synced to dashie-console origin/$BRANCH @ $CONSOLE_SHA" >&2
# Emit ONLY the source SHA on stdout so callers (release.sh) can capture it.
echo "$CONSOLE_SHA"
