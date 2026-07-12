# Dashie Hermes Agent (Beta)

Self-hosted [Hermes Agent](https://github.com/NousResearch/hermes-agent) as
Dashie's bring-your-own brain. Thin add-on wrapper over the official
`nousresearch/hermes-agent` image: persistent `HERMES_HOME` on the add-on data
volume, options→env glue for provider keys, and a bearer-protected
OpenAI-compatible API on port 8642.

See [DOCS.md](DOCS.md) for setup. Pairs with *Voice & AI → AI Model → "Hermes
Agent"* and *API Keys → Hermes* in the Dashie Console.
