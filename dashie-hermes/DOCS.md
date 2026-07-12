# Dashie Hermes Agent (Beta)

Runs [Hermes Agent](https://github.com/NousResearch/hermes-agent) — Nous Research's
open-source (MIT) personal AI agent — on your Home Assistant box, as a
**bring-your-own brain** for Dashie. Hermes keeps persistent memory and
self-built skills on your own hardware; Dashie keeps its cards, tools and
dialog. Only the model behind the brain changes — and it's yours.

## What you get

- Hermes's OpenAI-compatible API server on **port 8642**, bearer-protected
- Agent state (memory, skills, secrets) stored in the add-on data volume —
  survives add-on updates
- Zero Dashie credits for AI-model usage (managed STT/TTS stay metered if you
  use them)

## Setup

1. **Install and start this add-on.**
2. **Give Hermes a model.** Set one of the provider keys in the Configuration
   tab (`anthropic_api_key`, `openai_api_key`, or `openrouter_api_key`).
   Advanced: Hermes reads any of its supported settings from
   `/addon_configs`-style env — drop a full `.env` into the add-on's
   `/data/hermes/.env` (e.g. via the Studio Code Server or SSH add-on) for
   providers beyond the three surfaced options, including a local Ollama.
3. **Copy the API server key.** Leave `api_server_key` blank and the add-on
   generates one and prints it in the **Log** tab on every start. Or set your
   own in Configuration.
4. **Point Dashie at it** (in the Dashie Console add-on):
   - *Voice & AI → AI Model → Hermes Agent (self-hosted)* — set the endpoint
     URL to `http://homeassistant.local:8642` (or your HA box's IP).
   - *API Keys → Hermes* — paste the API server key from step 3.

## Notes & caveats

- **Beta.** The Dashie brain contract (short voice replies, tool JSON) is
  still being tuned against Hermes — expect rough edges in voice replies.
- **Security:** the API port is exposed on your LAN, protected by the bearer
  key. Hermes is a capable agent (terminal, files, web) — treat the key like a
  password. The Hermes dashboard (port 9119) is intentionally **not** exposed;
  it stores keys and has no auth.
- **Hardware:** no GPU needed; the agent itself is light. The model behind it
  is whatever your provider key (or local endpoint) supplies.
- **Nous Portal** (`hermes setup --portal`) is an interactive OAuth flow the
  add-on can't run headlessly yet — use a provider key, or run setup once via
  a shell inside the container (advanced).

## Ports

| Port | What |
|------|------|
| 8642 | OpenAI-compatible API (`/v1/chat/completions`, model id `hermes-agent`) — bearer required |
