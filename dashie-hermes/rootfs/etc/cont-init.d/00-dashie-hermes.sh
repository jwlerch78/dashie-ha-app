#!/command/with-contenv sh
# shellcheck shell=sh
# 00-dashie-hermes.sh — add-on glue, runs as root FIRST in s6 cont-init
# (alphabetical order — the image's own cont-init hooks must see our env,
# esp. HERMES_HOME, when they run; the hermes-user remap happens even
# earlier, in stage2-hook). Two jobs:
#
#  1. Data dir: point HERMES_HOME at /data/hermes (the HA add-on volume, which
#     survives add-on updates) instead of the image's anonymous /opt/data VOLUME.
#  2. Env staging: translate /data/options.json (the add-on Configuration tab)
#     into container env via /run/s6/container_environment/, which with-contenv
#     delivers to every service — the supported s6 mechanism, no schema games.
#
# API_SERVER_KEY: option value if set, else generate once and persist under
# /data/hermes (printed to the log so the user can copy it into Dashie's
# API Keys page). The key is mandatory — the API server is never exposed open.
set -e

ENVDIR=/run/s6/container_environment
OPTS=/data/options.json

mkdir -p /data/hermes
chown hermes:hermes /data/hermes 2>/dev/null || true

opt() { python3 -c "import json;v=json.load(open('$OPTS')).get('$1');print(v if v else '')" 2>/dev/null || true; }

# --- 1. Hermes state on the persistent volume ---
printf '%s' /data/hermes > "$ENVDIR/HERMES_HOME"

# --- 2. API server: always on, LAN-reachable, bearer-protected ---
printf '%s' true    > "$ENVDIR/API_SERVER_ENABLED"
printf '%s' 0.0.0.0 > "$ENVDIR/API_SERVER_HOST"

KEY="$(opt api_server_key)"
if [ -z "$KEY" ]; then
    KEYFILE=/data/hermes/.api_server_key
    if [ -f "$KEYFILE" ]; then
        KEY="$(cat "$KEYFILE")"
    else
        KEY="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
        umask 077
        printf '%s' "$KEY" > "$KEYFILE"
        chown hermes:hermes "$KEYFILE" 2>/dev/null || true
    fi
fi
printf '%s' "$KEY" > "$ENVDIR/API_SERVER_KEY"
echo "[dashie-hermes] API server on port 8642. Bearer key: $KEY"
echo "[dashie-hermes] Paste this key into Dashie Console -> API Keys -> Hermes."

# --- 3. Model-provider keys (optional; Hermes also reads /data/hermes/.env) ---
for pair in \
    anthropic_api_key:ANTHROPIC_API_KEY \
    openai_api_key:OPENAI_API_KEY \
    openrouter_api_key:OPENROUTER_API_KEY
do
    o="${pair%%:*}"; e="${pair##*:}"
    v="$(opt "$o")"
    [ -n "$v" ] && printf '%s' "$v" > "$ENVDIR/$e"
done

exit 0
