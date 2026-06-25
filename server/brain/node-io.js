// server/brain/node-io.js — the Node (add-on) implementation of the brain's OrchestratorIO.
//
// Build plan §13.15/§13.16/§13.17 (on-prem L3). The brain CORE is shared (voice-brain.bundle.js,
// generated from the same TS the cloud Deno edge fn runs). This file is the add-on's I/O SHELL —
// the Node analog of the cloud's default-io.ts. The orchestrator takes its I/O injectable, so the
// loop logic is identical across runtimes; only these adapters differ (by design).
//
// ── Milestone 1 (walking skeleton) scope ──
// ONLY `callGateway` is real: it forwards the assembled prompt to a LAN model over an
// OpenAI-compatible endpoint (/v1/chat/completions). This is L3's inference hop — the one thing
// that proves the core runs on-prem against a local model. Everything else is a safe STUB:
//   - web search / sports → empty results (tools land in M3; the cloud SearXNG/sports come later)
//   - personality        → null (base prompt)
//   - logging/credits     → no-op (real metering lands with the credit mechanism)
//   - retain transcripts  → false
// Target an OpenAI-compatible endpoint, NOT Ollama specifically (llama.cpp/LM Studio/vLLM/Ollama all
// expose /v1/chat/completions) — build plan §13.12.

/**
 * @param {object} opts
 * @param {string} opts.endpoint  Base URL of the LAN model server (no trailing /v1), e.g.
 *                                 http://localhost:11434 (Ollama) or http://localhost:8080 (llama.cpp).
 * @param {string} opts.model     Default model id when the caller doesn't pass one.
 * @param {function} [opts.log]   Optional logger (defaults to console.log).
 * @returns {object} an OrchestratorIO
 */
function createNodeIO({ endpoint, model, log = console.log }) {
  const chatUrl = String(endpoint).replace(/\/+$/, '') + '/v1/chat/completions';

  async function callGateway({ provider, prompt, modelId }) {
    const t0 = Date.now();
    const useModel = modelId || model;
    try {
      const resp = await fetch(chatUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: useModel,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.7,
          stream: false,
        }),
      });
      const body = await resp.json().catch(() => ({}));
      const latency_ms = Date.now() - t0;
      if (!resp.ok) {
        const error = body?.error?.message || body?.error || `HTTP ${resp.status}`;
        return { ok: false, error: typeof error === 'string' ? error : JSON.stringify(error), latency_ms };
      }
      const content = body?.choices?.[0]?.message?.content ?? '';
      const u = body?.usage || {};
      return {
        ok: true,
        latency_ms,
        // Map OpenAI usage → the brain's GatewayRaw.usage shape (input/output/total).
        raw: {
          content,
          usage: {
            input_tokens: u.prompt_tokens,
            output_tokens: u.completion_tokens,
            total_tokens: u.total_tokens,
          },
          model: body?.model || useModel,
          provider: 'local',
          latency: latency_ms,
        },
      };
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e), latency_ms: Date.now() - t0 };
    }
  }

  return {
    callGateway,
    // ── Stubs (M1). Shapes match the brain's WebSearchResult / SportsResult so the loop never
    //    crashes even if a model emits a tool request; real impls land in M3. ──
    runWebSearch: async (query) => ({ provider: 'none', query, results: [], result_count: 0, latency: 0 }),
    runSports: async (query) => ({ provider: 'none', query, games: [], result_count: 0, latency: 0 }),
    resolvePersonality: async () => null,
    logInteraction: async () => {},
    logWebSearch: async () => {},
    logSports: async () => {},
    getDefaultModel: async () => model,
    readRetainTranscripts: async () => false,
  };
}

module.exports = { createNodeIO };
