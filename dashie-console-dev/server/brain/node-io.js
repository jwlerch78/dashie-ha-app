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
// show up in the Console's interaction/intelligence log. The AI tokens run on the user's own
// key/model, so log_ai_interaction carries byok:true (recorded, never debited).
//
// TOOL PARITY (2026-07-13, "no technical reason BYOK shouldn't support all tools"):
//   - web search  → the SAME web-search-gateway edge fn the cloud brain's gather.ts hits
//                   (Tavily on Dashie's key). The core logs it via logWebSearch → the edge
//                   debit path, so Dashie-funded searches still bill credits on BYOK turns.
//   - sports      → bound straight from the brain bundle (pure keyless ESPN fetch).
//   - image search→ runs in the CORE (synthesizeImage → serper-image-search edge fn, which
//                   meters + bills itself); node-io supplies toolConn (no Deno env here).
//   - account config → getAccountVoiceConfig (ai.model/webSearchEnabled/retrievePictures),
//                   so the console toggles govern the add-on brain like the cloud one.
//   - credits     → checkSpendable reads the balance via get_credit_balance; with
//                   billing:'byok' the core does NOT reject an out-of-credits turn (the AI
//                   is free) — it disables the Dashie-funded tools for the turn instead.
// Still stubbed: personality (null = base prompt).
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
 * @param {string} [opts.endpoint]  Base URL of the LAN model server (no trailing /v1), e.g.
 *                                 http://localhost:11434 (Ollama) or http://localhost:8080 (llama.cpp).
 * @param {string} [opts.chatUrl]  FULL /chat/completions URL — overrides endpoint. Used by the
 *                                 BYOK cloud providers (providers.js), whose compat paths aren't
 *                                 uniformly /v1/chat/completions (Gemini's is /v1beta/openai/...).
 * @param {string} opts.model     Default model id when the caller doesn't pass one.
 * @param {string} [opts.providerLabel]  Human name ('OpenAI', 'Gemini', …) prefixed onto HTTP
 *                                 errors so a bad BYO key reads as "OpenAI: Incorrect API key…",
 *                                 attributing the failure to the user's provider, not Dashie.
 * @param {string} [opts.accountToken]  The account JWT for this request — used by
 *                                 checkSpendable (balance read). '' → fail-open spendable.
 * @param {function} [opts.log]   Optional logger (defaults to console.log).
 * @returns {object} an OrchestratorIO
 */
function createNodeIO({ endpoint, chatUrl: chatUrlOpt, model, key = '', providerLabel = '', accountToken = '', extraHeaders = {}, extraBody = {}, log = console.log }) {
  const chatUrl = chatUrlOpt || (String(endpoint).replace(/\/+$/, '') + '/v1/chat/completions');
  // BYO-model (WS-I): send a bearer when the account configured a key — required
  // for a Hermes API server or any remote OpenAI-compatible endpoint. Local
  // Ollama/llama.cpp usually need no key, so the header is omitted when blank.
  // extraHeaders carries provider-specific extras (OpenRouter's HTTP-Referer/X-Title).
  const authHeaders = { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...extraHeaders };

  // Sampling temperature by call INTENT, mirroring the cloud gateway.ts (see
  // 20260714_LOCAL_MODEL_BENCHMARK_RESULTS.md "DECIDE-vs-NARRATE"). A routing decision or an
  // ACTION emission is a classification — one right answer, so sample deterministically (0);
  // sending 0.7 made the same utterance route differently across runs. Prose synthesis keeps
  // warmth. Default 'narrate' preserves the prior 0.7 for any caller that doesn't declare intent.
  const TEMPERATURE = { decide: 0, narrate: 0.7 };

  async function callGateway({ provider, prompt, modelId, kind = 'narrate' }) {
    const t0 = Date.now();
    const useModel = modelId || model;
    try {
      const resp = await fetch(chatUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          model: useModel,
          messages: [{ role: 'user', content: prompt }],
          temperature: TEMPERATURE[kind] ?? 0.7,
          stream: false,
          // Optional per-endpoint extras (default {}). OpenRouter uses this for `provider`
          // routing prefs — pinning to one backend so temp-0 is reproducible (shared-GPU batching
          // across backends otherwise makes MoE inference non-bit-stable). Additive; production
          // passes nothing → unchanged.
          ...extraBody,
        }),
      });
      const body = await resp.json().catch(() => ({}));
      const latency_ms = Date.now() - t0;
      if (!resp.ok) {
        const error = body?.error?.message || body?.error || `HTTP ${resp.status}`;
        const msg = typeof error === 'string' ? error : JSON.stringify(error);
        return { ok: false, error: providerLabel ? `${providerLabel}: ${msg}` : msg, latency_ms };
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
          // 'local' for the on-box/Hermes rows; the provider name ('openai'/'gemini') for a
          // BYOK cloud key, so usage rows attribute the turn to the user's provider.
          provider: providerLabel ? providerLabel.toLowerCase() : 'local',
          latency: latency_ms,
        },
      };
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e), latency_ms: Date.now() - t0 };
    }
  }

  return {
    callGateway,
    // Web search: the SAME gateway edge fn the cloud brain's gather.ts calls (anon-key
    // request; the CORE bills it afterward via logWebSearch → the user's debit). Throws
    // on failure — the core's web_search branch already degrades a failed search.
    runWebSearch: async (query, opts = {}) => {
      const { provider = 'tavily', count = 10 } = opts;
      const t0 = Date.now();
      const resp = await fetch(`${SUPABASE.url}/functions/v1/web-search-gateway`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE.anonKey,
          Authorization: `Bearer ${SUPABASE.anonKey}`,
        },
        body: JSON.stringify({ provider, query, options: { count } }),
      });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(body.error || body.message || `HTTP ${resp.status}`);
      if (typeof body.latency !== 'number') body.latency = Date.now() - t0;
      return body;
    },
    // Sports: bound straight from the brain bundle (it calls the sports-gateway edge fn
    // — free/unbilled). Pass the Supabase conn explicitly: there is no Deno env here.
    // Falls back to the empty stub on an old bundle.
    runSports: async (query) => {
      const brain = require('./voice-brain.bundle.js');
      if (typeof brain.runSports === 'function') {
        return brain.runSports(query, { supabaseUrl: SUPABASE.url, anonKey: SUPABASE.anonKey });
      }
      return { provider: 'none', query, games: [], result_count: 0, latency: 0 };
    },
    // Personality (FB41): this was `async () => null` for the add-on's entire life — its comment
    // even said "Still stubbed" — so EVERY on-prem ("My Local LLM") turn ran the base prompt and a
    // household's chosen character (Santa, a princess in the kid's room, …) was silently dead on the
    // local route while the cloud brain applied it. Same class as the gateway defects: an
    // add-on/headless default applied to a real, personality-having tablet.
    //
    // Resolution is NOT reimplemented here — the device→account-default→UUID-vs-template→family-notes
    // chain is canonical in the brain's personality.ts and now re-exported from the bundle (like
    // runSports). node-io only supplies the credential: the ADD-ON's own account JWT (auth.getValidJwt
    // — the same identity account-config.js reads user_settings with), NOT the per-request token,
    // which is empty on an anon-kiosk turn. RLS scopes every read to that account; personality_templates
    // is a public catalog (is_available=true). Fails soft to null (= base prompt) on any error or an
    // old bundle, so it can never break a turn.
    resolvePersonality: async (_supabase, _reqUserId, endpointId, explicitId) => {
      try {
        const brain = require('./voice-brain.bundle.js');
        if (typeof brain.resolvePersonality !== 'function') return null; // old bundle → base prompt
        const auth = require('../auth');
        const { jwt, userId } = (await auth.getValidJwt()) || {};
        if (!jwt || !userId) return null; // not signed into an account → base prompt (unchanged)
        const { createClient } = require('@supabase/supabase-js');
        const client = createClient(SUPABASE.url, SUPABASE.anonKey, {
          global: { headers: { Authorization: `Bearer ${jwt}` } },
          auth: { persistSession: false, autoRefreshToken: false },
        });
        // The account's own userId + this device's endpointId — the per-device personality
        // (falls through to the account default when the device hasn't chosen one).
        return await brain.resolvePersonality(client, userId, endpointId, explicitId);
      } catch (e) {
        log?.('[node-io] resolvePersonality failed (→ base prompt):', e?.message || e);
        return null;
      }
    },
    // CR1 balance read for the BYOK tool gate. The core (billing:'byok') never rejects
    // the turn on !spendable — it just disables the Dashie-funded tools — so fail-open
    // here only risks a paid tool call that debitBalance floors later. get_credit_balance
    // is the same read the console uses.
    checkSpendable: async () => {
      const failOpen = { spendable: true, balance: Number.POSITIVE_INFINITY, floor: 0, low: false };
      if (!accountToken) return failOpen;
      try {
        const resp = await fetch(`${SUPABASE.url}/functions/v1/database-operations`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: SUPABASE.anonKey,
            Authorization: `Bearer ${accountToken}`,
          },
          body: JSON.stringify({ operation: 'get_credit_balance', data: {} }),
        });
        const body = await resp.json().catch(() => ({}));
        const balance = Number(body?.data?.balance ?? body?.balance);
        if (!resp.ok || !isFinite(balance)) return failOpen;
        return { spendable: balance > 0, balance, floor: 0, low: balance > 0 && balance < 1 };
      } catch { return failOpen; }
    },
    // Account tool toggles (T3 parity with the cloud brain's ai-settings.ts): without
    // this the core resolved retrieve_pictures to FALSE and the model hallucinated
    // "Here's a picture of Oslo" with no way to show one (2026-07-13). model stays null:
    // on this runtime the model is already resolved by voice-local (ai.model here can be
    // a routing sentinel like 'local'/'hermes', which must not leak into a turn).
    readAccountAiConfig: async () => {
      try {
        const a = await getAccountVoiceConfig();
        return {
          model: null,
          webSearchEnabled: a.webSearchEnabled ?? null,
          retrievePicturesEnabled: a.retrievePictures ?? null,
          zipCode: a.zipCode || null,
        };
      } catch {
        return { model: null, webSearchEnabled: null, retrievePicturesEnabled: null, zipCode: null };
      }
    },
    // BYOK billing mode + the Supabase connection for core-side tools (image search) —
    // there is no Deno env in Node, so the core must get the URL/key from here.
    billing: 'byok',
    toolConn: { supabaseUrl: SUPABASE.url, anonKey: SUPABASE.anonKey },
    // Capture on-prem turns in the Console (mirrors the cloud logging.ts). byok:true =
    // this brain runs on the user's own key/model, so the server records the row but
    // NEVER debits — required for cataloged model ids (a BYO Gemini key running
    // gemini-*-flash would otherwise bill Dashie credits), and it renders as
    // "model (API key)" in the usage views instead of a charge.
    logInteraction: (token, data) => postDbOp(token, 'log_ai_interaction', { ...data, byok: true }),
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
