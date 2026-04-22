#!/usr/bin/with-contenv bashio
# shellcheck shell=bash
set -euo pipefail

# Read add-on config options
LOG_LEVEL=$(bashio::config 'log_level' 'info')
SUPABASE_ENV=$(bashio::config 'supabase_env' 'development')

bashio::log.level "${LOG_LEVEL}"

bashio::log.info "============================================================"
bashio::log.info "Dashie HA Add-on starting"
bashio::log.info "============================================================"
bashio::log.info "Log level:     ${LOG_LEVEL}"
bashio::log.info "Supabase env:  ${SUPABASE_ENV}"
bashio::log.info "Supervisor:    $([ -n "${SUPERVISOR_TOKEN:-}" ] && echo 'present' || echo 'missing')"
bashio::log.info "Ingress port:  ${INGRESS_PORT:-8099}"
bashio::log.info "============================================================"

# Pass config into the Node process via env
export DASHIE_SUPABASE_ENV="${SUPABASE_ENV}"
export INGRESS_PORT="${INGRESS_PORT:-8099}"

cd /app
exec node server/index.js
