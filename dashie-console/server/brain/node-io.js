// server/brain/node-io.js — the Node (add-on) implementation of the brain's OrchestratorIO.
//
// Build plan §13.15/§13.16/§13.17 (on-prem L3). The brain CORE is shared (voice-brain.bundle.js,
// generated from the same TS the cloud Deno edge fn runs). This file is the add-on's I/O SHELL —
// the Node analog of the cloud's default-io.ts. The orchestrator takes its I/O injectable, so the
// loop logic is identical across runtimes; only these adapters differ (by design).
//
// ── Scope ──
// `callGateway` forwards the assembled prompt to a LAN model over an OpenAI-compatible endpoint
// (/v1/chat/completions) — L3's inference hop. `logInteraction`/`logWebSearch`/`logSports` mirror
// the cloud's logging.ts: they POST to database-operations under the account JWT so on-prem turns
// show up in the Console's interaction/intelligence log. A LOCAL model isn't in the cost catalog,
// so log_ai_interaction logs it but debits $0 (handleLogAIInteraction only debits when cost>0) —
// i.e. captured-but-free, per §11. Still STUBBED: web search / sports (tools land in M3; cloud
// SearXNG/sports later), personality (null = base prompt), retain transcripts (false).
// Target an OpenAI-compatible endpoint, NOT Ollama specifically (llama.cpp/LM Studio/vLLM/Ollama all
// expose /v1/chat/completions) — build plan §13.12.

const { SUPABASE } = require('../config');
const { getAccountVoiceConfig } = require('../account-config');

/** Fire-and-forget POST to the database-operations edge fn under the account JWT (mirrors the
 *  cloud brain's logging.ts). Never throws — logging must not break a turn. No token (anonymous
 *  M1 turn) → skip (nothing to attribute). */
async function postDbOp(token, operation, data) {
  if (!token) return;
  try {
    await fetch(`${SUPABASE.url}/functions/v1/database-operations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE.anonKey,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ operation, data }),
    });
  } catch { /* fire-and-forget */ }
}

/**
 * @param {object} opts
 * @param {string} opts.endpoint  Base URL of the LAN model server (no trailing /v1), e.g.
 *                                 http://localhost:11434 (Ollama) or http://localhost:8080 (llama.cpp).
 * @param {string} opts.model     Default model id when the caller doesn't pass one.
 * @param {function} [opts.log]   Optional logger (defaults to console.log).
 * @returns {object} an OrchestratorIO
 */
function createNodeIO({ endpoint, model, key = '', log = console.log }) {
  const chatUrl = String(endpoint).replace(/\/+$/, '') + '/v1/chat/completions';
  // BYO-model (WS-I): send a bearer when the account configured a key — required
  // for a Hermes API server or any remote OpenAI-compatible endpoint. Local
  // Ollama/llama.cpp usually need no key, so the header is omitted when blank.
  const authHeaders = key ? { Authorization: `Bearer ${key}` } : {};

  async function callGateway({ provider, prompt, modelId }) {
    const t0 = Date.now();
    const useModel = modelId || model;
    try {
      const resp = await fetch(chatUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
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
    // Capture on-prem turns in the Console (mirrors the cloud logging.ts). Local model = $0 debit.
    logInteraction: (token, data) => postDbOp(token, 'log_ai_interaction', data),
    logWebSearch: (token, data) => postDbOp(token, 'log_web_search', data),
    logSports: (token, data) => postDbOp(token, 'log_sports', data),
    getDefaultModel: async () => model,
    // Read the account's "Keep transcripts" opt-in so the brain retains the turn's
    // transcript. With the integration's caller-mode, the brain signals
    // metadata.retain_transcript → the integration stores it HA-locally → the Console
    // overlays it onto the interaction by session_id. Without this it was stuck false,
    // so local transcripts landed nowhere.
    readRetainTranscripts: async () => {
      try { return (await getAccountVoiceConfig()).retainTranscripts === true; }
      catch { return false; }
    },
  };
}

module.exports = { createNodeIO };
