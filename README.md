# Dashie Console for Home Assistant

Dashie Console — Home Assistant add-on that hosts the browser-based control center for your Dashie family dashboards, plus voice pipeline broker and live-metrics bridge.

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

## License

[MIT](LICENSE), and that is deliberate — see below.

### What MIT covers here, and why it is stated explicitly

This repository contains source that is **vendored in from a private repo** by
`scripts/release.sh` on every release:

| What | Where | Notes |
|---|---|---|
| Console frontend | `dashie-console/frontend/`, `dashie-console-dev/frontend/` | unminified source, comments intact |
| Node add-on server | `dashie-console/server/`, `dashie-console-dev/server/` | |
| Prompt builder | `…/frontend/dashie-console/js/lib/prompt-builder.js` | both channels |
| On-prem AI brain — TypeScript source and knowledge base | `dashie-console-dev/server/brain/src/` (39 files, incl. `_shared/tools/dashie-kb.generated.ts`) | **dev channel only.** The prod channel ships the built `voice-brain.bundle.js` without `src/` |

All of it originates in the private
[`dashie-console`](https://github.com/jwlerch78/dashie-console) repo.

**All of it is MIT, on purpose.** That vendoring started as a build-script side effect
rather than a decision, which left the code's license and our intent pointing in
different directions. Ratified 2026-07-30: the intent now matches the license. Nothing
is being retracted or reclassified, and no previously published snapshot changes.

Two things this does **not** mean:

- **MIT covers this source, not the hosted service.** The console and brain can talk to
  Dashie's backend, which is a separate, closed, metered service. The license grants you
  no rights to it and no claim on it. Running your own copy against your own
  infrastructure is your business; running it against ours is not covered.
- **It is not an invitation to contribute.** Read and fork freely — that is what MIT is
  for. Pull requests are not accepted. Issues are.

Copyright is retained, so future versions remain free to differ from what is published
here.
