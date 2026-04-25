# Dashie Hub for Home Assistant

Dashie Hub — Home Assistant add-on that hosts the browser-based control center for your Dashie family dashboards, plus voice pipeline broker and live-metrics bridge.

**Status:** Early development. Not yet available in HACS.

## Features (planned)

- **Control Center** — the full `dashieapp.com/console` UI, served from inside HA
- **Device metrics bridge** — live battery, RAM, WiFi, uptime surfaced in the console by polling HA entities and caching to Supabase
- **Voice pipeline broker** — expose Dashie's LLM / TTS / STT services to HA's native voice pipeline
- **MCP server** — Dashie family tools (calendar, chores, family info) available to any MCP client

## Development

```bash
git clone https://github.com/jwlerch78/dashie-ha-app.git
cd dashie-ha-app
npm install
npm run dev
# visit http://localhost:7123/
```

## Updating the bundled console

The frontend under `frontend/dashie-console/` is a vendored copy of the private
[`dashie-console`](https://github.com/jwlerch78/dashie-console) repo. It's vendored
(not a submodule) because HAOS has no credentials when it clones the add-on repo —
submodules to a private repo would fail at install time.

To pull in the latest console changes (requires a local clone of `dashie-console`
at `../dashie-console`):

```bash
./scripts/sync-console.sh
# Review staged changes, then:
git add frontend/dashie-console
git commit -m "Sync dashie-console to <sha>"
git push
```

## Architecture

Pure Node/Express server that:
- Serves the Dashie Console frontend (vendored copy at `frontend/dashie-console/`)
- Handles device-flow sign-in + JWT storage in `/data/dashie_auth.json` (persistent in HAOS add-on, or `./data/` for local dev)
- Reads HA's Supervisor token from `$SUPERVISOR_TOKEN` env var when running inside HAOS
- Polls HA's REST API for Dashie entity states and upserts metrics to the Dashie Supabase backend

The Python `custom_components/dashie/` HA integration remains unchanged — it provides entities; this add-on reads them.

## Licence

Proprietary. All rights reserved.
