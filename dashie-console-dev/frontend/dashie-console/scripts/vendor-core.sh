#!/usr/bin/env bash
# Vendor the console CORE from the public dashie-ha-console repo into this
# family-delta repo — the REVERSE of the retired sync-console.sh (repo inversion,
# 2026-07-27: dashie-ha/frontend/console is canonical; this repo carries
# only the Dashie delta listed in delta-manifest.txt plus brand identity).
#
# What it does:
#   1. git-archives <dashie-ha-console>/dashie-ha/frontend/console @ origin/<branch>
#      (COMMITTED tree only — no uncommitted-file contamination)
#   2. Replaces js/, css/, login/, vendor/ and index.html here with the core,
#      EXCEPT delta-manifest.txt paths (this repo's private files, untouched)
#      vendor/ joined that list on 2026-07-30: the published core stopped
#      loading supabase-js from the jsDelivr CDN and vendored it locally, so a
#      core-only copy set left index.html pointing at a file that never arrived.
#      Its own sanity gate caught it (dangling <script src>) — keep that gate.
#   3. Injects the delta <script> tags into the DELTA-SCRIPTS block (the old
#      static re-branding step is gone — see the note at that step)
#   4. Sanity gate: every <script src> resolves, every delta file exists,
#      node --check passes on changed JS
#
# assets/ is NOT vendored — each side owns its brand assets (shared icons
# under assets/icons drift-checked manually until the Phase-2 asset split).
#
# Edit shared console code in the PUBLIC repo, then run this. Direct edits
# to vendored files here WILL be overwritten.
#
# Usage: ./scripts/vendor-core.sh [branch] [dashie-ha-console-path]
set -euo pipefail

BRANCH="${1:-main}"
DASHIE_HA_CONSOLE_PATH="${2:-$(cd "$(dirname "$0")/../.." && pwd)/dashie-ha-console}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MANIFEST="$REPO_ROOT/delta-manifest.txt"
CORE_SUBDIR="dashie-ha/frontend/console"

[ -d "$DASHIE_HA_CONSOLE_PATH/.git" ] || { echo "Error: $DASHIE_HA_CONSOLE_PATH is not a git repo (pass your dashie-ha-console clone path)." >&2; exit 1; }
[ -f "$MANIFEST" ] || { echo "Error: delta-manifest.txt missing." >&2; exit 1; }

echo "==> Fetching dashie-ha-console origin/$BRANCH" >&2
git -C "$DASHIE_HA_CONSOLE_PATH" fetch origin "$BRANCH" --quiet
CORE_SHA="$(git -C "$DASHIE_HA_CONSOLE_PATH" rev-parse --short "origin/$BRANCH")"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
echo "==> Extracting core @ $CORE_SHA" >&2
git -C "$DASHIE_HA_CONSOLE_PATH" archive "origin/$BRANCH" "$CORE_SUBDIR" | tar -x -C "$TMP"
CORE="$TMP/$CORE_SUBDIR"
[ -f "$CORE/index.html" ] || { echo "Error: core extract failed (no index.html)." >&2; exit 1; }

# Delta paths (manifest, comments stripped). brand.js is delta-owned identity.
DELTA_PATHS=()
while IFS= read -r line; do
    line="${line%%#*}"; line="$(echo "$line" | xargs)"
    [ -n "$line" ] && DELTA_PATHS+=("$line")
done < "$MANIFEST"

is_delta() { local p="$1"; for d in "${DELTA_PATHS[@]}"; do [ "$p" = "$d" ] && return 0; done; return 1; }

# Both-owned check: a manifest path present in the core is a seam violation
# (brand.js excepted — both sides deliberately keep their own file at that path).
for d in "${DELTA_PATHS[@]}"; do
    [ "$d" = "js/lib/brand.js" ] && continue
    if [ -e "$CORE/$d" ]; then
        echo "Error: $d is in delta-manifest.txt AND in the public core — a file is core-owned or delta-owned, never both." >&2
        exit 1
    fi
done

echo "==> Vendoring core → repo (js/, css/, login/, vendor/, index.html; delta files untouched)" >&2
# Remove core-owned files that vanished upstream: delete every tracked file
# under js/, css/, login/, vendor/ that is NOT delta, then lay down the core.
( cd "$REPO_ROOT" && git ls-files js css login vendor ) | while IFS= read -r f; do
    is_delta "$f" && continue
    [ -e "$CORE/$f" ] || rm -f "$REPO_ROOT/$f"
done
( cd "$CORE" && find js css login vendor -type f 2>/dev/null ) | while IFS= read -r f; do
    is_delta "$f" && continue
    mkdir -p "$REPO_ROOT/$(dirname "$f")"
    cp "$CORE/$f" "$REPO_ROOT/$f"
done
cp "$CORE/index.html" "$REPO_ROOT/index.html"

echo "==> Injecting delta scripts" >&2
# No static re-branding step any more. It existed to rewrite Chickadee titles and
# icon paths out of the vendored statics; since the 2026-07-30 consolidation the
# published tree ships Dashie's own titles and assets, so the rewrites became
# no-ops (literally s|X|X|) and were removed. If the two editions ever diverge on
# a static again, put the rewrite back here rather than hand-editing the vendored
# file — this whole tree is overwritten on the next vendor.

# Delta <script> tags in manifest order (brand.js excluded — its tag is a core
# tag; only the FILE is per-side). ?v= is the core SHA + delta git state.
DELTA_V="$CORE_SHA$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo 0)"
TAGS=""
for d in "${DELTA_PATHS[@]}"; do
    [ "$d" = "js/lib/brand.js" ] && continue
    TAGS+="    <script src=\"$d?v=$DELTA_V\"></script>\n"
done
python3 - "$REPO_ROOT/index.html" <<EOF
import re, sys
p = sys.argv[1]
s = open(p).read()
tags = """$(printf "$TAGS")"""
block = '<!-- DELTA-SCRIPTS-BEGIN\n         Dashie delta modules — INJECTED by scripts/vendor-core.sh from\n         delta-manifest.txt. Do not hand-edit this block. -->\n' + tags + '    <!-- DELTA-SCRIPTS-END -->'
s2 = re.sub(r'<!-- DELTA-SCRIPTS-BEGIN.*DELTA-SCRIPTS-END -->', block, s, flags=re.S)
assert s2 != s, 'DELTA-SCRIPTS markers not found in vendored index.html'
open(p, 'w').write(s2)
EOF

echo "==> Sanity gate" >&2
fail=0
for html in "$REPO_ROOT/index.html" "$REPO_ROOT/login/index.html"; do
    [ -f "$html" ] || continue
    base="$(dirname "$html")"
    while IFS= read -r src; do
        [[ "$src" == http* ]] && continue
        rel="${src%%\?*}"
        [ -f "$base/$rel" ] || { echo "❌ dangling <script src=\"$src\"> in ${html#$REPO_ROOT/}" >&2; fail=1; }
    done < <(grep -o 'script src="[^"]*"' "$html" | sed 's/script src="//; s/"$//')
done
for d in "${DELTA_PATHS[@]}"; do
    [ -f "$REPO_ROOT/$d" ] || { echo "❌ delta file missing: $d" >&2; fail=1; }
done

# Delta → core API drift. The delta calls into FeatureGate across a repo
# boundary held together by nothing but convention, so a core rename lands here
# as an uncaught TypeError at render time, in a file the core's own gates never
# look at. That is not hypothetical: b9439ee (2026-07-30) renamed
# isChickadeeBuild() -> isPublishedBuild() in the core and left FIVE delta call
# sites invoking the deleted method — subscribe-gate, subscription-status, and
# account-plan x3 — every one of which would have thrown on the next vendor.
# node --check cannot see it (the syntax is fine); check-console-tree.sh cannot
# see it (it inspects the PUBLIC tree, and these files exist only here).
python3 - "$REPO_ROOT" "$CORE/js/lib/feature-gate.js" "${DELTA_PATHS[@]}" <<'PYEOF' || fail=1
import re, sys, os
root, gate_path, *delta = sys.argv[1:]
gate = open(gate_path).read()
# Members as declared in the object literal: `name() {` or `NAME: value`.
declared = set(re.findall(r'^\s{4}([A-Za-z_][A-Za-z0-9_]*)\s*[(:]', gate, re.M))
bad = []
for rel in delta:
    p = os.path.join(root, rel)
    if not os.path.isfile(p):
        continue
    for i, line in enumerate(open(p), 1):
        if line.lstrip().startswith(('//', '*')):
            continue
        for m in re.findall(r'FeatureGate\.([A-Za-z_][A-Za-z0-9_]*)', line):
            if m not in declared:
                bad.append(f"{rel}:{i}: FeatureGate.{m} does not exist in the vendored core")
if bad:
    print("❌ delta calls a FeatureGate member the core does not declare:", file=sys.stderr)
    for b in bad:
        print("   " + b, file=sys.stderr)
    print("   Fix the DELTA call sites here (these files are delta-owned), or restore the\n"
          "   member in the public core. Do not hand-edit vendored files.", file=sys.stderr)
    sys.exit(1)
PYEOF
while IFS= read -r f; do
    node --check "$REPO_ROOT/$f" >/dev/null 2>&1 || { echo "❌ syntax: $f" >&2; fail=1; }
done < <(cd "$REPO_ROOT" && git diff --name-only -- 'js/**/*.js' 'js/*.js' | grep '\.js$' || true)
[ "$fail" -eq 0 ] || { echo "vendor-core: sanity gate FAILED" >&2; exit 1; }

echo "==> Vendored published console core @ $CORE_SHA (Dashie brand + delta overlay applied)" >&2
echo "$CORE_SHA"
