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
const settingsStore = require('../settings-store');
const { createNodeIO } = require('../brain/node-io');
const brain = require('../brain/voice-brain.bundle.js');

const router = express.Router();

// LAN model target. OpenAI-compatible endpoint base (no trailing /v1). Defaults to Ollama on
// localhost for local dev; override per environment. (Account-level config move is Wave 2 / §16.7.)
const LOCAL_LLM_ENDPOINT = process.env.LOCAL_LLM_ENDPOINT || 'http://localhost:11434';
const LOCAL_LLM_MODEL = process.env.LOCAL_LLM_MODEL || 'qwen2.5:3b';

router.post('/converse-local', express.json(), async (req, res) => {
  // Gate on the household-sharing opt-in, consistent with /api/internal. NOTE: the local brain
  // spends NO account credits, so this gate may relax later — for M1 keep the endpoint closed.
  if (!settingsStore.isHouseholdSharingEnabled()) {
    return res.status(403).json({ error: 'sharing_disabled', message: 'Household sharing is off in the add-on.' });
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

  const model = (body.options && body.options.model) || LOCAL_LLM_MODEL;
  const io = createNodeIO({ endpoint: LOCAL_LLM_ENDPOINT, model });

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

// Tiny health/info probe — confirms the bundle loaded and which LAN model we'd hit.
router.get('/local-status', (req, res) => {
  res.json({
    ok: true,
    brain_source_sha: brain.BRAIN_SOURCE_SHA || null,
    endpoint: LOCAL_LLM_ENDPOINT,
    model: LOCAL_LLM_MODEL,
  });
});

module.exports = router;
