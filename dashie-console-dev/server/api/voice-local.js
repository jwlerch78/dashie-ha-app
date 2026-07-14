// server/api/voice-local.js — the on-prem brain HTTP entry (Milestone 1, build plan §13.16/§13.17).
//
// POST /api/voice/converse-local  { text, conversation_id?, endpoint_id?, language?, options?, provided_context? }
//   → runs the SHARED brain core (voice-brain.bundle.js) with the Node I/O shell (node-io.js),
//     which forwards inference to a LAN model. Returns the brain's Turn { ok, type, voice, text, action, ... }.
//
// This is the add-on analog of the cloud edge fn's index.ts: it builds OrchestrationDeps and calls
// runOrchestration with the runtime's I/O. The cloud injects default-io.ts; here we inject node-io.
//
// M1 scope: transcript in → LAN model → text out. No integration routing, no tablet UI, no tools,
// no metering yet (those are M2+). The LAN endpoint/model come from env for now (config move = Wave 2).

const express = require('express');
const auth = require('../auth');
const { getAccountVoiceConfig } = require('../account-config');
const keyStore = require('../key-store');
const providers = require('../brain/providers');
const { createNodeIO } = require('../brain/node-io');
const brain = require('../brain/voice-brain.bundle.js');
const { detectVoiceEngines } = require('../voice-engines');

const router = express.Router();

// LAN model target. Resolution order: account config (Console "My Local LLM" → voice.localLlmUrl /
// voice.localLlmModel) → env override → built-in default. The account config is the productized
// path (§16.7); env stays as a local-dev / pre-config fallback.
const ENV_ENDPOINT = process.env.LOCAL_LLM_ENDPOINT || 'http://localhost:11434';
const ENV_MODEL = process.env.LOCAL_LLM_MODEL || 'qwen2.5:3b';

// Hermes Agent (ai.model='hermes', WS-I): its OpenAI-compat API server takes the fixed
// model id 'hermes-agent' (docs: website/docs/user-guide/features/api-server.md) and
// requires a bearer (API_SERVER_KEY) — read from the on-box key store, not user_settings.
const HERMES_MODEL_ID = 'hermes-agent';

/** Resolve the inference target for the account: the dedicated Hermes row, a BYOK cloud
 *  provider (Open Brain §5 — the account's cloud model + the box's stored key), or the
 *  generic own-endpoint row. One resolver so /converse-local and /local-status agree.
 *  BYOK with the key deleted between routing and the turn → source 'byok_key_missing'
 *  (explicit 503 in the handler — degradation rule WS-I.8, never a silent cloud fallback). */
function resolveLanTarget(acct) {
  if (acct.model === 'hermes') {
    return {
      endpoint: acct.hermesUrl || '',
      model: HERMES_MODEL_ID,
      key: keyStore.readKeys().hermes?.key || '',
      source: acct.hermesUrl ? 'hermes' : 'hermes_unconfigured',
    };
  }
  if (acct.model && acct.model !== 'local') {
    // A concrete cloud model id reached the local brain — that only happens when the route
    // resolver saw a BYO key for its provider (providers.js). Re-resolve it fresh.
    const byok = providers.resolveByokTarget(acct.model);
    if (byok) {
      return { endpoint: '', chatUrl: byok.chatUrl, model: acct.model, key: byok.key, providerLabel: byok.label, source: 'byok' };
    }
    return { endpoint: '', model: acct.model, key: '', source: 'byok_key_missing' };
  }
  return {
    endpoint: acct.localLlmUrl || ENV_ENDPOINT,
    model: acct.localLlmModel || ENV_MODEL,
    key: acct.localLlmKey || '',
    source: acct.localLlmUrl ? 'account' : 'env',
  };
}

router.post('/converse-local', express.json(), async (req, res) => {
  // Local inference stays on the LAN — nothing leaves the network and no account credential is
  // vended — so it does NOT need the household-sharing opt-in (that gates credential vending in
  // /api/internal). It only needs the add-on signed in, to read the account's saved local-LLM
  // endpoint/model config.
  if (!auth.readStoredJwt()) {
    return res.status(403).json({ error: 'not_signed_in', message: 'The Dashie add-on is not signed in.' });
  }

  const body = req.body || {};
  if (!body.text || typeof body.text !== 'string') {
    return res.status(400).json({ error: 'bad_request', message: 'text is required' });
  }

  // Account identity — used by logging/personality once those un-stub (M3). M1 tolerates
  // not-signed-in (the stubs ignore userId/token) so the skeleton is testable without login.
  let userId = 'local';
  let token = '';
  try {
    const j = await auth.getValidJwt();
    userId = j.userId || 'local';
    token = j.jwt || '';
  } catch { /* anonymous in M1 */ }

  // Resolve the LAN target: account config (Console) → env → default. Request options.model
  // still wins (per-turn override, e.g. the test harness).
  const acct = await getAccountVoiceConfig();
  const target = resolveLanTarget(acct);
  // Explicit errors, never a silent fallback to the metered cloud brain (WS-I.8).
  if (target.source === 'byok_key_missing') {
    return res.status(503).json({
      error: 'byok_key_missing',
      message: `No API key is stored for the ${acct.model} provider. Add it under Manage → API Keys, or pick a different AI model.`,
    });
  }
  if (!target.endpoint && !target.chatUrl) {
    return res.status(503).json({
      error: 'local_brain_unconfigured',
      message: 'Hermes is selected but no endpoint URL is set. Add it under Voice & AI → AI Model → Hermes Agent.',
    });
  }
  const model = (body.options && body.options.model) || target.model;
  const io = createNodeIO({
    endpoint: target.endpoint,
    chatUrl: target.chatUrl,
    model,
    key: target.key,
    providerLabel: target.providerLabel || '',
    accountToken: token,   // BYOK tool gate: checkSpendable reads the balance under the account
  });

  const brainReq = {
    text: body.text,
    conversation_id: body.conversation_id || null,
    endpoint_id: body.endpoint_id || 'local',
    language: body.language || 'system',
    options: { ...(body.options || {}), model },
    provided_context: body.provided_context || null,
    history: body.history || null,
  };

  try {
    const turn = await brain.runOrchestration({ req: brainReq, userId, token, supabase: null }, io);
    return res.json(turn);
  } catch (e) {
    console.error('[voice-local] brain error:', (e && e.stack) || e);
    return res.status(500).json({ error: 'brain_error', message: (e && e.message) || String(e) });
  }
});

// Tiny health/info probe — confirms the bundle loaded and which LAN model we'd hit (account
// config if set, else the env/default fallback).
router.get('/local-status', async (req, res) => {
  const acct = await getAccountVoiceConfig();
  const target = resolveLanTarget(acct);
  res.json({
    ok: true,
    brain_source_sha: brain.BRAIN_SOURCE_SHA || null,
    route: acct.route,
    route_reason: acct.routeReason || null,
    endpoint: target.chatUrl || target.endpoint,
    model: target.model,
    source: target.source,
    ...(target.providerLabel ? { provider: target.providerLabel } : {}),
    key_set: !!target.key,   // never the key itself
  });
});

// GET /api/voice/engines — which local STT/TTS engines does the user's HA have?
//   ?refresh=1  bypass the 5-min cache (Console "Re-scan")
//   ?debug=1    attach a `_debug` block with raw WS shapes (§4.3 validation)
// No sign-in gate: this reads HA config only (no account credential), and the
// Console needs it whether or not the add-on is signed into a Dashie account.
router.get('/engines', async (req, res) => {
  try {
    const result = await detectVoiceEngines({
      refresh: req.query.refresh === '1' || req.query.refresh === 'true',
      debug: req.query.debug === '1' || req.query.debug === 'true',
    });
    res.json(result);
  } catch (e) {
    console.error('[voice-local] engine detection failed:', (e && e.stack) || e);
    // Detection is best-effort — never 500 the picker; return an empty set so
    // the Console falls back to URL-based local_* rows.
    res.json({ available: false, tts: [], stt: [], kokoro: { installed: false, reason: 'error' }, hermes: { installed: false, reason: 'error' }, error: (e && e.message) || String(e) });
  }
});

// POST /api/voice/probe  { url, kind: 'tts' | 'stt' | 'llm' }
// Reachability test behind the Console's "Test" button on the own-box engine URL
// fields (Local TTS / Local Whisper / My own AI). Runs server-side because the
// browser can't hit a LAN engine cross-origin.
//
// It also RETURNS THE ENGINE'S OPTION LIST so the Console can turn the sibling
// free-text field (voice / model) into a dropdown — the same upgrade detection
// gives the Kokoro add-on (§5.3), extended to any own-box URL the user types:
//   tts → GET /v1/audio/voices  → { voices: [...] }  → options
//   llm → GET /v1/models (OpenAI) or /api/tags (Ollama) → options
//   stt → GET /v1/models, falling back to /health (whisper.cpp serves no model list)
// 5s timeout per path; never 500s — { ok, detail, options? } either way.
const PROBE_PATHS = {
  tts: ['/v1/audio/voices'],
  llm: ['/v1/models', '/api/tags'],
  stt: ['/v1/models', '/health'],
};

/** Pull an option list out of whatever shape the engine answered with:
 *  {voices:[…]} (Kokoro/piper-shim), {data:[{id}]} (OpenAI), {models:[{name}]} (Ollama). */
function extractOptions(j) {
  const norm = (v) => (typeof v === 'string'
    ? { value: v, label: v }
    : (v && (v.voice_id || v.id || v.name))
      ? { value: String(v.voice_id || v.id || v.name), label: String(v.name || v.voice_id || v.id) }
      : null);
  const list = Array.isArray(j?.voices) ? j.voices
    : Array.isArray(j?.data) ? j.data
    : Array.isArray(j?.models) ? j.models
    : null;
  if (!list) return null;
  const opts = list.map(norm).filter(Boolean);
  return opts.length ? opts : null;
}

router.post('/probe', express.json(), async (req, res) => {
  const { url, kind } = req.body || {};
  if (!/^https?:\/\//i.test(String(url || ''))) {
    return res.json({ ok: false, detail: 'enter a full http:// URL (with port)' });
  }
  const base = String(url).replace(/\/+$/, '');
  const paths = PROBE_PATHS[kind] || PROBE_PATHS.stt;
  const noun = kind === 'llm' ? 'model' : kind === 'tts' ? 'voice' : 'model';
  let lastDetail = 'no response';
  for (const p of paths) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 5000);
    try {
      const resp = await fetch(base + p, { signal: ctl.signal });
      clearTimeout(timer);
      if (resp.ok) {
        let detail = `HTTP ${resp.status}`;
        let options = null;
        try {
          const j = await resp.json();
          options = extractOptions(j);
          if (options) detail = `${options.length} ${noun}${options.length === 1 ? '' : 's'} found`;
        } catch (_) { /* non-JSON body is still a reachable server (e.g. /health) */ }
        return res.json({ ok: true, detail, ...(options ? { options } : {}) });
      }
      lastDetail = `HTTP ${resp.status} on ${p}`;
    } catch (e) {
      clearTimeout(timer);
      lastDetail = e?.name === 'AbortError' ? 'timed out (5s)' : (e?.cause?.code || e?.message || 'fetch failed');
    }
  }
  res.json({ ok: false, detail: lastDetail });
});

module.exports = router;
