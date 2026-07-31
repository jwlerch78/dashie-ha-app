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

[AGPL-3.0](LICENSE) as of 2026-07-30. Releases before that date were MIT — see below.

### What the license covers, and why this changed

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

That vendoring started as a build-script side effect rather than a decision, and it
carried MIT with it — which was never a choice anyone made. The same code is also
published under **AGPL-3.0** in
[dashie-ha](https://github.com/jwlerch78/dashie-ha) (the brain source is byte-identical
between the two). Two licenses on one codebase is not a posture; it is an accident with
a license attached.

**Resolved 2026-07-30 by moving this repo to AGPL-3.0**, matching `dashie-ha`. One
posture across everything we publish.

To be exact about what that does and does not do:

- **Releases made before 2026-07-30 were MIT and stay MIT.** A license already granted
  cannot be withdrawn, and we are not pretending otherwise. Anyone who took a copy under
  those terms keeps them.
- **From here on the terms are AGPL-3.0** — including its network-use clause. This is the
  more restrictive direction, so nobody loses a right they were exercising.
- **The license covers this source, not the hosted service.** The console and brain can
  talk to Dashie's backend, which is a separate, closed, metered service. Neither license
  grants you rights to it. Running your own copy against your own infrastructure is your
  business; running it against ours is not covered. What the cloud runs, and which parts
  of it are not published, is spelled out in
  [dashie-ha/PROVENANCE.md](https://github.com/jwlerch78/dashie-ha/blob/main/PROVENANCE.md).
- **It is not an invitation to contribute.** Read, fork, and self-host freely. Pull
  requests are not accepted. Issues are.
