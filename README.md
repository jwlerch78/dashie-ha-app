# Dashie for Home Assistant

Dashie HA add-on — browser-based control center for your Dashie family dashboard, plus voice pipeline broker and live-metrics bridge.

**Status:** Early development. Not yet available in HACS.

## Features (planned)

- **Control Center** — the full `dashieapp.com/console` UI, served from inside HA
- **Device metrics bridge** — live battery, RAM, WiFi, uptime surfaced in the console by polling HA entities and caching to Supabase
- **Voice pipeline broker** — expose Dashie's LLM / TTS / STT services to HA's native voice pipeline
- **MCP server** — Dashie family tools (calendar, chores, family info) available to any MCP client

## Development

```bash
git clone --recursive https://github.com/jwlerch78/dashie-ha-app.git
cd dashie-ha-app
npm install
npm run dev
# visit http://localhost:7123/
```

The `--recursive` flag pulls the `dashie-console` submodule under `frontend/dashie-console`. If you cloned without it:

```bash
git submodule update --init --recursive
```

## Architecture

Pure Node/Express server that:
- Serves the Dashie Console frontend (vendored as a git submodule)
- Handles OAuth exchange + JWT storage in `/data/dashie_auth.json` (persistent in HAOS add-on, or `./data/` for local dev)
- Reads HA's Supervisor token from `$SUPERVISOR_TOKEN` env var when running inside HAOS
- Polls HA's REST API for Dashie entity states and upserts metrics to the Dashie Supabase backend

The Python `custom_components/dashie/` HA integration remains unchanged — it provides entities; this add-on reads them.

## Licence

Proprietary. All rights reserved.
