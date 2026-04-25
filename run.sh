#!/bin/sh
# Dashie Hub entrypoint.
# Reads config from /data/options.json (auto-mounted by HAOS Supervisor).

set -e

OPTIONS_FILE="/data/options.json"

# Defaults — overridden from /data/options.json if available.
LOG_LEVEL="info"
SUPABASE_ENV="development"

if [ -f "$OPTIONS_FILE" ]; then
    LOG_LEVEL=$(jq -r '.log_level // "info"' "$OPTIONS_FILE")
    SUPABASE_ENV=$(jq -r '.supabase_env // "development"' "$OPTIONS_FILE")
fi

echo "============================================================"
echo "Dashie Hub — run.sh"
echo "============================================================"
echo "Log level:       $LOG_LEVEL"
echo "Supabase env:    $SUPABASE_ENV"
echo "Ingress port:    ${INGRESS_PORT:-8099}"
echo "Supervisor tok:  $( [ -n "$SUPERVISOR_TOKEN" ] && echo 'present' || echo 'missing' )"
echo "Options file:    $( [ -f "$OPTIONS_FILE" ] && echo 'found' || echo 'missing' )"
echo "============================================================"

export DASHIE_SUPABASE_ENV="$SUPABASE_ENV"
export DASHIE_LOG_LEVEL="$LOG_LEVEL"
export INGRESS_PORT="${INGRESS_PORT:-8099}"

cd /app
exec node server/index.js
